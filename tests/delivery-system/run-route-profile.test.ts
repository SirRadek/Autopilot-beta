import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";
import { writeProviderQuotaStore } from "../../src/data/delivery-system/providerQuotaStore";
import { createRunOrchestrator } from "../../src/data/delivery-system/runOrchestrator";
import type { RunDraftInput } from "../../src/data/delivery-system/runStore";
import { SupervisorQueue } from "../../src/data/delivery-system/supervisorQueue";
import { TokenGateway } from "../../src/data/delivery-system/tokenGateway";

const now = "2026-07-27T10:00:00.000Z";

function harness() {
  const stateDir = mkdtempSync(join(tmpdir(), "run-route-profile-"));
  const projectRoot = join(stateDir, "projects");
  const projectCwd = join(projectRoot, "alpha");
  mkdirSync(projectCwd, { recursive: true });
  writeProjectRegistry(stateDir, {
    schema_version: "v1",
    projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: projectCwd, enabled: true }]
  });
  writeProviderQuotaStore(stateDir, {
    schema_version: "v1",
    snapshots: [{
      provider: "codex_cli",
      source: "cli",
      fetched_at: now,
      observed_at: now,
      five_hour: { limit: null, used: null, remaining: null, resets_at: null },
      weekly: { limit: null, used: null, remaining: null, resets_at: null },
      api_spend: null,
      currency: null,
      models: [],
      health: "unavailable",
      error_code: "provider_unavailable"
    }]
  });
  const orchestrator = createRunOrchestrator({
    stateDir,
    projectRoot,
    tokenGateway: new TokenGateway({ stateDir }),
    supervisor: new SupervisorQueue({ stateDir }),
    dispatch: vi.fn(),
    now: () => now
  });
  const draft: RunDraftInput = {
    project_id: "alpha",
    prompt: "Inspect status",
    provider: "codex_cli",
    model: "gpt-5.6-sol",
    requested_reasoning_effort: "high",
    estimated_tokens: 20_000,
    requested_artifacts: ["text"],
    profile: "dev"
  };
  return { orchestrator, draft };
}

describe("profile-aware run route eligibility", () => {
  it("prepares and approves a known DEV route when its quota snapshot is unavailable", () => {
    const { orchestrator, draft } = harness();

    const prepared = orchestrator.prepareRun(draft);
    const approved = orchestrator.approveAndQueueRun(prepared.current.run_id, prepared.current.revision, "owner");

    expect(prepared.status).toBe("draft");
    expect(approved.status).toBe("queued");
  });

  it("keeps PROD strict when a known route has an unavailable quota snapshot", () => {
    const { orchestrator, draft } = harness();

    expect(() => orchestrator.prepareRun({ ...draft, profile: "prod", promotion_packet_id: "packet-1" }))
      .toThrow("run_route_unavailable");
  });

  it.each([
    ["dev", { provider: "codex_cli", model: "unknown-model" }],
    ["prod", { provider: "codex_cli", model: "unknown-model" }],
    ["dev", { provider: "codex_cli", model: "GPT-5.3-Codex-Spark" }],
    ["dev", { provider: "claude_cli", model: "Opus 4.8" }],
    ["dev", { provider: "agy_cli", model: "Gemini Flash" }],
    ["dev", { provider: "unknown_cli", model: "gpt-5.6-sol" }],
    ["prod", { provider: "unknown_cli", model: "gpt-5.6-sol" }],
    ["dev", { provider: "__proto__", model: "gpt-5.6-sol" }],
    ["prod", { provider: "toString", model: "gpt-5.6-sol" }]
  ] as const)("rejects an unknown %s provider/model route", (profile, route) => {
    const { orchestrator, draft } = harness();

    expect(() => orchestrator.prepareRun({
      ...draft,
      profile,
      provider: route.provider,
      model: route.model,
      ...(profile === "prod" ? { promotion_packet_id: "packet-1" } : {})
    } as RunDraftInput)).toThrow("run_route_unavailable");
  });
});
