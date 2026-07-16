export interface TokenUsage {
  readonly input_tokens: number;
  readonly cached_input_tokens: number;
  readonly output_tokens: number;
  readonly reasoning_output_tokens: number;
}

export interface RolloutEfficiencyEstimate {
  readonly source: string;
  readonly root_session_id: string | null;
  readonly thread_source: string;
  readonly usage: TokenUsage;
  readonly token_events: number;
  readonly turn_count: number;
  readonly tool_calls: number;
  readonly tool_call_counts: Readonly<Record<string, number>>;
  readonly subagent_calls: number;
  readonly poll_calls: number;
  readonly compactions: number;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly total_wall_ms: number | null;
  readonly replay_events_excluded: number;
  readonly parse_errors: number;
  readonly coverage: "estimated" | "insufficient_evidence";
}

interface ParsedEvent {
  readonly index: number;
  readonly value: Record<string, unknown>;
}

interface UsageCounter {
  readonly index: number;
  readonly usage: TokenUsage;
}

const ZERO_USAGE: TokenUsage = {
  input_tokens: 0,
  cached_input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
};

export function summarizeCodexRolloutJsonl(
  text: string,
  source: string,
): RolloutEfficiencyEstimate {
  const events: ParsedEvent[] = [];
  let parseErrors = 0;

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) events.push({ index, value: parsed });
      else parseErrors += 1;
    } catch {
      parseErrors += 1;
    }
  }

  const sessionMeta = events.find(({ value }) => value.type === "session_meta");
  const sessionPayload = recordValue(sessionMeta?.value.payload);
  const firstTurnIndex = events.find(
    ({ value }) => value.type === "turn_context",
  )?.index;
  const currentStart = firstTurnIndex ?? Number.POSITIVE_INFINITY;
  const counters = events.flatMap(({ index, value }): UsageCounter[] => {
    const payload = recordValue(value.payload);
    const info = recordValue(payload?.info);
    const total = recordValue(info?.total_token_usage);
    if (
      value.type !== "event_msg" ||
      payload?.type !== "token_count" ||
      total === undefined
    ) {
      return [];
    }
    return [{ index, usage: tokenUsage(total) }];
  });
  const replayCounters = counters.filter(
    ({ index }) => index < currentStart,
  );
  const currentCounters = counters.filter(
    ({ index }) => index > currentStart,
  );
  const baseline = replayCounters.at(-1)?.usage ?? ZERO_USAGE;
  const measured = sumPositiveCounterDeltas(baseline, currentCounters);
  const currentEvents = events.filter(({ index }) => index >= currentStart);
  const toolCallCounts: Record<string, number> = {};

  for (const { value } of currentEvents) {
    const payload = recordValue(value.payload);
    if (value.type !== "response_item" || payload?.type !== "function_call") {
      continue;
    }
    const name =
      typeof payload.name === "string" && payload.name.length <= 128
        ? payload.name
        : "unknown";
    toolCallCounts[name] = (toolCallCounts[name] ?? 0) + 1;
  }

  const timestamps = events
    .map(({ value }) =>
      typeof value.timestamp === "string" ? Date.parse(value.timestamp) : NaN,
    )
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const startedAt = timestamps[0];
  const endedAt = timestamps.at(-1);
  const threadSource =
    typeof sessionPayload?.thread_source === "string"
      ? sessionPayload.thread_source
      : typeof sessionPayload?.source === "string"
        ? sessionPayload.source
        : "unknown";
  const rootSessionId =
    typeof sessionPayload?.session_id === "string"
      ? sessionPayload.session_id
      : typeof sessionPayload?.id === "string"
        ? sessionPayload.id
        : null;

  return {
    source,
    root_session_id: rootSessionId,
    thread_source: threadSource,
    usage: measured,
    token_events: currentCounters.length,
    turn_count: currentEvents.filter(({ value }) => value.type === "turn_context")
      .length,
    tool_calls: sumCounts(toolCallCounts),
    tool_call_counts: toolCallCounts,
    subagent_calls: sumNamedCounts(toolCallCounts, [
      "spawn_agent",
      "followup_task",
    ]),
    poll_calls: sumNamedCounts(toolCallCounts, [
      "wait",
      "wait_agent",
      "write_stdin",
    ]),
    compactions: currentEvents.filter(({ value }) => {
      const payload = recordValue(value.payload);
      return (
        value.type === "compacted" ||
        (value.type === "event_msg" && payload?.type === "context_compacted")
      );
    }).length,
    started_at:
      startedAt === undefined ? null : new Date(startedAt).toISOString(),
    ended_at: endedAt === undefined ? null : new Date(endedAt).toISOString(),
    total_wall_ms:
      startedAt === undefined || endedAt === undefined || timestamps.length < 2
        ? null
        : endedAt - startedAt,
    replay_events_excluded: replayCounters.length,
    parse_errors: parseErrors,
    coverage:
      firstTurnIndex !== undefined && currentCounters.length > 0
        ? "estimated"
        : "insufficient_evidence",
  };
}

function sumPositiveCounterDeltas(
  baseline: TokenUsage,
  counters: readonly UsageCounter[],
): TokenUsage {
  let previous = baseline;
  let total = ZERO_USAGE;

  for (const counter of counters) {
    total = addUsage(total, positiveDelta(previous, counter.usage));
    previous = counter.usage;
  }

  return total;
}

function positiveDelta(before: TokenUsage, after: TokenUsage): TokenUsage {
  return {
    input_tokens: counterDelta(before.input_tokens, after.input_tokens),
    cached_input_tokens: counterDelta(
      before.cached_input_tokens,
      after.cached_input_tokens,
    ),
    output_tokens: counterDelta(before.output_tokens, after.output_tokens),
    reasoning_output_tokens: counterDelta(
      before.reasoning_output_tokens,
      after.reasoning_output_tokens,
    ),
  };
}

function counterDelta(before: number, after: number): number {
  return after >= before ? after - before : after;
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    input_tokens: left.input_tokens + right.input_tokens,
    cached_input_tokens:
      left.cached_input_tokens + right.cached_input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    reasoning_output_tokens:
      left.reasoning_output_tokens + right.reasoning_output_tokens,
  };
}

function tokenUsage(value: Record<string, unknown>): TokenUsage {
  return {
    input_tokens: nonNegativeInteger(value.input_tokens),
    cached_input_tokens: nonNegativeInteger(value.cached_input_tokens),
    output_tokens: nonNegativeInteger(value.output_tokens),
    reasoning_output_tokens: nonNegativeInteger(
      value.reasoning_output_tokens,
    ),
  };
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(
  value: unknown,
): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function sumCounts(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function sumNamedCounts(
  counts: Readonly<Record<string, number>>,
  names: readonly string[],
): number {
  return names.reduce((sum, name) => sum + (counts[name] ?? 0), 0);
}
