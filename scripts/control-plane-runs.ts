import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isDeepStrictEqual } from "node:util";

import { createApprovalRecord, readApprovalQueue, writeApprovalQueue } from "../src/data/delivery-system/approvalQueue";
import { acknowledgeIncident, prepareRepairPacket, readIncidentStore, recordAutopilotIncident } from "../src/data/delivery-system/incidentStore";
import { isProjectConfigurationError, readProjectRegistry, resolveEnabledProject } from "../src/data/delivery-system/projectRegistry";
import { isRunRouteEligible } from "../src/data/delivery-system/runRouteEligibility";
import { createRunOrchestrator } from "../src/data/delivery-system/runOrchestrator";
import { readRunStore, reviseRunDraft, type RunDraft, type RunDraftInput, type RunProvider, type RunRecord, type RunStatus } from "../src/data/delivery-system/runStore";
import { SupervisorQueue } from "../src/data/delivery-system/supervisorQueue";
import { TokenGateway } from "../src/data/delivery-system/tokenGateway";
import { assertRunPromptPolicy, canonicalRunTokenBudget } from "../src/data/delivery-system/runPromptPolicy";
import { dispatchHandoff } from "../src/governed-core/dispatch";

const MAX_BODY_BYTES = 64 * 1024;
const PROVIDERS = new Set<RunProvider>(["codex_cli", "claude_cli", "agy_cli", "openrouter_api"]);
const STATUSES = new Set<RunStatus>(["draft", "approved", "queued", "running", "completed", "failed", "cancelled"]);
const ID = "([A-Za-z0-9][A-Za-z0-9._-]{0,199})";
const ROUTES = {
  run: new RegExp(`^/runs/${ID}$`),
  revision: new RegExp(`^/runs/${ID}/revisions$`),
  approve: new RegExp(`^/runs/${ID}/approve$`),
  cancel: new RegExp(`^/runs/${ID}/cancel$`),
  acknowledge: new RegExp(`^/incidents/${ID}/acknowledge$`),
  repair: new RegExp(`^/incidents/${ID}/repair-packet$`)
};

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export async function handleControlPlaneRunRoute(request: IncomingMessage, response: ServerResponse, stateDir: string, suppliedOrchestrator?: ReturnType<typeof createRunOrchestrator>, projectRoot?: string): Promise<boolean> {
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
      const status = new URL(request.url ?? "/", "http://control-plane.local").searchParams.get("status");
      if (status !== null && !STATUSES.has(status as RunStatus)) throw new HttpError(400, "invalid_run_status");
      const runs = readRunStore(stateDir).runs;
      return json(response, status === null ? runs : runs.filter((run) => run.status === status));
    }
    if (match.kind === "run") {
      const run = readRunStore(stateDir).runs.find((candidate) => candidate.current.run_id === match.id);
      if (run === undefined) throw new HttpError(404, "run_not_found");
      return json(response, run);
    }
    if (match.kind === "incidents") return json(response, readIncidentStore(stateDir).incidents);
    requireJsonContentType(request);
    const body = await readJsonBody(request);
    if (match.kind === "create") return json(response, orchestrator.prepareRun(draftInput(body)), 201);
    if (match.kind === "revision") {
      const revision = integer(body.revision, "invalid_run_revision");
      const input = draftInput(body);
      if (!routeAvailable(stateDir, input.provider, input.model)) throw new HttpError(409, "run_route_unavailable");
      return json(response, reviseRunWithApproval(stateDir, match.id, revision, input, { ...(projectRoot === undefined ? {} : { projectRoot }) }), 201);
    }
    if (match.kind === "approve") return json(response, orchestrator.approveAndQueueRun(match.id, integer(body.revision, "invalid_run_revision"), nonEmpty(body.operator, "invalid_run_approval")));
    if (match.kind === "cancel") return json(response, orchestrator.cancelRun(match.id));
    if (match.kind === "acknowledge") return json(response, acknowledgeIncident(stateDir, match.id, nonEmpty(body.owner, "invalid_incident_acknowledgement")));
    if (match.kind === "repair") return json(response, prepareRepairPacket(stateDir, match.id, repairInput(body)));
    return false;
  } catch (error) {
    const known = knownHttpError(error);
    if (known !== null) return json(response, { error: known.code }, known.status);
    let incidentId: string = randomUUID();
    try {
      incidentId = recordAutopilotIncident(stateDir, { severity: "high", stage: "control_plane_http", summary: "Unexpected control plane route failure", correlation_ids: {}, impact: "The requested control plane operation did not complete", retry_count: 0, event_refs: [] }).incident_id;
    } catch { /* the response must remain stable when incident persistence is unavailable */ }
    return json(response, { error: "autopilot_internal_error", incident_id: incidentId }, 500);
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

type Route = { readonly kind: "projects" | "runs" | "create" | "incidents" } | { readonly kind: "run" | "revision" | "approve" | "cancel" | "acknowledge" | "repair"; readonly id: string };

function matchRoute(method: string, path: string): Route | null {
  if (method === "GET" && path === "/projects") return { kind: "projects" };
  if (method === "GET" && path === "/runs") return { kind: "runs" };
  if (method === "POST" && path === "/runs") return { kind: "create" };
  if (method === "GET" && path === "/incidents") return { kind: "incidents" };
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
  return { project_id: body.project_id, prompt: body.prompt, provider: body.provider as RunProvider, model: body.model, estimated_tokens: estimated as number, requested_artifacts: body.requested_artifacts as RunDraftInput["requested_artifacts"], prompt_review_acknowledged: body.prompt_review_acknowledged === true };
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
  if (["run_revision_conflict", "run_route_unavailable", "invalid_run_cancellation", "approval_already_decided", "approval_not_approved", "token_input_cap_exceeded", "token_output_cap_exceeded", "token_budget_exhausted", "token_route_mismatch", "token_reservation_limit", "run_limit", "run_revision_limit"].includes(code)) return new HttpError(409, code);
  if (code === "repair_packet_too_large") return new HttpError(413, code);
  if (["invalid_run_draft", "invalid_run_approval", "invalid_incident", "run_prompt_token_cap_exceeded", "run_prompt_review_required", "run_token_budget_underestimated"].includes(code)) return new HttpError(400, code);
  return null;
}

function integer(value: unknown, code: string): number { if (!Number.isSafeInteger(value) || (value as number) < 1) throw new HttpError(400, code); return value as number; }
function nonEmpty(value: unknown, code: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 200) throw new HttpError(400, code); return value; }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function routeAvailable(stateDir: string, provider: string, model: string | null): boolean {
  return isRunRouteEligible(stateDir, provider, model, new Date().toISOString());
}
function sameDraftInput(draft: RunDraft, input: RunDraftInput): boolean {
  return isDeepStrictEqual({ project_id: draft.project_id, prompt: draft.prompt, provider: draft.provider, model: draft.model, estimated_tokens: draft.estimated_tokens, requested_artifacts: draft.requested_artifacts, prompt_review_acknowledged: draft.prompt_review_acknowledged }, { ...input, estimated_tokens: canonicalRunTokenBudget(input.prompt), prompt_review_acknowledged: input.prompt_review_acknowledged === true });
}
function json(response: ServerResponse, value: unknown, status = 200): true { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value, null, 2)); return true; }
