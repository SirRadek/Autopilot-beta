import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reviseRunWithApproval } from "../../scripts/control-plane-runs";
import { createControlPlaneRuntime, createControlPlaneServer, providerUsageCommandsFromEnvironment, secureCookiesFromEnvironment, secureCookiesRequiredFromEnvironment } from "../../scripts/control-plane-server";
import {
  ADMIN_CREDENTIALS_VERSION,
  hashPassword,
  writeAdminCredentials
} from "../../src/data/delivery-system/adminCredentials";
import {
  AuthSessionRegistry,
  SESSION_RENEW_AFTER_MS,
  authStateRoot
} from "../../src/data/delivery-system/authSessionRegistry";
import { readApprovalQueue, writeApprovalQueue } from "../../src/data/delivery-system/approvalQueue";
import { readBrainstormStore } from "../../src/data/delivery-system/brainstormStore";
import { readIncidentStore, recordAutopilotIncident } from "../../src/data/delivery-system/incidentStore";
import { writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";
import { writeProviderQuotaStore } from "../../src/data/delivery-system/providerQuotaStore";
import { SupervisorQueue } from "../../src/data/delivery-system/supervisorQueue";
import { createRunDraft, readRunStore, reviseRunDraft } from "../../src/data/delivery-system/runStore";
import type { ProviderQuotaStoreDocument } from "../../src/data/delivery-system/providerQuotaStore";
import type { ReadinessReport } from "../../src/data/delivery-system/readiness";

const SERVICE_TOKEN = "c".repeat(64);
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "test-admin-password";
const servers: ReturnType<typeof createControlPlaneServer>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

function provisionServiceToken(stateDir: string): AuthSessionRegistry {
  const registry = new AuthSessionRegistry(authStateRoot(stateDir));
  registry.storeServiceToken(SERVICE_TOKEN);
  return registry;
}

async function provisionAdminAuth(stateDir: string) {
  const sessionRegistry = provisionServiceToken(stateDir);
  const adminCredentialsPath = `${stateDir}-admin-credentials.json`;
  writeAdminCredentials(adminCredentialsPath, {
    version: ADMIN_CREDENTIALS_VERSION,
    username: ADMIN_USERNAME,
    ...await hashPassword(ADMIN_USERNAME, ADMIN_PASSWORD),
    credential_generation: 1
  });
  return { adminCredentialsPath, sessionRegistry, serviceToken: sessionRegistry };
}

async function request(path: string, token?: string) {
  const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
  provisionServiceToken(stateDir);
  const server = createControlPlaneServer(stateDir);
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
    authentication: { status: ready ? "ready" : "unavailable", error_code: ready ? null : "admin_credentials_missing" },
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
  it("fails startup when admin credentials are configured inside managed state", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-unsafe-admin-"));
    const registry = new AuthSessionRegistry(authStateRoot(stateDir));

    expect(() => createControlPlaneServer(stateDir, {
      auth: {
        adminCredentialsPath: join(stateDir, "admin-credentials.json"),
        sessionRegistry: registry,
        serviceToken: registry
      }
    })).toThrow("admin_credentials_in_managed_state");
  });

  async function publicGet(path: string, readiness: () => ReadinessReport) {
    const server = createControlPlaneServer(mkdtempSync(join(tmpdir(), "control-plane-ready-")), { readiness });
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
    const credentialsPath = `${stateDir}-admin-credentials.json`;
    writeAdminCredentials(credentialsPath, {
      version: ADMIN_CREDENTIALS_VERSION,
      username: "admin",
      ...await hashPassword("admin", "readiness-password"),
      credential_generation: 1
    });
    const authRegistry = new AuthSessionRegistry(authStateRoot(stateDir));
    authRegistry.storeServiceToken("c".repeat(64));
    const runtime = createControlPlaneRuntime(stateDir, {
      projectRoot,
      auth: { adminCredentialsPath: credentialsPath, sessionRegistry: authRegistry, serviceToken: authRegistry },
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
  const auth = await provisionAdminAuth(stateDir);
  const server = createControlPlaneServer(stateDir, { projectRoot, auth });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing address");
  const base = `http://127.0.0.1:${address.port}`;
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${SERVICE_TOKEN}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
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
    provisionServiceToken(stateDir);
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: outside, enabled: true }] });
    writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
    const previous = process.env.AUTOPILOT_PROJECTS_DIR;
    process.env.AUTOPILOT_PROJECTS_DIR = projectRoot;
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("missing address");
      const response = await fetch(`http://127.0.0.1:${address.port}/runs`, {
        method: "POST",
        headers: { authorization: `Bearer ${SERVICE_TOKEN}`, "content-type": "application/json" },
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
    const runtime = createControlPlaneRuntime(stateDir, {
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
    provisionServiceToken(stateDir);
    const projectRoot = join(stateDir, "projects");
    const inside = join(projectRoot, "inside");
    const outside = join(stateDir, "outside");
    mkdirSync(inside, { recursive: true });
    mkdirSync(outside);
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: inside, enabled: true }] });
    writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
    const runtime = createControlPlaneRuntime(stateDir, {
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
        headers: { authorization: `Bearer ${SERVICE_TOKEN}`, "content-type": "application/json" },
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
    provisionServiceToken(stateDir);
    mkdirSync(join(stateDir, "projects.json"));
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");

    const response = await fetch(`http://127.0.0.1:${address.port}/projects`, { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } });
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
    const missing = await fetch(`${api.base}/runs`, { method: "POST", headers: { authorization: `Bearer ${SERVICE_TOKEN}` }, body: JSON.stringify(draft) });
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

  it("prepares, revises, and approves a known DEV route without a usable quota snapshot", async () => {
    const api = await governedApi();
    writeProviderQuotaStore(api.stateDir, {
      schema_version: "v1",
      snapshots: [{
        ...snapshot("codex_cli", new Date().toISOString()),
        models: [],
        health: "unavailable",
        error_code: "provider_unavailable"
      }]
    });
    const fallbackDraft = { ...draft, model: "gpt-5.6-sol", requested_reasoning_effort: "high" };

    const createdResponse = await api.call("POST", "/runs", fallbackDraft);
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { current: { run_id: string; revision: number } };
    const revisedResponse = await api.call("POST", `/runs/${created.current.run_id}/revisions`, {
      ...fallbackDraft,
      prompt: "Inspect revised status",
      revision: created.current.revision
    });
    expect(revisedResponse.status).toBe(201);
    const revised = await revisedResponse.json() as { current: { revision: number } };
    const approvedResponse = await api.call("POST", `/runs/${created.current.run_id}/approve`, {
      revision: revised.current.revision,
      operator: "owner"
    });

    expect(approvedResponse.status).toBe(200);
    expect((await approvedResponse.json() as { status: string }).status).toBe("queued");
  });

  it("runs the production supervisor loop to a terminal result", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-runtime-"));
    provisionServiceToken(stateDir);
    const projectRoot = join(stateDir, "projects");
    const projectCwd = join(projectRoot, "autopilot-beta");
    mkdirSync(projectCwd, { recursive: true });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: projectCwd, enabled: true }] });
    writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
    const runtime = createControlPlaneRuntime(stateDir, { projectRoot, scheduler: { start() {}, stop() {} }, dispatch: async (handoff) => ({ refused: false, workerRunId: "runtime-worker", handoffId: handoff.handoffId, vendor: handoff.vendor, model: handoff.model ?? null, exitCode: 0, rawOutput: "runtime terminal", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn", workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true }), supervisorPollMs: 5 });
    servers.push(runtime.server);
    await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
    const address = runtime.server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const call = (path: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, { method: "POST", headers: { authorization: `Bearer ${SERVICE_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) });
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
    const runtime = createControlPlaneRuntime(stateDir, {
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
    const runtime = createControlPlaneRuntime(api.stateDir, { scheduler: { start() {}, stop() {} }, supervisorPollMs: 5, dispatch: async () => { throw new Error("must_not_dispatch_cancelled_orphan"); } });
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
    const runtime = createControlPlaneRuntime(stateDir, { projectRoot, scheduler: { start() {}, stop() {} }, supervisorPollMs: 5, shutdownDrainMs: 1_000, dispatch: async (handoff) => { await new Promise<void>((resolve) => { finish = resolve; }); return { refused: false, workerRunId: "drain-worker", handoffId: handoff.handoffId, vendor: handoff.vendor, model: handoff.model ?? null, exitCode: 0, rawOutput: "done", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn", workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true }; } });
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

  it("advances an approved brainstorm to completion through the real supervisor poll without a manual tick", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-brainstorm-poll-"));
    provisionServiceToken(stateDir);
    const projectRoot = join(stateDir, "projects");
    const projectCwd = join(projectRoot, "autopilot-beta");
    mkdirSync(projectCwd, { recursive: true });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: projectCwd, enabled: true }] });
    writeProviderQuotaStore(stateDir, {
      schema_version: "v1",
      snapshots: [snapshot("codex_cli", new Date().toISOString()), snapshot("claude_cli", new Date().toISOString()), snapshot("agy_cli", new Date().toISOString())]
    });
    const outputs = ["Alpha view", "Beta view", "Gamma view", JSON.stringify({ consensus: ["aligned"], conflicts: [], confidence: 0.9, final: "Winning direction" })];
    let callCount = 0;
    const runtime = createControlPlaneRuntime(stateDir, {
      projectRoot,
      scheduler: { start() {}, stop() {} },
      supervisorPollMs: 5,
      dispatch: async (handoff) => ({ refused: false, workerRunId: `poll-worker-${callCount}`, handoffId: handoff.handoffId, vendor: handoff.vendor, model: handoff.model ?? null, exitCode: 0, rawOutput: outputs[callCount++] ?? "done", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn", workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true })
    });
    servers.push(runtime.server);
    await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
    const address = runtime.server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const call = (path: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, { method: "POST", headers: { authorization: `Bearer ${SERVICE_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const draftBody = {
      project_id: "autopilot-beta",
      brief: "Compare three provider approaches for the readiness ratchet",
      profile: "dev" as const,
      routes: [
        { provider: "codex_cli", model: "model-a", requested_reasoning_effort: "low" },
        { provider: "claude_cli", model: "model-a", requested_reasoning_effort: "low" },
        { provider: "agy_cli", model: "model-a", requested_reasoning_effort: "low" }
      ],
      synthesizer: "codex_cli",
      estimated_tokens: 50_000,
      arbitration_route: null
    };
    const created = await (await call("/brainstorms", draftBody)).json() as { brainstorm_id: string };
    const approve = await call(`/brainstorms/${created.brainstorm_id}/approve`, { operator: "owner" });
    expect(approve.status).toBe(200);

    await vi.waitFor(() => {
      const record = readBrainstormStore(stateDir).brainstorms.find((item) => item.brainstorm_id === created.brainstorm_id);
      expect(["completed", "needs_arbitration"]).toContain(record?.status);
    });

    await runtime.stop();
  });

  it("parks a needs_arbitration brainstorm out of automatic polling instead of re-ticking it every cycle", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-brainstorm-park-"));
    provisionServiceToken(stateDir);
    const projectRoot = join(stateDir, "projects");
    const projectCwd = join(projectRoot, "autopilot-beta");
    mkdirSync(projectCwd, { recursive: true });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: projectCwd, enabled: true }] });
    writeProviderQuotaStore(stateDir, {
      schema_version: "v1",
      snapshots: [snapshot("codex_cli", new Date().toISOString()), snapshot("claude_cli", new Date().toISOString()), snapshot("agy_cli", new Date().toISOString())]
    });
    const outputs = [
      "Alpha view",
      "Beta view",
      "Gamma view",
      JSON.stringify({ consensus: [], conflicts: [{ output_labels: ["A", "B"], summary: "diverging recommendation", material: true }], confidence: 0.4, final: "" })
    ];
    let dispatchCalls = 0;
    const runtime = createControlPlaneRuntime(stateDir, {
      projectRoot,
      scheduler: { start() {}, stop() {} },
      supervisorPollMs: 5,
      dispatch: async (handoff) => {
        const callCount = dispatchCalls++;
        return { refused: false, workerRunId: `poll-worker-${callCount}`, handoffId: handoff.handoffId, vendor: handoff.vendor, model: handoff.model ?? null, exitCode: 0, rawOutput: outputs[callCount] ?? "done", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn", workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true };
      }
    });
    servers.push(runtime.server);
    await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
    const address = runtime.server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const call = (path: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, { method: "POST", headers: { authorization: `Bearer ${SERVICE_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const draftBody = {
      project_id: "autopilot-beta",
      brief: "Compare three provider approaches for a policy that will need arbitration",
      profile: "dev" as const,
      routes: [
        { provider: "codex_cli", model: "model-a", requested_reasoning_effort: "low" },
        { provider: "claude_cli", model: "model-a", requested_reasoning_effort: "low" },
        { provider: "agy_cli", model: "model-a", requested_reasoning_effort: "low" }
      ],
      synthesizer: "codex_cli",
      estimated_tokens: 50_000,
      arbitration_route: { provider: "agy_cli", model: "model-a", requested_reasoning_effort: "low" }
    };
    const created = await (await call("/brainstorms", draftBody)).json() as { brainstorm_id: string };
    const approve = await call(`/brainstorms/${created.brainstorm_id}/approve`, { operator: "owner" });
    expect(approve.status).toBe(200);

    await vi.waitFor(() => {
      const record = readBrainstormStore(stateDir).brainstorms.find((item) => item.brainstorm_id === created.brainstorm_id);
      expect(record?.status).toBe("needs_arbitration");
    });
    const dispatchCallsAtArbitration = dispatchCalls;

    // Deliberately break the telemetry store so that any further coordinator tick of this
    // parked record (which re-emits a "consolidated" telemetry event) throws and surfaces as
    // an operational incident. If the poll still excludes needs_arbitration records, this file
    // is never touched again and no incident is recorded.
    writeFileSync(join(stateDir, "brainstorm-telemetry.json"), "{ not valid json", "utf8");

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(readIncidentStore(stateDir).incidents.length).toBe(0);
    expect(dispatchCalls).toBe(dispatchCallsAtArbitration);
    const parked = readBrainstormStore(stateDir).brainstorms.find((item) => item.brainstorm_id === created.brainstorm_id);
    expect(parked?.status).toBe("needs_arbitration");

    await runtime.stop();
  });

  it("keeps the supervisor poll running and recovers brainstorm progression after the store is repaired following corruption", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-brainstorm-corrupt-"));
    provisionServiceToken(stateDir);
    const projectRoot = join(stateDir, "projects");
    const projectCwd = join(projectRoot, "autopilot-beta");
    mkdirSync(projectCwd, { recursive: true });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: projectCwd, enabled: true }] });
    writeProviderQuotaStore(stateDir, {
      schema_version: "v1",
      snapshots: [snapshot("codex_cli", new Date().toISOString()), snapshot("claude_cli", new Date().toISOString()), snapshot("agy_cli", new Date().toISOString())]
    });
    writeFileSync(join(stateDir, "brainstorms.json"), "{ not valid json", "utf8");
    const outputs = ["Alpha view", "Beta view", "Gamma view", JSON.stringify({ consensus: ["aligned"], conflicts: [], confidence: 0.9, final: "Winning direction" })];
    let dispatchCalls = 0;
    const runtime = createControlPlaneRuntime(stateDir, {
      projectRoot,
      scheduler: { start() {}, stop() {} },
      supervisorPollMs: 5,
      dispatch: async (handoff) => {
        const callCount = dispatchCalls++;
        return { refused: false, workerRunId: `poll-worker-${callCount}`, handoffId: handoff.handoffId, vendor: handoff.vendor, model: handoff.model ?? null, exitCode: 0, rawOutput: outputs[callCount] ?? "done", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn", workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true };
      }
    });
    servers.push(runtime.server);
    await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
    const address = runtime.server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const call = (path: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, { method: "POST", headers: { authorization: `Bearer ${SERVICE_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) });

    await new Promise((resolve) => setTimeout(resolve, 60));

    const health = await fetch(`http://127.0.0.1:${address.port}/projects`, { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } });
    expect(health.status).toBe(200);
    expect(readIncidentStore(stateDir).incidents.length).toBeGreaterThan(0);
    expect(dispatchCalls).toBe(0);

    writeFileSync(join(stateDir, "brainstorms.json"), JSON.stringify({ schema_version: "v1", brainstorms: [] }), "utf8");

    const draftBody = {
      project_id: "autopilot-beta",
      brief: "Compare three provider approaches after store repair",
      profile: "dev" as const,
      routes: [
        { provider: "codex_cli", model: "model-a", requested_reasoning_effort: "low" },
        { provider: "claude_cli", model: "model-a", requested_reasoning_effort: "low" },
        { provider: "agy_cli", model: "model-a", requested_reasoning_effort: "low" }
      ],
      synthesizer: "codex_cli",
      estimated_tokens: 50_000,
      arbitration_route: null
    };
    const created = await (await call("/brainstorms", draftBody)).json() as { brainstorm_id: string };
    const approve = await call(`/brainstorms/${created.brainstorm_id}/approve`, { operator: "owner" });
    expect(approve.status).toBe(200);

    await vi.waitFor(() => {
      const record = readBrainstormStore(stateDir).brainstorms.find((item) => item.brainstorm_id === created.brainstorm_id);
      expect(["completed", "needs_arbitration"]).toContain(record?.status);
    });
    expect(dispatchCalls).toBeGreaterThan(0);

    await runtime.stop();
  });

  it("keeps authentication and cookie CSRF protection on mutations", async () => {
    const api = await governedApi();
    expect((await fetch(`${api.base}/projects`)).status).toBe(401);
    const login = await fetch(`${api.base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(api.base).origin },
      body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    });
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
    provisionServiceToken(stateDir);
    injectFailure(stateDir);
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");

    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } });
    const body = await response.json() as { error: string; incident_id: string; request_id: string };

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: "autopilot_internal_error", incident_id: expect.any(String), request_id: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain("injected-secret");
    expect(readIncidentStore(stateDir).incidents.some((incident) => incident.incident_id === body.incident_id)).toBe(true);
  });
  it("serves authenticated bounded observability summary and filtered timeline", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-observability-"));
    provisionServiceToken(stateDir);
    writeFileSync(join(stateDir, "cli-call-telemetry.jsonl"), [
      JSON.stringify({ recorded_at: "2026-07-12T10:00:00Z", worker_run_id: "w-1", handoff_id: "h-1", session_id: "s-1", provider: "openrouter", model: "m-1", total_tokens: 12, attempt_count: 2, prompt: "must stay private" }),
      JSON.stringify({ recorded_at: "2026-07-12T10:00:01Z", worker_run_id: "w-2", handoff_id: "h-2", session_id: "s-2", provider: "anthropic_claude", model: "m-2", total_tokens: 7, attempt_count: 1 })
    ].join("\n"));
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${base}/observability/summary`)).status).toBe(401);
    const headers = { authorization: `Bearer ${SERVICE_TOKEN}` };
    const summary = await (await fetch(`${base}/observability/summary`, { headers })).json() as { events: number; tokens: number; retries: number };
    expect(summary).toMatchObject({ events: 2, tokens: 19, retries: 1 });
    const result = await (await fetch(`${base}/observability/timeline?session_id=s-1&limit=99999`, { headers })).json() as { timeline: unknown[]; limits: { max_events: number } };
    expect(result.timeline).toHaveLength(1);
    expect(result.limits.max_events).toBe(1_000);
    expect(JSON.stringify(result)).not.toContain("must stay private");
  });
  it("enables only fixed built-in provider usage probes from the explicit allowlist", () => {
    expect(providerUsageCommandsFromEnvironment({ CONTROL_PLANE_USAGE_PROBES: "codex,agy,unknown" })).toEqual({
      codex_cli: { kind: "tmux_usage", executable: "codex" },
      agy_cli: { kind: "tmux_usage", executable: "agy" }
    });
    expect(providerUsageCommandsFromEnvironment({})).toEqual({});
  });
  it("marks an enabled provider unavailable when its configured executable cannot be resolved", () => {
    const binDir = join(mkdtempSync(join(tmpdir(), "control-plane-provider-bin-")), "bin");
    mkdirSync(binDir, { mode: 0o700 });
    const codexPath = join(binDir, "codex");
    writeFileSync(codexPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });

    expect(providerUsageCommandsFromEnvironment({
      CONTROL_PLANE_USAGE_PROBES: "codex,claude",
      AUTOPILOT_PROVIDER_CLI_BIN_DIR: binDir,
      PATH: "/untrusted/path"
    })).toEqual({
      codex_cli: { kind: "tmux_usage", executable: codexPath },
      claude_cli: { kind: "unavailable", error_code: "provider_executable_missing" }
    });
  });
  it("validates provider probe refresh bodies and fails closed without a lease controller", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-probe-refresh-unavailable-"));
    provisionServiceToken(stateDir);
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const url = `http://127.0.0.1:${address.port}/providers/probes/refresh`;
    const post = (body: unknown) => fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${SERVICE_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    const unauthorized = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providers: ["codex_cli"] })
    });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "unauthorized" });

    for (const body of [
      {},
      { providers: [] },
      { providers: ["codex_cli", "codex_cli"] },
      { providers: ["openrouter_api"] },
      { providers: ["codex_cli", "claude_cli", "agy_cli", "codex_cli"] }
    ]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_probe_refresh" });
    }

    const unavailable = await post({ providers: ["codex_cli"] });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "probe_refresh_unavailable" });
  });
  it("enforces cookie CSRF, accepts bearer refreshes, and audits only provider ids", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-probe-refresh-auth-"));
    const auth = await provisionAdminAuth(stateDir);
    const requestLease = vi.fn().mockReturnValue({
      accepted: ["codex_cli"],
      rejected: ["agy_cli"],
      expires_at: "2026-07-11T12:10:00.000Z"
    });
    const server = createControlPlaneServer(stateDir, {
      auth,
      probeLeases: {
        request: requestLease,
        state: () => ({ leased: false, expires_at: null })
      }
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(base).origin },
      body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const body = JSON.stringify({ providers: ["codex_cli", "agy_cli"] });

    const csrf = await fetch(`${base}/providers/probes/refresh`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body
    });
    expect(csrf.status).toBe(403);
    expect(await csrf.json()).toEqual({ error: "csrf_origin_required" });
    expect(requestLease).not.toHaveBeenCalled();

    const accepted = await fetch(`${base}/providers/probes/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${SERVICE_TOKEN}`, "content-type": "application/json" },
      body
    });
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({
      accepted: ["codex_cli"],
      rejected: ["agy_cli"],
      expires_at: "2026-07-11T12:10:00.000Z"
    });
    expect(requestLease).toHaveBeenCalledOnce();
    expect(requestLease).toHaveBeenCalledWith(["codex_cli", "agy_cli"]);
    const auditRecord = readFileSync(join(stateDir, "control-plane-audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>).find((record) => record.action === "provider_probe_refresh");
    expect(auditRecord).toEqual({ at: expect.any(String), action: "provider_probe_refresh", providers: ["codex_cli", "agy_cli"] });
    expect(Object.keys(auditRecord ?? {}).sort()).toEqual(["action", "at", "providers"]);
  });
  it("does not grant a probe lease when durable audit persistence fails", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-probe-refresh-audit-failure-"));
    provisionServiceToken(stateDir);
    mkdirSync(join(stateDir, "control-plane-audit.jsonl"));
    const requestLease = vi.fn();
    const server = createControlPlaneServer(stateDir, {
      probeLeases: {
        request: requestLease,
        state: () => ({ leased: false, expires_at: null })
      }
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");

    const response = await fetch(`http://127.0.0.1:${address.port}/providers/probes/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${SERVICE_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ providers: ["codex_cli"] })
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "autopilot_internal_error" });
    expect(requestLease).not.toHaveBeenCalled();
  });
  it("keeps provider GETs side-effect free and exposes read-only lease health", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-probe-refresh-gets-"));
    provisionServiceToken(stateDir);
    writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
    const requestLease = vi.fn();
    const leaseState = vi.fn().mockReturnValue({ leased: true, expires_at: "2026-07-11T12:10:00.000Z" });
    const server = createControlPlaneServer(stateDir, {
      probeLeases: { request: requestLease, state: leaseState }
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    const init = { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } };

    expect((await fetch(`${base}/providers/quotas`, init)).status).toBe(200);
    expect((await fetch(`${base}/providers/models`, init)).status).toBe(200);
    const health = await (await fetch(`${base}/providers/health`, init)).json() as {
      providers: Array<{ provider: string; lease: { leased: boolean; expires_at: string | null } }>;
    };

    expect(requestLease).not.toHaveBeenCalled();
    expect(leaseState).toHaveBeenCalledOnce();
    expect(leaseState).toHaveBeenCalledWith("codex_cli");
    expect(health.providers[0]?.lease).toEqual({ leased: true, expires_at: "2026-07-11T12:10:00.000Z" });
  });
  it("parses secure-cookie configuration strictly", () => {
    expect(secureCookiesFromEnvironment({})).toBe(false);
    expect(secureCookiesFromEnvironment({ CONTROL_PLANE_SECURE_COOKIES: "true" })).toBe(true);
    expect(secureCookiesFromEnvironment({ CONTROL_PLANE_SECURE_COOKIES: " FALSE " })).toBe(false);
    expect(() => secureCookiesFromEnvironment({ CONTROL_PLANE_SECURE_COOKIES: "maybe" }))
      .toThrow("invalid_secure_cookie_configuration");
  });
  it("parses the independent secure-cookie requirement policy strictly", () => {
    expect(secureCookiesRequiredFromEnvironment({})).toBe(false);
    expect(secureCookiesRequiredFromEnvironment({ CONTROL_PLANE_REQUIRE_SECURE_COOKIES: "true" })).toBe(true);
    expect(secureCookiesRequiredFromEnvironment({ CONTROL_PLANE_REQUIRE_SECURE_COOKIES: " FALSE " })).toBe(false);
    // Independent of CONTROL_PLANE_SECURE_COOKIES so a single flag cannot mask its own absence.
    expect(secureCookiesRequiredFromEnvironment({ CONTROL_PLANE_SECURE_COOKIES: "true" })).toBe(false);
    expect(() => secureCookiesRequiredFromEnvironment({ CONTROL_PLANE_REQUIRE_SECURE_COOKIES: "maybe" }))
      .toThrow("invalid_secure_cookie_configuration");
  });
  it("fails runtime readiness closed when secure cookies are required but disabled", async () => {
    // Everything else is provisioned so /ready would be 200; only the independent
    // secure-cookie policy is violated, isolating the wiring fix (the requirement must
    // NOT be derived from secureCookies, or it could never fire in production).
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-require-secure-"));
    const projectRoot = join(stateDir, "projects");
    mkdirSync(projectRoot, { mode: 0o700 });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [] });
    const credentialsPath = `${stateDir}-admin-credentials.json`;
    writeAdminCredentials(credentialsPath, {
      version: ADMIN_CREDENTIALS_VERSION,
      username: "admin",
      ...await hashPassword("admin", "readiness-password"),
      credential_generation: 1
    });
    const authRegistry = new AuthSessionRegistry(authStateRoot(stateDir));
    authRegistry.storeServiceToken("c".repeat(64));
    const runtime = createControlPlaneRuntime(stateDir, {
      projectRoot,
      auth: { adminCredentialsPath: credentialsPath, sessionRegistry: authRegistry, serviceToken: authRegistry },
      scheduler: { start() {}, stop() {} },
      providerCommands: {},
      openRouterConfigured: false,
      supervisorPollMs: 60_000,
      secureCookies: false,
      secureCookiesRequired: true
    });
    await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
    try {
      const address = runtime.server.address();
      if (address === null || typeof address === "string") throw new Error("missing address");
      const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
      const body = await response.json() as ReadinessReport;
      expect(response.status).toBe(503);
      expect(body.components.authentication).toEqual({ status: "unavailable", error_code: "secure_cookies_required" });
    } finally {
      await runtime.stop();
    }
  });
  it("creates an HttpOnly browser session and accepts it for protected requests", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    const auth = await provisionAdminAuth(stateDir);
    const server = createControlPlaneServer(stateDir, { auth });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    const unauthorized = await fetch(`${base}/status`);
    expect(unauthorized.status).toBe(401);
    const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: new URL(base).origin }, body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }) });
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
    const auth = await provisionAdminAuth(stateDir);
    const server = createControlPlaneServer(stateDir, { auth, secureCookies: true });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: `https://${new URL(base).host}` }, body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }) });
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toContain("Secure");
    const cookieHeader = cookie.split(";")[0]!;
    const csrf = await fetch(`${base}/auth/logout`, { method: "POST", headers: { cookie: cookieHeader, origin: "https://evil.example" } });
    expect(csrf.status).toBe(403);
    const logout = await fetch(`${base}/auth/logout`, { method: "POST", headers: { cookie: cookieHeader, origin: `https://${new URL(base).host}` } });
    expect(logout.status).toBe(200);
  });

  it("rejects invalid browser credentials", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    const auth = await provisionAdminAuth(stateDir);
    const server = createControlPlaneServer(stateDir, { auth });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: new URL(base).origin }, body: JSON.stringify({ username: ADMIN_USERNAME, password: "wrong-password" }) });
    expect(response.status).toBe(401);
    expect(existsSync(join(authStateRoot(stateDir), "sessions.json"))).toBe(false);
  });

  it("authenticates an admin password with a durable opaque cookie and invalidates it after a generation bump", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-admin-login-"));
    const credentialsPath = `${stateDir}-admin-credentials.json`;
    const sessionRegistry = new AuthSessionRegistry(authStateRoot(stateDir));
    writeAdminCredentials(credentialsPath, {
      version: ADMIN_CREDENTIALS_VERSION,
      username: "admin.owner",
      ...await hashPassword("admin.owner", "correct-password-value"),
      credential_generation: 1
    });
    const auth = { adminCredentialsPath: credentialsPath, sessionRegistry, serviceToken: sessionRegistry };
    const server = createControlPlaneServer(stateDir, { auth });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;

    const login = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(base).origin },
      body: JSON.stringify({ username: "admin.owner", password: "correct-password-value" })
    });

    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toMatch(/autopilot_session=[A-Za-z0-9_-]{43};/);
    const cookieHeader = cookie.split(";")[0]!;
    expect((await fetch(`${base}/status`, { headers: { cookie: cookieHeader } })).status).toBe(200);
    expect(readFileSync(join(authStateRoot(stateDir), "sessions.json"), "utf8")).not.toContain(cookieHeader.split("=")[1]);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    const restarted = createControlPlaneServer(stateDir, { auth });
    servers.push(restarted);
    await new Promise<void>((resolve) => restarted.listen(0, "127.0.0.1", resolve));
    const restartedAddress = restarted.address();
    if (restartedAddress === null || typeof restartedAddress === "string") throw new Error("missing address");
    expect((await fetch(`http://127.0.0.1:${restartedAddress.port}/status`, { headers: { cookie: cookieHeader } })).status).toBe(200);

    unlinkSync(credentialsPath);
    expect((await fetch(`http://127.0.0.1:${restartedAddress.port}/status`, { headers: { cookie: cookieHeader } })).status).toBe(401);

    writeAdminCredentials(credentialsPath, {
      version: ADMIN_CREDENTIALS_VERSION,
      username: "admin.owner",
      ...await hashPassword("admin.owner", "replacement-password-value"),
      credential_generation: 2
    });
    expect((await fetch(`http://127.0.0.1:${restartedAddress.port}/status`, { headers: { cookie: cookieHeader } })).status).toBe(401);
  });

  it("accepts the service bearer and rejects other bearers", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-service-bearer-"));
    const registry = new AuthSessionRegistry(authStateRoot(stateDir));
    const serviceToken = "a".repeat(64);
    registry.storeServiceToken(serviceToken, Date.now());
    const server = createControlPlaneServer(stateDir, {
      auth: { adminCredentialsPath: `${stateDir}-missing.json`, sessionRegistry: registry, serviceToken: registry }
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;

    expect((await fetch(`${base}/status`, { headers: { authorization: `Bearer ${serviceToken}` } })).status).toBe(200);
    expect((await fetch(`${base}/status`, { headers: { authorization: `Bearer ${"b".repeat(64)}` } })).status).toBe(401);
  });

  it("rejects cross-origin and origin-less login plus every unsafe cross-origin cookie request", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-login-origin-"));
    const auth = await provisionAdminAuth(stateDir);
    const server = createControlPlaneServer(stateDir, { auth });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    const loginBody = JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    expect((await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: loginBody
    })).status).toBe(403);
    expect((await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: loginBody
    })).status).toBe(403);

    const login = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(base).origin },
      body: loginBody
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "PROPPATCH"]) {
      const response = await fetch(`${base}/status`, {
        method,
        headers: { cookie, origin: "https://attacker.example" }
      });
      expect(response.status, method).toBe(403);
    }
  });

  it("pins secure-cookie same-origin validation to https", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-secure-origin-"));
    const auth = await provisionAdminAuth(stateDir);
    const server = createControlPlaneServer(stateDir, { auth, secureCookies: true });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    const body = JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    expect((await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(base).origin },
      body
    })).status).toBe(403);
    expect((await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: `https://${new URL(base).host}` },
      body
    })).status).toBe(200);
  });

  it("reissues the browser cookie when the durable registry renews sliding expiry", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-session-renew-"));
    const rawToken = "d".repeat(43);
    const sessionRegistry = new AuthSessionRegistry(authStateRoot(stateDir));
    sessionRegistry.createSession(rawToken, Number.MAX_SAFE_INTEGER, Date.now() - SESSION_RENEW_AFTER_MS - 1_000);
    const server = createControlPlaneServer(stateDir, {
      auth: { adminCredentialsPath: `${stateDir}-missing.json`, sessionRegistry, serviceToken: sessionRegistry }
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");

    const response = await fetch(`http://127.0.0.1:${address.port}/auth/session`, {
      headers: { cookie: `autopilot_session=${rawToken}` }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(`autopilot_session=${rawToken}`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=2592000");
    const body = await response.json() as { authenticated: boolean; expires_at: string };
    expect(body.authenticated).toBe(true);
    expect(Date.parse(body.expires_at)).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1_000);
  });

  it("rejects cross-origin cookie mutations before durable session renewal", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-csrf-renew-"));
    const rawToken = "e".repeat(43);
    const sessionRegistry = new AuthSessionRegistry(authStateRoot(stateDir));
    sessionRegistry.createSession(rawToken, Number.MAX_SAFE_INTEGER, Date.now() - SESSION_RENEW_AFTER_MS - 1_000);
    const sessionsPath = join(authStateRoot(stateDir), "sessions.json");
    const before = readFileSync(sessionsPath, "utf8");
    const server = createControlPlaneServer(stateDir, {
      auth: { adminCredentialsPath: `${stateDir}-missing.json`, sessionRegistry, serviceToken: sessionRegistry }
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");

    const response = await fetch(`http://127.0.0.1:${address.port}/status`, {
      method: "POST",
      headers: {
        cookie: `autopilot_session=${rawToken}`,
        origin: "https://attacker.example"
      }
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(readFileSync(sessionsPath, "utf8")).toBe(before);
  });

  it("creates and mutates sessions through authenticated endpoints", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    provisionServiceToken(stateDir);
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    const init = { headers: { authorization: `Bearer ${SERVICE_TOKEN}`, "content-type": "application/json" } };
    const created = await (await fetch(`${base}/sessions`, { ...init, method: "POST", body: JSON.stringify({ agent_command: "codex_cli", cwd: "/work" }) })).json() as { session_id: string; status: string };
    expect(created.status).toBe("active");
    const closed = await (await fetch(`${base}/sessions/${created.session_id}`, { ...init, method: "POST", body: JSON.stringify({ action: "close" }) })).json() as { status: string };
    expect(closed.status).toBe("closed");
  });

  it("returns authenticated bounded worker records", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    provisionServiceToken(stateDir);
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const response = await fetch(`http://127.0.0.1:${address.port}/workers`, { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("marks a worker start older than the lock TTL as stale when no stop exists", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    provisionServiceToken(stateDir);
    writeFileSync(join(stateDir, "agent-registry.jsonl"), `${JSON.stringify({ event: "subagent_start", agent_id: "stale-worker", agent_type: "codex", started_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() })}\n`);
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");

    const response = await fetch(`http://127.0.0.1:${address.port}/workers`, { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } });
    const workers = await response.json() as Array<{ status: string; error_reason: string | null; finished_at: string | null }>;

    expect(workers[0]).toMatchObject({ status: "error", error_reason: "worker_stale_no_stop_event", finished_at: null });
  });

  it("keeps a recent worker start running when no stop exists", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    provisionServiceToken(stateDir);
    writeFileSync(join(stateDir, "agent-registry.jsonl"), `${JSON.stringify({ event: "subagent_start", agent_id: "recent-worker", agent_type: "codex", started_at: new Date(Date.now() - 5_000).toISOString() })}\n`);
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");

    const response = await fetch(`http://127.0.0.1:${address.port}/workers`, { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } });
    const workers = await response.json() as Array<{ status: string; error_reason: string | null }>;

    expect(workers[0]).toMatchObject({ status: "running", error_reason: null });
  });

  it("fails closed for an unparseable worker start with no stop", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    provisionServiceToken(stateDir);
    writeFileSync(join(stateDir, "agent-registry.jsonl"), `${JSON.stringify({ event: "subagent_start", agent_id: "invalid-start-worker", agent_type: "codex", started_at: "not-a-date" })}\n`);
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");

    const response = await fetch(`http://127.0.0.1:${address.port}/workers`, { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } });
    const workers = await response.json() as Array<{ status: string; error_reason: string | null }>;

    expect(workers[0]).toMatchObject({ status: "error", error_reason: "worker_stale_no_stop_event" });
  });

  it("reads status telemetry from a bounded tail", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    provisionServiceToken(stateDir);
    writeFileSync(join(stateDir, "cli-call-telemetry.jsonl"), `${"invalid-line\n".repeat(300_000)}${JSON.stringify({ outcome: "success", total_tokens: 7 })}\n`);
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const response = await fetch(`http://127.0.0.1:${address.port}/status`, { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } });
    const body = await response.json() as { telemetry: { calls: number; total_tokens: number } };
    expect(body.telemetry).toEqual({ calls: 1, successful: 1, total_tokens: 7 });
  });

  it("bounds worker output and ignores unsafe worker ids", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    provisionServiceToken(stateDir);
    writeFileSync(join(stateDir, "agent-registry.jsonl"), `${JSON.stringify({ event: "subagent_start", agent_id: "../outside", agent_type: "codex", started_at: new Date().toISOString() })}\n${JSON.stringify({ event: "subagent_start", agent_id: "safe-worker", agent_type: "codex", started_at: new Date().toISOString() })}\n`);
    writeFileSync(join(stateDir, "safe-worker-output.txt"), `${"x".repeat(50_000)}\npassword=worker-secret cookie: session-secret`);
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const response = await fetch(`http://127.0.0.1:${address.port}/workers`, { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } });
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
    const response = await request("/providers/quotas", SERVICE_TOKEN);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providers: [] });
  });

  it("serves the static model catalog as configured but unobserved and unavailable", async () => {
    const response = await request("/providers/models", SERVICE_TOKEN);
    const body = await response.json() as {
      models: Array<{
        model_id: string;
        providers: string[];
        configured: boolean;
        observed: boolean;
        available: boolean;
        health: string[];
        source: string;
        provider_routes: Array<{
          provider: string;
          configured: boolean;
          observed: boolean;
          available: boolean;
          health: string[];
          discovery: string;
          source: string;
          reasoning_efforts: string[];
        }>;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        model_id: "gpt-5.6-sol",
        providers: ["codex_cli"],
        configured: true,
        observed: false,
        available: false,
        health: ["unavailable"],
        source: "static_fallback",
        provider_routes: [{
          provider: "codex_cli",
          configured: true,
          observed: false,
          available: false,
          health: ["unavailable"],
          discovery: "static",
          source: "static_fallback",
          reasoning_efforts: ["low", "medium", "high", "xhigh"]
        }]
      }),
      expect.objectContaining({
        model_id: "claude-opus-4-8",
        providers: ["claude_cli"],
        source: "static_fallback"
      }),
      expect.objectContaining({
        model_id: "gemini-3.5-flash-medium",
        providers: ["agy_cli"],
        source: "static_fallback"
      })
    ]));
  });

  it("does not let static configuration override negative live availability", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    provisionServiceToken(stateDir);
    writeProviderQuotaStore(stateDir, {
      schema_version: "v1",
      snapshots: [{
        ...snapshot("codex_cli", new Date().toISOString()),
        models: [{ model_id: "gpt-5.6-sol", available: false, health: "unavailable", source: "api" }]
      }]
    });
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");

    const body = await (await fetch(`http://127.0.0.1:${address.port}/providers/models`, {
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` }
    })).json() as {
      models: Array<{
        model_id: string;
        providers: string[];
        configured: boolean;
        observed: boolean;
        available: boolean;
        source: string;
        provider_routes: Array<{
          provider: string;
          configured: boolean;
          observed: boolean;
          available: boolean;
          source: string;
        }>;
      }>;
    };

    expect(body.models.filter((model) => model.model_id === "gpt-5.6-sol" && model.providers.includes("codex_cli")))
      .toEqual([expect.objectContaining({
        configured: true,
        observed: true,
        available: false,
        source: "mixed",
        provider_routes: [expect.objectContaining({
          provider: "codex_cli",
          configured: true,
          observed: true,
          available: false,
          source: "mixed"
        })]
      })]);
  });

  it("preserves provider-specific availability when providers share a live model id", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    provisionServiceToken(stateDir);
    writeProviderQuotaStore(stateDir, {
      schema_version: "v1",
      snapshots: [
        {
          ...snapshot("codex_cli", new Date().toISOString()),
          models: [{ model_id: "shared-live-model", available: true, health: "healthy", source: "api" }]
        },
        {
          ...snapshot("claude_cli", new Date().toISOString()),
          models: [{ model_id: "shared-live-model", available: false, health: "unavailable", source: "api" }]
        }
      ]
    });
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");

    const body = await (await fetch(`http://127.0.0.1:${address.port}/providers/models`, {
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` }
    })).json() as {
      models: Array<{
        model_id: string;
        configured: boolean;
        observed: boolean;
        available: boolean;
        source: string;
        provider_routes: Array<{
          provider: string;
          configured: boolean;
          observed: boolean;
          available: boolean;
          health: string[];
          source: string;
        }>;
      }>;
    };
    const shared = body.models.find((model) => model.model_id === "shared-live-model");

    expect(shared).toMatchObject({ configured: false, observed: true, available: true, source: "live_snapshot" });
    expect(shared?.provider_routes).toEqual([
      expect.objectContaining({ provider: "claude_cli", configured: false, observed: true, available: false, health: ["unavailable"], source: "live_snapshot" }),
      expect.objectContaining({ provider: "codex_cli", configured: false, observed: true, available: true, health: ["healthy"], source: "live_snapshot" })
    ]);
  });

  it("returns stale snapshots and filters a provider", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    provisionServiceToken(stateDir);
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const document: ProviderQuotaStoreDocument = { schema_version: "v1", snapshots: [snapshot("codex_cli", old), snapshot("claude_cli", old)] };
    writeProviderQuotaStore(stateDir, document);
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const response = await fetch(`http://127.0.0.1:${address.port}/providers/codex_cli/quotas`, { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } });
    const body = await response.json() as { provider: string; freshness: string; next_poll_at: string };
    expect(body.provider).toBe("codex_cli");
    expect(body.freshness).toBe("stale");
  expect(body.next_poll_at).toBeNull();
  });

  it("aggregates models and exposes health", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "control-plane-"));
    provisionServiceToken(stateDir);
    writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [snapshot("codex_cli", new Date().toISOString())] });
    const server = createControlPlaneServer(stateDir);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    const init = { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } };
    const models = await (await fetch(`http://127.0.0.1:${address.port}/providers/models`, init)).json() as { models: Array<{ model_id: string }> };
    const health = await (await fetch(`http://127.0.0.1:${address.port}/providers/health`, init)).json() as { providers: Array<{ freshness: string }> };
    expect(models.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        model_id: "model-a",
        providers: ["codex_cli"],
        configured: false,
        observed: true,
        available: true,
        health: ["healthy"],
        reasoning_efforts: ["low", "medium", "high", "xhigh"],
        provider_routes: [{
          provider: "codex_cli",
          configured: false,
          observed: true,
          available: true,
          health: ["healthy"],
          discovery: "usage_probe",
          source: "live_snapshot",
          reasoning_efforts: ["low", "medium", "high", "xhigh"]
        }]
      }),
      expect.objectContaining({
        model_id: "gpt-5.6-sol",
        providers: ["codex_cli"],
        configured: true,
        observed: false,
        available: false,
        source: "static_fallback"
      })
    ]));
    expect(health.providers[0]?.freshness).toBe("fresh");
  });
});
