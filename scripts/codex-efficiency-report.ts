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
  const workUnitPath = optionalString(args, "work-units");
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

function readWorkUnitMap(path: string | null): WorkUnitMap {
  if (path === null || !existsSync(path)) {
    return {
      schema_version: "autopilot-codex-work-unit-map-v1",
      work_units: [],
    };
  }
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
  if (!isEfficiencyReport(value)) {
    throw new Error("invalid_efficiency_report");
  }
  return value;
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

function optionalString(
  args: ReadonlyMap<string, string | true>,
  name: string,
): string | null {
  const value = args.get(name);
  return typeof value === "string" && value.length > 0 ? value : null;
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

const REPORT_KEYS = [
  "schema_version",
  "generated_at",
  "window",
  "coverage",
  "contains_raw_content",
  "samples",
  "tokens",
  "context",
  "orchestration",
  "quality",
  "classes",
] as const;
const BASELINE_KEYS = [
  ...REPORT_KEYS,
  "method",
  "limitations",
  "routing",
  "acceptance",
] as const;
const CLASS_KEYS = [
  "deterministic_check",
  "mechanical_change",
  "bounded_implementation",
  "research_or_design",
  "review",
  "high_risk",
] as const;
const BASELINE_LIMITATIONS = new Set([
  "explicit historical source-to-work-unit map unavailable",
  "forked rollout counters are not provider billing records",
  "provider-authoritative telemetry unavailable",
]);
const ACCEPTANCE_REASONS = new Set([
  "historical_work_unit_map_unavailable",
  "minimum_sample_not_met",
  "coverage_insufficient",
  "baseline_median_unavailable",
  "escaped_critical_or_high",
  "first_pass_acceptance_regressed",
  "retry_exhaustion_increased",
  "incomplete_work_increased",
  "context_p90_above_limit",
  "median_reduction_below_target",
]);

function isEfficiencyReport(value: unknown): value is EfficiencyReportV1 {
  if (!isRecord(value)) return false;
  const baseline =
    value.schema_version === "autopilot-codex-efficiency-baseline-v1";
  if (
    !baseline &&
    value.schema_version !== "autopilot-codex-efficiency-report-v1"
  ) {
    return false;
  }
  if (!hasExactKeys(value, baseline ? BASELINE_KEYS : REPORT_KEYS)) return false;
  if (!isIsoDate(value.generated_at)) return false;
  if (
    !isExactRecord(value.window, ["since", "until"]) ||
    !isIsoDate(value.window.since) ||
    !isIsoDate(value.window.until)
  ) {
    return false;
  }
  if (
    !["estimated", "provider_authoritative", "insufficient_evidence"].includes(
      String(value.coverage),
    ) ||
    value.contains_raw_content !== false
  ) {
    return false;
  }
  if (
    !isNumericRecord(value.samples, ["ordinary", "high_risk", "completed"]) ||
    !isNumericRecord(value.tokens, [
      "median_per_completed",
      "cached_input",
      "uncached_input",
      "output",
      "reasoning_output",
    ]) ||
    !isNumericRecord(value.context, ["input_p50", "input_p90"]) ||
    !isNumericRecord(value.quality, [
      "first_pass_acceptance_pct",
      "escaped_critical",
      "escaped_high",
      "retry_exhausted",
      "incomplete",
    ])
  ) {
    return false;
  }
  if (
    !isExactRecord(value.orchestration, [
      "model_calls",
      "tool_calls",
      "poll_calls",
      "subagent_calls",
      "compactions",
      "total_wall_ms",
    ]) ||
    !nonNegativeNumber(value.orchestration.model_calls) ||
    !nonNegativeNumber(value.orchestration.tool_calls) ||
    !nonNegativeNumber(value.orchestration.poll_calls) ||
    !nonNegativeNumber(value.orchestration.subagent_calls) ||
    !nonNegativeNumber(value.orchestration.compactions) ||
    !(
      value.orchestration.total_wall_ms === null ||
      nonNegativeNumber(value.orchestration.total_wall_ms)
    )
  ) {
    return false;
  }
  if (!isExactRecord(value.classes, CLASS_KEYS)) return false;
  for (const key of CLASS_KEYS) {
    const summary = value.classes[key];
    if (
      !isExactRecord(summary, ["completed", "median_tokens"]) ||
      !nonNegativeNumber(summary.completed) ||
      !(
        summary.median_tokens === null ||
        nonNegativeNumber(summary.median_tokens)
      )
    ) {
      return false;
    }
  }
  if (!baseline) return true;
  return (
    value.method === "replay-aware-positive-counter-delta" &&
    Array.isArray(value.limitations) &&
    value.limitations.every(
      (item) => typeof item === "string" && BASELINE_LIMITATIONS.has(item),
    ) &&
    isExactRecord(value.routing, [
      "mode",
      "recommended_model",
      "recommended_reasoning_effort",
    ]) &&
    value.routing.mode === "shadow_only" &&
    value.routing.recommended_model === null &&
    value.routing.recommended_reasoning_effort === null &&
    isExactRecord(value.acceptance, [
      "status",
      "median_reduction_pct",
      "reasons",
    ]) &&
    [
      "accepted",
      "insufficient_evidence",
      "quality_regression",
      "savings_below_target",
    ].includes(String(value.acceptance.status)) &&
    (value.acceptance.median_reduction_pct === null ||
      nonNegativeNumber(value.acceptance.median_reduction_pct)) &&
    Array.isArray(value.acceptance.reasons) &&
    value.acceptance.reasons.every(
      (item) => typeof item === "string" && ACCEPTANCE_REASONS.has(item),
    )
  );
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, keys);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isNumericRecord(value: unknown, keys: readonly string[]): boolean {
  return (
    isExactRecord(value, keys) &&
    keys.every((key) => nonNegativeNumber(value[key]))
  );
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
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
