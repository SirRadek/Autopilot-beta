import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SupervisorQueue,
  validateSupervisorState
} from "../../src/data/delivery-system/supervisorQueue";
import type { GovernedHandoff } from "../../src/governed-core/dispatch";

function handoff(id: string): GovernedHandoff {
  return {
    handoffId: id as GovernedHandoff["handoffId"],
    vendor: "codex_cli",
    prompt: `do ${id}`,
    parentSessionHash: "parent",
    parentTurnHash: "turn",
    task: `task ${id}`,
    agent: "worker",
    packet_hash: "packet-hash",
    required_checks: ["tests"]
  };
}

function queue() {
  return new SupervisorQueue({ stateDir: mkdtempSync(join(tmpdir(), "supervisor-")), baseRetryDelayMs: 100, maxRetryDelayMs: 500 });
}

function persistedTaskState(): { readonly stateDir: string; readonly path: string } {
  const stateDir = mkdtempSync(join(tmpdir(), "supervisor-state-"));
  new SupervisorQueue({ stateDir }).enqueue({
    taskId: "task-a",
    handoff: handoff("hp-a"),
    now: "2026-07-12T00:00:00.000Z"
  });
  return { stateDir, path: join(stateDir, "supervisor-queue.json") };
}

function rewritePersistedState(
  path: string,
  mutate: (state: Record<string, any>) => void
): void {
  const state = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  mutate(state);
  writeFileSync(path, `${JSON.stringify(state)}\n`, "utf8");
}

describe("SupervisorQueue", () => {
  it("inspects the exact next claimable task without consuming an attempt", () => {
    const q = queue();
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });
    q.enqueue({ taskId: "b", handoff: handoff("hp-b"), now: "2026-07-12T00:00:00.000Z" });

    expect(q.peekClaimable("2026-07-12T00:00:01.000Z")).toMatchObject({ task_id: "a", status: "queued", attempt: 0 });
    expect(q.snapshot()[0]).toMatchObject({ task_id: "a", status: "queued", attempt: 0 });
    expect(q.claim("2026-07-12T00:00:01.000Z")).toMatchObject({ task_id: "a", status: "running", attempt: 1 });
  });

  it("enqueues and claims deterministically", () => {
    const q = queue();
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });
    const claimed = q.claim("2026-07-12T00:00:01.000Z");
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempt).toBe(1);
    expect(claimed?.handoff_ref.handoff_id).toBe("hp-a");
  });

  it("blocks for approval and releases after approval", () => {
    const q = queue();
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), requiresApproval: true, now: "2026-07-12T00:00:00.000Z" });
    expect(q.claim("2026-07-12T00:00:01.000Z")).toBeNull();
    expect(q.approve("a", "2026-07-12T00:00:02.000Z").status).toBe("queued");
    expect(q.claim("2026-07-12T00:00:03.000Z")?.status).toBe("running");
  });

  it("retries with backoff, then completes or cancels", () => {
    const q = queue();
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), maxAttempts: 3, now: "2026-07-12T00:00:00.000Z" });
    q.claim("2026-07-12T00:00:00.000Z");
    const retry = q.fail("a", "provider unavailable", "2026-07-12T00:00:01.000Z");
    expect(retry.status).toBe("queued");
    expect(retry.last_error).toBe("provider unavailable");
    q.cancel("a", "owner stopped", "2026-07-12T00:00:02.000Z");
    expect(q.snapshot()[0]?.status).toBe("cancelled");
  });

  it("times out and recovers running tasks after restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "supervisor-restart-"));
    const first = new SupervisorQueue({ stateDir: dir, baseRetryDelayMs: 100 });
    first.enqueue({ taskId: "a", handoff: handoff("hp-a"), timeoutMs: 1_000, now: "2026-07-12T00:00:00.000Z" });
    first.claim("2026-07-12T00:00:00.000Z");
    expect(first.recover("2026-07-12T00:00:02.000Z")[0]?.status).toBe("queued");
    const second = new SupervisorQueue({ stateDir: dir, baseRetryDelayMs: 100 });
    expect(second.snapshot()[0]?.status).toBe("queued");
    expect(second.claim("2026-07-12T00:00:02.050Z")).toBeNull();
    second.reconcile("2026-07-12T00:00:04.000Z");
  });

  it("honours dependencies", () => {
    const q = queue();
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });
    q.enqueue({ taskId: "b", handoff: handoff("hp-b"), dependencyIds: ["a"], now: "2026-07-12T00:00:00.000Z" });
    expect(q.claim("2026-07-12T00:00:00.000Z")?.task_id).toBe("a");
    expect(q.claim("2026-07-12T00:00:00.000Z")).toBeNull();
    q.complete("a", "2026-07-12T00:00:01.000Z");
    expect(q.claim("2026-07-12T00:00:02.000Z")?.task_id).toBe("b");
  });

  it("supports forward dependencies while refusing structurally invalid queue graphs", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supervisor-forward-dependency-"));
    const q = new SupervisorQueue({ stateDir });
    q.enqueue({
      taskId: "a",
      handoff: handoff("hp-a"),
      dependencyIds: ["b"],
      now: "2026-07-12T00:00:00.000Z"
    });
    expect(() => validateSupervisorState(stateDir)).not.toThrow();
    q.enqueue({ taskId: "b", handoff: handoff("hp-b"), now: "2026-07-12T00:00:00.000Z" });
    expect(q.claim("2026-07-12T00:00:00.000Z")?.task_id).toBe("b");

    expect(() => q.enqueue({
      taskId: "empty-dependency",
      handoff: handoff("hp-empty"),
      dependencyIds: [""],
      now: "2026-07-12T00:00:00.000Z"
    })).toThrow("invalid_task_dependency");
    expect(() => q.enqueue({
      taskId: "self-dependent",
      handoff: handoff("hp-self"),
      dependencyIds: ["self-dependent"],
      now: "2026-07-12T00:00:00.000Z"
    })).toThrow("invalid_task_dependency");

    const cyclic = queue();
    cyclic.enqueue({ taskId: "first", handoff: handoff("hp-first"), dependencyIds: ["second"], now: "2026-07-12T00:00:00.000Z" });
    expect(() => cyclic.enqueue({
      taskId: "second",
      handoff: handoff("hp-second"),
      dependencyIds: ["first"],
      now: "2026-07-12T00:00:00.000Z"
    })).toThrow("invalid_task_dependency");
  });

  it("refuses to persist an invalid lifecycle timestamp", () => {
    expect(() => queue().enqueue({
      taskId: "a",
      handoff: handoff("hp-a"),
      now: "not-a-date"
    })).toThrow("invalid_supervisor_timestamp");
  });

  it("routes a claimed task through the existing dispatcher", async () => {
    const q = queue();
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });
    const result = await q.runOnce("/tmp/state", async (packet) => ({
      ...({ workerRunId: "run", handoffId: packet.handoffId, vendor: packet.vendor, model: null, exitCode: 0, rawOutput: "ok", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn", workerOutputPath: null, errorReason: null } as const),
      refused: false as const,
      tier_id: null,
      provenance_verified: true as const
    }), "2026-07-12T00:00:01.000Z");
    expect(result?.task.status).toBe("completed");
    expect(result?.result.refused).toBe(false);
  });

  it.each([
    ["vendor", (task: Record<string, any>) => { delete task.handoff.vendor; }],
    ["task", (task: Record<string, any>) => { delete task.handoff.task; }],
    ["agent", (task: Record<string, any>) => { delete task.handoff.agent; }],
    ["packet_hash", (task: Record<string, any>) => { delete task.handoff.packet_hash; }],
    ["required_checks", (task: Record<string, any>) => { delete task.handoff.required_checks; }]
  ])("rejects a persisted handoff missing required %s", (_field, mutate) => {
    const { stateDir, path } = persistedTaskState();
    rewritePersistedState(path, (state) => mutate(state.tasks[0]));
    const before = readFileSync(path);

    expect(() => validateSupervisorState(stateDir)).toThrow("invalid_supervisor_state");
    expect(readFileSync(path)).toEqual(before);
  });

  it.each([
    ["unknown vendor", (state: Record<string, any>) => { state.tasks[0].handoff.vendor = "unknown"; }],
    ["invalid optional timeout", (state: Record<string, any>) => { state.tasks[0].handoff.timeoutMs = 0; }],
    ["optional prompt cap below the prompt length", (state: Record<string, any>) => { state.tasks[0].handoff.maxPromptChars = 1; }],
    ["invalid optional string array", (state: Record<string, any>) => { state.tasks[0].handoff.skillIds = ["skill", 1]; }],
    ["invalid optional dispatch mode", (state: Record<string, any>) => { state.tasks[0].handoff.codexMode = "write_everything"; }],
    ["invalid optional routing mode", (state: Record<string, any>) => { state.tasks[0].handoff.routing_mode = "ship"; }],
    ["mismatched handoff reference", (state: Record<string, any>) => { state.tasks[0].handoff_ref.packet_hash = "other"; }],
    ["empty task id", (state: Record<string, any>) => { state.tasks[0].task_id = "   "; }],
    ["duplicate task id", (state: Record<string, any>) => { state.tasks.push({ ...state.tasks[0] }); }],
    ["attempt above task maximum", (state: Record<string, any>) => { state.tasks[0].attempt = 4; state.tasks[0].max_attempts = 3; }],
    ["maximum attempts above writer cap", (state: Record<string, any>) => { state.tasks[0].max_attempts = 9; }],
    ["oversized dependency list", (state: Record<string, any>) => { state.tasks[0].dependency_ids = Array.from({ length: 33 }, (_, index) => `task-${index}`); }],
    ["duplicate dependency", (state: Record<string, any>) => { state.tasks[0].dependency_ids = ["task-b", "task-b"]; }],
    ["empty dependency", (state: Record<string, any>) => { state.tasks[0].dependency_ids = [""]; }],
    ["self dependency", (state: Record<string, any>) => { state.tasks[0].dependency_ids = ["task-a"]; }],
    ["dependency cycle", (state: Record<string, any>) => {
      state.tasks.push({ ...state.tasks[0], task_id: "task-b", dependency_ids: ["task-a"] });
      state.tasks[0].dependency_ids = ["task-b"];
    }],
    ["invalid queued timestamp", (state: Record<string, any>) => { state.tasks[0].queued_at = "not-a-date"; }],
    ["invalid nullable timestamp", (state: Record<string, any>) => { state.tasks[0].run_started_at = "not-a-date"; }],
    ["oversized prompt", (state: Record<string, any>) => { state.tasks[0].handoff.prompt = "x".repeat(32_001); }],
    ["oversized bounded error", (state: Record<string, any>) => { state.tasks[0].last_error = "x".repeat(513); }]
  ])("rejects persisted state with %s", (_case, mutate) => {
    const { stateDir, path } = persistedTaskState();
    rewritePersistedState(path, mutate);

    expect(() => validateSupervisorState(stateDir)).toThrow("invalid_supervisor_state");
  });

  it("accepts valid governed optional fields and the writer boundaries", () => {
    const { stateDir, path } = persistedTaskState();
    rewritePersistedState(path, (state) => {
      state.tasks[0].handoff = {
        ...state.tasks[0].handoff,
        sessionId: "session-a",
        skillIds: ["tests"],
        outputSchemaPath: "schema.json",
        codexMode: "codex_review",
        routingMode: "review",
        taskPacketRef: "packet.json",
        model: "gpt-5",
        timeoutMs: 1,
        cwd: "/project",
        addDirs: ["/shared"],
        images: ["image.png"],
        lockSource: "governed_dispatch_verified",
        maxPromptChars: 32_000,
        generationSettings: {
          temperature: 0,
          speculative_decoding: { type: "draft", draft_length: 1 }
        },
        routing_mode: "review",
        task_package_hash: "task-package",
        prep_provenance: { kind: "cheap_attempts", cheap_attempt_refs: ["draft-a"] }
      };
      state.tasks[0].handoff_ref.task_packet_ref = "packet.json";
      state.tasks[0].handoff.prompt = "x".repeat(32_000);
      state.tasks[0].attempt = 8;
      state.tasks[0].max_attempts = 8;
      state.tasks[0].last_error = "x".repeat(512);
    });

    expect(() => validateSupervisorState(stateDir)).not.toThrow();
  });

  it("accepts 32 unique dependencies that all reference persisted tasks", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supervisor-dependencies-"));
    const q = new SupervisorQueue({ stateDir });
    const now = "2026-07-12T00:00:00.000Z";
    const dependencies = Array.from({ length: 32 }, (_, index) => `dependency-${index}`);
    for (const taskId of dependencies) q.enqueue({ taskId, handoff: handoff(`hp-${taskId}`), now });
    q.enqueue({ taskId: "dependent", handoff: handoff("hp-dependent"), dependencyIds: dependencies, now });

    expect(() => validateSupervisorState(stateDir)).not.toThrow();
  });
});
