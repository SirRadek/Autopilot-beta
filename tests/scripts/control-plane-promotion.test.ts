import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createControlPlaneRuntime, createControlPlaneServer } from "../../scripts/control-plane-server";
import { writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";
import { readRunStore } from "../../src/data/delivery-system/runStore";
import { readPromotionStore } from "../../src/data/delivery-system/promotionPacket";
import { writeProviderQuotaStore } from "../../src/data/delivery-system/providerQuotaStore";

const servers: ReturnType<typeof createControlPlaneServer>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

async function harness(dispatch?: (handoff: { handoffId: string; vendor: string; model?: string | null }) => Promise<unknown>) {
  const stateDir = mkdtempSync(join(tmpdir(), "control-plane-promotion-"));
  const projectRoot = join(stateDir, "projects");
  const projectCwd = join(projectRoot, "autopilot-beta");
  mkdirSync(projectCwd, { recursive: true });
  writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: projectCwd, enabled: true }] });
  const now = new Date().toISOString();
  writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [
    { provider: "codex_cli", source: "api", fetched_at: now, observed_at: now, five_hour: { limit: 100, used: 0, remaining: 100, resets_at: null }, weekly: { limit: 1_000, used: 0, remaining: 1_000, resets_at: null }, api_spend: 0, currency: "USD", models: [], health: "healthy", error_code: null },
    { provider: "openrouter_api", source: "api", fetched_at: now, observed_at: now, five_hour: { limit: 100, used: 0, remaining: 100, resets_at: null }, weekly: { limit: 1_000, used: 0, remaining: 1_000, resets_at: null }, api_spend: 0, currency: "USD", models: [], health: "healthy", error_code: null }
  ] });
  const workerDispatch = vi.fn(dispatch ?? (async (handoff: { handoffId: string; vendor: string; model?: string | null }) => ({
    refused: false, workerRunId: "worker-1", handoffId: handoff.handoffId, vendor: handoff.vendor, model: handoff.model ?? null,
    exitCode: 0, rawOutput: "done", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn",
    workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true
  })));
  const runtime = createControlPlaneRuntime(stateDir, "secret", {
    projectRoot,
    scheduler: { start() {}, stop() {} },
    dispatch: workerDispatch as never,
    supervisorPollMs: 5
  });
  servers.push(runtime.server);
  await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const address = runtime.server.address();
  if (address === null || typeof address === "string") throw new Error("missing address");
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (method: string, path: string, body: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: "Bearer secret", ...(body === null ? {} : { "content-type": "application/json" }) },
      ...(body === null ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, json: await response.json() as never };
  };
  return { stateDir, request, workerDispatch, stop: runtime.stop };
}

const devDraft = { project_id: "autopilot-beta", prompt: "Iterate", provider: "codex_cli", model: null, requested_reasoning_effort: null, requested_artifacts: ["text"], profile: "dev" };

describe("control plane profile scoping and promotion endpoints", () => {
  it("promotes a completed dev run into a pending prod packet, never automatically", async () => {
    const { stateDir, request, workerDispatch } = await harness();
    const prepared = await request("POST", "/runs", devDraft);
    expect(prepared.status).toBe(201);
    const preparedRun = prepared.json as { current: { run_id: string; revision: number } };
    expect((await request("POST", `/runs/${preparedRun.current.run_id}/approve`, { revision: preparedRun.current.revision, operator: "owner" })).status).toBe(200);
    await vi.waitFor(() => expect(readRunStore(stateDir).runs.find((run) => run.current.run_id === preparedRun.current.run_id)?.status).toBe("completed"));
    workerDispatch.mockClear();

    const promote = await request("POST", `/runs/${preparedRun.current.run_id}/promote`, { intent: "Publish showcase", diff_summary: "edits", tests: ["npm run verify"], risks: ["cost"] });
    expect(promote.status).toBe(201);
    expect((promote.json as { status: string }).status).toBe("promotion_pending");

    const list = await request("GET", "/promotions", null);
    expect((list.json as { packets: unknown[] }).packets).toHaveLength(1);
    expect(workerDispatch).not.toHaveBeenCalled();
  });

  it("rejects a create without a profile", async () => {
    const { request } = await harness();
    const response = await request("POST", "/runs", { project_id: "autopilot-beta", prompt: "x", provider: "codex_cli", model: null, requested_reasoning_effort: null, requested_artifacts: ["text"] });
    expect(response.status).toBe(400);
    expect((response.json as { error: string }).error).toBe("run_profile_required");
  });

  it("rejects an unsupported reasoning effort for the requested provider", async () => {
    const { request } = await harness();
    const response = await request("POST", "/runs", { ...devDraft, provider: "openrouter_api", requested_reasoning_effort: "high" });
    expect(response.status).toBe(409);
    expect((response.json as { error: string }).error).toBe("unsupported_reasoning_effort");
  });

  it("does not trust a caller-supplied non-owner promotion approver", async () => {
    const { stateDir, request } = await harness();
    const prepared = await request("POST", "/runs", devDraft);
    const preparedRun = prepared.json as { current: { run_id: string; revision: number } };
    await request("POST", `/runs/${preparedRun.current.run_id}/approve`, { revision: preparedRun.current.revision, operator: "owner" });
    await vi.waitFor(() => expect(readRunStore(stateDir).runs.find((run) => run.current.run_id === preparedRun.current.run_id)?.status).toBe("completed"));
    const promoted = await request("POST", `/runs/${preparedRun.current.run_id}/promote`, { intent: "Publish", diff_summary: "edits", tests: ["npm run verify"], risks: [] });
    const packet = promoted.json as { packet_id: string };

    const response = await request("POST", `/promotions/${packet.packet_id}/approve`, { approver: "worker", review_ref: "review://1" });
    expect(response.status).toBe(409);
    expect((response.json as { error: string }).error).toBe("promotion_not_approved");
    expect(readPromotionStore(stateDir).packets[0]?.status).toBe("promotion_pending");
  });

  it("refuses a direct prod draft and never dispatches while linking an approved verified packet", async () => {
    const { stateDir, request, workerDispatch } = await harness();
    const directProd = await request("POST", "/runs", { project_id: "autopilot-beta", prompt: "Publish", provider: "codex_cli", model: null, requested_reasoning_effort: null, requested_artifacts: ["text"], profile: "prod" });
    expect(directProd.status).toBe(409);
    expect((directProd.json as { error: string }).error).toBe("promotion_evidence_required");

    const prepared = await request("POST", "/runs", devDraft);
    const preparedRun = prepared.json as { current: { run_id: string; revision: number } };
    await request("POST", `/runs/${preparedRun.current.run_id}/approve`, { revision: preparedRun.current.revision, operator: "owner" });
    await vi.waitFor(() => expect(readRunStore(stateDir).runs.find((run) => run.current.run_id === preparedRun.current.run_id)?.status).toBe("completed"));
    const promote = await request("POST", `/runs/${preparedRun.current.run_id}/promote`, { intent: "Publish showcase", diff_summary: "edits", tests: ["npm run verify"], risks: ["cost"] });
    const packet = promote.json as { packet_id: string };
    const approve = await request("POST", `/promotions/${packet.packet_id}/approve`, { approver: "owner", review_ref: "review://1", approved_at: new Date().toISOString() });
    expect(approve.status).toBe(200);
    const verify = await request("POST", `/promotions/${packet.packet_id}/record-verification`, { full_verification_ref: "sha256:evidence" });
    expect(verify.status).toBe(200);
    workerDispatch.mockClear();

    const prod = await request("POST", "/runs", { project_id: "autopilot-beta", prompt: "Publish", provider: "codex_cli", model: null, requested_reasoning_effort: null, requested_artifacts: ["text"], profile: "prod", promotion_packet_id: packet.packet_id, full_verification_ref: "sha256:evidence" });
    expect(prod.status).toBe(201);
    expect((prod.json as { status: string }).status).toBe("draft");
    expect(workerDispatch).not.toHaveBeenCalled();

    const second = await request("POST", "/runs", { project_id: "autopilot-beta", prompt: "Publish again", provider: "codex_cli", model: null, requested_reasoning_effort: null, requested_artifacts: ["text"], profile: "prod", promotion_packet_id: packet.packet_id, full_verification_ref: "sha256:evidence" });
    expect(second.status).toBe(409);
    expect((second.json as { error: string }).error).toBe("promotion_not_ready");

    const revision = await request("POST", `/runs/${prodRunId(prod.json)}/revisions`, {
      revision: 1, project_id: "autopilot-beta", prompt: "Bypass", provider: "codex_cli", model: null,
      requested_reasoning_effort: null, requested_artifacts: ["text"], profile: "prod",
      promotion_packet_id: "unverified-packet", full_verification_ref: "sha256:evidence"
    });
    expect(revision.status).toBe(409);
    expect((revision.json as { error: string }).error).toBe("promotion_not_ready");
  });

  it("filters runs by profile", async () => {
    const { request } = await harness();
    await request("POST", "/runs", devDraft);
    const devOnly = await request("GET", "/runs?profile=dev", null);
    expect((devOnly.json as unknown[]).length).toBe(1);
    const prodOnly = await request("GET", "/runs?profile=prod", null);
    expect((prodOnly.json as unknown[]).length).toBe(0);
  });

  it("keeps reasoning capabilities scoped to each provider route for a shared model id", async () => {
    const { stateDir, request } = await harness();
    const now = new Date().toISOString();
    const shared = { model_id: "shared-model", available: true, health: "healthy" as const, source: "api" as const };
    const quota = { source: "api" as const, fetched_at: now, observed_at: now, five_hour: { limit: 100, used: 0, remaining: 100, resets_at: null }, weekly: { limit: 1_000, used: 0, remaining: 1_000, resets_at: null }, api_spend: 0, currency: "USD", models: [shared], health: "healthy" as const, error_code: null };
    writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [
      { provider: "codex_cli", ...quota }, { provider: "openrouter_api", ...quota }
    ] });

    const response = await request("GET", "/providers/models", null);
    const model = (response.json as { models: Array<{ reasoning_efforts: string[]; provider_routes: Array<{ provider: string; reasoning_efforts: string[] }> }> }).models[0]!;
    expect(model.reasoning_efforts).toEqual([]);
    expect(model.provider_routes).toEqual([
      { provider: "codex_cli", reasoning_efforts: ["low", "medium", "high", "xhigh"] },
      { provider: "openrouter_api", reasoning_efforts: [] }
    ]);
  });

  it("maps promotion-store domain errors to conflict", async () => {
    const { stateDir, request } = await harness();
    const missing = await request("POST", "/promotions/missing/approve", { approver: "owner", review_ref: "review://1" });
    expect(missing.status).toBe(409);
    expect((missing.json as { error: string }).error).toBe("promotion_not_found");

    const prepared = await request("POST", "/runs", devDraft);
    const run = prepared.json as { current: { run_id: string; revision: number } };
    await request("POST", `/runs/${run.current.run_id}/approve`, { revision: run.current.revision, operator: "owner" });
    await vi.waitFor(() => expect(readRunStore(stateDir).runs.find((entry) => entry.current.run_id === run.current.run_id)?.status).toBe("completed"));
    const invalid = await request("POST", `/runs/${run.current.run_id}/promote`, { intent: "", diff_summary: "d", tests: [], risks: [] });
    expect(invalid.status).toBe(409);
    expect((invalid.json as { error: string }).error).toBe("invalid_promotion_packet");
  });

  it("marks a packet published only after linking a completed prod run and never deploys", async () => {
    const { stateDir, request, workerDispatch } = await harness();
    const prepared = await request("POST", "/runs", devDraft);
    const preparedRun = prepared.json as { current: { run_id: string; revision: number } };
    await request("POST", `/runs/${preparedRun.current.run_id}/approve`, { revision: preparedRun.current.revision, operator: "owner" });
    await vi.waitFor(() => expect(readRunStore(stateDir).runs.find((run) => run.current.run_id === preparedRun.current.run_id)?.status).toBe("completed"));
    const promote = await request("POST", `/runs/${preparedRun.current.run_id}/promote`, { intent: "Publish showcase", diff_summary: "edits", tests: ["npm run verify"], risks: ["cost"] });
    const packet = promote.json as { packet_id: string };
    await request("POST", `/promotions/${packet.packet_id}/approve`, { approver: "owner", review_ref: "review://1", approved_at: new Date().toISOString() });
    await request("POST", `/promotions/${packet.packet_id}/record-verification`, { full_verification_ref: "sha256:evidence" });

    const prematurePublish = await request("POST", `/promotions/${packet.packet_id}/mark-published`, { prod_run_id: "does-not-exist", full_verification_ref: "sha256:evidence", release_acceptance_ref: "release://1", rollback_ref: "rollback://1" });
    expect(prematurePublish.status).toBe(409);
    expect((prematurePublish.json as { error: string }).error).toBe("promotion_not_ready");

    const prod = await request("POST", "/runs", { project_id: "autopilot-beta", prompt: "Publish", provider: "codex_cli", model: null, requested_reasoning_effort: null, requested_artifacts: ["text"], profile: "prod", promotion_packet_id: packet.packet_id, full_verification_ref: "sha256:evidence" });
    const prodRun = prod.json as { current: { run_id: string; revision: number } };
    workerDispatch.mockClear();
    await request("POST", `/runs/${prodRun.current.run_id}/approve`, { revision: prodRun.current.revision, operator: "owner" });
    await vi.waitFor(() => expect(readRunStore(stateDir).runs.find((run) => run.current.run_id === prodRun.current.run_id)?.status).toBe("completed"));

    const publish = await request("POST", `/promotions/${packet.packet_id}/mark-published`, { prod_run_id: prodRun.current.run_id, full_verification_ref: "sha256:evidence", release_acceptance_ref: "release://1", rollback_ref: "rollback://1" });
    expect(publish.status).toBe(200);
    expect((publish.json as { status: string }).status).toBe("published");
    expect(readPromotionStore(stateDir).packets.find((entry) => entry.packet_id === packet.packet_id)?.prod_run_id).toBe(prodRun.current.run_id);
    expect(workerDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ task: expect.stringContaining("deploy") }));
  });

});

function prodRunId(value: unknown): string {
  return (value as { current: { run_id: string } }).current.run_id;
}
