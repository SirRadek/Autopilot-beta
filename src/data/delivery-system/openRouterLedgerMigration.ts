import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { TextDecoder } from "node:util";

import {
  OPENROUTER_ATTEMPT_COUNTER_FILE,
  OPENROUTER_SPEND_LEDGER_FILE
} from "./cliWorkerCapture";

export const OPENROUTER_LEDGER_MAX_BYTES = 4 * 1024 * 1024;
export const OPENROUTER_LEDGER_MAX_RECORDS = 20_000;

export interface OpenRouterLedgerMigrationResult {
  readonly status: "not_needed" | "migrated" | "already_migrated";
  readonly migrated_files: readonly string[];
  readonly retained_legacy_files: readonly string[];
}

type OpenRouterLedgerKind = "attempt" | "spend";

interface LedgerSpec {
  readonly fileName: string;
  readonly kind: OpenRouterLedgerKind;
}

interface ValidatedLedger {
  readonly path: string;
  readonly bytes: Buffer;
  readonly hash: string;
}

interface LedgerMigrationPlan {
  readonly spec: LedgerSpec;
  readonly legacy: ValidatedLedger | null;
  readonly managed: ValidatedLedger | null;
  readonly managedPath: string;
}

const LEDGER_SPECS: readonly LedgerSpec[] = [
  { fileName: OPENROUTER_ATTEMPT_COUNTER_FILE, kind: "attempt" },
  { fileName: OPENROUTER_SPEND_LEDGER_FILE, kind: "spend" }
];

export function ensureOpenRouterLedgersMigrated(stateDir: string): OpenRouterLedgerMigrationResult {
  const legacyDir = dirname(stateDir);
  const plans = LEDGER_SPECS.map((spec) => buildMigrationPlan(spec, legacyDir, stateDir));
  const retainedLegacyFiles = plans.flatMap((plan) => plan.legacy === null ? [] : [plan.legacy.path]);
  const hasAnyLedger = plans.some((plan) => plan.legacy !== null || plan.managed !== null);

  for (const plan of plans) {
    if (plan.legacy !== null && plan.managed !== null && !ledgersMatch(plan.legacy, plan.managed)) {
      throw new Error(`openrouter_ledger_migration_conflict: ${plan.spec.fileName}`);
    }
  }

  const migratedFiles: string[] = [];
  for (const plan of plans) {
    if (plan.legacy === null || plan.managed !== null) {
      continue;
    }

    if (publishLedgerWithoutOverwrite(plan.legacy, plan.managedPath, plan.spec.kind)) {
      migratedFiles.push(plan.managedPath);
    }
  }

  return {
    status: migratedFiles.length > 0 ? "migrated" : hasAnyLedger ? "already_migrated" : "not_needed",
    migrated_files: migratedFiles,
    retained_legacy_files: retainedLegacyFiles
  };
}

function buildMigrationPlan(spec: LedgerSpec, legacyDir: string, stateDir: string): LedgerMigrationPlan {
  const legacyPath = join(legacyDir, spec.fileName);
  const managedPath = join(stateDir, spec.fileName);
  return {
    spec,
    legacy: readValidatedLedgerIfPresent(legacyPath, spec.kind),
    managed: readValidatedLedgerIfPresent(managedPath, spec.kind),
    managedPath
  };
}

function readValidatedLedgerIfPresent(path: string, kind: OpenRouterLedgerKind): ValidatedLedger | null {
  let pathStats;
  try {
    pathStats = lstatSync(path, { bigint: true });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw error;
  }

  if (!pathStats.isFile() || pathStats.isSymbolicLink()) {
    throw new Error(`openrouter_ledger_migration_unsafe_file: ${path}`);
  }
  if (pathStats.size > BigInt(OPENROUTER_LEDGER_MAX_BYTES)) {
    throw new Error(`openrouter_ledger_migration_too_large: ${path}`);
  }

  const flags = constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;
  let fileDescriptor: number;
  try {
    fileDescriptor = openSync(path, flags);
  } catch (error) {
    if (isNodeError(error, "ELOOP")) {
      throw new Error(`openrouter_ledger_migration_unsafe_file: ${path}`);
    }
    throw error;
  }

  let bytes: Buffer;
  try {
    const openedStats = fstatSync(fileDescriptor, { bigint: true });
    if (
      !openedStats.isFile() ||
      openedStats.dev !== pathStats.dev ||
      openedStats.ino !== pathStats.ino ||
      openedStats.size > BigInt(OPENROUTER_LEDGER_MAX_BYTES)
    ) {
      throw new Error(`openrouter_ledger_migration_unsafe_file: ${path}`);
    }
    bytes = readBoundedLedger(fileDescriptor, path);
    const finalStats = fstatSync(fileDescriptor, { bigint: true });
    if (
      finalStats.size !== openedStats.size ||
      finalStats.size !== BigInt(bytes.byteLength) ||
      finalStats.mtimeNs !== openedStats.mtimeNs
    ) {
      throw new Error(`openrouter_ledger_migration_source_changed: ${path}`);
    }
  } finally {
    closeSync(fileDescriptor);
  }

  validateJsonl(bytes, kind, path);
  return { path, bytes, hash: sha256(bytes) };
}

function readBoundedLedger(fileDescriptor: number, path: string): Buffer {
  const buffer = Buffer.allocUnsafe(OPENROUTER_LEDGER_MAX_BYTES + 1);
  let bytesRead = 0;
  while (bytesRead < buffer.byteLength) {
    const count = readSync(fileDescriptor, buffer, bytesRead, buffer.byteLength - bytesRead, null);
    if (count === 0) {
      break;
    }
    bytesRead += count;
  }
  if (bytesRead > OPENROUTER_LEDGER_MAX_BYTES) {
    throw new Error(`openrouter_ledger_migration_too_large: ${path}`);
  }
  return Buffer.from(buffer.subarray(0, bytesRead));
}

function validateJsonl(bytes: Buffer, kind: OpenRouterLedgerKind, path: string): void {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`openrouter_ledger_migration_malformed: ${path}`);
  }

  let ledgerText: string;
  try {
    ledgerText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`openrouter_ledger_migration_malformed: ${path}`);
  }

  let recordCount = 0;
  for (const line of ledgerText.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    recordCount += 1;
    if (recordCount > OPENROUTER_LEDGER_MAX_RECORDS) {
      throw new Error(`openrouter_ledger_migration_too_many_records: ${path}`);
    }

    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`openrouter_ledger_migration_malformed: ${path}`);
    }
    if (!isValidLedgerRecord(value, kind)) {
      throw new Error(`openrouter_ledger_migration_malformed: ${path}`);
    }
  }
}

function isValidLedgerRecord(value: unknown, kind: OpenRouterLedgerKind): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.schema_version !== "v1" ||
    !isNonEmptyString(record.recorded_at) ||
    !Number.isFinite(Date.parse(record.recorded_at)) ||
    !isNonEmptyString(record.model) ||
    !isOpenRouterMode(record.openrouter_mode)
  ) {
    return false;
  }

  if (kind === "attempt") {
    return record.provider === "openrouter" && isNonEmptyString(record.task_packet_ref);
  }
  return typeof record.cost_usd === "number" && Number.isFinite(record.cost_usd) && record.cost_usd >= 0;
}

function publishLedgerWithoutOverwrite(
  source: ValidatedLedger,
  managedPath: string,
  kind: OpenRouterLedgerKind
): boolean {
  mkdirSync(dirname(managedPath), { recursive: true, mode: 0o700 });
  const temporaryPath = join(dirname(managedPath), `.${basename(managedPath)}.${process.pid}.${randomUUID()}.tmp`);
  let temporaryExists = false;

  try {
    const fileDescriptor = openSync(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    temporaryExists = true;
    try {
      fchmodSync(fileDescriptor, 0o600);
      writeFileSync(fileDescriptor, source.bytes);
      fsyncSync(fileDescriptor);
      const stats = fstatSync(fileDescriptor);
      if (stats.size !== source.bytes.byteLength) {
        throw new Error(`openrouter_ledger_migration_verification_failed: ${managedPath}`);
      }
    } finally {
      closeSync(fileDescriptor);
    }

    const temporary = readValidatedLedgerIfPresent(temporaryPath, kind);
    if (temporary === null || !ledgersMatch(source, temporary)) {
      throw new Error(`openrouter_ledger_migration_verification_failed: ${managedPath}`);
    }

    try {
      linkSync(temporaryPath, managedPath);
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) {
        throw error;
      }
      const existing = readValidatedLedgerIfPresent(managedPath, kind);
      if (existing === null || !ledgersMatch(source, existing)) {
        throw new Error(`openrouter_ledger_migration_conflict: ${managedPath}`);
      }
      return false;
    }

    fsyncDirectory(dirname(managedPath));
    const published = readValidatedLedgerIfPresent(managedPath, kind);
    if (published === null || !ledgersMatch(source, published)) {
      throw new Error(`openrouter_ledger_migration_verification_failed: ${managedPath}`);
    }
    return true;
  } finally {
    if (temporaryExists) {
      try {
        unlinkSync(temporaryPath);
        fsyncDirectory(dirname(managedPath));
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) {
          throw error;
        }
      }
    }
  }
}

function fsyncDirectory(path: string): void {
  const fileDescriptor = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fileDescriptor);
  } finally {
    closeSync(fileDescriptor);
  }
}

function ledgersMatch(left: ValidatedLedger, right: ValidatedLedger): boolean {
  return left.bytes.byteLength === right.bytes.byteLength && left.hash === right.hash;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOpenRouterMode(value: unknown): boolean {
  return value === "qwen3_code_draft" || value === "nemotron_planning";
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
