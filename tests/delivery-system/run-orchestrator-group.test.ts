import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  it("rejects changed estimated-token input and operator after run or approval persistence", () => {
    for (const phase of ["run_persisted", "approval_persisted"] as const) {
      for (const changed of [
        (c: ReturnType<typeof setup>) => ({ ...c.draft, estimated_tokens: c.draft.estimated_tokens + 1 }),
        (c: ReturnType<typeof setup>) => c.draft,
      ]) {
        const c = setup(phase); c.orchestrator.reserveOrchestrationGroup(c.spec);
        expect(() => c.orchestrator.ensureGroupRun({ groupId: "bsg-1", slotId: "fanout-0", draft: c.draft, operator: "owner" })).toThrow(`crash:${phase}`);
        const draft = changed(c); const operator = draft === c.draft ? "other-owner" : "owner";
        expect(() => c.restart().ensureGroupRun({ groupId: "bsg-1", slotId: "fanout-0", draft, operator })).toThrow("orchestration_group_run_mismatch");
      }
    }
  });

  it("rejects a duplicate persisted orchestration reference", () => {
    const c = setup(); c.orchestrator.reserveOrchestrationGroup(c.spec);
    c.orchestrator.ensureGroupRun({ groupId: "bsg-1", slotId: "fanout-0", draft: c.draft, operator: "owner" });
    c.orchestrator.reserveOrchestrationGroup({ groupId: "bsg-2", slots: [{ ...c.spec.slots[0], sessionId: "bgr-2-fanout-0" }] });
    c.orchestrator.ensureGroupRun({ groupId: "bsg-2", slotId: "fanout-0", draft: c.draft, operator: "owner" });
    const path = join(c.stateDir, "runs.json"); const document = JSON.parse(readFileSync(path, "utf8"));
    document.runs[1].orchestration_ref = document.runs[0].orchestration_ref;
    writeFileSync(path, JSON.stringify(document));
    expect(() => readRunStore(c.stateDir)).toThrow("invalid_run_store");
  });
});
