import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type EvidenceFreshnessStatus = "fresh" | "stale" | "future";

export interface EvidenceFreshnessInputRecord {
  readonly id: string;
  readonly source_date: string;
  readonly freshness_ttl_days: number;
}

export interface EvidenceFreshnessResult {
  readonly id: string;
  readonly source_date: string;
  readonly freshness_ttl_days: number;
  readonly expires_on: string;
  readonly status: EvidenceFreshnessStatus;
}

export function analyzeEvidenceFreshness(
  records: readonly EvidenceFreshnessInputRecord[],
  nowIso: string
): readonly EvidenceFreshnessResult[] {
  const nowTimestamp = dateOnlyToUtcTimestamp(nowIso);

  return records.map((record) => {
    const sourceTimestamp = dateOnlyToUtcTimestamp(record.source_date);
    const expiresTimestamp = Number.isNaN(sourceTimestamp)
      ? Number.NaN
      : sourceTimestamp + record.freshness_ttl_days * 24 * 60 * 60 * 1000;
    const expiresOn = Number.isNaN(expiresTimestamp)
      ? "invalid-date"
      : new Date(expiresTimestamp).toISOString().slice(0, 10);
    const status =
      !Number.isNaN(nowTimestamp) && !Number.isNaN(sourceTimestamp) && sourceTimestamp > nowTimestamp
        ? "future"
        : Number.isNaN(nowTimestamp) || Number.isNaN(expiresTimestamp) || expiresTimestamp < nowTimestamp
          ? "stale"
          : "fresh";

    return {
      id: record.id,
      source_date: record.source_date,
      freshness_ttl_days: record.freshness_ttl_days,
      expires_on: expiresOn,
      status
    };
  });
}

export function getEvidenceFreshnessExitCode(results: readonly EvidenceFreshnessResult[], failOnStale: boolean): 0 | 1 {
  if (!failOnStale) {
    return 0;
  }

  return results.some((result) => result.status === "stale" || result.status === "future") ? 1 : 0;
}

export function formatEvidenceFreshnessReport(
  results: readonly EvidenceFreshnessResult[],
  nowIso: string
): string {
  const lines = [`Evidence freshness report (now: ${nowIso})`];

  if (results.length === 0) {
    lines.push("No evidence records found.");
  }

  for (const result of results) {
    lines.push(
      `- ${result.id}: ${result.status} (source_date ${result.source_date}, ttl ${result.freshness_ttl_days}d, expires ${result.expires_on})`
    );
  }

  return `${lines.join("\n")}\n`;
}

function readEvidenceRecords(repoRoot: string): readonly EvidenceFreshnessInputRecord[] {
  const recordsRoot = join(repoRoot, "product-design-os", "evidence", "records");
  if (!existsSync(recordsRoot)) {
    return [];
  }

  return listFiles(recordsRoot)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => toEvidenceRecord(JSON.parse(readFileSync(file, "utf8")) as unknown, file));
}

function toEvidenceRecord(value: unknown, file: string): EvidenceFreshnessInputRecord {
  if (!isRecord(value)) {
    return { id: file, source_date: "invalid-date", freshness_ttl_days: 0 };
  }

  return {
    id: typeof value.id === "string" ? value.id : file,
    source_date: typeof value.source_date === "string" ? value.source_date : "invalid-date",
    freshness_ttl_days: typeof value.freshness_ttl_days === "number" ? value.freshness_ttl_days : 0
  };
}

function parseArgs(args: readonly string[]): { now?: string; failOnStale: boolean } {
  const result: { now?: string; failOnStale: boolean } = { failOnStale: false };

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];

    if (key === "--fail-on-stale") {
      result.failOnStale = true;
      continue;
    }

    const value = args[index + 1];
    if (!value) {
      continue;
    }

    if (key === "--now") {
      result.now = value;
      index += 1;
    }
  }

  return result;
}

function printUsage(): void {
  console.log(`Usage:
  tsx product-design-os/scripts/check-evidence-freshness-product-design-os.ts --now 2026-06-24 [--fail-on-stale]`);
}

function runCli(): void {
  let failOnStale = process.argv.slice(2).includes("--fail-on-stale");

  try {
    const args = parseArgs(process.argv.slice(2));
    failOnStale = args.failOnStale;
    const nowIso = args.now ?? formatLocalDateOnly(new Date());
    const records = readEvidenceRecords(process.cwd());
    const results = analyzeEvidenceFreshness(records, nowIso);
    console.log(formatEvidenceFreshnessReport(results, nowIso));
    const exitCode = getEvidenceFreshnessExitCode(results, failOnStale);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown evidence freshness failure.";
    console.error(`Evidence freshness check failed: ${message}`);
    printUsage();
    if (failOnStale) {
      process.exitCode = 1;
    }
  }
}

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    const stats = statSync(path);

    return stats.isDirectory() ? listFiles(path) : [path];
  });
}

function dateOnlyToUtcTimestamp(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return Number.NaN;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);

  if (new Date(timestamp).toISOString().slice(0, 10) !== value) {
    return Number.NaN;
  }

  return timestamp;
}

function formatLocalDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (basename(invokedFile) === basename(currentFile) && invokedFile === currentFile) {
  runCli();
}
