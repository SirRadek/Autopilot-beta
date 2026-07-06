import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runCliWorker,
  type CliWorkerInput
} from "../../src/data/delivery-system/cliWorker";
import {
  captureOpenRouterResponse,
  OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
  OPENROUTER_FREE_MINUTE_ATTEMPT_LIMIT,
  openRouterAttemptCounterPathForStateDir,
  type OpenRouterFetch,
  type OpenRouterMode,
  type OpenRouterModel
} from "../../src/data/delivery-system/cliWorkerCapture";

const secretKey = "sk-or-v1-test-secret-must-not-leak";

interface OpenRouterMockPayload {
  readonly model: OpenRouterModel | string;
  readonly content?: string;
  readonly usage?: Record<string, unknown>;
}

function openRouterInput(overrides: Partial<CliWorkerInput> = {}): CliWorkerInput {
  return {
    handoffId: "hp-openrouter-stage1" as CliWorkerInput["handoffId"],
    vendor: "openrouter_api",
    prompt: "bounded prompt packet for OpenRouter",
    openrouterMode: "qwen3_code_draft",
    taskPacketRef: "packet-openrouter-stage1",
    parentSessionHash: "session-hash",
    parentTurnHash: "turn-hash",
    ...overrides
  };
}

function openRouterResponse(payload: OpenRouterMockPayload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify({
      model: payload.model,
      choices: [
        {
          message: {
            content: payload.content ?? "{\"ok\":true}"
          }
        }
      ],
      usage: payload.usage ?? {
        prompt_tokens: 12,
        completion_tokens: 8,
        total_tokens: 20,
        cost: 0
      }
    })
  };
}

function readJsonlRecord(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8").trim().split(/\r?\n/)[0] ?? "{}") as Record<string, unknown>;
}

function writeMinuteBudgetAtLimit(stateDir: string): void {
  const counterPath = openRouterAttemptCounterPathForStateDir(stateDir);
  mkdirSync(dirname(counterPath), { recursive: true });
  const now = new Date().toISOString();
  const minutePrefix = now.slice(0, 16);
  const lines = Array.from({ length: OPENROUTER_FREE_MINUTE_ATTEMPT_LIMIT }, (_, index) => JSON.stringify({
    schema_version: "v1",
    recorded_at: `${minutePrefix}:00.${String(index).padStart(3, "0")}Z`,
    provider: "openrouter",
    openrouter_mode: "qwen3_code_draft",
    model: "qwen/qwen3-coder:free",
    task_packet_ref: `existing-${index}`
  }));
  writeFileSync(counterPath, `${lines.join("\n")}\n`, "utf8");
}

describe("OpenRouter Stage 1 worker lane", () => {
  let parentDir: string;
  let stateDir: string;
  let priorOpenRouterKey: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn<OpenRouterFetch>>;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), "autopilot-openrouter-stage1-"));
    stateDir = join(parentDir, "state");
    priorOpenRouterKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = secretKey;
    fetchMock = vi.fn<OpenRouterFetch>(async () =>
      openRouterResponse({ model: "qwen/qwen3-coder:free" })
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    if (priorOpenRouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = priorOpenRouterKey;
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    rmSync(parentDir, { recursive: true, force: true });
  });

  it.each([
    // Response mocks echo the CANONICAL model id WITHOUT the ":free" variant suffix — the suffix
    // is a request-side routing hint and the guard accepts the canonical form defensively (not yet
    // confirmed by a successful live response; the first live runs hit upstream-error envelopes).
    ["qwen3_code_draft", "qwen/qwen3-coder:free", "qwen/qwen3-coder"],
    ["nemotron_planning", "nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia/nemotron-3-ultra-550b-a55b"]
  ] as readonly [OpenRouterMode, OpenRouterModel, string][])("runs the %s mode through runCliWorker", async (mode, model, echoedModel) => {
    fetchMock.mockResolvedValueOnce(openRouterResponse({
      model: echoedModel,
      content: "{\"mode\":\"ok\"}"
    }));

    const result = await runCliWorker(openRouterInput({
      openrouterMode: mode,
      taskPacketRef: `packet-${mode}`
    }), stateDir);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT);
    expect(result).toMatchObject({
      vendor: "openrouter_api",
      model,
      exitCode: 0,
      rawOutput: "{\"mode\":\"ok\"}",
      parsedJson: { mode: "ok" },
      errorReason: null
    });

    const telemetry = readJsonlRecord(join(stateDir, "cli-call-telemetry.jsonl"));
    expect(telemetry).toMatchObject({
      vendor: "openrouter_api",
      provider: "openrouter",
      model,
      openrouter_mode: mode,
      task_packet_ref: `packet-${mode}`,
      token_source: "provider_reported",
      input_tokens: 12,
      output_tokens: 8,
      total_tokens: 20
    });
    expect(telemetry.attempt_counts).toMatchObject({
      day: 1,
      minute: 1,
      day_limit: 50,
      minute_limit: 20
    });

    const evidence = readJsonlRecord(join(stateDir, "subagent-evidence.jsonl"));
    expect(evidence).toMatchObject({
      agent_type: "openrouter_api-external",
      model,
      openrouter_mode: mode,
      task_packet_ref: `packet-${mode}`
    });
    expect(evidence.attempt_counts).toMatchObject({
      day: 1,
      minute: 1
    });
  });

  it("returns MISSING when OPENROUTER_API_KEY is absent", async () => {
    delete process.env.OPENROUTER_API_KEY;

    const result = await runCliWorker(openRouterInput(), stateDir);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      vendor: "openrouter_api",
      rawOutput: "",
      errorReason: "MISSING: openrouter_api_key_missing",
      missing: {
        status: "MISSING",
        provider: "openrouter",
        reason: "openrouter_api_key_missing"
      }
    });

    const telemetry = readJsonlRecord(join(stateDir, "cli-call-telemetry.jsonl"));
    expect(telemetry).toMatchObject({
      vendor: "openrouter_api",
      provider: "openrouter",
      openrouter_mode: "qwen3_code_draft",
      task_packet_ref: "packet-openrouter-stage1",
      error_reason: "MISSING: openrouter_api_key_missing"
    });
    expect(telemetry.attempt_counts).toBeUndefined();
  });

  it("rejects an off-allowlist model before network or telemetry", async () => {
    await expect(runCliWorker(openRouterInput({
      model: "openrouter/free"
    }), stateDir)).rejects.toThrow("openrouter_model_rejected");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(join(stateDir, "cli-call-telemetry.jsonl"))).toBe(false);
  });

  it("surfaces a 200-status error envelope as an upstream provider error (measured live shape)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          error: {
            message: "Upstream error from Nvidia: ResourceExhausted: Worker local total request limit reached (115/32)",
            code: 502
          }
        })
    });

    const result = await runCliWorker(openRouterInput({
      openrouterMode: "nemotron_planning",
      taskPacketRef: "packet-upstream-error"
    }), stateDir);

    expect(result.exitCode).toBe(1);
    expect(result.rawOutput).toBe("");
    expect(result.errorReason).toContain("openrouter_upstream_error: code 502");
    expect(result.errorReason).not.toContain("model did not match");
  });

  it("rejects a response that echoes a genuinely different model", async () => {
    fetchMock.mockResolvedValueOnce(openRouterResponse({
      model: "some-other/model",
      content: "{\"mode\":\"ok\"}"
    }));

    const result = await runCliWorker(openRouterInput({
      openrouterMode: "nemotron_planning",
      taskPacketRef: "packet-mismatch"
    }), stateDir);

    expect(result.exitCode).toBe(1);
    expect(result.rawOutput).toBe("");
    expect(result.errorReason).toContain("openrouter_model_rejected");
  });

  it("throws before worker side effects when taskPacketRef is missing", async () => {
    const input: CliWorkerInput = {
      handoffId: "hp-openrouter-stage1" as CliWorkerInput["handoffId"],
      vendor: "openrouter_api",
      prompt: "bounded prompt packet",
      openrouterMode: "qwen3_code_draft",
      parentSessionHash: "session-hash",
      parentTurnHash: "turn-hash"
    };

    await expect(runCliWorker(input, stateDir)).rejects.toThrow("openrouter_api requires taskPacketRef");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(join(stateDir, "worker.lock"))).toBe(false);
    expect(existsSync(join(stateDir, "cli-call-telemetry.jsonl"))).toBe(false);
  });

  it.each([
    ["secret-bearing", "please use api_key=super-secret-value"],
    ["path-bearing", "read C:\\Users\\owner\\project\\secrets.txt"]
  ])("rejects a %s prompt before network or telemetry", async (_name, prompt) => {
    await expect(runCliWorker(openRouterInput({ prompt }), stateDir)).rejects.toThrow("openrouter_redaction_rejected");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(join(stateDir, "cli-call-telemetry.jsonl"))).toBe(false);
  });

  it("rejects cwd/addDirs/images for ACCESS-TIER-001 structure", async () => {
    await expect(runCliWorker(openRouterInput({
      cwd: process.cwd()
    }), stateDir)).rejects.toThrow("openrouter_access_tier_violation");

    await expect(runCliWorker(openRouterInput({
      addDirs: []
    }), stateDir)).rejects.toThrow("openrouter_access_tier_violation");

    await expect(runCliWorker(openRouterInput({
      images: []
    }), stateDir)).rejects.toThrow("openrouter_access_tier_violation");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records budget exhaustion without calling fetch", async () => {
    // Freeze Date (only Date — real timers stay live) so the seeded minute-window
    // records and the budget check's minute key cannot straddle a minute boundary
    // when a slow parallel run delays the check past :59 of the seeding minute.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
    writeMinuteBudgetAtLimit(stateDir);

    const result = await runCliWorker(openRouterInput(), stateDir);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.errorReason).toContain("OpenRouterBudgetError: openrouter_budget_exceeded");

    const telemetry = readJsonlRecord(join(stateDir, "cli-call-telemetry.jsonl"));
    expect(telemetry.error_reason).toContain("OpenRouterBudgetError: openrouter_budget_exceeded");
    expect(telemetry.attempt_counts).toMatchObject({
      minute: OPENROUTER_FREE_MINUTE_ATTEMPT_LIMIT + 1,
      minute_limit: OPENROUTER_FREE_MINUTE_ATTEMPT_LIMIT
    });
  });

  it("records a named error when usage reports nonzero cost", async () => {
    fetchMock.mockResolvedValueOnce(openRouterResponse({
      model: "qwen/qwen3-coder:free",
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        total_cost: 0.01
      }
    }));

    const result = await runCliWorker(openRouterInput(), stateDir);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.errorReason).toContain("OpenRouterZeroCostAssertionError: openrouter_nonzero_cost_detected");

    const telemetry = readJsonlRecord(join(stateDir, "cli-call-telemetry.jsonl"));
    expect(telemetry.error_reason).toContain("OpenRouterZeroCostAssertionError: openrouter_nonzero_cost_detected");

    const evidence = readJsonlRecord(join(stateDir, "subagent-evidence.jsonl"));
    expect(evidence.error_reason).toContain("OpenRouterZeroCostAssertionError: openrouter_nonzero_cost_detected");
  });

  it("keeps the API key out of serialized results, telemetry, evidence, and error strings", async () => {
    fetchMock.mockResolvedValueOnce(openRouterResponse({
      model: "qwen/qwen3-coder:free",
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        cost: 0.25
      }
    }));

    const result = await runCliWorker(openRouterInput(), stateDir);
    const telemetry = readJsonlRecord(join(stateDir, "cli-call-telemetry.jsonl"));
    const evidence = readJsonlRecord(join(stateDir, "subagent-evidence.jsonl"));

    expect(JSON.stringify({
      result,
      telemetry,
      evidence,
      error: result.errorReason
    })).not.toContain(secretKey);
  });

  it("supports direct mocked fetch injection in captureOpenRouterResponse", async () => {
    const injectedFetch = vi.fn<OpenRouterFetch>(async () =>
      openRouterResponse({
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
        content: "planning draft"
      })
    );

    const result = await captureOpenRouterResponse("bounded prompt packet", {
      openrouterMode: "nemotron_planning",
      fetchImpl: injectedFetch
    });

    expect(injectedFetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      exitCode: 0,
      rawOutput: "planning draft",
      model: "nvidia/nemotron-3-ultra-550b-a55b:free"
    });
  });
});
