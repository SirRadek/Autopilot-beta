import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reviseRunWithApproval } from "../../scripts/control-plane-runs";
import { createControlPlaneRuntime, createControlPlaneServer, providerUsageCommandsFromEnvironment } from "../../scripts/control-plane-server";
import { readApprovalQueue, writeApprovalQueue } from "../../src/data/delivery-system/approvalQueue";
import { recordAutopilotIncident } from "../../src/data/delivery-system/incidentStore";
import { writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";
import { writeProviderQuotaStore } from "../../src/data/delivery-system/providerQuotaStore";
import { SupervisorQueue } from "../../src/data/delivery-system/supervisorQueue";
import { readRunStore, reviseRunDraft } from "../../src/data/delivery-system/runStore";
import type { ProviderQuotaStoreDocument } from "../../src/data/delivery-system/providerQuotaStore";

const servers: ReturnType<typeof createControlPlaneServer>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

async function request(path: string, token?: string) {
  const server = createControlPlaneServer(mkdtempSync(join(tmpdir(), "control-plane-")), "secret");
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing address");
  return fetch(`http://127.0.0.1:${address.port}${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : {});
}

const snapshot = (provider: string, fetchedAt: string) => ({
  provider, source: "api" as const, fetched_at: fetchedAt, observed_at: fetchedAt,
  five_hour: { limit: 100, used: 20, remaining: 80, resets_at: null },
  weekly: { limit: 1_000, used: 100, remaining: 900, resets_at: null }, api_spend: 1.25, currency: "USD",
  models: [{ model_id: "model-a", available: true, health: "healthy" as const, source: "api" as const }], health: "healthy" as const, error_code: null
});

async function governedApi() {
  const stateDir = mkdtempSync(join(tmpdir(), "control-plane-runs-"));
  writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: stateDir, enabled: true }] });
  writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
  const server = createControlPlaneServer(stateDir, "secret");
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing address");
  const base = `http://127.0.0.1:${address.port}`;
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
    method,
    headers: { authorization: "Bearer secret", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) })
  });
  return { stateDir, base, call };
}

describe("control plane governed run API", () => {
  const draft = { project_id: "autopilot-beta", prompt: "Inspect status", provider: "codex_cli", model: null, requested_artifacts: ["text"] };

  it("prepares but does not execute a run", async () => {
    const api = await governedApi();
    const response = await api.call("POST", "/runs", draft);
    expect(response.status).toBe(201);
    expect(((await response.json()) as { status: string }).status).toBe("draft");
    expect(new SupervisorQueue({ stateDir: api.stateDir }).snapshot()).toEqual([]);
  });

  it("rejects arbitrary paths and bodies larger than 64 KiB", async () => {
    const api = await governedApi();
    expect((await api.call("GET", "/runs/not-a-run/extra")).status).toBe(404);
    const oversized = await api.call("POST", "/runs", `{"prompt":"${"x".repeat(64 * 1024)}"}`);
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: "request_body_too_large" });
  });

  it("requires manual review above 1k estimated tokens and hard-caps prompts below 10k", async () => {
    const api = await governedApi();
    const reviewPrompt = "x".repeat(4_004);
    const reviewRequired = await api.call("POST", "/runs", { ...draft, prompt: reviewPrompt });
    expect(await reviewRequired.json()).toEqual({ error: "run_prompt_review_required" });
    expect((await api.call("POST", "/runs", { ...draft, prompt: reviewPrompt, prompt_review_acknowledged: true })).status).toBe(201);
    const hardCap = await api.call("POST", "/runs", { ...draft, prompt: "x".repeat(32_000), prompt_review_acknowledged: true });
    expect(await hardCap.json()).toEqual({ error: "run_prompt_token_cap_exceeded" });
  });

  it("requires application/json for every mutation body", async () => {
    const api = await governedApi();
    const missing = await fetch(`${api.base}/runs`, { method: "POST", headers: { authorization: "Bearer secret" }, body: JSON.stringify(draft) });
    expect(missing.status).toBe(415);
    expect(await missing.json()).toEqual({ error: "unsupported_media_type" });
    const wrong = await api.call("POST", "/runs", JSON.stringify(draft), { "content-type": "text/plain" });
    expect(wrong.status).toBe(415);
    const accepted = await api.call("POST", "/runs", draft, { "content-type": "application/json; charset=utf-8" });
    expect(accepted.status).toBe(201);
  });

  it("maps unavailable models and stale revisions to conflict", async () => {
    const api = await governedApi();
    const unavailable = await api.call("POST", "/runs", { ...draft, model: "missing" });
    expect(unavailable.status).toBe(409);
    expect(await unavailable.json()).toEqual({ error: "run_route_unavailable" });
    const created = await (await api.call("POST", "/runs", draft)).json() as { current: { run_id: string } };
    const revised = await api.call("POST", `/runs/${created.current.run_id}/revisions`, { ...draft, prompt: "new", revision: 1 });
    expect(revised.status).toBe(201);
    const stale = await api.call("POST", `/runs/${created.current.run_id}/revisions`, { ...draft, revision: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "run_revision_conflict" });
  });

  it("rejects stale routes at prepare and revalidates before approval", async () => {
    const api = await governedApi();
    writeProviderQuotaStore(api.stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", "2026-01-01T00:00:00.000Z")] });
    expect((await api.call("POST", "/runs", draft)).status).toBe(409);
    writeProviderQuotaStore(api.stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
    const created = await (await api.call("POST", "/runs", draft)).json() as { current: { run_id: string; revision: number } };
    writeProviderQuotaStore(api.stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", "2026-01-01T00:00:00.000Z")] });
    expect((await api.call("POST", `/runs/${created.current.run_id}/approve`, { revision: 1, operator: "owner" })).status).toBe(409);
    expect(new SupervisorQueue({ stateDir: api.stateDir }).snapshot()).toEqual([]);
  });

  it("runs the production supervisor loop to a terminal result", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-runtime-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: stateDir, enabled: true }] });
    writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
    const runtime = createControlPlaneRuntime(stateDir, "secret", { scheduler: { start() {}, stop() {} }, dispatch: async (handoff) => ({ refused: false, workerRunId: "runtime-worker", handoffId: handoff.handoffId, vendor: handoff.vendor, model: handoff.model ?? null, exitCode: 0, rawOutput: "runtime terminal", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn", workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true }), supervisorPollMs: 5 });
    servers.push(runtime.server);
    await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
    const address = runtime.server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const call = (path: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, { method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" }, body: JSON.stringify(body) });
    const created = await (await call("/runs", draft)).json() as { current: { run_id: string } };
    await call(`/runs/${created.current.run_id}/approve`, { revision: 1, operator: "owner" });
    await vi.waitFor(() => expect(readRunStore(stateDir).runs[0]?.status).toBe("completed"));
    runtime.stop();
  });

  it("keeps authentication and cookie CSRF protection on mutations", async () => {
    const api = await governedApi();
    expect((await fetch(`${api.base}/projects`)).status).toBe(401);
    const login = await fetch(`${api.base}/auth/login`, { method: "POST", body: JSON.stringify({ token: "secret" }) });
    const cookie = login.headers.get("set-cookie") ?? "";
    const crossOrigin = await fetch(`${api.base}/runs`, { method: "POST", headers: { cookie, origin: "https://attacker.example", "content-type": "application/json" }, body: JSON.stringify(draft) });
    expect(crossOrigin.status).toBe(403);
  });

  it("approves idempotently without launching a worker", async () => {
    const api = await governedApi();
    const created = await (await api.call("POST", "/runs", draft)).json() as { current: { run_id: string; revision: number } };
    const path = `/runs/${created.current.run_id}/approve`;
    const body = { revision: created.current.revision, operator: "owner" };
    const first = await (await api.call("POST", path, body)).json();
    const second = await (await api.call("POST", path, body)).json();
    expect(second).toEqual(first);
    expect(new SupervisorQueue({ stateDir: api.stateDir }).snapshot()).toHaveLength(1);
  });

  it("acknowledges incidents and returns redacted manual repair packets", async () => {
    const api = await governedApi();
    const incident = recordAutopilotIncident(api.stateDir, { severity: "high", stage: "api", summary: "Bearer secret-value", correlation_ids: {}, impact: "password=hunter2", retry_count: 0, event_refs: [] });
    const acknowledged = await api.call("POST", `/incidents/${incident.incident_id}/acknowledge`, { owner: "owner" });
    expect(acknowledged.status).toBe(200);
    expect(((await acknowledged.json()) as { status: string }).status).toBe("acknowledged");
    const packet = await api.call("POST", `/incidents/${incident.incident_id}/repair-packet`, { expected: "authorization: Bearer expected-secret", actual: "password=actual-secret" });
    expect(packet.status).toBe(200);
    const text = await packet.text();
    expect(text).toContain('"execution": "manual"');
    expect(text).not.toContain("expected-secret");
    expect(text).not.toContain("actual-secret");
  });

  it("records a redacted incident for an unknown internal failure", async () => {
    const api = await governedApi();
    writeFileSync(join(api.stateDir, "runs.json"), "not json secret-token");
    const response = await api.call("GET", "/runs");
    expect(response.status).toBe(500);
    const body = await response.json() as { error: string; incident_id: string };
    expect(body.error).toBe("autopilot_internal_error");
    const incidents = await (await api.call("GET", "/incidents")).text();
    expect(incidents).toContain(body.incident_id);
    expect(incidents).not.toContain("secret-token");
  });

  it("returns a stable internal error when incident persistence also fails", async () => {
    const api = await governedApi();
    writeFileSync(join(api.stateDir, "runs.json"), "not json");
    writeFileSync(join(api.stateDir, "autopilot-incidents.json"), "not json");
    const response = await api.call("GET", "/runs");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "autopilot_internal_error",
      incident_id: expect.stringMatching(/^[0-9a-f-]{36}$/i)
    });
  });

  it("recovers exact committed revisions and missing approvals without rewriting history", async () => {
    const api = await governedApi();
    const created = await (await api.call("POST", "/runs", draft)).json() as { current: { run_id: string } };
    const input = { ...draft, provider: "codex_cli" as const, requested_artifacts: ["text"] as const, estimated_tokens: 4 };
    let revisionFault = true;
    expect(() => reviseRunWithApproval(api.stateDir, created.current.run_id, 1, input, {
      revise: (...args) => {
        const revised = reviseRunDraft(...args);
        if (revisionFault) { revisionFault = false; throw new Error("commit_then_throw"); }
        return revised;
      }
    })).toThrow("commit_then_throw");
    const recovered = reviseRunWithApproval(api.stateDir, created.current.run_id, 1, input);
    expect(recovered.current.revision).toBe(2);
    expect(recovered.revisions).toHaveLength(2);
    expect(readApprovalQueue(api.stateDir).records.filter((record) => record.run_id === created.current.run_id && record.revision === 2)).toHaveLength(1);

    const next = { ...input, prompt: "third revision" };
    let approvalFault = true;
    expect(() => reviseRunWithApproval(api.stateDir, created.current.run_id, 2, next, {
      writeApprovals: (...args) => {
        writeApprovalQueue(...args);
        if (approvalFault) { approvalFault = false; throw new Error("approval_commit_then_throw"); }
      }
    })).toThrow("approval_commit_then_throw");
    const restarted = reviseRunWithApproval(api.stateDir, created.current.run_id, 2, next);
    expect(restarted.current.revision).toBe(3);
    expect(readRunStore(api.stateDir).runs[0]?.revisions).toHaveLength(3);
    expect(readApprovalQueue(api.stateDir).records.filter((record) => record.run_id === created.current.run_id && record.revision === 3)).toHaveLength(1);
  });
});

describe("control plane provider endpoints", () => {
  it("serves authenticated bounded observability summary and filtered timeline", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-observability-"));
    writeFileSync(join(stateDir, "cli-call-telemetry.jsonl"), [
      JSON.stringify({ recorded_at: "2026-07-12T10:00:00Z", worker_run_id: "w-1", handoff_id: "h-1", session_id: "s-1", provider: "openrouter", model: "m-1", total_tokens: 12, attempt_count: 2, prompt: "must stay private" }),
      JSON.stringify({ recorded_at: "2026-07-12T10:00:01Z", worker_run_id: "w-2", handoff_id: "h-2", session_id: "s-2", provider: "anthropic_claude", model: "m-2", total_tokens: 7, attempt_count: 1 })
    ].join("\n"));
    const server = createControlPlaneServer(stateDir, "secret");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${base}/observability/summary`)).status).toBe(401);
    const headers = { authorization: "Bearer secret" };
    const summary = await (await fetch(`${base}/observability/summary`, { headers })).json() as { events: number; tokens: number; retries: number };
    expect(summary).toMatchObject({ events: 2, tokens: 19, retries: 1 });
    const result = await (await fetch(`${base}/observability/timeline?session_id=s-1&limit=99999`, { headers })).json() as { timeline: unknown[]; limits: { max_events: number } };
    expect(result.timeline).toHaveLength(1);
    expect(result.limits.max_events).toBe(1_000);
    expect(JSON.stringify(result)).not.toContain("must stay private");
  });
  it("enables only fixed built-in provider usage probes from the explicit allowlist", () => {
    expect(providerUsageCommandsFromEnvironment({ CONTROL_PLANE_USAGE_PROBES: "codex,agy,unknown" })).toEqual({
      codex_cli: { kind: "tmux_usage" },
      agy_cli: { kind: "tmux_usage" }
    });
    expect(providerUsageCommandsFromEnvironment({})).toEqual({});
  });
  it("creates an HttpOnly browser session and accepts it for protected requests", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    const server = createControlPlaneServer(stateDir, "secret");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    const unauthorized = await fetch(`${base}/status`);
    expect(unauthorized.status).toBe(401);
    const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "secret" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie");
    expect(cookie).toContain("autopilot_session=");
    expect(cookie).toContain("HttpOnly");
    const session = await fetch(`${base}/auth/session`, { headers: { cookie: cookie!.split(";")[0]! } });
    expect(session.status).toBe(200);
    const protectedResponse = await fetch(`${base}/status`, { headers: { cookie: cookie!.split(";")[0]! } });
    expect(protectedResponse.status).toBe(200);
    await fetch(`${base}/auth/logout`, { method: "POST", headers: { cookie: cookie!.split(";")[0]!, origin: new URL(base).origin } });
    expect((await fetch(`${base}/status`, { headers: { cookie: cookie!.split(";")[0]! } })).status).toBe(401);
  });

  it("requires same-origin validation for cookie mutations and supports Secure production cookies", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    const server = createControlPlaneServer(stateDir, "secret", { secureCookies: true });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "secret" }) });
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toContain("Secure");
    const cookieHeader = cookie.split(";")[0]!;
    const csrf = await fetch(`${base}/auth/logout`, { method: "POST", headers: { cookie: cookieHeader, origin: "https://evil.example" } });
    expect(csrf.status).toBe(403);
    const logout = await fetch(`${base}/auth/logout`, { method: "POST", headers: { cookie: cookieHeader, origin: new URL(base).origin } });
    expect(logout.status).toBe(200);
  });

  it("rejects invalid browser credentials", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    const server = createControlPlaneServer(stateDir, "secret");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const response = await fetch(`http://127.0.0.1:${address.port}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "wrong" }) });
    expect(response.status).toBe(401);
  });

  it("creates and mutates sessions through authenticated endpoints", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    const server = createControlPlaneServer(stateDir, "secret");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    const init = { headers: { authorization: "Bearer secret", "content-type": "application/json" } };
    const created = await (await fetch(`${base}/sessions`, { ...init, method: "POST", body: JSON.stringify({ agent_command: "codex_cli", cwd: "/work" }) })).json() as { session_id: string; status: string };
    expect(created.status).toBe("active");
    const closed = await (await fetch(`${base}/sessions/${created.session_id}`, { ...init, method: "POST", body: JSON.stringify({ action: "close" }) })).json() as { status: string };
    expect(closed.status).toBe("closed");
  });

  it("returns authenticated bounded worker records", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    const server = createControlPlaneServer(stateDir, "secret");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const response = await fetch(`http://127.0.0.1:${address.port}/workers`, { headers: { authorization: "Bearer secret" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("reads status telemetry from a bounded tail", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    writeFileSync(join(stateDir, "cli-call-telemetry.jsonl"), `${"invalid-line\n".repeat(300_000)}${JSON.stringify({ outcome: "success", total_tokens: 7 })}\n`);
    const server = createControlPlaneServer(stateDir, "secret");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const response = await fetch(`http://127.0.0.1:${address.port}/status`, { headers: { authorization: "Bearer secret" } });
    const body = await response.json() as { telemetry: { calls: number; total_tokens: number } };
    expect(body.telemetry).toEqual({ calls: 1, successful: 1, total_tokens: 7 });
  });

  it("bounds worker output and ignores unsafe worker ids", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    writeFileSync(join(stateDir, "agent-registry.jsonl"), `${JSON.stringify({ event: "subagent_start", agent_id: "../outside", agent_type: "codex", started_at: new Date().toISOString() })}\n${JSON.stringify({ event: "subagent_start", agent_id: "safe-worker", agent_type: "codex", started_at: new Date().toISOString() })}\n`);
    writeFileSync(join(stateDir, "safe-worker-output.txt"), "x".repeat(50_000));
    const server = createControlPlaneServer(stateDir, "secret");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const response = await fetch(`http://127.0.0.1:${address.port}/workers`, { headers: { authorization: "Bearer secret" } });
    const workers = await response.json() as Array<{ worker_run_id: string; output: string }>;
    expect(workers.find((worker) => worker.worker_run_id === "../outside")?.output).toBe("");
    expect(workers.find((worker) => worker.worker_run_id === "safe-worker")?.output.length).toBeLessThanOrEqual(16 * 1024);
  });

  it("requires bearer auth", async () => {
    const response = await request("/providers/quotas");
    expect(response.status).toBe(401);
  });

  it("returns an empty authenticated store", async () => {
    const response = await request("/providers/quotas", "secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providers: [] });
  });

  it("returns stale snapshots and filters a provider", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const document: ProviderQuotaStoreDocument = { schema_version: "v1", snapshots: [snapshot("codex_cli", old), snapshot("claude_cli", old)] };
    writeProviderQuotaStore(stateDir, document);
    const server = createControlPlaneServer(stateDir, "secret");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const response = await fetch(`http://127.0.0.1:${address.port}/providers/codex_cli/quotas`, { headers: { authorization: "Bearer secret" } });
    const body = await response.json() as { provider: string; freshness: string; next_poll_at: string };
    expect(body.provider).toBe("codex_cli");
    expect(body.freshness).toBe("stale");
  expect(body.next_poll_at).toBeNull();
  });

  it("aggregates models and exposes health", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
    const server = createControlPlaneServer(stateDir, "secret");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const init = { headers: { authorization: "Bearer secret" } };
    const models = await (await fetch(`http://127.0.0.1:${address.port}/providers/models`, init)).json() as { models: Array<{ model_id: string }> };
    const health = await (await fetch(`http://127.0.0.1:${address.port}/providers/health`, init)).json() as { providers: Array<{ freshness: string }> };
    expect(models.models).toEqual([{ model_id: "model-a", providers: ["codex_cli"], available: true, health: ["healthy"] }]);
    expect(health.providers[0]?.freshness).toBe("fresh");
  });
});
