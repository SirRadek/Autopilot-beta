import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { appendStateFile } from "../src/data/delivery-system/stateMaintenanceLock";
import { sanitizeWorkerOutput } from "../src/data/delivery-system/workerOutputPolicy";
import {
  recordOperationalIncident,
  type OperationalIncidentStage
} from "../src/data/delivery-system/operationalIncidents";
import { promisify } from "node:util";

import { decideApproval, readApprovalQueue, writeApprovalQueue } from "../src/data/delivery-system/approvalQueue";
import { cancelSession, createSessionRecord, readSessionRegistry, resumeSession, writeSessionRegistry } from "../src/data/delivery-system/sessionRegistry";
import { freshnessForSnapshot, type ProviderSnapshot } from "../src/data/delivery-system/providerQuota";
import { readProviderQuotaStore } from "../src/data/delivery-system/providerQuotaStore";
import { createProviderQuotaAdapters, type ProviderCliCapability, type ProviderCommandRunner } from "../src/data/delivery-system/providerQuotaAdapters";
import { createProviderQuotaScheduler } from "../src/data/delivery-system/providerQuotaScheduler";
import { buildObservability, type ObservabilityOptions } from "../src/data/delivery-system/observability";
import { handleControlPlaneRunRoute } from "./control-plane-runs";
import { createRunOrchestrator, type RunPacketBuilder } from "../src/data/delivery-system/runOrchestrator";
import { buildReadiness, type ReadinessReport } from "../src/data/delivery-system/readiness";
import { SupervisorQueue } from "../src/data/delivery-system/supervisorQueue";
import { TokenGateway } from "../src/data/delivery-system/tokenGateway";
import { resolveConfiguredProjectRoot } from "../src/data/delivery-system/runtimePaths";
import { dispatchHandoff, type DispatchResult, type GovernedHandoff } from "../src/governed-core/dispatch";
import { SUPPORTED_REASONING_EFFORTS, type RunReasoningEffort } from "../src/data/delivery-system/executionProfile";
import type { RunProvider } from "../src/data/delivery-system/runStore";

const execFileAsync = promisify(execFile);

export interface ControlPlaneScheduler {
  start(): void;
  stop(): void;
}

export interface ControlPlaneRuntime {
  readonly server: ReturnType<typeof createControlPlaneServer>;
  readonly scheduler: ControlPlaneScheduler;
  readonly orchestrator: ReturnType<typeof createRunOrchestrator>;
  readonly stop: () => Promise<void>;
}

export interface ControlPlaneRuntimeOptions {
  readonly projectRoot?: string;
  readonly scheduler?: ControlPlaneScheduler;
  readonly commandRunner?: ProviderCommandRunner;
  /** Explicit provider CLI capabilities; omitted providers remain unavailable. */
  readonly providerCommands?: Partial<Record<"codex_cli" | "claude_cli" | "agy_cli", ProviderCliCapability>>;
  /** Add Secure to browser cookies when the public cockpit is served over TLS. */
  readonly secureCookies?: boolean;
  readonly openRouterConfigured?: boolean;
  readonly dispatch?: (handoff: GovernedHandoff, stateDir: string) => Promise<DispatchResult>;
  /** Test/recovery seam; production omits it and loads the canonical decision mesh. */
  readonly packetBuilder?: RunPacketBuilder;
  readonly supervisorPollMs?: number;
  readonly shutdownDrainMs?: number;
}

export function providerUsageCommandsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): Partial<Record<"codex_cli" | "claude_cli" | "agy_cli", ProviderCliCapability>> {
  const enabled = new Set((environment.CONTROL_PLANE_USAGE_PROBES ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  return {
    ...(enabled.has("codex") ? { codex_cli: { kind: "tmux_usage" as const } } : {}),
    ...(enabled.has("claude") ? { claude_cli: { kind: "tmux_usage" as const } } : {}),
    ...(enabled.has("agy") ? { agy_cli: { kind: "tmux_usage" as const } } : {})
  };
}

export function secureCookiesFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): boolean {
  const value = environment.CONTROL_PLANE_SECURE_COOKIES?.trim().toLowerCase();
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error("invalid_secure_cookie_configuration");
}

export interface ControlPlaneServerOptions {
  /** Add Secure to browser cookies; disabled by default for loopback HTTP development. */
  readonly secureCookies?: boolean;
  readonly runOrchestrator?: ReturnType<typeof createRunOrchestrator>;
  readonly projectRoot?: string;
  readonly readiness?: () => ReadinessReport;
}

export function createControlPlaneServer(stateDir: string, authToken: string | undefined, options: ControlPlaneServerOptions = {}) {
  const browserSessions = new Map<string, number>();
  const sessionTtlMs = 8 * 60 * 60 * 1000;
  return createServer(async (request, response) => {
  const requestId = randomUUID();
  try {
  if (request.method === "GET" && request.url === "/health") returnJson(response, { ok: true });
  else if (request.method === "GET" && request.url === "/ready") return readinessHttp(response, options.readiness);
  else if (request.method === "POST" && request.url === "/auth/login") await loginBrowser(request, response, authToken, browserSessions, sessionTtlMs, options.secureCookies === true);
  else if (request.method === "POST" && request.url === "/auth/logout") {
    if (cookieValue(request.headers.cookie, "autopilot_session") !== null && !isBearerAuthenticated(request, authToken) && !isSameOriginMutation(request)) returnJson(response, { error: "csrf_origin_required" }, 403);
    else logoutBrowser(request, response, browserSessions, options.secureCookies === true);
  }
  else if (request.method === "GET" && request.url === "/auth/session") {
    const authenticated = isAuthenticated(request, authToken, browserSessions);
    returnJson(response, authenticated ? { authenticated: true, expires_at: sessionExpiry(request, browserSessions) } : { authenticated: false }, authenticated ? 200 : 401);
  }
  else if (!isAuthenticated(request, authToken, browserSessions)) returnJson(response, { error: "unauthorized" }, 401);
  else if (request.method === "POST" && !isBearerAuthenticated(request, authToken) && !isSameOriginMutation(request)) returnJson(response, { error: "csrf_origin_required" }, 403);
  else if (request.method === "GET" && request.url === "/status") returnJson(response, buildStatus(stateDir));
  else if (request.method === "GET" && request.url === "/sessions") returnJson(response, readSessionRegistry(stateDir).sessions);
  else if (request.method === "POST" && request.url === "/sessions") await createSessionHttp(request, response, stateDir);
  else if (request.method === "POST" && request.url?.startsWith("/sessions/")) await mutateSessionHttp(request, response, stateDir);
  else if (request.method === "GET" && request.url === "/workers") returnJson(response, workerViews(stateDir));
  else if (request.method === "GET" && request.url === "/observability/summary") returnJson(response, buildObservability(stateDir).summary);
  else if (request.method === "GET" && request.url?.startsWith("/observability/timeline")) returnJson(response, observabilityTimeline(stateDir, request.url));
  else if (request.method === "GET" && request.url === "/approvals") returnJson(response, readApprovalQueue(stateDir).records);
  else if (request.method === "POST" && request.url?.startsWith("/approvals/")) await decideApprovalHttp(request, response, stateDir);
    else if (request.method === "GET" && request.url === "/providers/quotas") returnJson(response, providerQuotas(stateDir));
    else if (request.method === "GET" && request.url?.startsWith("/providers/") && request.url.endsWith("/quotas")) {
      const result = providerQuota(stateDir, decodeURIComponent(request.url.slice("/providers/".length, -"/quotas".length)));
      returnJson(response, result, "error" in result ? 404 : 200);
    }
    else if (request.method === "GET" && request.url === "/providers/models") returnJson(response, providerModels(stateDir));
    else if (request.method === "GET" && request.url === "/providers/health") returnJson(response, providerHealth(stateDir));
    else if (await handleControlPlaneRunRoute(request, response, stateDir, options.runOrchestrator, options.projectRoot, requestId)) return;
    else returnJson(response, { error: "not_found" }, 404);
  } catch {
    if (response.writableEnded) return;
    if (response.headersSent) {
      response.end();
      return;
    }
    const incidentId = recordRouteIncidentBestEffort(stateDir, operationalStageForRequest(request), requestId);
    returnJson(response, { error: "autopilot_internal_error", incident_id: incidentId, request_id: requestId }, 500);
  }
  });
}

function operationalStageForRequest(request: IncomingMessage): OperationalIncidentStage {
  const path = new URL(request.url ?? "/", "http://control-plane.local").pathname;
  if (path === "/workers") return "control_plane_workers";
  if (path.startsWith("/sessions")) return "control_plane_sessions";
  if (path.startsWith("/providers")) return "control_plane_providers";
  if (path.startsWith("/observability")) return "control_plane_observability";
  if (path.startsWith("/approvals")) return "control_plane_approvals";
  if (path.startsWith("/runs") || path.startsWith("/projects") || path.startsWith("/incidents")) return "control_plane_runs";
  return "control_plane_status";
}

function recordRouteIncidentBestEffort(
  stateDir: string,
  stage: OperationalIncidentStage,
  requestId: string
): string {
  try {
    return recordOperationalIncident(stateDir, { stage, correlation_ids: { request_id: requestId } }).incident_id;
  } catch {
    return randomUUID();
  }
}

function readinessHttp(response: ServerResponse, readiness: (() => ReadinessReport) | undefined): void {
  try {
    const report = readiness?.() ?? failedReadinessReport();
    returnJson(response, report, report.ready ? 200 : 503);
  } catch {
    returnJson(response, failedReadinessReport(), 503);
  }
}

function failedReadinessReport(): ReadinessReport {
  return {
    ready: false,
    status: "unavailable",
    checked_at: new Date().toISOString(),
    components: {
      configuration: { status: "unavailable", error_code: "invalid_configuration" },
      managed_state: { status: "unavailable", error_code: "state_unavailable" },
      project_registry: { status: "unavailable", error_code: "invalid_project_registry" },
      supervisor: { status: "unavailable", error_code: "invalid_supervisor_state" },
      token_gateway: { status: "unavailable", error_code: "invalid_token_gateway_state" },
      providers: {
        codex_cli: { status: "unavailable", error_code: "not_observed" },
        claude_cli: { status: "unavailable", error_code: "not_observed" },
        agy_cli: { status: "unavailable", error_code: "not_observed" },
        openrouter_api: { status: "unavailable", error_code: "not_observed" }
      }
    }
  };
}

function observabilityTimeline(stateDir: string, requestUrl: string) {
  const query = new URL(requestUrl, "http://control-plane.local").searchParams;
  const options: ObservabilityOptions = {};
  const limit = Number(query.get("limit"));
  if (Number.isFinite(limit) && limit > 0) Object.assign(options, { max_events: Math.min(1_000, Math.floor(limit)) });
  for (const key of ["session_id", "handoff_id", "worker_run_id", "provider", "model"] as const) {
    const value = query.get(key);
    if (value !== null && value.length > 0) Object.assign(options, { [key]: value.slice(0, 200) });
  }
  return buildObservability(stateDir, options);
}

function isAuthenticated(request: IncomingMessage, authToken: string | undefined, browserSessions: Map<string, number>): boolean {
  if (isBearerAuthenticated(request, authToken)) return true;
  const sessionId = cookieValue(request.headers.cookie, "autopilot_session");
  const expires = sessionId === null ? undefined : browserSessions.get(sessionId);
  if (expires === undefined) return false;
  if (expires <= Date.now()) { browserSessions.delete(sessionId!); return false; }
  return true;
}

function sessionExpiry(request: IncomingMessage, browserSessions: Map<string, number>): string | null {
  const sessionId = cookieValue(request.headers.cookie, "autopilot_session");
  const expires = sessionId === null ? undefined : browserSessions.get(sessionId);
  return expires === undefined ? null : new Date(expires).toISOString();
}

async function loginBrowser(request: IncomingMessage, response: ServerResponse, authToken: string | undefined, browserSessions: Map<string, number>, ttlMs: number, secureCookies: boolean): Promise<void> {
  const body = await readBody(request);
  if (authToken === undefined || typeof body.token !== "string" || body.token.length === 0 || body.token !== authToken) returnJson(response, { error: "invalid_credentials" }, 401);
  else {
    const sessionId = randomBytes(32).toString("base64url");
    const expires = Date.now() + ttlMs;
    browserSessions.set(sessionId, expires);
    response.setHeader("Set-Cookie", `autopilot_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}${secureCookies ? "; Secure" : ""}`);
    returnJson(response, { authenticated: true, expires_at: new Date(expires).toISOString() });
  }
}

function logoutBrowser(request: IncomingMessage, response: ServerResponse, browserSessions: Map<string, number>, secureCookies: boolean): void {
  const sessionId = cookieValue(request.headers.cookie, "autopilot_session");
  if (sessionId !== null) browserSessions.delete(sessionId);
  response.setHeader("Set-Cookie", `autopilot_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookies ? "; Secure" : ""}`);
  returnJson(response, { authenticated: false });
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

function isBearerAuthenticated(request: IncomingMessage, authToken: string | undefined): boolean {
  return authToken !== undefined && request.headers.authorization === `Bearer ${authToken}`;
}

function isSameOriginMutation(request: IncomingMessage): boolean {
  const host = request.headers.host;
  if (!host) return false;
  const expected = new Set([`http://${host}`, `https://${host}`]);
  const origin = request.headers.origin;
  if (origin !== undefined) return expected.has(origin.replace(/\/$/, ""));
  const referer = request.headers.referer;
  if (referer === undefined) return false;
  try { return expected.has(new URL(referer).origin); } catch { return false; }
}

async function createSessionHttp(request: IncomingMessage, response: ServerResponse, directory: string): Promise<void> {
  const body = await readBody(request);
  if (typeof body.agent_command !== "string" || typeof body.cwd !== "string" || body.agent_command.length > 120 || body.cwd.length > 512) returnJson(response, { error: "invalid_session" }, 400);
  else {
    const document = readSessionRegistry(directory);
    const session = createSessionRecord({ sessionId: typeof body.session_id === "string" ? body.session_id : `session-${Date.now()}`, agentCommand: body.agent_command, cwd: body.cwd, ...(typeof body.name === "string" ? { name: body.name } : {}) });
    writeSessionRegistry(directory, { ...document, sessions: [...document.sessions, session] });
    audit(directory, "session_create", { session_id: session.session_id });
    returnJson(response, session, 201);
  }
}

async function mutateSessionHttp(request: IncomingMessage, response: ServerResponse, directory: string): Promise<void> {
  const sessionId = decodeURIComponent(request.url?.slice("/sessions/".length) ?? "");
  const action = (await readBody(request)).action;
  if (!sessionId || action !== "resume" && action !== "close") returnJson(response, { error: "invalid_session_action" }, 400);
  else {
    const document = readSessionRegistry(directory);
    const current = document.sessions.find((session) => session.session_id === sessionId);
    if (!current) returnJson(response, { error: "session_not_found" }, 404);
    else {
      const now = new Date().toISOString();
      const updated = action === "resume" ? resumeSession(current, now) : cancelSession(current, "closed_by_operator", now);
      writeSessionRegistry(directory, { ...document, sessions: document.sessions.map((session) => session.session_id === sessionId ? updated : session) });
      audit(directory, `session_${action}`, { session_id: sessionId });
      returnJson(response, updated);
    }
  }
}

function workerViews(directory: string): readonly Record<string, unknown>[] {
  const readJsonl = (name: string, maxBytes = 256 * 1024, maxLines = 2_000): Record<string, unknown>[] => {
    const path = join(directory, name);
    if (!existsSync(path)) return [];
    const fd = openSync(path, "r");
    try {
      const size = fstatSync(fd).size;
      const start = Math.max(0, size - maxBytes);
      const buffer = Buffer.alloc(Number(size - start));
      readSync(fd, buffer, 0, buffer.length, start);
      return buffer.toString("utf8").split(/\r?\n/).slice(start > 0 ? 1 : 0).filter(Boolean).slice(-maxLines).flatMap((line) => {
        try {
          const value = JSON.parse(line) as unknown;
          return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
        } catch {
          return [];
        }
      });
    } finally {
      closeSync(fd);
    }
  };
  const starts = new Map<string, Record<string, unknown>>();
  const stops = new Map<string, Record<string, unknown>>();
  const telemetry = new Map<string, Record<string, unknown>>();
  for (const record of readJsonl("cli-call-telemetry.jsonl")) { if (typeof record.worker_run_id === "string") telemetry.set(record.worker_run_id, record); }
  for (const event of readJsonl("agent-registry.jsonl")) { const id = typeof event.agent_id === "string" ? event.agent_id : null; if (!id) continue; if (event.event === "subagent_start") starts.set(id, event); else if (event.event === "subagent_stop") stops.set(id, event); }
  return [...starts.entries()].slice(-100).map(([id, start]) => {
    const stop = stops.get(id);
    const call = telemetry.get(id);
    const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id) ? id : null;
    const outputPath = safeId === null ? null : join(directory, `${safeId}-output.txt`);
    const output = outputPath !== null && existsSync(outputPath) ? readBoundedText(outputPath) : "";
    return { worker_run_id: id, vendor: String(start.agent_type ?? "unknown").replace(/-external$/, ""), model: typeof call?.model === "string" ? call.model : null, session_id: typeof call?.session_id === "string" ? call.session_id : "unknown", status: stop ? (Number(stop.exit_code) === 0 ? "completed" : "error") : "running", started_at: String(start.started_at ?? new Date().toISOString()), finished_at: stop?.stopped_at ?? null, output, error_reason: typeof call?.error_reason === "string" ? call.error_reason : stop && Number(stop.exit_code) !== 0 ? "worker_failed" : null };
  });
}

function readBoundedText(path: string, maxBytes = 16 * 1024): string {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(Number(size - start));
    readSync(fd, buffer, 0, buffer.length, start);
    return sanitizeWorkerOutput(buffer.toString("utf8"), maxBytes);
  } finally {
    closeSync(fd);
  }
}

function audit(directory: string, action: string, details: Record<string, unknown>): void { appendStateFile(directory, join(directory, "control-plane-audit.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), action, ...details })}\n`); }

export function createControlPlaneRuntime(
  stateDir: string,
  authToken: string | undefined,
  options: ControlPlaneRuntimeOptions = {}
): ControlPlaneRuntime {
  const projectRoot = options.projectRoot ?? resolveConfiguredProjectRoot();
  const providerCommands = options.providerCommands ?? {};
  const scheduler = options.scheduler ?? createProviderQuotaScheduler({
    sessions: () => readSessionRegistry(stateDir).sessions,
    adapters: createProviderQuotaAdapters({
      runCommand: options.commandRunner ?? runProviderCommand,
      commands: providerCommands
    }),
    store: { stateDir },
    onPollFailure: ({ provider }) => {
      try {
        recordOperationalIncident(stateDir, {
          stage: "provider_poll",
          correlation_ids: { provider }
        });
      } catch {
        // Provider polling must remain available when incident persistence is unavailable.
      }
    }
  });
  const supervisor = new SupervisorQueue({ stateDir });
  supervisor.recover();
  const orchestrator = createRunOrchestrator({
    stateDir,
    projectRoot,
    tokenGateway: new TokenGateway({ stateDir }),
    supervisor,
    ...(options.packetBuilder === undefined ? {} : { packetBuilder: options.packetBuilder }),
    dispatch: options.dispatch ?? ((handoff, directory) => dispatchHandoff(handoff, directory, { reservationOwner: "caller" }))
  });
  const server = createControlPlaneServer(stateDir, authToken, {
    ...(options.secureCookies === undefined ? {} : { secureCookies: options.secureCookies }),
    runOrchestrator: orchestrator,
    projectRoot,
    readiness: () => buildReadiness({
      stateDir,
      projectRoot,
      authToken,
      providerCommands,
      openRouterConfigured: options.openRouterConfigured ?? Boolean(process.env.OPENROUTER_API_KEY?.trim())
    })
  });
  scheduler.start();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activePoll: Promise<void> | null = null;
  let supervisorFailureActive = false;
  const poll = async () => {
    if (stopped) return;
    try {
      await orchestrator.runSupervisorOnce();
      supervisorFailureActive = false;
    } catch {
      if (!supervisorFailureActive) {
        supervisorFailureActive = true;
        try {
          recordOperationalIncident(stateDir, { stage: "supervisor_loop" });
        } catch {
          // The supervisor retry loop must survive unavailable incident persistence.
        }
      }
    }
    if (!stopped) timer = setTimeout(startPoll, options.supervisorPollMs ?? 250);
  };
  const startPoll = () => { activePoll = poll().finally(() => { activePoll = null; }); };
  startPoll();
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    scheduler.stop();
    const drain = activePoll;
    if (drain !== null) await Promise.race([drain, new Promise<void>((resolve) => setTimeout(resolve, options.shutdownDrainMs ?? 5_000))]);
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { server, scheduler, orchestrator, stop };
}

async function runProviderCommand(input: { readonly command: string; readonly args: readonly string[]; readonly signal: AbortSignal }): Promise<{ readonly stdout: string; readonly stderr?: string; readonly exitCode?: number | null }> {
  try {
    const result = await execFileAsync(input.command, [...input.args], { encoding: "utf8", signal: input.signal, maxBuffer: 128 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string; code?: number | string };
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? (error instanceof Error ? error.message : ""), exitCode: typeof result.code === "number" ? result.code : 1 };
  }
}

const stateDir = process.argv[2] ?? process.env.CONTROL_PLANE_STATE_DIR ?? "";
const port = Number(process.argv[3] ?? process.env.CONTROL_PLANE_PORT ?? "8787");
const authToken = process.env.CONTROL_PLANE_TOKEN?.trim();
const secureCookies = secureCookiesFromEnvironment(process.env);
if (process.argv[1]?.endsWith("control-plane-server.ts")) {
  if (!stateDir || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("usage: control-plane-server STATE_DIR [PORT]");
  const providerCommands = providerUsageCommandsFromEnvironment(process.env);
  const runtime = createControlPlaneRuntime(stateDir, authToken, { secureCookies, providerCommands });
  const shutdown = () => { void runtime.stop(); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  runtime.server.listen(port, "127.0.0.1", () => process.stdout.write(`control-plane listening on http://127.0.0.1:${port}\n`));
}

async function decideApprovalHttp(request: IncomingMessage, response: ServerResponse, directory: string): Promise<void> {
  const approvalId = request.url?.split("/")[2];
  const body = await readBody(request);
  const decision = body.decision === "approved" || body.decision === "rejected" ? body.decision : null;
  if (!approvalId || decision === null) returnJson(response, { error: "invalid_approval_decision" }, 400);
  else {
    const document = readApprovalQueue(directory);
    if (!document.records.some((record) => record.approval_id === approvalId)) returnJson(response, { error: "approval_not_found" }, 404);
    else {
      const records = document.records.map((record) => record.approval_id === approvalId
        ? decideApproval(record, decision, new Date().toISOString(), typeof body.reason === "string" ? body.reason : undefined)
        : record);
      writeApprovalQueue(directory, { ...document, records });
      appendStateFile(directory, join(directory, "control-plane-audit.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), action: decision, approval_id: approvalId })}\n`);
      returnJson(response, records.find((record) => record.approval_id === approvalId));
    }
  }
}

function buildStatus(directory: string) {
  const sessions = readSessionRegistry(directory).sessions;
  const approvals = readApprovalQueue(directory).records;
  const telemetry = readBoundedJsonl(join(directory, "cli-call-telemetry.jsonl"));
  return {
    sessions: { total: sessions.length, active: sessions.filter((item) => item.status === "active").length, closed: sessions.filter((item) => item.status === "closed").length },
    approvals: { total: approvals.length, pending: approvals.filter((item) => item.status === "pending").length, approved: approvals.filter((item) => item.status === "approved").length, rejected: approvals.filter((item) => item.status === "rejected").length },
    telemetry: { calls: telemetry.length, successful: telemetry.filter((item) => item.outcome === "success").length, total_tokens: telemetry.reduce((sum, item) => sum + (typeof item.total_tokens === "number" ? item.total_tokens : 0), 0) }
  };
}

function readBoundedJsonl(path: string, maxBytes = 256 * 1024, maxLines = 2_000): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(Number(size - start));
    readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString("utf8").split(/\r?\n/).slice(start > 0 ? 1 : 0).filter(Boolean).slice(-maxLines).flatMap((line) => {
      try {
        const value = JSON.parse(line) as unknown;
        return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
      } catch {
        return [];
      }
    });
  } finally {
    closeSync(fd);
  }
}

interface QuotaView extends ProviderSnapshot {
  readonly freshness: "fresh" | "stale" | "unavailable";
  readonly next_poll_at: string | null;
}

function quotaView(snapshot: ProviderSnapshot, now = new Date().toISOString()): QuotaView {
  const freshness = freshnessForSnapshot(snapshot, now);
  return {
    ...snapshot,
    freshness,
    // The snapshot does not encode scheduler backoff/lease state. Never invent a
    // five-minute deadline; the control plane reports unknown until that metadata
    // is persisted by the scheduler.
    next_poll_at: null
  };
}

function providerQuotas(directory: string): { providers: readonly QuotaView[] } {
  const now = new Date().toISOString();
  return { providers: readProviderQuotaStore(directory).snapshots.map((snapshot) => quotaView(snapshot, now)) };
}

function providerQuota(directory: string, provider: string): QuotaView | { error: "provider_not_found" } {
  const snapshot = readProviderQuotaStore(directory).snapshots.find((candidate) => candidate.provider === provider);
  return snapshot === undefined ? { error: "provider_not_found" } : quotaView(snapshot);
}

function providerModels(directory: string): { freshness: string; fetched_at: string | null; next_poll_at: string | null; models: readonly Record<string, unknown>[] } {
  const snapshots = readProviderQuotaStore(directory).snapshots;
  const now = new Date().toISOString();
  const byModel = new Map<string, { model_id: string; providers: Set<string>; available: boolean; health: Set<string>; reasoningByProvider: Map<string, readonly RunReasoningEffort[]> }>();
  for (const snapshot of snapshots) {
    const supported: readonly RunReasoningEffort[] = snapshot.provider in SUPPORTED_REASONING_EFFORTS
      ? SUPPORTED_REASONING_EFFORTS[snapshot.provider as RunProvider]
      : [];
    for (const model of snapshot.models) {
      const entry = byModel.get(model.model_id) ?? { model_id: model.model_id, providers: new Set<string>(), available: false, health: new Set<string>(), reasoningByProvider: new Map<string, readonly RunReasoningEffort[]>() };
      entry.providers.add(snapshot.provider);
      entry.available ||= model.available;
      entry.health.add(model.health);
      entry.reasoningByProvider.set(snapshot.provider, supported);
      byModel.set(model.model_id, entry);
    }
  }
  const views = snapshots.map((snapshot) => quotaView(snapshot, now));
  const freshness = views.length === 0 || views.some((view) => view.freshness === "unavailable") ? "unavailable" : views.some((view) => view.freshness === "stale") ? "stale" : "fresh";
  const fetchedAt = views.map((view) => view.fetched_at).sort().at(-1) ?? null;
  const nextPollAt = views.map((view) => view.next_poll_at).filter((value): value is string => value !== null).sort().at(0) ?? null;
  return {
    freshness,
    fetched_at: fetchedAt,
    next_poll_at: nextPollAt,
    models: [...byModel.values()].map((model) => {
      const providers = [...model.providers].sort();
      const routes = providers.map((provider) => ({ provider, reasoning_efforts: [...(model.reasoningByProvider.get(provider) ?? [])] }));
      const reasoningEfforts = routes.length === 0 ? [] : routes[0]!.reasoning_efforts.filter((effort) => routes.every((route) => route.reasoning_efforts.includes(effort)));
      return {
        model_id: model.model_id,
        providers,
        available: model.available,
        health: [...model.health].sort(),
        reasoning_efforts: reasoningEfforts,
        ...(routes.length > 1 ? { provider_routes: routes } : {})
      };
    }).sort((a, b) => a.model_id.localeCompare(b.model_id))
  };
}

function providerHealth(directory: string): { providers: readonly Record<string, unknown>[] } {
  const now = new Date().toISOString();
  return { providers: readProviderQuotaStore(directory).snapshots.map((snapshot) => ({ provider: snapshot.provider, health: snapshot.health, freshness: freshnessForSnapshot(snapshot, now), fetched_at: snapshot.fetched_at, next_poll_at: quotaView(snapshot, now).next_poll_at, error_code: snapshot.error_code })) };
}

function returnJson(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value, null, 2));
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) return {};
    chunks.push(buffer);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { return {}; }
  return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
}
