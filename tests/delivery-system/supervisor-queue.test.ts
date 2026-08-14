import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SupervisorQueue,
  validateSupervisorState
} from "../../src/data/delivery-system/supervisorQueue";
import type { DispatchResult, GovernedHandoff } from "../../src/governed-core/dispatch";

type SuccessfulDispatchResult = Extract<DispatchResult, { refused: false }>;

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

function successfulDispatchResult(
  packet: GovernedHandoff,
  overrides: Partial<SuccessfulDispatchResult> = {}
): SuccessfulDispatchResult {
  return {
    workerRunId: "run",
    handoffId: packet.handoffId,
    vendor: packet.vendor,
    model: null,
    exitCode: 0,
    rawOutput: "ok",
    parsedJson: null,
    durationSeconds: 0,
    lockStatus: "acquired_supervisor_spawn",
    workerOutputPath: null,
    errorReason: null,
    refused: false,
    tier_id: null,
    provenance_verified: true,
    ...overrides
  };
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

function expectRoundTrip(stateDir: string, queue: SupervisorQueue): void {
  expect(() => validateSupervisorState(stateDir)).not.toThrow();
  expect(new SupervisorQueue({ stateDir }).snapshot()).toEqual(queue.snapshot());
}

describe("SupervisorQueue", () => {
  it("defaults ordinary supervisor work to two total attempts", () => {
    const q = queue();
    const queued = q.enqueue({
      taskId: "a",
      handoff: handoff("hp-a"),
      now: "2026-07-12T00:00:00.000Z"
    });

    expect(queued.max_attempts).toBe(2);
  });

  it("requires a material delta before attempt two and persists only its hash", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supervisor-delta-"));
    const q = new SupervisorQueue({ stateDir });
    const at = "2026-07-12T00:00:00.000Z";
    const later = "2026-07-12T00:00:01.000Z";
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: at });
    q.claim(at);

    expect(() =>
      q.retry("a", "same input", later, { attemptDelta: "" })
    ).toThrow("attempt_delta_missing");

    const retried = q.retry("a", "same input", later, {
      attemptDelta: "retry after classified transient empty output"
    });
    expect(retried.attempt_delta_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(join(stateDir, "supervisor-queue.json"), "utf8"))
      .not.toContain("retry after classified transient empty output");
  });

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
    const retry = q.fail(
      "a",
      "provider unavailable",
      "2026-07-12T00:00:01.000Z",
      { attemptDelta: "retry after provider availability failure" }
    );
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
    const stateDir = mkdtempSync(join(tmpdir(), "supervisor-dispatch-"));
    const q = new SupervisorQueue({ stateDir });
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });
    const result = await q.runOnce("/tmp/state", async (packet) => successfulDispatchResult(packet), "2026-07-12T00:00:01.000Z");
    expect(result?.task.status).toBe("completed");
    expect(result?.result.refused).toBe(false);
    expectRoundTrip(stateDir, q);
  });

  it("requeues a non-refused worker result with a non-zero exit code", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supervisor-worker-exit-"));
    const q = new SupervisorQueue({ stateDir, baseRetryDelayMs: 100, maxRetryDelayMs: 500 });
    const reason = "non_zero_exit: worker exited with code 1";
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });
    const beforeDispatch = Date.now();

    const result = await q.runOnce("/tmp/state", async (packet) => successfulDispatchResult(packet, {
      exitCode: 1,
      errorReason: reason
    }), "2026-07-12T00:00:01.000Z");

    expect(result?.result.refused).toBe(false);
    expect(result?.task.status).toBe("queued");
    expect(result?.task.last_error).toBe(reason);
    expect(Date.parse(result!.task.next_attempt_at)).toBeGreaterThan(beforeDispatch);
    expect(result?.task.attempt_delta_hash).toBe("7a628ab9f1f9596b42a26fceb99785b2c01f3260ca415fd078f6783970b97c50");
    expectRoundTrip(stateDir, q);
  });

  it.each([
    {
      name: "an error reason at exit zero",
      overrides: { errorReason: "token_settlement_failed" },
      reason: "token_settlement_failed"
    },
    {
      name: "a failed worker lock",
      overrides: { lockStatus: "failed", errorReason: null },
      reason: "worker_lock_failed"
    },
    {
      name: "an already-locked worker",
      overrides: { exitCode: -1, lockStatus: "already_locked", errorReason: "worker_busy: another worker holds the lock" },
      reason: "worker_busy: another worker holds the lock"
    },
    {
      name: "the OpenRouter missing-key result",
      overrides: {
        exitCode: -1,
        rawOutput: "",
        errorReason: "MISSING: openrouter_api_key_missing",
        missing: { status: "MISSING", provider: "openrouter", reason: "openrouter_api_key_missing" }
      },
      reason: "MISSING: openrouter_api_key_missing"
    },
    {
      name: "a defensive missing marker without an error reason",
      overrides: {
        errorReason: null,
        missing: { status: "MISSING", provider: "openrouter", reason: "openrouter_api_key_missing" }
      },
      reason: "openrouter_api_key_missing"
    }
  ] as const)("requeues a non-refused worker result with $name", async ({ overrides, reason }) => {
    const stateDir = mkdtempSync(join(tmpdir(), "supervisor-worker-failure-"));
    const q = new SupervisorQueue({ stateDir, baseRetryDelayMs: 100, maxRetryDelayMs: 500 });
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });

    const result = await q.runOnce("/tmp/state", async (packet) => successfulDispatchResult(packet, overrides), "2026-07-12T00:00:01.000Z");

    expect(result?.task.status).toBe("queued");
    expect(result?.task.last_error).toBe(reason);
    expectRoundTrip(stateDir, q);
  });

  it("terminally fails after a worker exhausts the task attempt budget", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supervisor-worker-terminal-"));
    const q = new SupervisorQueue({ stateDir, baseRetryDelayMs: 0, maxRetryDelayMs: 0 });
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), maxAttempts: 2, now: "2026-07-12T00:00:00.000Z" });
    const dispatch = async (packet: GovernedHandoff) => successfulDispatchResult(packet, {
      exitCode: 1,
      errorReason: "worker_failed"
    });

    const first = await q.runOnce("/tmp/state", dispatch, "2026-07-12T00:00:01.000Z");
    const second = await q.runOnce("/tmp/state", dispatch, "2099-07-12T00:00:02.000Z");

    expect(first?.task.status).toBe("queued");
    expect(second?.task.status).toBe("failed");
    expect(second?.task.last_error).toBe("worker_failed");
    expectRoundTrip(stateDir, q);
  });

  it("accepts the legacy runtime fixture shape with no parsed JSON or optional failure fields", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supervisor-runtime-fixture-"));
    const q = new SupervisorQueue({ stateDir });
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });

    const result = await q.runOnce("/tmp/state", async () => ({
      refused: false,
      workerRunId: "run",
      rawOutput: "ok",
      exitCode: 0,
      parsedJson: null
    } as unknown as SuccessfulDispatchResult), "2026-07-12T00:00:01.000Z");

    expect(result?.task.status).toBe("completed");
    expectRoundTrip(stateDir, q);
  });

  it("keeps the refusal retry convention", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supervisor-refusal-"));
    const q = new SupervisorQueue({ stateDir });
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });

    const result = await q.runOnce("/tmp/state", async () => ({
      refused: true,
      reason: "token_budget_exhausted",
      tier_id: null,
      provenance_verified: true
    }), "2026-07-12T00:00:01.000Z");

    expect(result?.task.status).toBe("queued");
    expect(result?.task.last_error).toBe("token_budget_exhausted");
    expect(result?.task.attempt_delta_hash).toBe("2103b3fbb55b6ab811a6ed2274ca436f33d158f5b03e03caae059dfb2882bffb");
    expectRoundTrip(stateDir, q);
  });

  it("keeps the dispatch-exception retry convention and propagates the error", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supervisor-dispatch-exception-"));
    const q = new SupervisorQueue({ stateDir });
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });

    await expect(q.runOnce("/tmp/state", async () => {
      throw new Error("dispatch exploded");
    }, "2026-07-12T00:00:01.000Z")).rejects.toThrow("dispatch exploded");

    expect(q.snapshot()[0]?.status).toBe("queued");
    expect(q.snapshot()[0]?.last_error).toBe("dispatch exploded");
    expect(q.snapshot()[0]?.attempt_delta_hash).toBe("a2eb46971cd392079475e0fbb3641928da791052a13c9464c30d00604bb80327");
    expectRoundTrip(stateDir, q);
  });

  it("round-trips empty required checks through every public lifecycle transition", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supervisor-round-trip-"));
    const q = new SupervisorQueue({ stateDir, baseRetryDelayMs: 0, maxRetryDelayMs: 0 });
    const unchecked = { ...handoff("hp-empty-checks"), required_checks: [] };
    const at = "2026-07-12T00:00:00.000Z";

    q.enqueue({ taskId: "approved", handoff: unchecked, requiresApproval: true, now: at });
    expectRoundTrip(stateDir, q);
    q.approve("approved", at);
    expectRoundTrip(stateDir, q);
    q.claim(at);
    expectRoundTrip(stateDir, q);
    q.retry("approved", "retry", at, { attemptDelta: "round-trip retry" });
    expectRoundTrip(stateDir, q);
    q.claim(at);
    q.complete("approved", at);
    expectRoundTrip(stateDir, q);

    q.enqueue({ taskId: "cancelled", handoff: unchecked, now: at });
    q.cancel("cancelled", "cancelled", at);
    expectRoundTrip(stateDir, q);

    q.enqueue({ taskId: "recovered", handoff: unchecked, now: at });
    q.claim(at);
    q.recover(at);
    expectRoundTrip(stateDir, q);
    q.cancel("recovered", "recovered", at);

    q.enqueue({ taskId: "reconciled", handoff: unchecked, timeoutMs: 1_000, now: at });
    q.claim(at);
    q.reconcile("2026-07-12T00:00:02.000Z");
    expectRoundTrip(stateDir, q);
    q.cancel("reconciled", "reconciled", at);

    q.enqueue({ taskId: "failed", handoff: unchecked, maxAttempts: 1, now: at });
    q.claim(at);
    q.fail("failed", "failed", at);
    expectRoundTrip(stateDir, q);
  });

  it.each([
    ["fractional max attempts", { maxAttempts: 1.5 }],
    ["non-finite max attempts", { maxAttempts: Number.NaN }],
    ["unsafe max attempts", { maxAttempts: Number.MAX_SAFE_INTEGER + 1 }],
    ["fractional timeout", { timeoutMs: 1_000.5 }],
    ["non-finite timeout", { timeoutMs: Number.POSITIVE_INFINITY }],
    ["unsafe timeout", { timeoutMs: Number.MAX_SAFE_INTEGER + 1 }]
  ])("rejects %s before mutating supervisor state", (_case, numericInput) => {
    const stateDir = mkdtempSync(join(tmpdir(), "supervisor-numeric-input-"));
    const q = new SupervisorQueue({ stateDir });
    q.enqueue({ taskId: "existing", handoff: handoff("hp-existing"), now: "2026-07-12T00:00:00.000Z" });
    const path = join(stateDir, "supervisor-queue.json");
    const bytes = readFileSync(path);
    const snapshot = q.snapshot();

    expect(() => q.enqueue({
      taskId: "invalid",
      handoff: handoff("hp-invalid"),
      now: "2026-07-12T00:00:00.000Z",
      ...numericInput
    })).toThrow("invalid_supervisor_numeric_input");
    expect(q.snapshot()).toEqual(snapshot);
    expect(readFileSync(path)).toEqual(bytes);
    expectRoundTrip(stateDir, q);
  });

  it("refuses an oversized optional handoff before replacing valid memory or disk state", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "supervisor-large-state-"));
    const q = new SupervisorQueue({ stateDir });
    q.enqueue({ taskId: "existing", handoff: handoff("hp-existing"), now: "2026-07-12T00:00:00.000Z" });
    const path = join(stateDir, "supervisor-queue.json");
    const bytes = readFileSync(path);
    const snapshot = q.snapshot();
    const oversized = {
      ...handoff("hp-oversized"),
      task_package_hash: "x".repeat(4 * 1024 * 1024)
    };

    expect(() => q.enqueue({
      taskId: "oversized",
      handoff: oversized,
      now: "2026-07-12T00:00:00.000Z"
    })).toThrow("supervisor_state_too_large");
    expect(q.snapshot()).toEqual(snapshot);
    expect(readFileSync(path)).toEqual(bytes);
    expectRoundTrip(stateDir, q);
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
    ["queued task at maximum attempts", (state: Record<string, any>) => { state.tasks[0].attempt = 3; state.tasks[0].max_attempts = 3; }],
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
      state.tasks[0].status = "running";
      state.tasks[0].attempt = 8;
      state.tasks[0].max_attempts = 8;
      state.tasks[0].run_started_at = "2026-07-12T00:00:00.000Z";
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
