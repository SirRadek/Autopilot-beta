import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reviseRunWithApproval } from "../../scripts/control-plane-runs";
import { createControlPlaneRuntime, createControlPlaneServer, providerUsageCommandsFromEnvironment, secureCookiesFromEnvironment } from "../../scripts/control-plane-server";
import { readApprovalQueue, writeApprovalQueue } from "../../src/data/delivery-system/approvalQueue";
import { readIncidentStore, recordAutopilotIncident } from "../../src/data/delivery-system/incidentStore";
import { writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";
import { writeProviderQuotaStore } from "../../src/data/delivery-system/providerQuotaStore";
import { SupervisorQueue } from "../../src/data/delivery-system/supervisorQueue";
import { createRunDraft, readRunStore, reviseRunDraft } from "../../src/data/delivery-system/runStore";
import type { ProviderQuotaStoreDocument } from "../../src/data/delivery-system/providerQuotaStore";
import type { ReadinessReport } from "../../src/data/delivery-system/readiness";

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

const readinessReport = (ready: boolean): ReadinessReport => ({
  ready,
  status: ready ? "ready" : "unavailable",
  checked_at: "2026-07-13T12:00:00.000Z",
  components: {
    configuration: { status: ready ? "ready" : "unavailable", error_code: ready ? null : "invalid_configuration" },
    managed_state: { status: "ready", error_code: null },
    project_registry: { status: "ready", error_code: null },
    supervisor: { status: "ready", error_code: null },
    token_gateway: { status: "ready", error_code: null },
    providers: {
      codex_cli: { status: "degraded", error_code: "not_observed" },
      claude_cli: { status: "degraded", error_code: "not_observed" },
      agy_cli: { status: "degraded", error_code: "not_observed" },
      openrouter_api: { status: "degraded", error_code: "not_observed" }
    }
  }
});

describe("control plane liveness and readiness", () => {
  async function publicGet(path: string, readiness: () => ReadinessReport) {
    const server = createControlPlaneServer(mkdtempSync(join(tmpdir(), "control-plane-ready-")), "secret-value", { readiness });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    return { status: response.status, body: await response.json() as unknown };
  }

  it("keeps health public and independent of readiness", async () => {
    expect(await publicGet("/health", () => { throw new Error("secret-value"); }))
      .toEqual({ status: 200, body: { ok: true } });
  });

  it("serves healthy and unavailable readiness without authentication", async () => {
    expect(await publicGet("/ready", () => readinessReport(true)))
      .toEqual({ status: 200, body: readinessReport(true) });
    expect(await publicGet("/ready", () => readinessReport(false)))
      .toEqual({ status: 503, body: readinessReport(false) });
  });

  it("maps readiness exceptions to a fixed redacted 503 report", async () => {
    const result = await publicGet("/ready", () => { throw new Error("secret-value:/private/path"); });

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ready: false, status: "unavailable" });
    expect(JSON.stringify(result.body)).not.toContain("secret-value");
    expect(JSON.stringify(result.body)).not.toContain("/private/path");
  });

  it("wires the pure readiness builder into the production runtime", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-runtime-ready-"));
    const projectRoot = join(stateDir, "projects");
    mkdirSync(projectRoot, { mode: 0o700 });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [] });
    const runtime = createControlPlaneRuntime(stateDir, "secret", {
      projectRoot,
      scheduler: { start() {}, stop() {} },
      providerCommands: {},
      openRouterConfigured: false,
      supervisorPollMs: 60_000
    });
    await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
    try {
      const address = runtime.server.address();
      if (address === null || typeof address === "string") throw new Error("missing address");
      const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
      const body = await response.json() as ReadinessReport;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ ready: true, status: "degraded" });
      expect(body.components.configuration).toEqual({ status: "ready", error_code: null });
    } finally {
      await runtime.stop();
    }
  });
});

const snapshot = (provider: string, fetchedAt: string) => ({
  provider, source: "api" as const, fetched_at: fetchedAt, observed_at: fetchedAt,
  five_hour: { limit: 100, used: 20, remaining: 80, resets_at: null },
  weekly: { limit: 1_000, used: 100, remaining: 900, resets_at: null }, api_spend: 1.25, currency: "USD",
  models: [{ model_id: "model-a", available: true, health: "healthy" as const, source: "api" as const }], health: "healthy" as const, error_code: null
});

async function governedApi() {
  const stateDir = mkdtempSync(join(tmpdir(), "control-plane-runs-"));
  const projectRoot = join(stateDir, "projects");
  const projectCwd = join(projectRoot, "autopilot-beta");
  mkdirSync(projectCwd, { recursive: true });
  writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: projectCwd, enabled: true }] });
  writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
  const server = createControlPlaneServer(stateDir, "secret", { projectRoot });
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
  return { stateDir, projectRoot, base, call };
}

describe("control plane governed run API", () => {
  const draft = { project_id: "autopilot-beta", prompt: "Inspect status", provider: "codex_cli", model: null, requested_artifacts: ["text"], profile: "dev" as const, requested_reasoning_effort: null };

  it("rejects an out-of-root HTTP run through the server fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "control-plane-default-root-"));
    const stateDir = join(root, "state");
    const projectRoot = join(root, "projects");
    const outside = join(root, "outside");
    mkdirSync(stateDir);
    mkdirSync(projectRoot);
    mkdirSync(outside);
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: outside, enabled: true }] });
    writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
    const previous = process.env.AUTOPILOT_PROJECTS_DIR;
    process.env.AUTOPILOT_PROJECTS_DIR = projectRoot;
    const server = createControlPlaneServer(stateDir, "secret");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("missing address");
      const response = await fetch(`http://127.0.0.1:${address.port}/runs`, {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify(draft)
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "project_path_outside_root" });
      expect(readRunStore(stateDir).runs).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.AUTOPILOT_PROJECTS_DIR;
      else process.env.AUTOPILOT_PROJECTS_DIR = previous;
    }
  });

  it("threads the configured project root through revision operations", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-revision-root-"));
    const projectRoot = join(stateDir, "projects");
    const inside = join(projectRoot, "inside");
    const outside = join(stateDir, "outside");
    mkdirSync(inside, { recursive: true });
    mkdirSync(outside);
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: inside, enabled: true }] });
    const input = { ...draft, provider: "codex_cli" as const, requested_artifacts: ["text"] as const, estimated_tokens: 20_000 };
    const created = createRunDraft(stateDir, input, "2026-07-13T10:00:00.000Z", { projectRoot });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: outside, enabled: true }] });

    expect(() => reviseRunWithApproval(stateDir, created.run_id, created.revision, input, { projectRoot }))
      .toThrow("project_path_outside_root");
  });

  it("rechecks the project root while recovering an already committed revision", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-revision-recovery-root-"));
    const projectRoot = join(stateDir, "projects");
    const inside = join(projectRoot, "inside");
    const outside = join(stateDir, "outside");
    mkdirSync(inside, { recursive: true });
    mkdirSync(outside);
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: inside, enabled: true }] });
    const input = { ...draft, provider: "codex_cli" as const, requested_artifacts: ["text"] as const, estimated_tokens: 20_000 };
    const created = createRunDraft(stateDir, input, "2026-07-13T10:00:00.000Z", { projectRoot });
    reviseRunWithApproval(stateDir, created.run_id, created.revision, input, { projectRoot });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: outside, enabled: true }] });

    expect(() => reviseRunWithApproval(stateDir, created.run_id, created.revision, input, { projectRoot }))
      .toThrow("project_path_outside_root");
  });

  it("threads the configured project root into the runtime orchestrator", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-runtime-root-"));
    const projectRoot = join(stateDir, "projects");
    const outside = join(stateDir, "outside");
    mkdirSync(projectRoot);
    mkdirSync(outside);
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: outside, enabled: true }] });
    const runtime = createControlPlaneRuntime(stateDir, "secret", {
      projectRoot,
      scheduler: { start() {}, stop() {} },
      supervisorPollMs: 60_000
    });
    try {
      expect(() => runtime.orchestrator.prepareRun({ ...draft, provider: "codex_cli", requested_artifacts: ["text"], estimated_tokens: 20_000, profile: "dev", requested_reasoning_effort: null }))
        .toThrow("project_path_outside_root");
    } finally {
      await runtime.stop();
    }
  });

  it("rejects an out-of-root HTTP revision without mutating revisions or approvals", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-http-revision-root-"));
    const projectRoot = join(stateDir, "projects");
    const inside = join(projectRoot, "inside");
    const outside = join(stateDir, "outside");
    mkdirSync(inside, { recursive: true });
    mkdirSync(outside);
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: inside, enabled: true }] });
    writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
    const runtime = createControlPlaneRuntime(stateDir, "secret", {
      projectRoot,
      scheduler: { start() {}, stop() {} },
      supervisorPollMs: 60_000
    });
    await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
    try {
      const address = runtime.server.address();
      if (address === null || typeof address === "string") throw new Error("missing address");
      const call = (path: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const createdResponse = await call("/runs", draft);
      expect(createdResponse.status).toBe(201);
      const created = await createdResponse.json() as { current: { run_id: string } };
      const runsBefore = readRunStore(stateDir);
      const approvalsBefore = readApprovalQueue(stateDir);
      writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: outside, enabled: true }] });

      const response = await call(`/runs/${created.current.run_id}/revisions`, { ...draft, prompt: "revised", revision: 1 });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "project_path_outside_root" });
      expect(readRunStore(stateDir)).toEqual(runsBefore);
      expect(readApprovalQueue(stateDir)).toEqual(approvalsBefore);
      expect(readIncidentStore(stateDir).incidents).toEqual([]);
    } finally {
      await runtime.stop();
    }
  });

  it("reports a non-regular project registry as invalid configuration without leaking paths", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-registry-io-secret-"));
    mkdirSync(join(stateDir, "projects.json"));
    const server = createControlPlaneServer(stateDir, "secret");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");

    const response = await fetch(`http://127.0.0.1:${address.port}/projects`, { headers: { authorization: "Bearer secret" } });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "invalid_project_registry" });
    expect(JSON.stringify(body)).not.toContain(stateDir);
    expect(JSON.stringify(body)).not.toContain("EISDIR");
    expect(JSON.stringify(body)).not.toContain("secret");
    const incidents = readIncidentStore(stateDir).incidents;
    expect(incidents).toEqual([]);
    expect(JSON.stringify(incidents)).not.toContain(stateDir);
    expect(JSON.stringify(incidents)).not.toContain("EISDIR");
    expect(JSON.stringify(incidents)).not.toContain("secret");
  });

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

  it("rejects zero and underestimated HTTP budgets and persists the canonical value", async () => {
    const api = await governedApi();
    expect(await (await api.call("POST", "/runs", { ...draft, estimated_tokens: 0 })).json()).toEqual({ error: "run_token_budget_underestimated" });
    expect(await (await api.call("POST", "/runs", { ...draft, estimated_tokens: 77 })).json()).toEqual({ error: "run_token_budget_underestimated" });
    const created = await (await api.call("POST", "/runs", { ...draft, estimated_tokens: 10_000 })).json() as { current: { input_token_bound: number; output_token_allowance: number; estimated_tokens: number } };
    expect(created.current).toMatchObject({ input_token_bound: 14, output_token_allowance: 8_192, estimated_tokens: 8_206 });
  });

  it("rejects explicitly invalid profile, reasoning-effort, and promotion-packet types instead of coercing them", async () => {
    const api = await governedApi();
    const invalidProfile = await api.call("POST", "/runs", { ...draft, profile: "staging" });
    expect(invalidProfile.status).toBe(400);
    expect(await invalidProfile.json()).toEqual({ error: "invalid_run_draft" });
    const invalidReasoning = await api.call("POST", "/runs", { ...draft, requested_reasoning_effort: 7 });
    expect(invalidReasoning.status).toBe(400);
    expect(await invalidReasoning.json()).toEqual({ error: "invalid_run_draft" });
    const invalidPromotion = await api.call("POST", "/runs", { ...draft, promotion_packet_id: 7 });
    expect(invalidPromotion.status).toBe(400);
    expect(await invalidPromotion.json()).toEqual({ error: "invalid_run_draft" });
  });

  it("requires an explicit profile on create and defaults only the reasoning effort", async () => {
    const api = await governedApi();
    const { profile, requested_reasoning_effort, ...withoutProfileFields } = draft as Record<string, unknown>;
    const missingProfile = await api.call("POST", "/runs", withoutProfileFields);
    expect(missingProfile.status).toBe(400);
    expect(await missingProfile.json()).toEqual({ error: "run_profile_required" });
    const created = await (await api.call("POST", "/runs", { ...withoutProfileFields, profile: "dev" })).json() as { current: { profile: string; requested_reasoning_effort: unknown } };
    expect(created.current.profile).toBe("dev");
    expect(created.current.requested_reasoning_effort).toBeNull();
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
    const projectRoot = join(stateDir, "projects");
    const projectCwd = join(projectRoot, "autopilot-beta");
    mkdirSync(projectCwd, { recursive: true });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: projectCwd, enabled: true }] });
    writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
    const runtime = createControlPlaneRuntime(stateDir, "secret", { projectRoot, scheduler: { start() {}, stop() {} }, dispatch: async (handoff) => ({ refused: false, workerRunId: "runtime-worker", handoffId: handoff.handoffId, vendor: handoff.vendor, model: handoff.model ?? null, exitCode: 0, rawOutput: "runtime terminal", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn", workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true }), supervisorPollMs: 5 });
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

  it("records only the transition into a repeated supervisor-loop failure", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-supervisor-failure-"));
    const projectRoot = join(stateDir, "projects");
    mkdirSync(projectRoot, { recursive: true });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [] });
    const runtime = createControlPlaneRuntime(stateDir, "secret", {
      projectRoot,
      scheduler: { start() {}, stop() {} },
      supervisorPollMs: 5
    });

    writeFileSync(join(stateDir, "runs.json"), "not-json injected-secret");
    await vi.waitFor(() => {
      expect(readIncidentStore(stateDir).incidents.filter((incident) => incident.stage === "supervisor_loop")).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const incidents = readIncidentStore(stateDir).incidents.filter((incident) => incident.stage === "supervisor_loop");
    expect(incidents).toHaveLength(1);
    expect(JSON.stringify(incidents)).not.toContain("injected-secret");
    await runtime.stop();
  });

  it("recovers an orphan running cancellation on runtime restart", async () => {
    const api = await governedApi();
    const supervisor = new SupervisorQueue({ stateDir: api.stateDir });
    const gateway = new (await import("../../src/data/delivery-system/tokenGateway")).TokenGateway({ stateDir: api.stateDir });
    const first = (await import("../../src/data/delivery-system/runOrchestrator")).createRunOrchestrator({ stateDir: api.stateDir, projectRoot: api.projectRoot, tokenGateway: gateway, supervisor, dispatch: async () => new Promise(() => {}), isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "autopilot-beta", prompt: "cancel after crash", provider: "codex_cli", model: "model-a", estimated_tokens: 20_000, requested_artifacts: ["text"], profile: "dev", requested_reasoning_effort: null });
    first.approveAndQueueRun(draft.current.run_id, 1, "owner");
    supervisor.claim(new Date().toISOString());
    const { requestRunCancellation, transitionRun } = await import("../../src/data/delivery-system/runStore");
    transitionRun(api.stateDir, draft.current.run_id, "running", new Date().toISOString());
    requestRunCancellation(api.stateDir, draft.current.run_id, new Date().toISOString());
    const runtime = createControlPlaneRuntime(api.stateDir, "secret", { scheduler: { start() {}, stop() {} }, supervisorPollMs: 5, dispatch: async () => { throw new Error("must_not_dispatch_cancelled_orphan"); } });
    await vi.waitFor(() => expect(readRunStore(api.stateDir).runs.find((run) => run.current.run_id === draft.current.run_id)?.status).toBe("cancelled"));
    await runtime.stop();
  });

  it("drains an in-flight supervisor poll before stop resolves", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-drain-"));
    const projectRoot = join(stateDir, "projects");
    const projectCwd = join(projectRoot, "autopilot-beta");
    mkdirSync(projectCwd, { recursive: true });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: projectCwd, enabled: true }] });
    writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
    let finish!: () => void;
    const runtime = createControlPlaneRuntime(stateDir, "secret", { projectRoot, scheduler: { start() {}, stop() {} }, supervisorPollMs: 5, shutdownDrainMs: 1_000, dispatch: async (handoff) => { await new Promise<void>((resolve) => { finish = resolve; }); return { refused: false, workerRunId: "drain-worker", handoffId: handoff.handoffId, vendor: handoff.vendor, model: handoff.model ?? null, exitCode: 0, rawOutput: "done", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn", workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true }; } });
    const orchestrator = (runtime as any).orchestrator;
    const draft = orchestrator.prepareRun({ project_id: "autopilot-beta", prompt: "drain", provider: "codex_cli", model: "model-a", estimated_tokens: 20_000, requested_artifacts: ["text"], profile: "dev", requested_reasoning_effort: null });
    orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner");
    await vi.waitFor(() => expect(typeof finish).toBe("function"));
    let stopped = false;
    const stopping = runtime.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await stopping;
    expect(readRunStore(stateDir).runs[0]?.status).toBe("completed");
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
      incident_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      request_id: expect.stringMatching(/^[0-9a-f-]{36}$/i)
    });
  });

  it("recovers exact committed revisions and missing approvals without rewriting history", async () => {
    const api = await governedApi();
    const created = await (await api.call("POST", "/runs", draft)).json() as { current: { run_id: string } };
    const input = { ...draft, provider: "codex_cli" as const, requested_artifacts: ["text"] as const, estimated_tokens: 20_000 };
    let revisionFault = true;
    expect(() => reviseRunWithApproval(api.stateDir, created.current.run_id, 1, input, {
      projectRoot: api.projectRoot,
      revise: (...args) => {
        const revised = reviseRunDraft(...args);
        if (revisionFault) { revisionFault = false; throw new Error("commit_then_throw"); }
        return revised;
      }
    })).toThrow("commit_then_throw");
    const recovered = reviseRunWithApproval(api.stateDir, created.current.run_id, 1, input, { projectRoot: api.projectRoot });
    expect(recovered.current.revision).toBe(2);
    expect(recovered.revisions).toHaveLength(2);
    expect(readApprovalQueue(api.stateDir).records.filter((record) => record.run_id === created.current.run_id && record.revision === 2)).toHaveLength(1);

    const next = { ...input, prompt: "third revision" };
    let approvalFault = true;
    expect(() => reviseRunWithApproval(api.stateDir, created.current.run_id, 2, next, {
      projectRoot: api.projectRoot,
      writeApprovals: (...args) => {
        writeApprovalQueue(...args);
        if (approvalFault) { approvalFault = false; throw new Error("approval_commit_then_throw"); }
      }
    })).toThrow("approval_commit_then_throw");
    const restarted = reviseRunWithApproval(api.stateDir, created.current.run_id, 2, next, { projectRoot: api.projectRoot });
    expect(restarted.current.revision).toBe(3);
    expect(readRunStore(api.stateDir).runs[0]?.revisions).toHaveLength(3);
    expect(readApprovalQueue(api.stateDir).records.filter((record) => record.run_id === created.current.run_id && record.revision === 3)).toHaveLength(1);
  });
});

describe("control plane provider endpoints", () => {
  it.each([
    ["status", "/status", (stateDir: string) => writeFileSync(join(stateDir, "session-registry.json"), "not-json injected-secret")],
    ["sessions", "/sessions", (stateDir: string) => writeFileSync(join(stateDir, "session-registry.json"), "not-json injected-secret")],
    ["workers", "/workers", (stateDir: string) => mkdirSync(join(stateDir, "agent-registry.jsonl"))],
    ["providers", "/providers/quotas", (stateDir: string) => writeFileSync(join(stateDir, "provider-quota-snapshots.json"), "not-json injected-secret")],
    ["observability", "/observability/summary", (stateDir: string) => mkdirSync(join(stateDir, "cli-call-telemetry.jsonl"))],
    ["approvals", "/approvals", (stateDir: string) => writeFileSync(join(stateDir, "approval-queue.json"), "not-json injected-secret")]
  ])("records a bounded incident when the %s route fails", async (_name, path, injectFailure) => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-route-failure-"));
    injectFailure(stateDir);
    const server = createControlPlaneServer(stateDir, "secret");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");

    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { headers: { authorization: "Bearer secret" } });
    const body = await response.json() as { error: string; incident_id: string; request_id: string };

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: "autopilot_internal_error", incident_id: expect.any(String), request_id: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain("injected-secret");
    expect(readIncidentStore(stateDir).incidents.some((incident) => incident.incident_id === body.incident_id)).toBe(true);
  });
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
  it("parses secure-cookie configuration strictly", () => {
    expect(secureCookiesFromEnvironment({})).toBe(false);
    expect(secureCookiesFromEnvironment({ CONTROL_PLANE_SECURE_COOKIES: "true" })).toBe(true);
    expect(secureCookiesFromEnvironment({ CONTROL_PLANE_SECURE_COOKIES: " FALSE " })).toBe(false);
    expect(() => secureCookiesFromEnvironment({ CONTROL_PLANE_SECURE_COOKIES: "maybe" }))
      .toThrow("invalid_secure_cookie_configuration");
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
    expect(cookie).not.toContain("Secure");
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
    writeFileSync(join(stateDir, "safe-worker-output.txt"), `${"x".repeat(50_000)}\npassword=worker-secret cookie: session-secret`);
    const server = createControlPlaneServer(stateDir, "secret");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const response = await fetch(`http://127.0.0.1:${address.port}/workers`, { headers: { authorization: "Bearer secret" } });
    const workers = await response.json() as Array<{ worker_run_id: string; output: string }>;
    expect(workers.find((worker) => worker.worker_run_id === "../outside")?.output).toBe("");
    const safeOutput = workers.find((worker) => worker.worker_run_id === "safe-worker")?.output ?? "";
    expect(safeOutput.length).toBeLessThanOrEqual(16 * 1024);
    expect(safeOutput).not.toContain("worker-secret");
    expect(safeOutput).not.toContain("session-secret");
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
    expect(models.models).toEqual([{ model_id: "model-a", providers: ["codex_cli"], available: true, health: ["healthy"], reasoning_efforts: ["low", "medium", "high", "xhigh"] }]);
    expect(health.providers[0]?.freshness).toBe("fresh");
  });
});
