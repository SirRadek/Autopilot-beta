import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";
import { readRunStore } from "../../src/data/delivery-system/runStore";
import { createRunOrchestrator } from "../../src/data/delivery-system/runOrchestrator";
import { SupervisorQueue } from "../../src/data/delivery-system/supervisorQueue";
import { TokenGateway } from "../../src/data/delivery-system/tokenGateway";

const now = "2026-07-22T12:00:00.000Z";
function setup(crash?: string) {
  const root = mkdtempSync(join(tmpdir(), "orchestrator-group-")); const stateDir = join(root, "state"); const cwd = join(root, "projects", "alpha"); mkdirSync(stateDir); mkdirSync(cwd, { recursive: true });
  writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd, enabled: true }] });
  const gateway = new TokenGateway({ stateDir }); const supervisor = new SupervisorQueue({ stateDir });
  const make = (tokenGateway: TokenGateway, queue: SupervisorQueue, afterPhase?: (phase: string) => void) => createRunOrchestrator({ stateDir, projectRoot: join(root, "projects"), tokenGateway, supervisor: queue, dispatch: async () => { throw new Error("unused"); }, now: () => now, isRouteAvailable: () => true, afterPhase: afterPhase as never });
  const orchestrator = make(gateway, supervisor, crash ? (phase) => { if (phase === crash) throw new Error(`crash:${phase}`); } : undefined);
  const draft = { project_id: "alpha", prompt: "build it", provider: "codex_cli" as const, model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] as const, profile: "dev" as const, requested_reasoning_effort: null };
  const spec = { groupId: "bsg-1", slots: [{ slotId: "fanout-0", provider: "codex_cli", model: "gpt-5", sessionId: "bgr-1-fanout-0", holdTokens: 16_386 }] } as const;
  return { stateDir, gateway, supervisor, orchestrator, restart: () => make(new TokenGateway({ stateDir }), new SupervisorQueue({ stateDir })), draft, spec };
}

describe("group run orchestration recovery", () => {
  it("creates one governed run per immutable group slot", () => {
    const c = setup(); c.orchestrator.reserveOrchestrationGroup(c.spec);
    const first = c.orchestrator.ensureGroupRun({ groupId: "bsg-1", slotId: "fanout-0", draft: c.draft, operator: "owner" });
    const repeated = c.orchestrator.ensureGroupRun({ groupId: "bsg-1", slotId: "fanout-0", draft: c.draft, operator: "owner" });
    expect(repeated.current.run_id).toBe(first.current.run_id); expect(readRunStore(c.stateDir).runs).toHaveLength(1);
    expect(first.orchestration_ref).toEqual({ group_id: "bsg-1", slot_id: "fanout-0" });
    expect(() => c.orchestrator.ensureGroupRun({ groupId: "bsg-1", slotId: "fanout-0", draft: { ...c.draft, prompt: "different" }, operator: "owner" })).toThrow("orchestration_group_run_mismatch");
  });

  for (const phase of ["run_persisted", "approval_persisted", "bound", "queued"] as const) {
    it(`repairs or returns the same run after restart following ${phase}`, () => {
      const c = setup(phase); c.orchestrator.reserveOrchestrationGroup(c.spec);
      expect(() => c.orchestrator.ensureGroupRun({ groupId: "bsg-1", slotId: "fanout-0", draft: c.draft, operator: "owner" })).toThrow(`crash:${phase}`);
      const recovered = c.restart().ensureGroupRun({ groupId: "bsg-1", slotId: "fanout-0", draft: c.draft, operator: "owner" });
      expect(recovered.status).toBe("queued"); expect(readRunStore(c.stateDir).runs).toHaveLength(1);
    });
  }
});
