import type {
  RolloutEfficiencyEstimate,
  TokenUsage,
} from "./codexRolloutEfficiency";
import type {
  WorkUnitClass,
  WorkUnitDescriptor,
} from "./efficiencyPolicy";

export interface WorkUnitRecord {
  readonly source: string;
  readonly descriptor: WorkUnitDescriptor;
  readonly status: "completed" | "incomplete";
  readonly first_pass_accepted: boolean;
  readonly escaped_severity: "critical" | "high" | "lower" | null;
  readonly retry_exhausted: boolean;
}

export interface EfficiencyReportV1 {
  readonly schema_version: "autopilot-codex-efficiency-report-v1";
  readonly generated_at: string;
  readonly window: {
    readonly since: string;
    readonly until: string;
  };
  readonly coverage:
    | "estimated"
    | "provider_authoritative"
    | "insufficient_evidence";
  readonly contains_raw_content: false;
  readonly samples: {
    readonly ordinary: number;
    readonly high_risk: number;
    readonly completed: number;
  };
  readonly tokens: {
    readonly median_per_completed: number;
    readonly cached_input: number;
    readonly uncached_input: number;
    readonly output: number;
    readonly reasoning_output: number;
  };
  readonly context: {
    readonly input_p50: number;
    readonly input_p90: number;
  };
  readonly orchestration: {
    readonly model_calls: number;
    readonly tool_calls: number;
    readonly poll_calls: number;
    readonly subagent_calls: number;
    readonly compactions: number;
    readonly total_wall_ms: number | null;
  };
  readonly quality: {
    readonly first_pass_acceptance_pct: number;
    readonly escaped_critical: number;
    readonly escaped_high: number;
    readonly retry_exhausted: number;
    readonly incomplete: number;
  };
  readonly classes: Readonly<
    Record<
      WorkUnitClass,
      { readonly completed: number; readonly median_tokens: number | null }
    >
  >;
}

export interface EfficiencyComparison {
  readonly status:
    | "accepted"
    | "insufficient_evidence"
    | "quality_regression"
    | "savings_below_target";
  readonly median_reduction_pct: number | null;
  readonly ordinary_samples: number;
  readonly high_risk_samples: number;
  readonly reasons: readonly string[];
}

export interface BuildEfficiencyReportInput {
  readonly estimates: readonly RolloutEfficiencyEstimate[];
  readonly workUnits: readonly WorkUnitRecord[];
  readonly since: string;
  readonly until: string;
  readonly generatedAt: string;
}

const WORK_UNIT_CLASSES: readonly WorkUnitClass[] = [
  "deterministic_check",
  "mechanical_change",
  "bounded_implementation",
  "research_or_design",
  "review",
  "high_risk",
];
const FORBIDDEN_AGGREGATE_KEY =
  /prompt|response|secret|environment|tool_payload/i;

export function buildEfficiencyReport(
  input: BuildEfficiencyReportInput,
): EfficiencyReportV1 {
  const estimateBySource = new Map(
    input.estimates.map((estimate) => [estimate.source, estimate]),
  );
  const completedRecords = input.workUnits.filter(
    (record) => record.status === "completed",
  );
  const completed = completedRecords.flatMap((record) => {
    const estimate = estimateBySource.get(record.source);
    return estimate === undefined ? [] : [{ record, estimate }];
  });
  const usages = completed.map(({ estimate }) => estimate.usage);
  const totalTokens = usages.map(totalUsageTokens);
  const inputTokens = usages.map((usage) => usage.input_tokens);
  const aggregateUsage = usages.reduce(addUsage, zeroUsage());
  const knownWallTimes = completed
    .map(({ estimate }) => estimate.total_wall_ms)
    .filter((value): value is number => value !== null);
  const firstPassAccepted = completedRecords.filter(
    (record) => record.first_pass_accepted,
  ).length;
  const coverageLost =
    completedRecords.length === 0 ||
    completed.length !== completedRecords.length ||
    completed.some(
      ({ estimate }) => estimate.coverage === "insufficient_evidence",
    );

  const report: EfficiencyReportV1 = {
    schema_version: "autopilot-codex-efficiency-report-v1",
    generated_at: input.generatedAt,
    window: { since: input.since, until: input.until },
    coverage: coverageLost ? "insufficient_evidence" : "estimated",
    contains_raw_content: false,
    samples: {
      ordinary: completedRecords.filter(
        (record) => record.descriptor.risk === "ordinary",
      ).length,
      high_risk: completedRecords.filter(
        (record) => record.descriptor.risk === "high",
      ).length,
      completed: completedRecords.length,
    },
    tokens: {
      median_per_completed: nearestRank(totalTokens, 0.5),
      cached_input: aggregateUsage.cached_input_tokens,
      uncached_input: Math.max(
        0,
        aggregateUsage.input_tokens - aggregateUsage.cached_input_tokens,
      ),
      output: aggregateUsage.output_tokens,
      reasoning_output: aggregateUsage.reasoning_output_tokens,
    },
    context: {
      input_p50: nearestRank(inputTokens, 0.5),
      input_p90: nearestRank(inputTokens, 0.9),
    },
    orchestration: {
      model_calls: completed.reduce(
        (sum, { estimate }) => sum + estimate.token_events,
        0,
      ),
      tool_calls: completed.reduce(
        (sum, { estimate }) => sum + estimate.tool_calls,
        0,
      ),
      poll_calls: completed.reduce(
        (sum, { estimate }) => sum + estimate.poll_calls,
        0,
      ),
      subagent_calls: completed.reduce(
        (sum, { estimate }) => sum + estimate.subagent_calls,
        0,
      ),
      compactions: completed.reduce(
        (sum, { estimate }) => sum + estimate.compactions,
        0,
      ),
      total_wall_ms:
        knownWallTimes.length === 0
          ? null
          : knownWallTimes.reduce((sum, value) => sum + value, 0),
    },
    quality: {
      first_pass_acceptance_pct:
        completedRecords.length === 0
          ? 0
          : roundPercent(
              (firstPassAccepted / completedRecords.length) * 100,
            ),
      escaped_critical: input.workUnits.filter(
        (record) => record.escaped_severity === "critical",
      ).length,
      escaped_high: input.workUnits.filter(
        (record) => record.escaped_severity === "high",
      ).length,
      retry_exhausted: input.workUnits.filter(
        (record) => record.retry_exhausted,
      ).length,
      incomplete: input.workUnits.filter(
        (record) => record.status === "incomplete",
      ).length,
    },
    classes: buildClassSummary(completed),
  };

  assertAggregateOnly(report);
  return report;
}

export function compareEfficiencyWindows(
  baseline: EfficiencyReportV1,
  candidate: EfficiencyReportV1,
): EfficiencyComparison {
  const evidenceReasons: string[] = [];
  const qualityReasons: string[] = [];
  const savingsReasons: string[] = [];
  const enoughSamples =
    baseline.samples.ordinary >= 20 &&
    baseline.samples.high_risk >= 5 &&
    candidate.samples.ordinary >= 20 &&
    candidate.samples.high_risk >= 5;

  if (
    baseline.coverage === "insufficient_evidence" ||
    candidate.coverage === "insufficient_evidence"
  ) {
    evidenceReasons.push("coverage_insufficient");
  }
  if (!enoughSamples) evidenceReasons.push("minimum_sample_not_met");

  const baselineMedian = baseline.tokens.median_per_completed;
  const reduction =
    baselineMedian <= 0
      ? null
      : roundPercent(
          (1 - candidate.tokens.median_per_completed / baselineMedian) * 100,
        );
  if (reduction === null) evidenceReasons.push("baseline_median_unavailable");

  if (
    candidate.quality.escaped_critical + candidate.quality.escaped_high >
    0
  ) {
    qualityReasons.push("escaped_critical_or_high");
  }
  if (
    baseline.quality.first_pass_acceptance_pct -
      candidate.quality.first_pass_acceptance_pct >
    2
  ) {
    qualityReasons.push("first_pass_acceptance_regressed");
  }
  if (
    candidate.quality.retry_exhausted > baseline.quality.retry_exhausted
  ) {
    qualityReasons.push("retry_exhaustion_increased");
  }
  if (candidate.quality.incomplete > baseline.quality.incomplete) {
    qualityReasons.push("incomplete_work_increased");
  }
  if (candidate.context.input_p90 >= 150_000) {
    savingsReasons.push("context_p90_above_limit");
  }
  if (reduction !== null && reduction < 30) {
    savingsReasons.push("median_reduction_below_target");
  }

  const common = {
    median_reduction_pct: reduction,
    ordinary_samples: candidate.samples.ordinary,
    high_risk_samples: candidate.samples.high_risk,
  };
  if (evidenceReasons.length > 0) {
    return {
      ...common,
      status: "insufficient_evidence",
      reasons: evidenceReasons,
    };
  }
  if (qualityReasons.length > 0) {
    return {
      ...common,
      status: "quality_regression",
      reasons: qualityReasons,
    };
  }
  if (savingsReasons.length > 0) {
    return {
      ...common,
      status: "savings_below_target",
      reasons: savingsReasons,
    };
  }
  return { ...common, status: "accepted", reasons: [] };
}

export function assertAggregateOnly(value: unknown): void {
  visitAggregate(value, "$");
}

function visitAggregate(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitAggregate(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_AGGREGATE_KEY.test(key)) {
      throw new Error(`forbidden_aggregate_key:${path}.${key}`);
    }
    visitAggregate(child, `${path}.${key}`);
  }
}

function buildClassSummary(
  completed: readonly {
    readonly record: WorkUnitRecord;
    readonly estimate: RolloutEfficiencyEstimate;
  }[],
): EfficiencyReportV1["classes"] {
  return Object.fromEntries(
    WORK_UNIT_CLASSES.map((workClass) => {
      const classItems = completed.filter(
        ({ record }) => record.descriptor.class === workClass,
      );
      return [
        workClass,
        {
          completed: classItems.length,
          median_tokens:
            classItems.length === 0
              ? null
              : nearestRank(
                  classItems.map(({ estimate }) =>
                    totalUsageTokens(estimate.usage),
                  ),
                  0.5,
                ),
        },
      ];
    }),
  ) as EfficiencyReportV1["classes"];
}

function totalUsageTokens(usage: TokenUsage): number {
  return usage.input_tokens + usage.output_tokens;
}

function nearestRank(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function zeroUsage(): TokenUsage {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
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

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
