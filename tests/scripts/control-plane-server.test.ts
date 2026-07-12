import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createControlPlaneServer, providerUsageCommandsFromEnvironment } from "../../scripts/control-plane-server";
import { writeProviderQuotaStore, type ProviderQuotaStoreDocument } from "../../src/data/delivery-system/providerQuotaStore";

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
