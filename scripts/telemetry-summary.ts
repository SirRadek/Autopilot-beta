import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EXPENSIVE_LANES } from "../src/data/delivery-system/routingModes";
import {
  CLI_CALL_TELEMETRY_PATH,
  DISPATCH_DECISION_TELEMETRY_PATH
} from "../src/data/delivery-system/sessionState";
import {
  aggregateCliCallTelemetryIntoBudget,
  type SubscriptionSessionBudget
} from "../src/data/delivery-system/subscriptionBudget";

export interface ParsedTelemetryJsonl {
  readonly records: unknown[];
  readonly parse_errors: number;
}

export interface TokenSummary {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
}

export interface ModelCallSummary {
  readonly total: number;
  readonly successful: number;
  readonly retried: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly duration_seconds: number;
}

export interface VendorCallSummary {
  readonly total: number;
  readonly parse_errors: number;
  readonly excluded_out_of_window_or_invalid: number;
  readonly by_vendor: Record<string, number>;
  readonly by_routing_mode: Record<string, number>;
  readonly by_outcome: Record<string, number>;
  readonly by_model: Record<string, ModelCallSummary>;
  readonly by_session: Record<string, ModelCallSummary>;
  readonly retried_calls: number;
  readonly tokens_by_provider: Record<string, TokenSummary>;
}

export interface DispatchDecisionSummary {
  readonly total: number;
  readonly parse_errors: number;
  readonly excluded_out_of_window_or_invalid: number;
  readonly dispatched: number;
  readonly refused: number;
  readonly by_refusal_reason: Record<string, number>;
  readonly by_routing_mode: Record<string, number>;
  readonly by_resolved_lane: Record<string, number>;
  readonly cheap_lane_dispatched_pct: number | null;
}

export interface TelemetrySummary {
  readonly since: string;
  readonly vendor_calls: VendorCallSummary;
  readonly dispatch_decisions: DispatchDecisionSummary;
}

export function parseTelemetryJsonl(text: string): ParsedTelemetryJsonl {
  const records: unknown[] = [];
  let parseErrors = 0;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      records.push(JSON.parse(line) as unknown);
    } catch {
      parseErrors += 1;
    }
  }

  return {
    records,
    parse_errors: parseErrors
  };
}

export function parseSinceDuration(value: string): number {
  const match = /^([1-9]\d*)([dhm])$/.exec(value);
  if (!match) {
    throw new Error(`invalid_since_duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];

  if (!Number.isSafeInteger(amount)) {
    throw new Error(`invalid_since_duration: ${value}`);
  }

  switch (unit) {
    case "d":
      return amount * 24 * 60 * 60 * 1000;
    case "h":
      return amount * 60 * 60 * 1000;
    case "m":
      return amount * 60 * 1000;
    default:
      throw new Error(`invalid_since_duration: ${value}`);
  }
}

export function withinSince(recordedAt: unknown, nowMs: number, sinceMs: number): boolean {
  const recordedAtMs = timestampMs(recordedAt);
  if (
    recordedAtMs === undefined ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(sinceMs) ||
    sinceMs < 0
  ) {
    return false;
  }

  return recordedAtMs >= nowMs - sinceMs && recordedAtMs <= nowMs;
}

export function summarizeVendorCalls(
  records: readonly unknown[],
  nowMs: number,
  sinceMs: number
): VendorCallSummary {
  const byVendor: Record<string, number> = {};
  const byRoutingMode: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  const byModel = new Map<string, ModelCallSummary>();
  const bySession = new Map<string, ModelCallSummary>();
  const providerBudgets = new Map<string, SubscriptionSessionBudget>();
  let total = 0;
  let excluded = 0;
  let retriedCalls = 0;

  for (const record of records) {
    if (!isRecord(record) || !withinSince(record.recorded_at, nowMs, sinceMs)) {
      excluded += 1;
      continue;
    }

    total += 1;
    increment(byVendor, stringBucket(record.vendor, "unknown"));
    increment(byRoutingMode, stringBucket(record.routing_mode, "none"));
    increment(byOutcome, stringBucket(record.outcome, "unknown"));

    if (numberBucket(record.attempt_count) > 1) {
      retriedCalls += 1;
    }

    const model = stringBucket(record.model, "unknown");
    const priorModel = byModel.get(model) ?? {
      total: 0,
      successful: 0,
      retried: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      duration_seconds: 0
    };
    const attemptCount = numberBucket(record.attempt_count);
    byModel.set(model, {
      total: priorModel.total + 1,
      successful: priorModel.successful + (record.outcome === "success" ? 1 : 0),
      retried: priorModel.retried + (attemptCount > 1 ? 1 : 0),
      input_tokens: priorModel.input_tokens + numberBucket(record.input_tokens),
      output_tokens: priorModel.output_tokens + numberBucket(record.output_tokens),
      total_tokens: priorModel.total_tokens + numberBucket(record.total_tokens),
      duration_seconds: priorModel.duration_seconds + numberBucket(record.duration_seconds)
    });

    const session = stringBucket(record.session_id, "none");
    const priorSession = bySession.get(session) ?? {
      total: 0,
      successful: 0,
      retried: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      duration_seconds: 0
    };
    bySession.set(session, {
      total: priorSession.total + 1,
      successful: priorSession.successful + (record.outcome === "success" ? 1 : 0),
      retried: priorSession.retried + (attemptCount > 1 ? 1 : 0),
      input_tokens: priorSession.input_tokens + numberBucket(record.input_tokens),
      output_tokens: priorSession.output_tokens + numberBucket(record.output_tokens),
      total_tokens: priorSession.total_tokens + numberBucket(record.total_tokens),
      duration_seconds: priorSession.duration_seconds + numberBucket(record.duration_seconds)
    });

    const provider = stringBucket(record.provider, "unknown");
    const priorBudget = providerBudgets.get(provider) ?? createZeroBudget(provider);
    providerBudgets.set(
      provider,
      aggregateCliCallTelemetryIntoBudget(priorBudget, {
        recorded_at: String(record.recorded_at),
        input_tokens: numberBucket(record.input_tokens),
        output_tokens: numberBucket(record.output_tokens),
        total_tokens: numberBucket(record.total_tokens)
      })
    );
  }

  return {
    total,
    parse_errors: 0,
    excluded_out_of_window_or_invalid: excluded,
    by_vendor: byVendor,
    by_routing_mode: byRoutingMode,
    by_outcome: byOutcome,
    by_model: Object.fromEntries(byModel),
    by_session: Object.fromEntries(bySession),
    retried_calls: retriedCalls,
    tokens_by_provider: Object.fromEntries(
      [...providerBudgets.entries()].map(([provider, budget]) => [
        provider,
        {
          input_tokens: budget.sessionInputTokens,
          output_tokens: budget.sessionOutputTokens,
          total_tokens: budget.sessionTotalTokens
        }
      ])
    )
  };
}

export function summarizeDispatchDecisions(
  records: readonly unknown[],
  nowMs: number,
  sinceMs: number
): DispatchDecisionSummary {
  const byRefusalReason: Record<string, number> = {};
  const byRoutingMode: Record<string, number> = {};
  const byResolvedLane: Record<string, number> = {};
  const expensiveLanes = new Set<string>(EXPENSIVE_LANES);
  let total = 0;
  let excluded = 0;
  let dispatched = 0;
  let refused = 0;
  let dispatchedWithLane = 0;
  let cheapDispatchedWithLane = 0;

  for (const record of records) {
    if (!isRecord(record) || !withinSince(record.recorded_at, nowMs, sinceMs)) {
      excluded += 1;
      continue;
    }

    total += 1;
    const decision = stringBucket(record.decision, "unknown");
    const resolvedLane = stringBucket(record.resolved_lane, "unresolved");

    increment(byRoutingMode, stringBucket(record.routing_mode, "none"));
    increment(byResolvedLane, resolvedLane);

    if (decision === "dispatched") {
      dispatched += 1;
      if (resolvedLane !== "unresolved") {
        dispatchedWithLane += 1;
        if (!expensiveLanes.has(resolvedLane)) {
          cheapDispatchedWithLane += 1;
        }
      }
    } else if (decision === "refused") {
      refused += 1;
      increment(byRefusalReason, stringBucket(record.refusal_reason, "none"));
    }
  }

  return {
    total,
    parse_errors: 0,
    excluded_out_of_window_or_invalid: excluded,
    dispatched,
    refused,
    by_refusal_reason: byRefusalReason,
    by_routing_mode: byRoutingMode,
    by_resolved_lane: byResolvedLane,
    cheap_lane_dispatched_pct:
      dispatchedWithLane === 0 ? null : (cheapDispatchedWithLane / dispatchedWithLane) * 100
  };
}

export function buildTelemetrySummary(input: {
  readonly vendorCallsText: string;
  readonly dispatchDecisionsText: string;
  readonly now?: string | Date;
  readonly since: string;
}): TelemetrySummary {
  const sinceMs = parseSinceDuration(input.since);
  const nowMs = input.now === undefined ? Date.now() : timestampMs(input.now);

  if (nowMs === undefined) {
    throw new Error("invalid_now_timestamp");
  }

  const vendorCalls = parseTelemetryJsonl(input.vendorCallsText);
  const dispatchDecisions = parseTelemetryJsonl(input.dispatchDecisionsText);
  const vendorCallSummary = summarizeVendorCalls(vendorCalls.records, nowMs, sinceMs);
  const dispatchDecisionSummary = summarizeDispatchDecisions(dispatchDecisions.records, nowMs, sinceMs);

  return {
    since: input.since,
    vendor_calls: {
      ...vendorCallSummary,
      parse_errors: vendorCalls.parse_errors
    },
    dispatch_decisions: {
      ...dispatchDecisionSummary,
      parse_errors: dispatchDecisions.parse_errors
    }
  };
}

function formatTelemetrySummary(summary: TelemetrySummary): string {
  return [
    `Telemetry summary since ${summary.since}`,
    `Vendor calls: total=${summary.vendor_calls.total} parse_errors=${summary.vendor_calls.parse_errors} excluded=${summary.vendor_calls.excluded_out_of_window_or_invalid} retried=${summary.vendor_calls.retried_calls}`,
    `  by_vendor: ${formatCountMap(summary.vendor_calls.by_vendor)}`,
    `  by_routing_mode: ${formatCountMap(summary.vendor_calls.by_routing_mode)}`,
    `  by_outcome: ${formatCountMap(summary.vendor_calls.by_outcome)}`,
    `  by_model: ${formatModelMap(summary.vendor_calls.by_model)}`,
    `  tokens_by_provider: ${formatTokenMap(summary.vendor_calls.tokens_by_provider)}`,
    `Dispatch decisions: total=${summary.dispatch_decisions.total} parse_errors=${summary.dispatch_decisions.parse_errors} excluded=${summary.dispatch_decisions.excluded_out_of_window_or_invalid} dispatched=${summary.dispatch_decisions.dispatched} refused=${summary.dispatch_decisions.refused} cheap_lane_dispatched_pct=${summary.dispatch_decisions.cheap_lane_dispatched_pct ?? "null"}`,
    `  by_refusal_reason: ${formatCountMap(summary.dispatch_decisions.by_refusal_reason)}`,
    `  by_routing_mode: ${formatCountMap(summary.dispatch_decisions.by_routing_mode)}`,
    `  by_resolved_lane: ${formatCountMap(summary.dispatch_decisions.by_resolved_lane)}`
  ].join("\n");
}

function parseCliArgs(args: readonly string[]): { readonly since: string; readonly root: string; readonly json: boolean } {
  let since = "7d";
  let root = process.cwd();
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--since") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("missing --since value");
      }
      since = value;
      index += 1;
      continue;
    }

    if (arg === "--root") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("missing --root value");
      }
      root = value;
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${arg ?? ""}`);
  }

  parseSinceDuration(since);

  return {
    since,
    root: resolve(root),
    json
  };
}

function readTextIfExists(path: string): string {
  if (!existsSync(path)) {
    return "";
  }

  return readFileSync(path, "utf8");
}

function formatCountMap(map: Readonly<Record<string, number>>): string {
  const entries = Object.entries(map).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0 ? "none" : entries.map(([key, count]) => `${key}=${count}`).join(", ");
}

function formatTokenMap(map: Readonly<Record<string, TokenSummary>>): string {
  const entries = Object.entries(map).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0
    ? "none"
    : entries
        .map(
          ([key, tokens]) =>
            `${key}=input:${tokens.input_tokens},output:${tokens.output_tokens},total:${tokens.total_tokens}`
        )
        .join(", ");
}

function formatModelMap(map: Readonly<Record<string, ModelCallSummary>>): string {
  const entries = Object.entries(map).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0
    ? "none"
    : entries
        .map(
          ([key, model]) =>
            `${key}=calls:${model.total},success:${model.successful},retry:${model.retried},tokens:${model.total_tokens},seconds:${model.duration_seconds}`
        )
        .join(", ");
}

function timestampMs(value: unknown): number | undefined {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function createZeroBudget(provider: string): SubscriptionSessionBudget {
  return {
    provider: provider as SubscriptionSessionBudget["provider"],
    activeTierId: undefined,
    activeTierRateLimitState: "unknown",
    rateLimitHitAt: undefined,
    lastAttemptedAt: undefined,
    availableTiers: [],
    exhaustedTierIds: [],
    sessionTaskCount: 0,
    sessionInputTokens: 0,
    sessionOutputTokens: 0,
    sessionTotalTokens: 0,
    sessionCallCount: 0,
    lastSuccessfulTaskAt: undefined,
    notes: undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function stringBucket(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberBucket(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (invokedFile === currentFile) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    const summary = buildTelemetrySummary({
      vendorCallsText: readTextIfExists(join(args.root, CLI_CALL_TELEMETRY_PATH)),
      dispatchDecisionsText: readTextIfExists(join(args.root, DISPATCH_DECISION_TELEMETRY_PATH)),
      since: args.since
    });

    console.log(args.json ? JSON.stringify(summary, null, 2) : formatTelemetrySummary(summary));
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid telemetry summary arguments";
    console.error(`telemetry:summary failed: ${message}`);
    process.exit(1);
  }
}
