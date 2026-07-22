import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isDeepStrictEqual } from "node:util";

import { createApprovalRecord, readApprovalQueue, writeApprovalQueue } from "../src/data/delivery-system/approvalQueue";
import { acknowledgeIncident, prepareRepairPacket, readIncidentStore } from "../src/data/delivery-system/incidentStore";
import { recordOperationalIncident } from "../src/data/delivery-system/operationalIncidents";
import { isProjectConfigurationError, readProjectRegistry, resolveEnabledProject } from "../src/data/delivery-system/projectRegistry";
import { isRunRouteEligible } from "../src/data/delivery-system/runRouteEligibility";
import { createRunOrchestrator } from "../src/data/delivery-system/runOrchestrator";
import { readRunStore, resolveRunProfile, reviseRunDraft, type RunDraft, type RunDraftInput, type RunProvider, type RunRecord, type RunStatus } from "../src/data/delivery-system/runStore";
import { SUPPORTED_REASONING_EFFORTS, type RunProfile, type RunReasoningEffort } from "../src/data/delivery-system/executionProfile";
import { SupervisorQueue } from "../src/data/delivery-system/supervisorQueue";
import { TokenGateway } from "../src/data/delivery-system/tokenGateway";
import { assertRunPromptPolicy, canonicalRunTokenBudget } from "../src/data/delivery-system/runPromptPolicy";
import { dispatchHandoff } from "../src/governed-core/dispatch";
import {
  approvePromotion,
  buildPromotionPacket,
  markPromotionPublished,
  markPromotionRolledBack,
  readPromotionStore,
  recordPromotionVerification,
  rejectPromotion,
  type PromotionApproval,
  type PromotionPublishEvidence
} from "../src/data/delivery-system/promotionPacket";
import { withStateMaintenanceLock } from "../src/data/delivery-system/stateMaintenanceLock";

const MAX_BODY_BYTES = 64 * 1024;
const PROVIDERS = new Set<RunProvider>(["codex_cli", "claude_cli", "agy_cli", "openrouter_api"]);
const STATUSES = new Set<RunStatus>(["draft", "approved", "queued", "running", "completed", "failed", "cancelled"]);
const ID = "([A-Za-z0-9][A-Za-z0-9._-]{0,199})";
const ROUTES = {
  run: new RegExp(`^/runs/${ID}$`),
  revision: new RegExp(`^/runs/${ID}/revisions$`),
  approve: new RegExp(`^/runs/${ID}/approve$`),
  cancel: new RegExp(`^/runs/${ID}/cancel$`),
  promote: new RegExp(`^/runs/${ID}/promote$`),
  acknowledge: new RegExp(`^/incidents/${ID}/acknowledge$`),
  repair: new RegExp(`^/incidents/${ID}/repair-packet$`),
  promotion_approve: new RegExp(`^/promotions/${ID}/approve$`),
  promotion_reject: new RegExp(`^/promotions/${ID}/reject$`),
  promotion_verify: new RegExp(`^/promotions/${ID}/record-verification$`),
  promotion_publish: new RegExp(`^/promotions/${ID}/mark-published$`),
  promotion_rollback: new RegExp(`^/promotions/${ID}/mark-rolled-back$`)
};

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export async function handleControlPlaneRunRoute(
  request: IncomingMessage,
  response: ServerResponse,
  stateDir: string,
  suppliedOrchestrator?: ReturnType<typeof createRunOrchestrator>,
  projectRoot?: string,
  requestId = randomUUID()
): Promise<boolean> {
  const method = request.method ?? "";
  const path = new URL(request.url ?? "/", "http://control-plane.local").pathname;
  const match = matchRoute(method, path);
  if (match === null) return false;
  try {
    const orchestrator = suppliedOrchestrator ?? createRunOrchestrator({
      stateDir,
      ...(projectRoot === undefined ? {} : { projectRoot }),
      tokenGateway: new TokenGateway({ stateDir }),
      supervisor: new SupervisorQueue({ stateDir }),
      dispatch: (handoff, directory) => dispatchHandoff(handoff, directory, { reservationOwner: "caller" })
    });
    if (match.kind === "projects") return json(response, readProjectRegistry(stateDir).projects);
    if (match.kind === "runs") {
      const query = new URL(request.url ?? "/", "http://control-plane.local").searchParams;
      const status = query.get("status");
      if (status !== null && !STATUSES.has(status as RunStatus)) throw new HttpError(400, "invalid_run_status");
      const profile = query.get("profile");
      if (profile !== null && profile !== "dev" && profile !== "prod") throw new HttpError(400, "invalid_run_profile");
      let runs = readRunStore(stateDir).runs;
      if (status !== null) runs = runs.filter((run) => run.status === status);
      if (profile !== null) runs = runs.filter((run) => (run.current as { readonly profile?: string }).profile === profile);
      return json(response, runs);
    }
    if (match.kind === "run") {
      const run = readRunStore(stateDir).runs.find((candidate) => candidate.current.run_id === match.id);
      if (run === undefined) throw new HttpError(404, "run_not_found");
      return json(response, run);
    }
    if (match.kind === "incidents") return json(response, readIncidentStore(stateDir).incidents);
    if (match.kind === "promotions") return json(response, { packets: readPromotionStore(stateDir).packets });
    requireJsonContentType(request);
    const body = await readJsonBody(request);
    if (match.kind === "create") {
      if (body.profile === undefined) throw new HttpError(400, "run_profile_required");
      checkReasoningCapability(body);
      const input = draftInput(body);
      if (input.profile === "prod") return json(response, createProdDraft(stateDir, orchestrator, input, body.full_verification_ref), 201);
      return json(response, orchestrator.prepareRun(input), 201);
    }
    if (match.kind === "revision") {
      const revision = integer(body.revision, "invalid_run_revision");
      checkReasoningCapability(body);
      const input = draftInput(body);
      if (!routeAvailable(stateDir, input.provider, input.model)) throw new HttpError(409, "run_route_unavailable");
      const existing = readRunStore(stateDir).runs.find((run) => run.current.run_id === match.id);
      if (existing === undefined) throw new HttpError(404, "run_not_found");
      if (resolveRunProfile(existing) === "prod" || input.profile === "prod") {
        return json(response, reviseProdDraft(stateDir, match.id, revision, input, body.full_verification_ref, projectRoot), 201);
      }
      return json(response, reviseRunWithApproval(stateDir, match.id, revision, input, { ...(projectRoot === undefined ? {} : { projectRoot }) }), 201);
    }
    if (match.kind === "approve") return json(response, orchestrator.approveAndQueueRun(match.id, integer(body.revision, "invalid_run_revision"), nonEmpty(body.operator, "invalid_run_approval")));
    if (match.kind === "cancel") return json(response, orchestrator.cancelRun(match.id));
    if (match.kind === "promote") {
      const run = readRunStore(stateDir).runs.find((candidate) => candidate.current.run_id === match.id);
      if (run === undefined) throw new HttpError(404, "run_not_found");
      return json(response, buildPromotionPacket(stateDir, run, promoteInput(body), new Date().toISOString()), 201);
    }
    if (match.kind === "acknowledge") return json(response, acknowledgeIncident(stateDir, match.id, nonEmpty(body.owner, "invalid_incident_acknowledgement")));
    if (match.kind === "repair") return json(response, prepareRepairPacket(stateDir, match.id, repairInput(body)));
    if (match.kind === "promotion_approve") {
      return json(response, approvePromotion(stateDir, match.id, promotionApprovalInput(body), new Date().toISOString()));
    }
    if (match.kind === "promotion_reject") return json(response, rejectPromotion(stateDir, match.id, new Date().toISOString()));
    if (match.kind === "promotion_verify") {
      return json(response, recordPromotionVerification(stateDir, match.id, promotionEvidenceRef(body.full_verification_ref), new Date().toISOString()));
    }
    if (match.kind === "promotion_publish") {
      return json(response, publishPromotion(stateDir, match.id, publishEvidenceInput(body)));
    }
    if (match.kind === "promotion_rollback") return json(response, markPromotionRolledBack(stateDir, match.id, new Date().toISOString()));
    return false;
  } catch (error) {
    const known = knownHttpError(error);
    if (known !== null) return json(response, { error: known.code }, known.status);
    let incidentId: string = randomUUID();
    try {
      incidentId = recordOperationalIncident(stateDir, {
        stage: "control_plane_runs",
        correlation_ids: { request_id: requestId }
      }).incident_id;
    } catch { /* the response must remain stable when incident persistence is unavailable */ }
    return json(response, { error: "autopilot_internal_error", incident_id: incidentId, request_id: requestId }, 500);
  }
}

interface RevisionOperations {
  readonly revise?: typeof reviseRunDraft;
  readonly writeApprovals?: typeof writeApprovalQueue;
  readonly projectRoot?: string;
}

export function reviseRunWithApproval(stateDir: string, runId: string, expectedRevision: number, input: RunDraftInput, operations: RevisionOperations = {}): RunRecord {
  const revise = operations.revise ?? reviseRunDraft;
  const writeApprovals = operations.writeApprovals ?? writeApprovalQueue;
  resolveEnabledProject(stateDir, input.project_id, operations.projectRoot === undefined ? {} : { projectRoot: operations.projectRoot });
  const before = readRunStore(stateDir).runs.find((run) => run.current.run_id === runId);
  if (before === undefined) throw new Error("run_not_found");
  let draft: RunDraft;
  if (before.status === "draft" && before.current.revision === expectedRevision + 1 && sameDraftInput(before.current, input)) draft = before.current;
  else draft = revise(stateDir, runId, expectedRevision, input, new Date().toISOString(), operations.projectRoot === undefined ? {} : { projectRoot: operations.projectRoot });
  const queue = readApprovalQueue(stateDir);
  if (!queue.records.some((record) => record.run_id === runId && record.revision === draft.revision)) {
    const approval = createApprovalRecord({ approvalId: `run-approval-${draft.run_id}-${draft.revision}`, runId: draft.run_id, revision: draft.revision, sessionId: draft.run_id, vendor: draft.provider, ...(draft.model === null ? {} : { model: draft.model }), skillIds: [], prompt: draft.prompt, estimatedTokens: draft.estimated_tokens, inputTokenBound: draft.input_token_bound, outputTokenAllowance: draft.output_token_allowance, promptReviewAcknowledged: draft.prompt_review_acknowledged });
    writeApprovals(stateDir, { ...queue, records: [...queue.records, approval] });
  }
  return readRunStore(stateDir).runs.find((run) => run.current.run_id === runId)!;
}

type Route = { readonly kind: "projects" | "runs" | "create" | "incidents" | "promotions" } |
  { readonly kind: "run" | "revision" | "approve" | "cancel" | "promote" | "acknowledge" | "repair" |
    "promotion_approve" | "promotion_reject" | "promotion_verify" | "promotion_publish" | "promotion_rollback"; readonly id: string };

function matchRoute(method: string, path: string): Route | null {
  if (method === "GET" && path === "/projects") return { kind: "projects" };
  if (method === "GET" && path === "/runs") return { kind: "runs" };
  if (method === "POST" && path === "/runs") return { kind: "create" };
  if (method === "GET" && path === "/incidents") return { kind: "incidents" };
  if (method === "GET" && path === "/promotions") return { kind: "promotions" };
  for (const [kind, expression] of Object.entries(ROUTES) as [keyof typeof ROUTES, RegExp][]) {
    const match = expression.exec(path);
    if (match !== null && method === (kind === "run" ? "GET" : "POST")) return { kind, id: decodeURIComponent(match[1]!) };
  }
  return null;
}

function draftInput(body: Record<string, unknown>): RunDraftInput {
  if (typeof body.project_id !== "string" || typeof body.prompt !== "string" || !PROVIDERS.has(body.provider as RunProvider) ||
      body.model !== null && typeof body.model !== "string" || !Array.isArray(body.requested_artifacts)) throw new HttpError(400, "invalid_run_draft");
  const estimated = body.estimated_tokens === undefined ? canonicalRunTokenBudget(body.prompt) : body.estimated_tokens;
  try { assertRunPromptPolicy(body.prompt, body.prompt_review_acknowledged === true); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "invalid_run_draft"); }
  if (!Number.isSafeInteger(estimated)) throw new HttpError(400, "invalid_run_draft");
  if (body.profile !== undefined && body.profile !== "dev" && body.profile !== "prod") throw new HttpError(400, "invalid_run_draft");
  const profile: RunProfile = body.profile === undefined ? "dev" : body.profile;
  if (body.requested_reasoning_effort !== undefined && body.requested_reasoning_effort !== null && typeof body.requested_reasoning_effort !== "string") throw new HttpError(400, "invalid_run_draft");
  const requestedReasoningEffort: RunReasoningEffort | null = body.requested_reasoning_effort === undefined ? null : (body.requested_reasoning_effort as RunReasoningEffort | null);
  if (body.promotion_packet_id !== undefined && body.promotion_packet_id !== null && typeof body.promotion_packet_id !== "string") throw new HttpError(400, "invalid_run_draft");
  const promotionPacketId: string | null | undefined = body.promotion_packet_id as string | null | undefined;
  return { project_id: body.project_id, prompt: body.prompt, provider: body.provider as RunProvider, model: body.model, estimated_tokens: estimated as number, requested_artifacts: body.requested_artifacts as RunDraftInput["requested_artifacts"], prompt_review_acknowledged: body.prompt_review_acknowledged === true, profile, requested_reasoning_effort: requestedReasoningEffort, ...(promotionPacketId === undefined ? {} : { promotion_packet_id: promotionPacketId }) };
}

function checkReasoningCapability(body: Record<string, unknown>): void {
  const effort = body.requested_reasoning_effort;
  if (effort === undefined || effort === null || typeof effort !== "string") return;
  const provider = body.provider;
  if (typeof provider !== "string" || !PROVIDERS.has(provider as RunProvider)) return;
  const supported: readonly RunReasoningEffort[] = SUPPORTED_REASONING_EFFORTS[provider as RunProvider];
  if (!supported.includes(effort as RunReasoningEffort)) throw new HttpError(409, "unsupported_reasoning_effort");
}

function createProdDraft(
  stateDir: string,
  orchestrator: ReturnType<typeof createRunOrchestrator>,
  input: RunDraftInput,
  fullVerificationRef: unknown
): RunRecord {
  const packetId = input.promotion_packet_id;
  if (typeof packetId !== "string" || packetId.length === 0 || typeof fullVerificationRef !== "string" || fullVerificationRef.length === 0) {
    throw new HttpError(409, "promotion_evidence_required");
  }
  return withStateMaintenanceLock(stateDir, () => {
    const packet = readPromotionStore(stateDir).packets.find((candidate) => candidate.packet_id === packetId);
    if (packet === undefined) throw new HttpError(409, "promotion_not_found");
    const alreadyLinked = readRunStore(stateDir).runs.some((run) => run.current.promotion_packet_id === packetId);
    if (packet.status !== "approved" || !packet.approvals.some((approval) => approval.approver === "owner") || packet.prod_run_id !== null ||
      packet.full_verification_ref !== fullVerificationRef || alreadyLinked) {
      throw new HttpError(409, "promotion_not_ready");
    }
    return orchestrator.prepareRun(input);
  });
}

function reviseProdDraft(
  stateDir: string,
  runId: string,
  revision: number,
  input: RunDraftInput,
  fullVerificationRef: unknown,
  projectRoot: string | undefined
): RunRecord {
  return withStateMaintenanceLock(stateDir, () => {
    const existing = readRunStore(stateDir).runs.find((run) => run.current.run_id === runId);
    const packetId = existing?.current.promotion_packet_id;
    if (existing === undefined || resolveRunProfile(existing) !== "prod" || input.profile !== "prod" ||
      typeof packetId !== "string" || input.promotion_packet_id !== packetId ||
      typeof fullVerificationRef !== "string" || fullVerificationRef.length === 0) {
      throw new HttpError(409, "promotion_not_ready");
    }
    const packet = readPromotionStore(stateDir).packets.find((candidate) => candidate.packet_id === packetId);
    const duplicate = readRunStore(stateDir).runs.some((run) => run.current.run_id !== runId && run.current.promotion_packet_id === packetId);
    if (packet === undefined || packet.status !== "approved" || !packet.approvals.some((approval) => approval.approver === "owner") ||
      packet.prod_run_id !== null || packet.full_verification_ref !== fullVerificationRef || duplicate) {
      throw new HttpError(409, "promotion_not_ready");
    }
    return reviseRunWithApproval(stateDir, runId, revision, input, { ...(projectRoot === undefined ? {} : { projectRoot }) });
  });
}

function publishPromotion(stateDir: string, packetId: string, evidence: PromotionPublishEvidence): ReturnType<typeof markPromotionPublished> {
  const run = readRunStore(stateDir).runs.find((candidate) => candidate.current.run_id === evidence.prod_run_id);
  if (run === undefined || run.status !== "completed" || (run.current as { readonly profile?: string }).profile !== "prod" ||
    run.current.promotion_packet_id !== packetId) {
    throw new HttpError(409, "promotion_not_ready");
  }
  return markPromotionPublished(stateDir, packetId, evidence, new Date().toISOString());
}

function promoteInput(body: Record<string, unknown>): { readonly intent: string; readonly diff_summary: string; readonly tests: readonly string[]; readonly risks: readonly string[] } {
  if (typeof body.intent !== "string" || typeof body.diff_summary !== "string" ||
    !isStringArray(body.tests) || !isStringArray(body.risks)) throw new HttpError(409, "invalid_promotion_packet");
  return { intent: body.intent, diff_summary: body.diff_summary, tests: body.tests, risks: body.risks };
}

function promotionApprovalInput(body: Record<string, unknown>): PromotionApproval {
  // The current bearer/session contract has no principal object. Until it does,
  // accept only the canonical owner operator and persist that server-side value.
  if (body.approver !== "owner" || typeof body.review_ref !== "string") throw new HttpError(409, "promotion_not_approved");
  return { approver: "owner", review_ref: body.review_ref, approved_at: new Date().toISOString() };
}

function publishEvidenceInput(body: Record<string, unknown>): PromotionPublishEvidence {
  if (typeof body.prod_run_id !== "string" || typeof body.full_verification_ref !== "string" ||
    typeof body.release_acceptance_ref !== "string" || typeof body.rollback_ref !== "string") throw new HttpError(409, "promotion_evidence_required");
  return { prod_run_id: body.prod_run_id, full_verification_ref: body.full_verification_ref, release_acceptance_ref: body.release_acceptance_ref, rollback_ref: body.rollback_ref };
}

function promotionEvidenceRef(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000) throw new HttpError(409, "promotion_evidence_required");
  return value;
}

function repairInput(body: Record<string, unknown>) {
  if (typeof body.expected !== "string" || typeof body.actual !== "string" || body.reproduction_steps !== undefined && !isStringArray(body.reproduction_steps) || body.verification_commands !== undefined && !isStringArray(body.verification_commands)) throw new HttpError(400, "invalid_repair_packet");
  return { expected: body.expected, actual: body.actual, ...(body.reproduction_steps === undefined ? {} : { reproduction_steps: body.reproduction_steps as string[] }), ...(body.verification_commands === undefined ? {} : { verification_commands: body.verification_commands as string[] }) };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request_body_too_large");
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, "invalid_json_body"); }
}

function requireJsonContentType(request: IncomingMessage): void {
  const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") throw new HttpError(415, "unsupported_media_type");
}

function knownHttpError(error: unknown): HttpError | null {
  if (error instanceof HttpError) return error;
  const code = error instanceof Error ? error.message : "";
  if (["project_not_found", "run_not_found", "incident_not_found", "approval_not_found"].includes(code)) return new HttpError(404, code);
  if (isProjectConfigurationError(error)) return new HttpError(409, code);
  if ([
    "run_revision_conflict", "run_route_unavailable", "invalid_run_cancellation", "approval_already_decided", "approval_not_approved",
    "token_input_cap_exceeded", "token_output_cap_exceeded", "token_budget_exhausted", "token_route_mismatch", "token_reservation_limit",
    "run_limit", "run_revision_limit", "unsupported_reasoning_effort", "promotion_source_not_completed", "promotion_source_not_dev",
    "promotion_limit", "invalid_promotion_transition", "promotion_not_approved", "promotion_evidence_required", "promotion_not_ready",
    "promotion_verification_mismatch", "promotion_not_published", "promotion_not_found", "invalid_promotion_packet", "invalid_promotion_store"
  ].includes(code)) return new HttpError(409, code);
  if (code === "repair_packet_too_large") return new HttpError(413, code);
  if ([
    "invalid_run_draft", "invalid_run_approval", "invalid_incident", "run_prompt_token_cap_exceeded", "run_prompt_review_required",
    "run_token_budget_underestimated", "run_profile_required", "invalid_run_profile"
  ].includes(code)) return new HttpError(400, code);
  return null;
}

function integer(value: unknown, code: string): number { if (!Number.isSafeInteger(value) || (value as number) < 1) throw new HttpError(400, code); return value as number; }
function nonEmpty(value: unknown, code: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 200) throw new HttpError(400, code); return value; }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function routeAvailable(stateDir: string, provider: string, model: string | null): boolean {
  return isRunRouteEligible(stateDir, provider, model, new Date().toISOString());
}
function sameDraftInput(draft: RunDraft, input: RunDraftInput): boolean {
  return isDeepStrictEqual({ project_id: draft.project_id, prompt: draft.prompt, provider: draft.provider, model: draft.model, estimated_tokens: draft.estimated_tokens, requested_artifacts: draft.requested_artifacts, prompt_review_acknowledged: draft.prompt_review_acknowledged, profile: draft.profile, requested_reasoning_effort: draft.requested_reasoning_effort, promotion_packet_id: draft.promotion_packet_id }, { project_id: input.project_id, prompt: input.prompt, provider: input.provider, model: input.model, estimated_tokens: canonicalRunTokenBudget(input.prompt), requested_artifacts: input.requested_artifacts, prompt_review_acknowledged: input.prompt_review_acknowledged === true, profile: input.profile, requested_reasoning_effort: input.requested_reasoning_effort, promotion_packet_id: input.promotion_packet_id ?? null });
}
function json(response: ServerResponse, value: unknown, status = 200): true { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value, null, 2)); return true; }
