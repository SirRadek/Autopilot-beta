import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { dirname, join } from "node:path";

import { redactLegacyObservabilityText } from "./telemetryRedaction";

const SOURCES = [
  ["dispatch-decisions.jsonl", "dispatch"],
  ["cli-call-telemetry.jsonl", "cli_call"],
  ["token-gateway-telemetry.jsonl", "token_gateway"],
  ["openrouter-api-spend.jsonl", "openrouter_spend"],
  ["provider-quota-events.jsonl", "provider_quota"],
  ["control-plane-audit.jsonl", "audit"]
] as const;

export type ObservabilitySource = typeof SOURCES[number][1];

export interface ObservabilityEvent {
  readonly at: string;
  readonly source: ObservabilitySource;
  readonly event: string;
  readonly session_id: string | null;
  readonly handoff_id: string | null;
  readonly worker_run_id: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly tokens: number;
  readonly retries: number;
  readonly refused: boolean;
  readonly cost_usd: number;
  readonly detail: string | null;
}

export interface ObservabilityOptions {
  readonly max_bytes_per_file?: number;
  readonly max_lines_per_file?: number;
  readonly max_events?: number;
  readonly session_id?: string;
  readonly handoff_id?: string;
  readonly worker_run_id?: string;
  readonly provider?: string;
  readonly model?: string;
}

export interface ObservabilityResult {
  readonly summary: {
    readonly events: number;
    readonly tokens: number;
    readonly retries: number;
    readonly refusals: number;
    readonly openrouter_cost_usd: number;
    readonly waste_signals: readonly WasteSignal[];
  };
  readonly timeline: readonly ObservabilityEvent[];
  readonly limits: {
    readonly files_scanned: number;
    readonly max_bytes_per_file: number;
    readonly max_lines_per_file: number;
    readonly max_events: number;
    readonly truncated: boolean;
  };
}

interface WasteSignal {
  readonly kind: "duplicate_dispatch" | "repeated_input_token_count";
  readonly evidence_key: string;
  readonly occurrences: number;
}

const safeString = (value: unknown): string | null => typeof value === "string" && value.length > 0
  ? redactLegacyObservabilityText(value.slice(0, 200))
  : null;
const safeNumber = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

export function buildObservability(stateDir: string, options: ObservabilityOptions = {}): ObservabilityResult {
  const maxBytes = boundedInteger(options.max_bytes_per_file, 256 * 1024, 1_024, 1024 * 1024);
  const maxLines = boundedInteger(options.max_lines_per_file, 2_000, 1, 5_000);
  const maxEvents = boundedInteger(options.max_events, 500, 1, 1_000);
  let sourceTruncated = false;
  const raw: { source: ObservabilitySource; row: Record<string, unknown> }[] = [];
  for (const [file, source] of SOURCES) {
    const statePath = join(stateDir, file);
    const path = source === "openrouter_spend" && !existsSync(statePath) ? join(dirname(stateDir), file) : statePath;
    const result = readTail(path, maxBytes, maxLines);
    sourceTruncated ||= result.truncated;
    raw.push(...result.rows.map((row) => ({ source, row })));
  }
  const allEvents = raw.map(({ source, row }) => normalize(source, row)).filter((event) => matches(event, options));
  allEvents.sort((left, right) => left.at.localeCompare(right.at));
  const outputTruncated = allEvents.length > maxEvents;
  const timeline = allEvents.slice(-maxEvents);
  const wasteSignals = detectWaste(raw, options);

  const tokens = observedTokens(raw.filter(({ source, row }) => matches(normalize(source, row), options)));
  return {
    summary: {
      events: allEvents.length,
      tokens,
      retries: allEvents.reduce((sum, event) => sum + event.retries, 0),
      refusals: new Set(allEvents.filter((event) => event.refused).map((event) => event.handoff_id ?? `${event.source}:${event.at}`)).size,
      openrouter_cost_usd: rounded(allEvents.reduce((sum, event) => sum + event.cost_usd, 0)),
      waste_signals: wasteSignals
    },
    timeline,
    limits: { files_scanned: SOURCES.length, max_bytes_per_file: maxBytes, max_lines_per_file: maxLines, max_events: maxEvents, truncated: sourceTruncated || outputTruncated }
  };
}

function normalize(source: ObservabilitySource, row: Record<string, unknown>): ObservabilityEvent {
  const provider = safeString(row.provider) ?? safeString(row.vendor);
  const attemptCount = safeNumber(row.attempt_count);
  const event = source === "dispatch" ? safeString(row.decision)
    : source === "cli_call" ? safeString(row.outcome)
    : source === "token_gateway" ? safeString(row.event)
    : source === "openrouter_spend" ? "cost_recorded"
    : source === "provider_quota" ? safeString(row.status)
    : safeString(row.action);
  const detail = source === "dispatch" ? safeString(row.refusal_reason)
    : source === "cli_call" ? safeString(row.error_reason)
    : source === "token_gateway" ? safeString(row.reason)
    : source === "provider_quota" ? safeString(row.error_code)
    : null;
  return {
    at: safeString(row.recorded_at) ?? safeString(row.observed_at) ?? safeString(row.at) ?? "1970-01-01T00:00:00.000Z",
    source,
    event: event ?? "observed",
    session_id: safeString(row.session_id),
    handoff_id: safeString(row.handoff_id),
    worker_run_id: safeString(row.worker_run_id),
    provider,
    model: safeString(row.model),
    tokens: source === "cli_call" || source === "token_gateway" ? safeNumber(row.total_tokens) : 0,
    retries: source === "cli_call" ? Math.max(0, Math.floor(attemptCount) - 1) : 0,
    refused: row.decision === "refused" || row.event === "refused" || row.outcome === "refused",
    cost_usd: source === "openrouter_spend" ? safeNumber(row.cost_usd) : 0,
    detail
  };
}

function matches(event: ObservabilityEvent, options: ObservabilityOptions): boolean {
  return (["session_id", "handoff_id", "worker_run_id", "provider", "model"] as const)
    .every((key) => options[key] === undefined || event[key] === options[key]);
}

function detectWaste(raw: readonly { source: ObservabilitySource; row: Record<string, unknown> }[], options: ObservabilityOptions): WasteSignal[] {
  const counts = new Map<string, { kind: WasteSignal["kind"]; evidence: string; occurrences: Set<string> }>();
  for (const item of raw) {
    const event = normalize(item.source, item.row);
    if (!matches(event, options)) continue;
    let kind: WasteSignal["kind"] | null = null;
    let evidence: string | null = null;
    if (item.source === "dispatch") {
      kind = "duplicate_dispatch";
      evidence = safeString(item.row.task_hash);
    } else if (item.source === "token_gateway" && (item.row.event === "reserved" || item.row.event === "settled" || item.row.event === "refused")) {
      kind = "repeated_input_token_count";
      const input = safeNumber(item.row.input_tokens);
      if (event.session_id !== null && event.provider !== null && input > 0) evidence = `${event.session_id}|${event.provider}|${event.model ?? "default"}|${input}`;
    }
    if (kind !== null && evidence !== null) {
      const key = `${kind}:${evidence}`;
      const current = counts.get(key);
      const occurrence = safeString(item.row.reservation_id) ?? event.handoff_id ?? event.worker_run_id ?? event.at;
      const occurrences = current?.occurrences ?? new Set<string>();
      occurrences.add(occurrence);
      counts.set(key, { kind, evidence, occurrences });
    }
  }
  return [...counts.values()].filter((item) => item.occurrences.size > 1).map((item) => ({ kind: item.kind, evidence_key: item.evidence, occurrences: item.occurrences.size })).sort((a, b) => a.kind.localeCompare(b.kind) || a.evidence_key.localeCompare(b.evidence_key)).slice(0, 100);
}

function observedTokens(raw: readonly { source: ObservabilitySource; row: Record<string, unknown> }[]): number {
  const settledHandoffs = new Set<string>();
  let settledTokens = 0;
  for (const item of raw) {
    if (item.source !== "token_gateway") continue;
    const event = normalize(item.source, item.row);
    if (event.event !== "settled") continue;
    settledTokens += event.tokens;
    if (event.handoff_id !== null) settledHandoffs.add(event.handoff_id);
  }
  return raw.reduce((sum, item) => {
    if (item.source !== "cli_call") return sum;
    const event = normalize(item.source, item.row);
    return event.handoff_id !== null && settledHandoffs.has(event.handoff_id) ? sum : sum + event.tokens;
  }, settledTokens);
}

function readTail(path: string, maxBytes: number, maxLines: number): { rows: Record<string, unknown>[]; truncated: boolean } {
  if (!existsSync(path)) return { rows: [], truncated: false };
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split(/\r?\n/).slice(start > 0 ? 1 : 0).filter(Boolean);
    const rows = lines.slice(-maxLines).flatMap((line) => {
      try {
        const value = JSON.parse(line) as unknown;
        return value !== null && typeof value === "object" && !Array.isArray(value) ? [value as Record<string, unknown>] : [];
      } catch { return []; }
    });
    return { rows, truncated: start > 0 || lines.length > maxLines };
  } finally { closeSync(fd); }
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function rounded(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
