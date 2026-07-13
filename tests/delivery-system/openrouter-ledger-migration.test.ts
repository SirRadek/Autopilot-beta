import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCliWorker, type CliWorkerInput } from "../../src/data/delivery-system/cliWorker";
import {
  OPENROUTER_ATTEMPT_COUNTER_FILE,
  OPENROUTER_SPEND_LEDGER_FILE,
  openRouterAttemptCounterPathForStateDir,
  openRouterSpendLedgerPathForStateDir,
  type OpenRouterFetch
} from "../../src/data/delivery-system/cliWorkerCapture";
import {
  OPENROUTER_LEDGER_MAX_BYTES,
  OPENROUTER_LEDGER_MAX_RECORDS,
  ensureOpenRouterLedgersMigrated
} from "../../src/data/delivery-system/openRouterLedgerMigration";

function attemptRecord(taskPacketRef = "packet-existing"): Record<string, unknown> {
  return {
    schema_version: "v1",
    recorded_at: "2026-07-13T10:00:00.000Z",
    provider: "openrouter",
    openrouter_mode: "qwen3_code_draft",
    model: "qwen/qwen3-coder:free",
    task_packet_ref: taskPacketRef
  };
}

function spendRecord(costUsd = 0.25): Record<string, unknown> {
  return {
    schema_version: "v1",
    recorded_at: "2026-07-13T10:00:00.000Z",
    model: "qwen/qwen3-coder:free",
    openrouter_mode: "qwen3_code_draft",
    cost_usd: costUsd
  };
}

function jsonl(records: readonly Record<string, unknown>[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

describe("managed OpenRouter ledger migration", () => {
  let parentDir: string;
  let stateDir: string;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), "autopilot-openrouter-ledger-migration-"));
    stateDir = join(parentDir, "state");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(parentDir, { recursive: true, force: true });
  });

  it("keeps both active ledger paths directly under managed state", () => {
    expect(openRouterAttemptCounterPathForStateDir(stateDir)).toBe(join(stateDir, OPENROUTER_ATTEMPT_COUNTER_FILE));
    expect(openRouterSpendLedgerPathForStateDir(stateDir)).toBe(join(stateDir, OPENROUTER_SPEND_LEDGER_FILE));
  });

  it("copies valid legacy ledgers byte-for-byte and retains their sources", () => {
    const legacyAttemptPath = join(parentDir, OPENROUTER_ATTEMPT_COUNTER_FILE);
    const legacySpendPath = join(parentDir, OPENROUTER_SPEND_LEDGER_FILE);
    writeFileSync(legacyAttemptPath, `\n${jsonl([attemptRecord()])}`, "utf8");
    writeFileSync(legacySpendPath, jsonl([spendRecord()]), "utf8");

    const result = ensureOpenRouterLedgersMigrated(stateDir);

    expect(result).toEqual({
      status: "migrated",
      migrated_files: [
        join(stateDir, OPENROUTER_ATTEMPT_COUNTER_FILE),
        join(stateDir, OPENROUTER_SPEND_LEDGER_FILE)
      ],
      retained_legacy_files: [legacyAttemptPath, legacySpendPath]
    });
    expect(readFileSync(join(stateDir, OPENROUTER_ATTEMPT_COUNTER_FILE))).toEqual(readFileSync(legacyAttemptPath));
    expect(readFileSync(join(stateDir, OPENROUTER_SPEND_LEDGER_FILE))).toEqual(readFileSync(legacySpendPath));
    expect(statSync(join(stateDir, OPENROUTER_ATTEMPT_COUNTER_FILE)).mode & 0o777).toBe(0o600);
    expect(statSync(join(stateDir, OPENROUTER_SPEND_LEDGER_FILE)).mode & 0o777).toBe(0o600);
    expect(existsSync(legacyAttemptPath)).toBe(true);
    expect(existsSync(legacySpendPath)).toBe(true);
  });

  it("reports not_needed without creating ledger files when no ledgers exist", () => {
    expect(ensureOpenRouterLedgersMigrated(stateDir)).toEqual({
      status: "not_needed",
      migrated_files: [],
      retained_legacy_files: []
    });
    expect(existsSync(join(stateDir, OPENROUTER_ATTEMPT_COUNTER_FILE))).toBe(false);
    expect(existsSync(join(stateDir, OPENROUTER_SPEND_LEDGER_FILE))).toBe(false);
  });

  it("is idempotent when managed and retained legacy bytes match", () => {
    const legacyPath = join(parentDir, OPENROUTER_ATTEMPT_COUNTER_FILE);
    writeFileSync(legacyPath, jsonl([attemptRecord()]), "utf8");
    ensureOpenRouterLedgersMigrated(stateDir);

    expect(ensureOpenRouterLedgersMigrated(stateDir)).toEqual({
      status: "already_migrated",
      migrated_files: [],
      retained_legacy_files: [legacyPath]
    });
  });

  it("rejects conflicting legacy and managed ledgers", () => {
    mkdirSync(stateDir);
    writeFileSync(join(parentDir, OPENROUTER_ATTEMPT_COUNTER_FILE), jsonl([attemptRecord("legacy")]), "utf8");
    writeFileSync(join(stateDir, OPENROUTER_ATTEMPT_COUNTER_FILE), jsonl([attemptRecord("managed")]), "utf8");

    expect(() => ensureOpenRouterLedgersMigrated(stateDir)).toThrow("openrouter_ledger_migration_conflict");
  });

  it("completes a partial migration without replacing the matching managed ledger", () => {
    mkdirSync(stateDir);
    const attemptBytes = jsonl([attemptRecord()]);
    const legacyAttemptPath = join(parentDir, OPENROUTER_ATTEMPT_COUNTER_FILE);
    const legacySpendPath = join(parentDir, OPENROUTER_SPEND_LEDGER_FILE);
    const managedAttemptPath = join(stateDir, OPENROUTER_ATTEMPT_COUNTER_FILE);
    writeFileSync(legacyAttemptPath, attemptBytes, "utf8");
    writeFileSync(managedAttemptPath, attemptBytes, "utf8");
    writeFileSync(legacySpendPath, jsonl([spendRecord()]), "utf8");

    expect(ensureOpenRouterLedgersMigrated(stateDir)).toEqual({
      status: "migrated",
      migrated_files: [join(stateDir, OPENROUTER_SPEND_LEDGER_FILE)],
      retained_legacy_files: [legacyAttemptPath, legacySpendPath]
    });
    expect(readFileSync(managedAttemptPath, "utf8")).toBe(attemptBytes);
  });

  it.each([
    ["legacy", false],
    ["managed", true]
  ])("rejects a symlinked %s ledger", (_location, managed) => {
    if (managed) {
      mkdirSync(stateDir);
    }
    const targetPath = join(parentDir, "target.jsonl");
    writeFileSync(targetPath, jsonl([attemptRecord()]), "utf8");
    symlinkSync(targetPath, join(managed ? stateDir : parentDir, OPENROUTER_ATTEMPT_COUNTER_FILE));

    expect(() => ensureOpenRouterLedgersMigrated(stateDir)).toThrow("openrouter_ledger_migration_unsafe_file");
  });

  it("rejects a non-regular legacy ledger", () => {
    mkdirSync(join(parentDir, OPENROUTER_ATTEMPT_COUNTER_FILE));

    expect(() => ensureOpenRouterLedgersMigrated(stateDir)).toThrow("openrouter_ledger_migration_unsafe_file");
  });

  it.each([
    ["malformed JSON", "{not-json\n"],
    ["wrong schema version", `${JSON.stringify({ ...attemptRecord(), schema_version: "v2" })}\n`],
    ["invalid v1 attempt record", `${JSON.stringify({ schema_version: "v1" })}\n`]
  ])("rejects %s", (_name, content) => {
    writeFileSync(join(parentDir, OPENROUTER_ATTEMPT_COUNTER_FILE), content, "utf8");

    expect(() => ensureOpenRouterLedgersMigrated(stateDir)).toThrow("openrouter_ledger_migration_malformed");
  });

  it("rejects a ledger above the byte bound", () => {
    const path = join(parentDir, OPENROUTER_ATTEMPT_COUNTER_FILE);
    writeFileSync(path, Buffer.alloc(OPENROUTER_LEDGER_MAX_BYTES + 1, 0x20));

    expect(() => ensureOpenRouterLedgersMigrated(stateDir)).toThrow("openrouter_ledger_migration_too_large");
  });

  it("rejects more than the non-empty record bound", () => {
    const record = JSON.stringify(attemptRecord());
    writeFileSync(
      join(parentDir, OPENROUTER_ATTEMPT_COUNTER_FILE),
      `${Array.from({ length: OPENROUTER_LEDGER_MAX_RECORDS + 1 }, () => record).join("\n")}\n`,
      "utf8"
    );

    expect(() => ensureOpenRouterLedgersMigrated(stateDir)).toThrow("openrouter_ledger_migration_too_many_records");
  });

  it("does not call the provider when migration fails", async () => {
    writeFileSync(join(parentDir, OPENROUTER_ATTEMPT_COUNTER_FILE), "{not-json\n", "utf8");
    const fetchMock = vi.fn<OpenRouterFetch>();
    vi.stubGlobal("fetch", fetchMock);
    const priorKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test-secret-must-not-leak";
    const input: CliWorkerInput = {
      handoffId: "hp-openrouter-migration" as CliWorkerInput["handoffId"],
      vendor: "openrouter_api",
      prompt: "bounded OpenRouter migration packet",
      openrouterMode: "qwen3_code_draft",
      taskPacketRef: "packet-openrouter-migration",
      parentSessionHash: "session-hash",
      parentTurnHash: "turn-hash"
    };

    try {
      const result = await runCliWorker(input, stateDir);
      expect(result.errorReason).toContain("openrouter_ledger_migration_malformed");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(existsSync(openRouterAttemptCounterPathForStateDir(stateDir))).toBe(false);
    } finally {
      if (priorKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = priorKey;
      }
    }
  });
});
