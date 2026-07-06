import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runCliWorker,
  type CliWorkerInput
} from "../../src/data/delivery-system/cliWorker";
import {
  OPENROUTER_DAILY_SPEND_CAP_USD,
  openRouterSpendLedgerPathForStateDir,
  sumOpenRouterSpendForDay,
  type OpenRouterFetch,
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
    handoffId: "hp-openrouter-spend-cap" as CliWorkerInput["handoffId"],
    vendor: "openrouter_api",
    prompt: "bounded prompt packet for OpenRouter spend cap",
    openrouterMode: "qwen3_code_draft",
    taskPacketRef: "packet-openrouter-spend-cap",
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

function writeSpendLedger(stateDir: string, records: readonly Record<string, unknown>[]): string {
  const ledgerPath = openRouterSpendLedgerPathForStateDir(stateDir);
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  return ledgerPath;
}

function readJsonlRecord(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8").trim().split(/\r?\n/)[0] ?? "{}") as Record<string, unknown>;
}

function readJsonlRecords(path: string): readonly Record<string, unknown>[] {
  if (!existsSync(path)) {
    return [];
  }

  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("OpenRouter spend cap ledger", () => {
  let parentDir: string;
  let stateDir: string;
  let priorOpenRouterKey: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn<OpenRouterFetch>>;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), "autopilot-openrouter-spend-cap-"));
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
    vi.unstubAllGlobals();
    rmSync(parentDir, { recursive: true, force: true });
  });

  it("sums only the requested UTC day and skips malformed ledger lines", () => {
    const ledgerText = [
      JSON.stringify({ recorded_at: "2026-07-06T00:00:00.000Z", cost_usd: 0.25 }),
      "{not-json",
      JSON.stringify({ recorded_at: "2026-07-05T23:59:59.999Z", cost_usd: 9 }),
      JSON.stringify({ recorded_at: "2026-07-06T12:00:00.000Z", cost_usd: 0.75 }),
      JSON.stringify({ recorded_at: "2026-07-06T18:00:00.000Z", cost_usd: "not-a-number" })
    ].join("\n");

    expect(sumOpenRouterSpendForDay(ledgerText, "2026-07-06")).toBe(1);
    expect(sumOpenRouterSpendForDay("", "2026-07-06")).toBe(0);
  });

  it("refuses pre-send when today's ledgered spend has reached the cap", async () => {
    const today = new Date().toISOString();
    writeSpendLedger(stateDir, [
      {
        schema_version: "v1",
        recorded_at: today,
        model: "qwen/qwen3-coder:free",
        openrouter_mode: "qwen3_code_draft",
        cost_usd: OPENROUTER_DAILY_SPEND_CAP_USD
      }
    ]);

    const result = await runCliWorker(openRouterInput(), stateDir);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.errorReason).toContain("OpenRouterSpendBudgetError: openrouter_spend_budget_exhausted");

    const telemetry = readJsonlRecord(join(stateDir, "cli-call-telemetry.jsonl"));
    expect(telemetry.error_reason).toContain("OpenRouterSpendBudgetError: openrouter_spend_budget_exhausted");
  });

  it("does not block today for yesterday's ledgered spend", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    writeSpendLedger(stateDir, [
      {
        schema_version: "v1",
        recorded_at: yesterday,
        model: "qwen/qwen3-coder:free",
        openrouter_mode: "qwen3_code_draft",
        cost_usd: OPENROUTER_DAILY_SPEND_CAP_USD
      }
    ]);

    const result = await runCliWorker(openRouterInput(), stateDir);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      exitCode: 0,
      errorReason: null
    });
  });

  it("ledgers a nonzero-cost response before the zero-cost assertion rejects it", async () => {
    fetchMock.mockResolvedValueOnce(openRouterResponse({
      model: "qwen/qwen3-coder:free",
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        total_cost: 0.42
      }
    }));

    const result = await runCliWorker(openRouterInput(), stateDir);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.errorReason).toContain("OpenRouterZeroCostAssertionError: openrouter_nonzero_cost_detected");

    const ledgerRecords = readJsonlRecords(openRouterSpendLedgerPathForStateDir(stateDir));
    expect(ledgerRecords).toHaveLength(1);
    expect(ledgerRecords[0]).toMatchObject({
      schema_version: "v1",
      model: "qwen/qwen3-coder:free",
      openrouter_mode: "qwen3_code_draft",
      cost_usd: 0.42
    });
    expect(typeof ledgerRecords[0]?.recorded_at).toBe("string");
  });

  it("does not append a spend ledger line for a zero-cost response", async () => {
    const result = await runCliWorker(openRouterInput(), stateDir);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      exitCode: 0,
      errorReason: null
    });
    expect(existsSync(openRouterSpendLedgerPathForStateDir(stateDir))).toBe(false);
  });
});
