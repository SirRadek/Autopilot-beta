import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { estimateBrainstormTokenEnvelope } from "../src/data/delivery-system/brainstormBudget";
import { createBrainstormCoordinator } from "../src/data/delivery-system/brainstormCoordinator";
import { createBrainstorm, readBrainstormStore, type BrainstormCreateInput, type BrainstormRecord, type BrainstormRoute } from "../src/data/delivery-system/brainstormStore";
import { recordBrainstormTelemetryLifecycle } from "../src/data/delivery-system/brainstormTelemetry";
import { SUPPORTED_REASONING_EFFORTS, type RunReasoningEffort } from "../src/data/delivery-system/executionProfile";
import { isProjectConfigurationError, resolveEnabledProject } from "../src/data/delivery-system/projectRegistry";
import { createRunOrchestrator } from "../src/data/delivery-system/runOrchestrator";
import { isRunRouteEligible } from "../src/data/delivery-system/runRouteEligibility";
import type { RunProvider } from "../src/data/delivery-system/runStore";
import { recordOperationalIncident } from "../src/data/delivery-system/operationalIncidents";

const MAX_BODY_BYTES = 64 * 1024;
const PROVIDERS = new Set<RunProvider>(["codex_cli", "claude_cli", "agy_cli", "openrouter_api"]);
const ID = "([A-Za-z0-9][A-Za-z0-9._:-]{0,255})";
const BRAINSTORM_ROUTE = new RegExp(`^/brainstorms/${ID}$`);
const APPROVE_ROUTE = new RegExp(`^/brainstorms/${ID}/approve$`);
const ARBITRATE_ROUTE = new RegExp(`^/brainstorms/${ID}/arbitrate$`);
const CANCEL_ROUTE = new RegExp(`^/brainstorms/${ID}/cancel$`);
const MAX_BRIEF_CHARS = 32_000;
const MAX_MODEL_CHARS = 256;
const MAX_OPERATOR_CHARS = 200;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export async function handleControlPlaneBrainstormRoute(
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
    if (match.kind === "list") return json(response, readBrainstormStore(stateDir).brainstorms);
    if (match.kind === "get") {
      const record = readBrainstormStore(stateDir).brainstorms.find((candidate) => candidate.brainstorm_id === match.id);
      if (record === undefined) throw new HttpError(404, "brainstorm_not_found");
      return json(response, record);
    }
    requireJsonContentType(request);
    const body = await readJsonBody(request);
    if (match.kind === "create") {
      const input = brainstormCreateInput(stateDir, body, projectRoot);
      const record = createBrainstorm(stateDir, input, new Date().toISOString());
      recordBrainstormTelemetryLifecycle(stateDir, record, [], "created", record.created_at);
      return json(response, record, 201);
    }
    if (match.kind !== "approve" && match.kind !== "arbitrate" && match.kind !== "cancel") return false;
    const actionId = match.id;
    if (readBrainstormStore(stateDir).brainstorms.every((candidate) => candidate.brainstorm_id !== actionId)) throw new HttpError(404, "brainstorm_not_found");
    if (suppliedOrchestrator === undefined) throw new Error("brainstorm_orchestrator_unavailable");
    const coordinator = createBrainstormCoordinator({ stateDir, runOrchestrator: suppliedOrchestrator });
    if (match.kind === "approve") return json(response, coordinator.approve(match.id, operatorInput(body)));
    if (match.kind === "arbitrate") return json(response, coordinator.requestArbitration(match.id, routeInput(stateDir, body.route), operatorInput(body)));
    return json(response, coordinator.cancel(match.id));
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

type Route = { readonly kind: "list" | "create" } | { readonly kind: "get" | "approve" | "arbitrate" | "cancel"; readonly id: string };

function matchRoute(method: string, path: string): Route | null {
  if (method === "GET" && path === "/brainstorms") return { kind: "list" };
  if (method === "POST" && path === "/brainstorms") return { kind: "create" };
  const getMatch = BRAINSTORM_ROUTE.exec(path);
  if (getMatch !== null && method === "GET") return { kind: "get", id: decodeURIComponent(getMatch[1]!) };
  const approveMatch = APPROVE_ROUTE.exec(path);
  if (approveMatch !== null && method === "POST") return { kind: "approve", id: decodeURIComponent(approveMatch[1]!) };
  const arbitrateMatch = ARBITRATE_ROUTE.exec(path);
  if (arbitrateMatch !== null && method === "POST") return { kind: "arbitrate", id: decodeURIComponent(arbitrateMatch[1]!) };
  const cancelMatch = CANCEL_ROUTE.exec(path);
  if (cancelMatch !== null && method === "POST") return { kind: "cancel", id: decodeURIComponent(cancelMatch[1]!) };
  return null;
}

function operatorInput(body: Record<string, unknown>): string {
  if (typeof body.operator !== "string" || body.operator.length > MAX_OPERATOR_CHARS) throw new HttpError(400, "invalid_brainstorm_action");
  return body.operator;
}

function routeInput(stateDir: string, value: unknown): BrainstormRoute {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "invalid_brainstorm_action");
  const record = value as Record<string, unknown>;
  if (!PROVIDERS.has(record.provider as RunProvider) || !boundedString(record.model, MAX_MODEL_CHARS) ||
    !Number.isSafeInteger(record.estimated_tokens) || (record.estimated_tokens as number) <= 0) {
    throw new HttpError(400, "invalid_brainstorm_action");
  }
  const provider = record.provider as RunProvider;
  const model = record.model as string;
  if (record.reasoning_effort !== null && typeof record.reasoning_effort !== "string") throw new HttpError(400, "invalid_brainstorm_action");
  const reasoningEffort = record.reasoning_effort as RunReasoningEffort | null;
  const supported: readonly RunReasoningEffort[] = SUPPORTED_REASONING_EFFORTS[provider];
  if (supported.length === 0 ? reasoningEffort !== null : reasoningEffort === null || !supported.includes(reasoningEffort)) {
    throw new HttpError(409, "unsupported_reasoning_effort");
  }
  checkRouteEligible(stateDir, provider, model);
  return {
    provider,
    model,
    reasoning_effort: reasoningEffort,
    estimated_tokens: record.estimated_tokens as number
  };
}

function brainstormCreateInput(stateDir: string, body: Record<string, unknown>, projectRoot: string | undefined): BrainstormCreateInput {
  if (typeof body.project_id !== "string") throw new HttpError(400, "invalid_brainstorm_draft");
  resolveEnabledProject(stateDir, body.project_id, projectRoot === undefined ? {} : { projectRoot });
  if (!boundedString(body.brief, MAX_BRIEF_CHARS)) throw new HttpError(400, "invalid_brainstorm_draft");
  if (body.profile !== undefined && body.profile !== "dev") throw new HttpError(400, "invalid_brainstorm_draft");
  if (!Array.isArray(body.routes) || body.routes.length < 3 || body.routes.length > 4) throw new HttpError(400, "invalid_brainstorm_draft");
  const routeDrafts = body.routes.map((route) => routeDraft(route));
  if (new Set(routeDrafts.map((route) => route.provider)).size !== routeDrafts.length) throw new HttpError(400, "invalid_brainstorm_draft");
  for (const route of routeDrafts) checkRouteEligible(stateDir, route.provider, route.model);
  if (typeof body.synthesizer !== "string" || !PROVIDERS.has(body.synthesizer as RunProvider)) throw new HttpError(400, "invalid_brainstorm_draft");
  const synthesizerSource = routeDrafts.find((route) => route.provider === body.synthesizer);
  if (synthesizerSource === undefined) throw new HttpError(400, "invalid_brainstorm_draft");
  if (!Number.isSafeInteger(body.estimated_tokens) || (body.estimated_tokens as number) <= 0) throw new HttpError(400, "invalid_brainstorm_draft");
  const estimatedTokens = body.estimated_tokens as number;
  const allocation = canonicalAllocation(estimatedTokens, routeDrafts.length);
  const routes: BrainstormRoute[] = routeDrafts.map((route) => ({ ...route, estimated_tokens: allocation.perRoute }));
  const synthesizerRoute: BrainstormRoute = { ...synthesizerSource, estimated_tokens: allocation.synthesis };
  const tokenEnvelope = estimateBrainstormTokenEnvelope(routes, synthesizerRoute.estimated_tokens, 0);
  if (tokenEnvelope.maximum_tokens > estimatedTokens) throw new HttpError(409, "brainstorm_token_budget_insufficient");
  return {
    project_id: body.project_id,
    brief: body.brief,
    routes,
    synthesizer_route: synthesizerRoute,
    arbitration_route: null,
    token_envelope: tokenEnvelope
  };
}

function routeDraft(value: unknown): BrainstormRoute {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "invalid_brainstorm_draft");
  const record = value as Record<string, unknown>;
  if (!PROVIDERS.has(record.provider as RunProvider) || !boundedString(record.model, MAX_MODEL_CHARS)) throw new HttpError(400, "invalid_brainstorm_draft");
  const provider = record.provider as RunProvider;
  if (record.requested_reasoning_effort !== undefined && record.requested_reasoning_effort !== null && typeof record.requested_reasoning_effort !== "string") {
    throw new HttpError(400, "invalid_brainstorm_draft");
  }
  const requested: RunReasoningEffort | null = record.requested_reasoning_effort === undefined ? null : (record.requested_reasoning_effort as RunReasoningEffort | null);
  const supported: readonly RunReasoningEffort[] = SUPPORTED_REASONING_EFFORTS[provider];
  if (requested !== null && !supported.includes(requested)) throw new HttpError(409, "unsupported_reasoning_effort");
  const reasoningEffort = supported.length === 0 ? null : requested ?? supported[0]!;
  return { provider, model: record.model, reasoning_effort: reasoningEffort, estimated_tokens: 1 };
}

function checkRouteEligible(stateDir: string, provider: RunProvider, model: string): void {
  if (!isRunRouteEligible(stateDir, provider, model, new Date().toISOString())) throw new HttpError(409, "brainstorm_route_unavailable");
}

function canonicalAllocation(estimatedTokens: number, routeCount: number): { readonly perRoute: number; readonly synthesis: number } {
  const shares = routeCount + 1;
  const perRoute = Math.floor(estimatedTokens / shares);
  if (perRoute < 1) throw new HttpError(409, "brainstorm_token_budget_insufficient");
  const remainder = estimatedTokens - perRoute * shares;
  return { perRoute, synthesis: perRoute + remainder };
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

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

const CONFLICT_ERROR_CODES = new Set([
  "brainstorm_route_count", "brainstorm_provider_duplicate", "brainstorm_token_envelope_noncanonical", "brainstorm_limit",
  "unsupported_reasoning_effort", "brainstorm_route_unavailable", "brainstorm_token_budget_insufficient",
  "brainstorm_operator_required", "brainstorm_operator_mismatch", "brainstorm_not_approvable", "brainstorm_not_reserved",
  "brainstorm_arbitration_not_allowed", "brainstorm_no_independent_arbiter", "brainstorm_not_cancellable",
  "brainstorm_child_run_mismatch", "brainstorm_output_too_large", "brainstorm_nonce_invalid", "brainstorm_prompt_too_large",
  "brainstorm_arbitration_source_missing", "brainstorm_slot_route_missing", "brainstorm_slot_missing",
  "brainstorm_consolidation_invalid", "brainstorm_arbitration_invalid", "brainstorm_revision_conflict", "brainstorm_telemetry_limit",
  "token_input_cap_exceeded", "token_output_cap_exceeded", "token_budget_exhausted", "token_route_mismatch",
  "token_reservation_limit", "run_limit", "run_revision_limit", "run_route_unavailable", "invalid_run_cancellation"
]);

const BAD_REQUEST_ERROR_CODES = new Set([
  "invalid_brainstorm_draft", "invalid_brainstorm", "invalid_json_body", "invalid_brainstorm_action", "invalid_run_draft"
]);

const NOT_FOUND_ERROR_CODES = new Set(["project_not_found", "brainstorm_not_found", "run_not_found"]);

export function classifyBrainstormErrorCode(code: string): number | null {
  if (NOT_FOUND_ERROR_CODES.has(code)) return 404;
  if (CONFLICT_ERROR_CODES.has(code)) return 409;
  if (BAD_REQUEST_ERROR_CODES.has(code)) return 400;
  return null;
}

function knownHttpError(error: unknown): HttpError | null {
  if (error instanceof HttpError) return error;
  const code = error instanceof Error ? error.message : "";
  if (isProjectConfigurationError(error)) return new HttpError(409, code);
  const status = classifyBrainstormErrorCode(code);
  return status === null ? null : new HttpError(status, code);
}

function json(response: ServerResponse, value: unknown, status = 200): true {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value, null, 2));
  return true;
}

export type { BrainstormRecord };
