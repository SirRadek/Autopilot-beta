export type WorkUnitClass =
  | "deterministic_check"
  | "mechanical_change"
  | "bounded_implementation"
  | "research_or_design"
  | "review"
  | "high_risk";

export type WorkUnitRisk = "ordinary" | "high";

export interface WorkUnitDescriptor {
  readonly work_unit_id: string;
  readonly class: WorkUnitClass;
  readonly risk: WorkUnitRisk;
}

export interface EfficiencyBudget {
  readonly max_direct_subagents: 2;
  readonly max_depth: 1;
  readonly max_total_attempts: 2;
  readonly max_reviews: 1;
  readonly max_rereviews: 1;
  readonly context_soft_limit_tokens: 150_000;
}

export interface EfficiencyObservation {
  readonly direct_subagents: number;
  readonly depth: number;
  readonly total_attempts: number;
  readonly reviews: number;
  readonly rereviews: number;
  readonly context_tokens: number;
  readonly attempt_two_delta: string | null;
}

export interface EfficiencyOverride {
  readonly risk_trigger: string;
  readonly expected_assurance: string;
  readonly stopping_condition: string;
}

export type EfficiencyViolationCode =
  | "subagent_budget_exceeded"
  | "recursive_fanout_forbidden"
  | "attempt_budget_exceeded"
  | "attempt_delta_missing"
  | "review_budget_exceeded"
  | "rereview_budget_exceeded"
  | "context_checkpoint_required"
  | "override_required";

export interface EfficiencyViolation {
  readonly code: EfficiencyViolationCode;
  readonly observed: number | null;
  readonly limit: number | null;
}

const ORDINARY_BUDGET: EfficiencyBudget = {
  max_direct_subagents: 2,
  max_depth: 1,
  max_total_attempts: 2,
  max_reviews: 1,
  max_rereviews: 1,
  context_soft_limit_tokens: 150_000,
};

export function resolveEfficiencyBudget(
  _descriptor: WorkUnitDescriptor,
): EfficiencyBudget {
  return ORDINARY_BUDGET;
}

export function evaluateEfficiencyBudget(
  descriptor: WorkUnitDescriptor,
  observation: EfficiencyObservation,
  override?: EfficiencyOverride,
): readonly EfficiencyViolation[] {
  const budget = resolveEfficiencyBudget(descriptor);
  const violations: EfficiencyViolation[] = [];
  const add = (
    condition: boolean,
    code: EfficiencyViolationCode,
    observed: number | null,
    limit: number | null,
  ): void => {
    if (condition) violations.push({ code, observed, limit });
  };

  add(
    observation.direct_subagents > budget.max_direct_subagents,
    "subagent_budget_exceeded",
    observation.direct_subagents,
    budget.max_direct_subagents,
  );
  add(
    observation.depth > budget.max_depth,
    "recursive_fanout_forbidden",
    observation.depth,
    budget.max_depth,
  );
  add(
    observation.total_attempts > budget.max_total_attempts,
    "attempt_budget_exceeded",
    observation.total_attempts,
    budget.max_total_attempts,
  );
  add(
    observation.total_attempts > 1 && !observation.attempt_two_delta?.trim(),
    "attempt_delta_missing",
    null,
    null,
  );
  add(
    observation.reviews > budget.max_reviews,
    "review_budget_exceeded",
    observation.reviews,
    budget.max_reviews,
  );
  add(
    observation.rereviews > budget.max_rereviews,
    "rereview_budget_exceeded",
    observation.rereviews,
    budget.max_rereviews,
  );
  add(
    observation.context_tokens >= budget.context_soft_limit_tokens,
    "context_checkpoint_required",
    observation.context_tokens,
    budget.context_soft_limit_tokens,
  );

  const validOverride =
    override !== undefined &&
    override.risk_trigger.trim().length > 0 &&
    override.expected_assurance.trim().length > 0 &&
    override.stopping_condition.trim().length > 0;
  if (descriptor.risk === "high" && violations.length > 0 && !validOverride) {
    return [
      { code: "override_required", observed: null, limit: null },
      ...violations,
    ];
  }

  return violations;
}
