import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { summarizeCodexRolloutJsonl } from "../src/data/delivery-system/codexRolloutEfficiency";
import {
  assertAggregateOnly,
  buildEfficiencyReport,
  compareEfficiencyWindows,
  type EfficiencyReportV1,
  type WorkUnitRecord,
} from "../src/data/delivery-system/efficiencyReport";
import type {
  WorkUnitClass,
  WorkUnitRisk,
} from "../src/data/delivery-system/efficiencyPolicy";
import { requireNode24 } from "./lib/require-node24.mjs";

interface WorkUnitMap {
  readonly schema_version: "autopilot-codex-work-unit-map-v1";
  readonly work_units: readonly WorkUnitRecord[];
}

requireNode24();

export function runCodexEfficiencyCli(
  argv: readonly string[],
  now = new Date(),
): unknown {
  const [command, ...rest] = argv;
  const args = parseArguments(rest);
  if (command === "report") return runReport(args, now);
  if (command === "compare") return runCompare(args);
  throw new Error("usage: codex-efficiency-report.ts <report|compare>");
}

function runReport(
  args: ReadonlyMap<string, string | true>,
  now: Date,
): EfficiencyReportV1 {
  const sessions = requiredString(args, "sessions");
  const workUnitPath = requiredString(args, "work-units");
  const sinceText = requiredString(args, "since");
  const until = now.toISOString();
  const since = new Date(now.getTime() - parseDurationMs(sinceText)).toISOString();
  const workUnitMap = readWorkUnitMap(workUnitPath);
  const estimates = listJsonlFiles(sessions)
    .map((path) => {
      const source = basename(path);
      return summarizeCodexRolloutJsonl(readFileSync(path, "utf8"), source);
    })
    .filter(
      (estimate) =>
        estimate.ended_at === null || estimate.ended_at >= since,
    );
  return buildEfficiencyReport({
    estimates,
    workUnits: workUnitMap.work_units,
    since,
    until,
    generatedAt: until,
  });
}

function runCompare(
  args: ReadonlyMap<string, string | true>,
): ReturnType<typeof compareEfficiencyWindows> {
  const baseline = readEfficiencyReport(requiredString(args, "baseline"));
  const candidate = readEfficiencyReport(requiredString(args, "candidate"));
  return compareEfficiencyWindows(baseline, candidate);
}

function readWorkUnitMap(path: string): WorkUnitMap {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !isRecord(value) ||
    value.schema_version !== "autopilot-codex-work-unit-map-v1" ||
    !Array.isArray(value.work_units)
  ) {
    throw new Error("invalid_work_unit_map");
  }
  const workUnits = value.work_units.map(parseWorkUnitRecord);
  return {
    schema_version: "autopilot-codex-work-unit-map-v1",
    work_units: workUnits,
  };
}

function parseWorkUnitRecord(value: unknown): WorkUnitRecord {
  if (!isRecord(value) || !isRecord(value.descriptor)) {
    throw new Error("invalid_work_unit_record");
  }
  const descriptor = value.descriptor;
  const workClass = descriptor.class;
  const risk = descriptor.risk;
  if (
    typeof value.source !== "string" ||
    typeof descriptor.work_unit_id !== "string" ||
    !isWorkUnitClass(workClass) ||
    !isWorkUnitRisk(risk) ||
    (value.status !== "completed" && value.status !== "incomplete") ||
    typeof value.first_pass_accepted !== "boolean" ||
    !isEscapedSeverity(value.escaped_severity) ||
    typeof value.retry_exhausted !== "boolean"
  ) {
    throw new Error("invalid_work_unit_record");
  }
  return {
    source: value.source,
    descriptor: {
      work_unit_id: descriptor.work_unit_id,
      class: workClass,
      risk,
    },
    status: value.status,
    first_pass_accepted: value.first_pass_accepted,
    escaped_severity: value.escaped_severity,
    retry_exhausted: value.retry_exhausted,
  };
}

function readEfficiencyReport(path: string): EfficiencyReportV1 {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  assertAggregateOnly(value);
  if (
    !isRecord(value) ||
    value.schema_version !== "autopilot-codex-efficiency-report-v1"
  ) {
    throw new Error("invalid_efficiency_report");
  }
  return value as unknown as EfficiencyReportV1;
}

function listJsonlFiles(directory: string): string[] {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error("sessions_directory_missing");
  }
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory()
        ? listJsonlFiles(path)
        : path.endsWith(".jsonl")
          ? [path]
          : [];
    })
    .sort();
}

function parseArguments(
  argv: readonly string[],
): ReadonlyMap<string, string | true> {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === undefined || !item.startsWith("--")) {
      throw new Error(`invalid_argument:${item ?? ""}`);
    }
    const name = item.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed.set(name, true);
      continue;
    }
    parsed.set(name, next);
    index += 1;
  }
  return parsed;
}

function requiredString(
  args: ReadonlyMap<string, string | true>,
  name: string,
): string {
  const value = args.get(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing_argument:${name}`);
  }
  return value;
}

function parseDurationMs(value: string): number {
  const match = /^(\d+)([mhd])$/.exec(value);
  if (!match) throw new Error("invalid_since_duration");
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * multiplier;
}

function isWorkUnitClass(value: unknown): value is WorkUnitClass {
  return [
    "deterministic_check",
    "mechanical_change",
    "bounded_implementation",
    "research_or_design",
    "review",
    "high_risk",
  ].includes(String(value));
}

function isWorkUnitRisk(value: unknown): value is WorkUnitRisk {
  return value === "ordinary" || value === "high";
}

function isEscapedSeverity(
  value: unknown,
): value is WorkUnitRecord["escaped_severity"] {
  return (
    value === null ||
    value === "critical" ||
    value === "high" ||
    value === "lower"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentFile === invokedFile) {
  try {
    const result = runCodexEfficiencyCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
