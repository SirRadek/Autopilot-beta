import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  alertTriggersForCliWorkerOutcome,
  buildCliCallTelemetryRecord,
  classifyCliWorkerOutcome,
  estimateCliWorkerTokens,
  isWorkerLockStale,
  runCliWorker,
  type CliWorkerInput,
  type WorkerLockRecord
} from "../../src/data/delivery-system/cliWorker";
import {
  aggregateCliCallTelemetryIntoBudget,
  type SubscriptionSessionBudget
} from "../../src/data/delivery-system/subscriptionBudget";
import {
  buildVendorEnv,
  buildCodexBashCommand,
  buildAgyArgs,
  captureCodexResponse,
  shq
} from "../../src/data/delivery-system/cliWorkerCapture";

const baseLock: WorkerLockRecord = {
  schema_version: "v1",
  worker_run_id: "cli-codex-hp-test-20260625T120000",
  handoff_id: "hp-test" as WorkerLockRecord["handoff_id"],
  vendor: "codex_cli",
  model: null,
  pid: null,
  started_at: new Date().toISOString(),
  lock_source: "supervisor_spawn",
  ttl_minutes: 30
};

describe("CLI worker safety classification", () => {
  it("keeps the clean success classification empty", () => {
    expect(classifyCliWorkerOutcome({
      exitCode: 0,
      rawOutput: "worker text",
      parsedJson: null,
      structuredOutputRequested: false
    })).toEqual({
      outcome: "success",
      errorReason: null,
      failure_signals: []
    });
  });

  it("sets errorReason for a non-zero exit even when text exists", () => {
    const result = classifyCliWorkerOutcome({
      exitCode: 2,
      rawOutput: "usage: codex exec ...",
      parsedJson: null,
      structuredOutputRequested: false
    });

    expect(result.outcome).toBe("non_zero_exit");
    expect(result.errorReason).toBe("non_zero_exit: worker exited with code 2");
    expect(result.failure_signals).toEqual(["non_zero_exit"]);
    expect(alertTriggersForCliWorkerOutcome(result)).toEqual(["non_zero_exit"]);
  });

  it("sets errorReason for auth-error text", () => {
    const result = classifyCliWorkerOutcome({
      exitCode: 0,
      rawOutput: "Error: login required before using this CLI",
      parsedJson: null,
      structuredOutputRequested: false
    });

    expect(result.outcome).toBe("auth_error");
    expect(result.errorReason).toBe("auth_error: worker output indicates authentication failure");
    expect(result.failure_signals).toEqual(["auth_error"]);
  });

  it("sets errorReason for timeout diagnostics", () => {
    const result = classifyCliWorkerOutcome({
      exitCode: 1,
      rawOutput: "",
      parsedJson: null,
      structuredOutputRequested: false,
      errorText: "codex capture timed out after 120000ms"
    });

    expect(result.outcome).toBe("timeout");
    expect(result.errorReason).toBe("timeout: worker capture timed out");
    expect(result.failure_signals).toEqual(["timeout", "empty_output", "non_zero_exit"]);
  });

  it("sets errorReason for empty output", () => {
    const result = classifyCliWorkerOutcome({
      exitCode: 0,
      rawOutput: "   ",
      parsedJson: null,
      structuredOutputRequested: false
    });

    expect(result.outcome).toBe("empty_output");
    expect(result.errorReason).toBe("empty_output: worker produced no output");
    expect(result.failure_signals).toEqual(["empty_output"]);
  });

  it("sets errorReason for invalid JSON when structured output was requested", () => {
    const result = classifyCliWorkerOutcome({
      exitCode: 0,
      rawOutput: "{ invalid json",
      parsedJson: null,
      structuredOutputRequested: true
    });

    expect(result.outcome).toBe("invalid_json");
    expect(result.errorReason).toBe("invalid_json: structured output requested but parsed JSON is absent");
    expect(result.failure_signals).toEqual(["invalid_json"]);
  });
});

describe("CLI worker lock validation", () => {
  it("treats invalid started_at as stale", () => {
    expect(isWorkerLockStale({ ...baseLock, started_at: "not-a-date" })).toBe(true);
  });

  it("treats missing or non-numeric ttl_minutes as stale", () => {
    expect(isWorkerLockStale({ ...baseLock, ttl_minutes: Number.NaN })).toBe(true);
    expect(isWorkerLockStale({ ...baseLock, ttl_minutes: undefined as unknown as number })).toBe(true);
    expect(isWorkerLockStale({ ...baseLock, ttl_minutes: "30" as unknown as number })).toBe(true);
  });
});

describe("CLI worker token telemetry", () => {
  it("estimates tokens from chars and word-like counts", () => {
    expect(estimateCliWorkerTokens("hello world")).toBe(3);
    expect(estimateCliWorkerTokens("")).toBe(0);
  });

  it("records the scoped session id when supplied", () => {
    const record = buildCliCallTelemetryRecord({
      recordedAt: "2026-06-25T12:00:00.000Z",
      workerRunId: "cli-codex-hp-session-20260625T120000",
      handoffId: "hp-session" as WorkerLockRecord["handoff_id"],
      sessionId: "session-project-manager",
      vendor: "codex_cli",
      model: "gpt-5-codex",
      tierId: null,
      prompt: "hello",
      rawOutput: "world",
      durationSeconds: 1,
      exitCode: 0,
      lockStatus: "acquired_supervisor_spawn",
      outcome: "success",
      failureSignals: [],
      errorReason: null,
      parsedJson: null
    });

    expect(record.session_id).toBe("session-project-manager");
  });

  it("builds the requested telemetry shape with estimated token counts", () => {
    const record = buildCliCallTelemetryRecord({
      recordedAt: "2026-06-25T12:00:00.000Z",
      workerRunId: "cli-codex-hp-test-20260625T120000",
      handoffId: "hp-test" as WorkerLockRecord["handoff_id"],
      vendor: "codex_cli",
      model: "gpt-5-codex",
      tierId: null,
      prompt: "hello world",
      rawOutput: "alpha beta gamma",
      durationSeconds: 1.25,
      attempt_count: 2,
      exitCode: 0,
      lockStatus: "acquired_supervisor_spawn",
      outcome: "success",
      failureSignals: [],
      errorReason: null,
      parsedJson: { ok: true }
    });

    expect(record).toEqual({
      schema_version: "v1",
      recorded_at: "2026-06-25T12:00:00.000Z",
      worker_run_id: "cli-codex-hp-test-20260625T120000",
      handoff_id: "hp-test",
      vendor: "codex_cli",
      provider: "openai_gpt",
      model: "gpt-5-codex",
      tier_id: null,
      input_chars: 11,
      output_chars: 16,
      input_tokens: 3,
      output_tokens: 4,
      total_tokens: 7,
      token_source: "estimated_chars",
      lock_source: "supervisor_spawn",
      duration_seconds: 1.25,
      attempt_count: 2,
      exit_code: 0,
      lock_status: "acquired_supervisor_spawn",
      outcome: "success",
      failure_signals: [],
      error_reason: null,
      parsed_json_present: true
    });
  });

  it("records routing_mode in telemetry when provided", () => {
    const record = buildCliCallTelemetryRecord({
      recordedAt: "2026-06-25T12:00:00.000Z",
      workerRunId: "cli-codex-hp-test-20260625T120000",
      handoffId: "hp-test" as WorkerLockRecord["handoff_id"],
      vendor: "codex_cli",
      model: "gpt-5-codex",
      tierId: null,
      prompt: "hello world",
      rawOutput: "alpha beta gamma",
      durationSeconds: 1.25,
      exitCode: 0,
      lockStatus: "acquired_supervisor_spawn",
      outcome: "success",
      failureSignals: [],
      errorReason: null,
      parsedJson: null,
      routingMode: "idea"
    });

    expect(record.routing_mode).toBe("idea");
  });

  it("records model generation settings when an adapter provides them", () => {
    const record = buildCliCallTelemetryRecord({
      recordedAt: "2026-06-25T12:00:00.000Z",
      workerRunId: "cli-codex-hp-test-20260625T120000",
      handoffId: "hp-test" as WorkerLockRecord["handoff_id"],
      vendor: "codex_cli",
      model: "gpt-5-codex",
      tierId: null,
      prompt: "hello world",
      rawOutput: "alpha beta gamma",
      durationSeconds: 1.25,
      exitCode: 0,
      lockStatus: "acquired_supervisor_spawn",
      outcome: "success",
      failureSignals: [],
      errorReason: null,
      parsedJson: null,
      generationSettings: {
        temperature: 0,
        max_output_tokens: 1200
      }
    });

    expect(record.generation_settings).toEqual({
      temperature: 0,
      max_output_tokens: 1200
    });
  });

  it("records adapter governance settings separately from generation settings", () => {
    const record = buildCliCallTelemetryRecord({
      recordedAt: "2026-06-25T12:00:00.000Z",
      workerRunId: "cli-openrouter-hp-test-20260625T120000",
      handoffId: "hp-test" as WorkerLockRecord["handoff_id"],
      vendor: "openrouter_api",
      model: "openrouter/free",
      tierId: null,
      prompt: "hello world",
      rawOutput: "alpha beta gamma",
      durationSeconds: 1.25,
      exitCode: 0,
      lockStatus: "acquired_supervisor_spawn",
      outcome: "success",
      failureSignals: [],
      errorReason: null,
      parsedJson: null,
      governanceSettings: {
        allow_fallbacks: false,
        max_price: { prompt: 0, completion: 0, request: 0 }
      }
    });

    expect(record.governance_settings).toEqual({
      allow_fallbacks: false,
      max_price: { prompt: 0, completion: 0, request: 0 }
    });
  });

  it("omits routing_mode from telemetry when absent", () => {
    const record = buildCliCallTelemetryRecord({
      recordedAt: "2026-06-25T12:00:00.000Z",
      workerRunId: "cli-codex-hp-test-20260625T120000",
      handoffId: "hp-test" as WorkerLockRecord["handoff_id"],
      vendor: "codex_cli",
      model: "gpt-5-codex",
      tierId: null,
      prompt: "hello world",
      rawOutput: "alpha beta gamma",
      durationSeconds: 1.25,
      exitCode: 0,
      lockStatus: "acquired_supervisor_spawn",
      outcome: "success",
      failureSignals: [],
      errorReason: null,
      parsedJson: null
    });

    expect("routing_mode" in record).toBe(false);
  });

  it("aggregates telemetry into the subscription session budget", () => {
    const budget: SubscriptionSessionBudget = {
      provider: "openai_gpt",
      activeTierId: "codex_subscription",
      activeTierRateLimitState: "available",
      rateLimitHitAt: undefined,
      lastAttemptedAt: undefined,
      availableTiers: [],
      exhaustedTierIds: [],
      sessionTaskCount: 2,
      sessionInputTokens: 10,
      sessionOutputTokens: 20,
      sessionTotalTokens: 30,
      sessionCallCount: 2,
      lastSuccessfulTaskAt: undefined,
      notes: undefined
    };

    expect(aggregateCliCallTelemetryIntoBudget(budget, {
      input_tokens: 3,
      output_tokens: 4,
      total_tokens: 7,
      recorded_at: "2026-06-25T12:00:00.000Z"
    })).toEqual({
      ...budget,
      sessionInputTokens: 13,
      sessionOutputTokens: 24,
      sessionTotalTokens: 37,
      sessionCallCount: 3,
      lastAttemptedAt: "2026-06-25T12:00:00.000Z"
    });
  });
});

// AF5 — containment (not just accounting): the exec lane must not leak host secrets
// into the vendor shell. Covers the env-scrub shipped in AF2.
describe("CLI worker exec containment", () => {
  it("scrubs host secrets from the vendor spawn env but keeps OS essentials", () => {
    const SECRET = "GITHUB_TOKEN";
    const SENTINEL = "ghp_sentinel_must_not_leak_to_vendor";
    const prior = process.env[SECRET];
    process.env[SECRET] = SENTINEL;
    try {
      const env = buildVendorEnv();
      // the secret must not reach the vendor shell, by key or by value
      expect(env[SECRET]).toBeUndefined();
      expect(Object.values(env)).not.toContain(SENTINEL);
      // no secret-ish key survives the allowlist
      for (const key of Object.keys(env)) {
        expect(/token|api[_-]?key|secret|password|aws|credential/i.test(key)).toBe(false);
      }
      // but the OS essentials the CLI needs to run are preserved
      const lowerKeys = Object.keys(env).map((key) => key.toLowerCase());
      expect(lowerKeys).toContain("path");
    } finally {
      if (prior === undefined) delete process.env[SECRET];
      else process.env[SECRET] = prior;
    }
  });

  it("shq wraps a value and escapes embedded single quotes", () => {
    expect(shq("plain")).toBe("'plain'");
    expect(shq("a'b")).toBe("'a'\\''b'");
  });

  it("forces a read-only sandbox + never-approve on the codex command", () => {
    const cmd = buildCodexBashCommand("codex", { model: "gpt-5-codex" }, "/tmp/out.json", "/tmp/p.txt");
    expect(cmd).toContain("-c sandbox_mode=read-only");
    expect(cmd).toContain("-c approval_policy=never");
  });

  it("rejects caller-supplied codex model values that could inject a command", () => {
    const evil = `m'; rm -rf ~ #`;
    expect(() => buildCodexBashCommand("codex", { model: evil }, "/tmp/o.json", "/tmp/p.txt"))
      .toThrow("invalid_model");
    expect(shq(evil)).toBe(`'m'\\''; rm -rf ~ #'`);
  });

  it("agy runs sandboxed by default without the permission bypass", () => {
    const args = buildAgyArgs("ping", { addDirs: ["/repo"] });
    expect(args).toContain("--sandbox");
    expect(args).not.toContain("--dangerously-skip-permissions");
    // --add-dir access grant stays independent of the bypass
    expect(args).toContain("--add-dir");
    expect(args).toContain("/repo");
  });

  it("agy includes the permission bypass only when explicitly opted in", () => {
    const args = buildAgyArgs("ping", { addDirs: ["/repo"], dangerouslySkipPermissions: true });
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--sandbox");
    // --add-dir access grant stays independent of the bypass
    expect(args).toContain("--add-dir");
    expect(args).toContain("/repo");
  });

  it("retries codex once when the first output file is empty and the second has JSON", async () => {
    const captureDirectory = join(tmpdir(), "autopilot-codex-captures");
    const promptFilesBefore = new Set(existsSync(captureDirectory)
      ? readdirSync(captureDirectory).filter((name) => name.startsWith("prompt-"))
      : []);
    const spawnSyncMock = vi.fn()
      .mockReturnValueOnce({ status: 1, stderr: "", stdout: "", error: undefined })
      .mockReturnValueOnce({ status: 0, stderr: "", stdout: "", error: undefined });
    const readFileSyncMock = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce(JSON.stringify({ ok: true }));

    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawnSync: spawnSyncMock };
    });
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return { ...actual, readFileSync: readFileSyncMock };
    });

    try {
      const result = await captureCodexResponse("ping", { retries: 1, timeoutMs: 1000 });

      expect(spawnSyncMock).toHaveBeenCalledTimes(2);
      expect(readFileSyncMock).toHaveBeenCalledTimes(2);
      expect(result.attempts).toBe(2);
      expect(result.parsedJson).toEqual({ ok: true });
      const promptFilesAfter = existsSync(captureDirectory)
        ? readdirSync(captureDirectory).filter((name) => name.startsWith("prompt-") && !promptFilesBefore.has(name))
        : [];
      expect(promptFilesAfter).toEqual([]);
    } finally {
      vi.doUnmock("node:child_process");
      vi.doUnmock("node:fs");
      vi.restoreAllMocks();
    }
  });
});

// AF6 — capability-tuple enforcement: an owner-selected reasoning effort unsupported by the
// selected adapter must refuse before any lock, telemetry, or provider side effect exists.
describe("CLI worker capability-tuple enforcement", () => {
  function baseInput(overrides: Partial<CliWorkerInput> = {}): CliWorkerInput {
    return {
      handoffId: "hp-effort-guard" as CliWorkerInput["handoffId"],
      vendor: "agy_cli",
      prompt: "ping",
      parentSessionHash: "session-hash",
      parentTurnHash: "turn-hash",
      ...overrides
    };
  }

  it("refuses an unsupported vendor/reasoning-effort tuple before any lock or telemetry side effect", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "autopilot-cli-worker-effort-guard-"));

    await expect(runCliWorker(baseInput({
      vendor: "agy_cli",
      generationSettings: { reasoning_effort: "xhigh" }
    }), stateDir)).rejects.toThrow("unsupported_reasoning_effort");

    expect(existsSync(join(stateDir, "worker.lock"))).toBe(false);
    expect(existsSync(join(stateDir, "cli-call-telemetry.jsonl"))).toBe(false);
  });

  it("refuses any non-null OpenRouter reasoning effort before any side effect", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "autopilot-cli-worker-effort-guard-"));

    await expect(runCliWorker(baseInput({
      vendor: "openrouter_api",
      openrouterMode: "qwen3_code_draft",
      taskPacketRef: "packet-1",
      generationSettings: { reasoning_effort: "low" }
    }), stateDir)).rejects.toThrow("unsupported_reasoning_effort");

    expect(existsSync(join(stateDir, "worker.lock"))).toBe(false);
    expect(existsSync(join(stateDir, "cli-call-telemetry.jsonl"))).toBe(false);
  });

  it("refuses an invalid model before every worker side effect", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "autopilot-cli-worker-model-guard-"));

    await expect(runCliWorker(baseInput({
      vendor: "claude_cli",
      model: "opus latest",
      generationSettings: { reasoning_effort: "high" }
    }), stateDir)).rejects.toThrow("invalid_model");

    expect(readdirSync(stateDir)).toEqual([]);
  });

  it("refuses a C1 control character in the model before every worker side effect", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "autopilot-cli-worker-model-guard-"));

    await expect(runCliWorker(baseInput({
      vendor: "claude_cli",
      model: "opus\u0085latest",
      generationSettings: { reasoning_effort: "high" }
    }), stateDir)).rejects.toThrow("invalid_model");

    expect(readdirSync(stateDir)).toEqual([]);
  });
});
