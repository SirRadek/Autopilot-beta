import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createControlPlaneServer } from "../../scripts/control-plane-server";
import { classifyBrainstormErrorCode } from "../../scripts/control-plane-brainstorms";
import { AuthSessionRegistry, authStateRoot } from "../../src/data/delivery-system/authSessionRegistry";
import { estimateBrainstormTokenEnvelope } from "../../src/data/delivery-system/brainstormBudget";
import { createBrainstormCoordinator } from "../../src/data/delivery-system/brainstormCoordinator";
import { createBrainstorm, readBrainstormStore } from "../../src/data/delivery-system/brainstormStore";
import { readBrainstormTelemetry } from "../../src/data/delivery-system/brainstormTelemetry";
import { writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";
import { createRunOrchestrator } from "../../src/data/delivery-system/runOrchestrator";
import { readRunStore } from "../../src/data/delivery-system/runStore";
import { SupervisorQueue } from "../../src/data/delivery-system/supervisorQueue";
import { TokenGateway } from "../../src/data/delivery-system/tokenGateway";
import { writeProviderQuotaStore } from "../../src/data/delivery-system/providerQuotaStore";

const SERVICE_TOKEN = "c".repeat(64);
const servers: ReturnType<typeof createControlPlaneServer>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

const snapshot = (provider: string, fetchedAt: string, overrides: Partial<{ readonly health: "healthy" | "degraded" | "unavailable"; readonly modelId: string }> = {}) => ({
  provider, source: "api" as const, fetched_at: fetchedAt, observed_at: fetchedAt,
  five_hour: { limit: 100, used: 20, remaining: 80, resets_at: null },
  weekly: { limit: 1_000, used: 100, remaining: 900, resets_at: null }, api_spend: 1.25, currency: "USD",
  models: [{ model_id: overrides.modelId ?? "model-a", available: true, health: "healthy" as const, source: "api" as const }], health: "healthy" as const, error_code: null,
  ...overrides
});

const defaultSnapshots = () => [
  snapshot("codex_cli", new Date().toISOString()),
  snapshot("claude_cli", new Date().toISOString()),
  snapshot("agy_cli", new Date().toISOString())
];

const lifecycleSnapshots = (fetchedAt = new Date().toISOString()) => [
  snapshot("codex_cli", fetchedAt, { modelId: "gpt-5.6-sol" }),
  snapshot("claude_cli", fetchedAt, { modelId: "claude-opus-4-8" }),
  snapshot("agy_cli", fetchedAt, { modelId: "gemini-3.1-pro-high" })
];

async function brainstormApi(options: {
  readonly runOrchestrator?: ReturnType<typeof createRunOrchestrator>;
  readonly snapshots?: readonly ReturnType<typeof snapshot>[];
  readonly stateDir?: string;
  readonly projectRoot?: string;
} = {}) {
  const stateDir = options.stateDir ?? mkdtempSync(join(tmpdir(), "control-plane-brainstorms-"));
  const projectRoot = options.projectRoot ?? join(stateDir, "projects");
  if (options.stateDir === undefined) {
    const projectCwd = join(projectRoot, "autopilot-beta");
    mkdirSync(projectCwd, { recursive: true });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: projectCwd, enabled: true }] });
    writeProviderQuotaStore(stateDir, {
      schema_version: "v1",
      snapshots: options.snapshots ?? defaultSnapshots()
    });
  }
  new AuthSessionRegistry(authStateRoot(stateDir)).storeServiceToken(SERVICE_TOKEN);
  const server = createControlPlaneServer(stateDir, { projectRoot, ...(options.runOrchestrator === undefined ? {} : { runOrchestrator: options.runOrchestrator }) });
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

// A minimal three-provider DEV draft; later steps (malformed JSON, content-type/64KiB limits,
// project/route/quota/reasoning/token validation, concurrent approval, arbitration, cancellation)
// will extend/derive from this shared shape rather than redefine it.
const validDraft = {
  project_id: "autopilot-beta",
  brief: "Compare three provider approaches for the delivery-system readiness ratchet",
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

describe("control plane governed brainstorm API (RED)", () => {
  it("expects 201 on an authenticated POST /brainstorms with a valid three-provider DEV draft", async () => {
    const api = await brainstormApi();

    const response = await api.call("POST", "/brainstorms", validDraft);

    expect(response.status).toBe(201);
  });

  it("rejects an unauthenticated POST /brainstorms with 401", async () => {
    const api = await brainstormApi();

    const response = await fetch(`${api.base}/brainstorms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validDraft)
    });

    expect(response.status).toBe(401);
  });

  it("expects 200 on an authenticated GET /brainstorms", async () => {
    const api = await brainstormApi();

    const response = await api.call("GET", "/brainstorms");

    expect(response.status).toBe(200);
  });
});

// Full governed lifecycle: approve/arbitrate/cancel wired through options.runOrchestrator and
// createBrainstormCoordinator, exercised with a real injected test orchestrator (scripted
// dispatch only) so atomic persistence, reservation, and CAS behavior are never mocked away.
const now = "2026-07-22T13:00:00.000Z";
const brief = "Find the strongest implementation direction without changing the requested route.";
const routes = [
  { provider: "codex_cli" as const, model: "gpt-5.6-sol", reasoning_effort: "high" as const, estimated_tokens: 12_000 },
  { provider: "claude_cli" as const, model: "claude-opus-4-8", reasoning_effort: "high" as const, estimated_tokens: 12_000 },
  { provider: "agy_cli" as const, model: "gemini-3.1-pro-high", reasoning_effort: "high" as const, estimated_tokens: 12_000 }
] as const;
const synthesizer = { provider: "claude_cli" as const, model: "claude-opus-4-8", reasoning_effort: "high" as const, estimated_tokens: 20_000 };
const arbitration = { provider: "codex_cli" as const, model: "gpt-5.6-sol", reasoning_effort: "xhigh" as const, estimated_tokens: 16_000 };

async function lifecycleApi(outputs: string[] = []) {
  const stateDir = mkdtempSync(join(tmpdir(), "control-plane-brainstorms-lifecycle-"));
  const projectRoot = join(stateDir, "projects");
  const projectCwd = join(projectRoot, "alpha");
  mkdirSync(projectCwd, { recursive: true });
  writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: projectCwd, enabled: true }] });
  writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: lifecycleSnapshots() });
  const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: `worker-${dispatch.mock.calls.length}`, rawOutput: outputs.shift() ?? "candidate", exitCode: 0, model: null }));
  const runOrchestrator = createRunOrchestrator({
    stateDir, projectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }),
    dispatch: dispatch as never, now: () => now, isRouteAvailable: () => true
  });
  const brainstorm = createBrainstorm(stateDir, {
    project_id: "alpha", brief, routes, synthesizer_route: synthesizer, arbitration_route: arbitration,
    token_envelope: estimateBrainstormTokenEnvelope(routes, synthesizer.estimated_tokens, arbitration.estimated_tokens)
  }, now);
  const api = await brainstormApi({ runOrchestrator, stateDir, projectRoot });
  return { ...api, stateDir, projectRoot, dispatch, runOrchestrator, brainstorm };
}

async function finishQueuedRuns(runOrchestrator: ReturnType<typeof createRunOrchestrator>, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) await runOrchestrator.runSupervisorOnce();
}

describe("control plane governed brainstorm HTTP actions", () => {
  it("rejects malformed JSON on POST /brainstorms with 400", async () => {
    const api = await brainstormApi();

    const response = await api.call("POST", "/brainstorms", "{not json", { "content-type": "application/json" });

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toBe("invalid_json_body");
  });

  it("rejects a mutating POST with a missing or wrong content type with 415", async () => {
    const api = await brainstormApi();

    const missing = await fetch(`${api.base}/brainstorms`, { method: "POST", headers: { authorization: `Bearer ${SERVICE_TOKEN}` }, body: JSON.stringify(validDraft) });
    const wrong = await api.call("POST", "/brainstorms", JSON.stringify(validDraft), { "content-type": "text/plain" });

    expect(missing.status).toBe(415);
    expect(wrong.status).toBe(415);
  });

  it("rejects a POST body over 64KiB with 413", async () => {
    const api = await brainstormApi();
    const oversized = { ...validDraft, brief: "x".repeat(70 * 1024) };

    const response = await api.call("POST", "/brainstorms", oversized);

    expect(response.status).toBe(413);
    expect((await response.json() as { error: string }).error).toBe("request_body_too_large");
  });

  it("rejects duplicate providers across routes with 400", async () => {
    const api = await brainstormApi();
    const duplicate = { ...validDraft, routes: [validDraft.routes[0], validDraft.routes[0], validDraft.routes[1]] };

    const response = await api.call("POST", "/brainstorms", duplicate);

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toBe("invalid_brainstorm_draft");
  });

  it.each([
    { label: "stale", codexSnapshot: snapshot("codex_cli", new Date(Date.now() - 10 * 60 * 1000).toISOString()) },
    { label: "unavailable", codexSnapshot: snapshot("codex_cli", new Date().toISOString(), { health: "unavailable" as const }) }
  ])("rejects a $label provider route with 409", async ({ codexSnapshot }) => {
    const api = await brainstormApi({ snapshots: [codexSnapshot, snapshot("claude_cli", new Date().toISOString()), snapshot("agy_cli", new Date().toISOString())] });

    const response = await api.call("POST", "/brainstorms", validDraft);

    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toBe("brainstorm_route_unavailable");
  });

  it("rejects an unsupported reasoning effort for a provider with 409", async () => {
    const api = await brainstormApi();
    const invalidReasoning = { ...validDraft, routes: [validDraft.routes[0], validDraft.routes[1], { ...validDraft.routes[2], requested_reasoning_effort: "xhigh" }] };

    const response = await api.call("POST", "/brainstorms", invalidReasoning);

    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toBe("unsupported_reasoning_effort");
  });

  it("rejects a route with a missing requested_reasoning_effort field with 400 instead of silently defaulting", async () => {
    const api = await brainstormApi();
    const route2 = validDraft.routes[2] as Record<string, unknown>;
    const missingField = { ...route2 };
    delete missingField.requested_reasoning_effort;
    const missingReasoning = { ...validDraft, routes: [validDraft.routes[0], validDraft.routes[1], missingField] };

    const response = await api.call("POST", "/brainstorms", missingReasoning);

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toBe("invalid_brainstorm_draft");
  });

  it("rejects null requested_reasoning_effort for a provider that requires one with 409 instead of silently defaulting", async () => {
    const api = await brainstormApi();
    const nullReasoning = { ...validDraft, routes: [validDraft.routes[0], validDraft.routes[1], { ...validDraft.routes[2], requested_reasoning_effort: null }] };

    const response = await api.call("POST", "/brainstorms", nullReasoning);

    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toBe("unsupported_reasoning_effort");
  });

  it("rejects an estimated token budget too small to allocate across routes with 409", async () => {
    const api = await brainstormApi();
    const underflow = { ...validDraft, estimated_tokens: 2 };

    const response = await api.call("POST", "/brainstorms", underflow);

    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toBe("brainstorm_token_budget_insufficient");
  });

  it("rejects a POST /brainstorms body that omits arbitration_route with 400 instead of silently defaulting", async () => {
    const api = await brainstormApi();
    const missingArbitration = { ...validDraft } as Record<string, unknown>;
    delete missingArbitration.arbitration_route;

    const response = await api.call("POST", "/brainstorms", missingArbitration);

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toBe("invalid_brainstorm_draft");
  });

  it("persists a non-null arbitration_route and allocates estimated_tokens canonically across fanout, synthesis, and arbitration", async () => {
    const api = await brainstormApi();
    const withArbitration = {
      ...validDraft,
      arbitration_route: { provider: "agy_cli", model: "model-a", requested_reasoning_effort: "low" }
    };

    const response = await api.call("POST", "/brainstorms", withArbitration);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body.arbitration_route).toMatchObject({ provider: "agy_cli", model: "model-a", reasoning_effort: "low" });
    const envelope = body.token_envelope as { readonly maximum_tokens: number };
    expect(envelope.maximum_tokens).toBe(validDraft.estimated_tokens);
    const arbitrationSlot = (body.slots as { readonly slot_id: string; readonly stage: string }[]).find((slot) => slot.stage === "arbitration");
    expect(arbitrationSlot).toBeDefined();
  });

  it("rejects an arbitration_route with an unsupported reasoning effort with 409, exactly like a fanout route", async () => {
    const api = await brainstormApi();
    const badArbitration = {
      ...validDraft,
      arbitration_route: { provider: "agy_cli", model: "model-a", requested_reasoning_effort: "xhigh" }
    };

    const response = await api.call("POST", "/brainstorms", badArbitration);

    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toBe("unsupported_reasoning_effort");
  });

  it("keeps an explicit null arbitration_route a valid draft, but fails closed instead of zombie needs_arbitration on a material conflict", async () => {
    const conflictJson = JSON.stringify({ consensus: [], conflicts: [{ output_labels: ["B", "C"], summary: "material disagreement", material: true }], confidence: 0.4, final: "provisional" });
    const api = await lifecycleApi(["A", "B", "C", conflictJson]);
    const stateDir = api.stateDir;
    const noArbitrationBrainstorm = createBrainstorm(stateDir, {
      project_id: "alpha", brief, routes, synthesizer_route: synthesizer, arbitration_route: null,
      token_envelope: estimateBrainstormTokenEnvelope(routes, synthesizer.estimated_tokens, 0)
    }, now);

    const approve = await api.call("POST", `/brainstorms/${noArbitrationBrainstorm.brainstorm_id}/approve`, { operator: "owner" });
    expect(approve.status).toBe(200);
    await finishQueuedRuns(api.runOrchestrator, 3);
    const directCoordinator = createBrainstormCoordinator({ stateDir, runOrchestrator: api.runOrchestrator, now: () => now });
    await directCoordinator.tick(noArbitrationBrainstorm.brainstorm_id);
    await api.runOrchestrator.runSupervisorOnce();
    const settled = await directCoordinator.tick(noArbitrationBrainstorm.brainstorm_id);

    expect(settled.status).toBe("failed");
    expect(settled.status).not.toBe("needs_arbitration");
  });

  it("emits exactly one privacy-safe created telemetry event immediately on POST /brainstorms", async () => {
    const api = await brainstormApi();

    const response = await api.call("POST", "/brainstorms", validDraft);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    const events = readBrainstormTelemetry(api.stateDir).events.filter((event) => event.brainstorm_id === body.brainstorm_id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "created", brainstorm_id: body.brainstorm_id, provider_count: 3, actual_tokens: null });
    expect(JSON.stringify(events[0])).not.toContain(validDraft.brief);
    expect(Object.keys(events[0]!).sort()).toEqual(
      ["actual_tokens", "at", "brainstorm_id", "duration_ms", "event", "estimated_tokens", "material_conflict_count", "provider_count", "schema_version"].sort()
    );
  });

  it("returns 404 for a missing brainstorm record on GET and on approve", async () => {
    const api = await brainstormApi();

    const get = await api.call("GET", "/brainstorms/does-not-exist");
    const approve = await api.call("POST", "/brainstorms/does-not-exist/approve", { operator: "owner" });

    expect(get.status).toBe(404);
    expect((await get.json() as { error: string }).error).toBe("brainstorm_not_found");
    expect(approve.status).toBe(404);
    expect((await approve.json() as { error: string }).error).toBe("brainstorm_not_found");
  });

  it("rejects approval after route snapshots expire without changing state or reserving tokens", async () => {
    const api = await lifecycleApi();
    const before = readBrainstormStore(api.stateDir).brainstorms.find((candidate) => candidate.brainstorm_id === api.brainstorm.brainstorm_id)!;
    const reserve = vi.spyOn(api.runOrchestrator, "reserveOrchestrationGroup");
    const expiredAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    writeProviderQuotaStore(api.stateDir, { schema_version: "v1", snapshots: lifecycleSnapshots(expiredAt) });

    const response = await api.call("POST", `/brainstorms/${api.brainstorm.brainstorm_id}/approve`, { operator: "owner" });

    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toBe("brainstorm_route_unavailable");
    expect(reserve).not.toHaveBeenCalled();
    expect(readBrainstormStore(api.stateDir).brainstorms.find((candidate) => candidate.brainstorm_id === api.brainstorm.brainstorm_id)).toEqual(before);
    expect(readRunStore(api.stateDir).runs).toHaveLength(0);
    expect(new TokenGateway({ stateDir: api.stateDir }).snapshot()).toEqual({ used: {}, activeReservations: 0 });
  });

  it("proves one persisted transition, reservation, and child run per provider under concurrent double approval", async () => {
    const api = await lifecycleApi();

    const [first, second] = await Promise.all([
      api.call("POST", `/brainstorms/${api.brainstorm.brainstorm_id}/approve`, { operator: "owner" }),
      api.call("POST", `/brainstorms/${api.brainstorm.brainstorm_id}/approve`, { operator: "owner" })
    ]);
    const firstBody = await first.json() as Record<string, unknown>;
    const secondBody = await second.json() as Record<string, unknown>;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody.status).toBe("fanout_running");
    expect(secondBody.child_run_ids).toEqual(firstBody.child_run_ids);
    const runs = readRunStore(api.stateDir).runs;
    expect(runs).toHaveLength(3);
    expect(new Set(runs.map((run) => run.current.provider)).size).toBe(3);
  });

  it("arbitrates at the explicit boundary and rejects a second arbitration request with 409", async () => {
    const conflictJson = JSON.stringify({ consensus: [], conflicts: [{ output_labels: ["B", "C"], summary: "material disagreement", material: true }], confidence: 0.4, final: "provisional" });
    const api = await lifecycleApi(["A", "B", "C", conflictJson]);

    const approve = await api.call("POST", `/brainstorms/${api.brainstorm.brainstorm_id}/approve`, { operator: "owner" });
    expect(approve.status).toBe(200);
    await finishQueuedRuns(api.runOrchestrator, 3);
    const directCoordinator = createBrainstormCoordinator({ stateDir: api.stateDir, runOrchestrator: api.runOrchestrator, now: () => now });
    await directCoordinator.tick(api.brainstorm.brainstorm_id);
    await api.runOrchestrator.runSupervisorOnce();
    const conflicted = await directCoordinator.tick(api.brainstorm.brainstorm_id);
    expect(conflicted.status).toBe("needs_arbitration");

    const firstArbitrate = await api.call("POST", `/brainstorms/${api.brainstorm.brainstorm_id}/arbitrate`, { operator: "owner", route: arbitration });
    const firstBody = await firstArbitrate.json() as { status: string };
    expect(firstArbitrate.status).toBe(200);
    expect(firstBody.status).toBe("arbitrating");

    const secondArbitrate = await api.call("POST", `/brainstorms/${api.brainstorm.brainstorm_id}/arbitrate`, { operator: "owner", route: arbitration });
    expect(secondArbitrate.status).toBe(409);
    expect(((await secondArbitrate.json()) as { error: string }).error).toBe("brainstorm_arbitration_not_allowed");
    expect(readRunStore(api.stateDir).runs.filter((run) => run.orchestration_ref?.slot_id === "arbitration")).toHaveLength(1);
  });

  it("cancels a brainstorm through the HTTP action idempotently", async () => {
    const api = await lifecycleApi();

    const approve = await api.call("POST", `/brainstorms/${api.brainstorm.brainstorm_id}/approve`, { operator: "owner" });
    expect(approve.status).toBe(200);

    const firstCancel = await api.call("POST", `/brainstorms/${api.brainstorm.brainstorm_id}/cancel`, {});
    const firstBody = await firstCancel.json() as Record<string, unknown>;
    expect(firstCancel.status).toBe(200);
    expect(firstBody.status).toBe("cancelled");

    const secondCancel = await api.call("POST", `/brainstorms/${api.brainstorm.brainstorm_id}/cancel`, {});
    const secondBody = await secondCancel.json() as Record<string, unknown>;
    expect(secondCancel.status).toBe(200);
    expect(secondBody.revision).toBe(firstBody.revision);
    expect(readRunStore(api.stateDir).runs.every((run) => run.status === "cancelled")).toBe(true);
  });
});

describe("classifyBrainstormErrorCode", () => {
  it("maps revision conflict and telemetry limit errors to 409", () => {
    expect(classifyBrainstormErrorCode("brainstorm_revision_conflict")).toBe(409);
    expect(classifyBrainstormErrorCode("brainstorm_telemetry_limit")).toBe(409);
  });

  it("leaves immutable-field and telemetry-conflict invariant failures unclassified as 500 internal errors", () => {
    expect(classifyBrainstormErrorCode("brainstorm_immutable_fields")).toBeNull();
    expect(classifyBrainstormErrorCode("brainstorm_telemetry_conflict")).toBeNull();
  });
});
