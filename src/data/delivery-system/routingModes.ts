/**
 * Routing modes are explicit supervisor/human input. Keyword auto-classifiers are
 * advisory only; auto-classification is the first step toward auto-switching,
 * which is out of scope for this slice.
 *
 * Live activation of the Nemotron/Qwen worker lanes remains a future slice
 * pending the tiered-eval regime and ACCESS-TIER-001: workers are packet-only,
 * with no self-prompting or learning. This module is pure structure, not live
 * dispatch.
 */

export type RoutingModeId = "idea" | "spec" | "build" | "review";

// `agy_*` lanes map to the agy_cli choice in CliVendorSelection; `openrouter_*`
// lanes mirror OpenRouterMode values; `codex_cli` keeps the CLI vendor id stable.
export type RoutingLaneId =
  | "agy_fast"
  | "agy_deep"
  | "agy_gpt_oss_120b"
  | "agy_claude_sonnet_4_6"
  | "openrouter_nemotron_planning"
  | "openrouter_qwen3_code_draft"
  | "qwen_local"
  | "deterministic_tools"
  | "claude_supervisor"
  | "codex_cli";

// Expensive means owner-subscription decision/implementation lanes, not a cost number; guard is cost-blind.
export const EXPENSIVE_LANES: readonly RoutingLaneId[] = ["claude_supervisor", "codex_cli"];

export type LaneCostTier = "free" | "mid" | "expensive";

// Owner-ratified 2026-07-06 (docs/decisions/lane-cost-tiers-2026-07-06.md): free lanes are always
// tried first, then mid, then expensive. Ordering is supervisor doctrine + future routing input —
// enforcement stays at the existing cost-blind gates (idea-mode wall, build-mode draft trail).
// agy_deep is mid, NOT free: Antigravity quota burns proportionally to token cost and Gemini 3.1
// Pro consumes the shared weekly quota far faster than 3.5 Flash.
export const LANE_COST_TIERS: Record<RoutingLaneId, LaneCostTier> = {
  deterministic_tools: "free",
  qwen_local: "free",
  openrouter_qwen3_code_draft: "free",
  openrouter_nemotron_planning: "free",
  agy_fast: "mid",
  agy_deep: "mid",
  // Separate Antigravity "Claude and GPT models" quota pool - measured 2026-07-06:
  // consumes neither the Gemini group quota nor OpenRouter free budget.
  agy_gpt_oss_120b: "mid",
  agy_claude_sonnet_4_6: "mid",
  claude_supervisor: "expensive",
  codex_cli: "expensive"
};

// Live-verified 2026-07-06 (owner smokes returned "OK"): see docs/decisions/lane-cost-tiers-2026-07-06.md.
export const AGY_VERIFIED_MODELS = {
  agy_fast_default: "gemini-3.5-flash-medium", // ratified routine default (quota saver)
  agy_fast_quality: "gemini-3.5-flash-high", // explicit quality escalation
  agy_deep: "gemini-3.1-pro-high", // explicit justification only
  agy_gpt_oss_120b: "gpt-oss-120b",
  agy_claude_sonnet_4_6: "claude-4.6-sonnet"
} as const;

export type BuildPrepProvenance =
  | { readonly kind: "cheap_attempts"; readonly cheap_attempt_refs: readonly string[] }
  | { readonly kind: "cheap_not_applicable"; readonly reason: string; readonly owner_override: true };

export function isBuildPrepProvenanceSatisfied(p: BuildPrepProvenance | undefined): boolean {
  if (p === undefined) return false;

  if (p.kind === "cheap_attempts") {
    return (
      Array.isArray(p.cheap_attempt_refs) &&
      p.cheap_attempt_refs.length > 0 &&
      p.cheap_attempt_refs.every((ref) => typeof ref === "string" && ref.trim().length > 0)
    );
  }

  if (p.kind === "cheap_not_applicable") {
    return typeof p.reason === "string" && p.reason.trim().length > 0 && p.owner_override === true;
  }

  return false;
}

export interface RoutingModePolicy {
  readonly id: RoutingModeId;
  readonly summary: string;
  readonly allowedLanes: readonly RoutingLaneId[];
  readonly expensiveLanesAllowed: boolean;
  readonly refuseWhen: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
  readonly slice: "shipped" | "deferred";
}

export const routingModes = [
  {
    id: "idea",
    summary:
      "Brainstorming and variants run only on non-expensive advisory lanes; Claude/Codex decision and implementation lanes are hard-forbidden.",
    allowedLanes: [
      "agy_fast",
      "agy_deep",
      "agy_gpt_oss_120b",
      "agy_claude_sonnet_4_6",
      "openrouter_nemotron_planning"
    ],
    expensiveLanesAllowed: false,
    refuseWhen: ["any expensive lane requested (claude_supervisor/codex_cli)"],
    requiredChecks: ["mode_is_explicit_supervisor_input", "lane_in_allowed_set", "no_expensive_lane"],
    stopConditions: ["expensive_lane_requested_in_idea", "auto_mode_classification_used_as_authority"],
    slice: "shipped"
  },
  {
    id: "spec",
    summary:
      "Specification drafting starts with Nemotron or agy planning plus deterministic local context before any deferred supervisor handoff.",
    allowedLanes: ["openrouter_nemotron_planning", "agy_fast", "agy_deep", "deterministic_tools"],
    expensiveLanesAllowed: true,
    refuseWhen: ["cheap draft missing", "task package hash missing"],
    requiredChecks: ["mode_is_explicit_supervisor_input", "lane_in_allowed_set", "upstream_spec_draft_present"],
    stopConditions: ["missing_upstream_draft", "missing_task_package_hash", "auto_mode_classification_used_as_authority"],
    slice: "deferred"
  },
  {
    id: "build",
    summary:
      "Implementation starts with Qwen draft lanes, local worker lanes, and deterministic checks before the deferred Codex patch path.",
    allowedLanes: ["openrouter_qwen3_code_draft", "qwen_local", "deterministic_tools", "codex_cli"],
    expensiveLanesAllowed: true,
    refuseWhen: ["raw prompt sent to build lane", "approved draft or failed-attempt trail missing"],
    requiredChecks: ["mode_is_explicit_supervisor_input", "lane_in_allowed_set", "approved_patch_plan_present"],
    stopConditions: ["missing_upstream_draft", "missing_failed_attempt_trail", "raw_prompt_used_for_build"],
    slice: "shipped"
  },
  {
    id: "review",
    summary:
      "Review starts with agy critique lanes; Claude/Codex review paths remain deferred to declared severity and bounded artifacts.",
    allowedLanes: ["agy_fast", "agy_deep", "agy_gpt_oss_120b", "agy_claude_sonnet_4_6", "claude_supervisor", "codex_cli"],
    expensiveLanesAllowed: true,
    refuseWhen: ["severity not declared", "cheap review artifact absent", "low-severity polish routed to Claude"],
    requiredChecks: ["mode_is_explicit_supervisor_input", "lane_in_allowed_set", "review_severity_declared"],
    stopConditions: ["missing_review_severity", "cheap_artifact_absent", "low_severity_polish_routed_to_claude"],
    slice: "deferred"
  }
] as const satisfies readonly RoutingModePolicy[];

export function getRoutingMode(id: RoutingModeId): RoutingModePolicy {
  const mode = routingModes.find((candidate) => candidate.id === id);
  if (!mode) {
    throw new Error(`routing_mode_not_found: ${String(id)}`);
  }

  return mode;
}

export function isLaneAllowedInMode(id: RoutingModeId, lane: RoutingLaneId): boolean {
  return getRoutingMode(id).allowedLanes.includes(lane);
}

export function resolveRoutingLane(input: {
  readonly vendor: "codex_cli" | "agy_cli" | "openrouter_api";
  readonly openrouterMode?: "qwen3_code_draft" | "nemotron_planning";
  readonly model?: string;
}): RoutingLaneId {
  if (input.vendor === "codex_cli") return "codex_cli";
  if (input.vendor === "agy_cli") {
    const model = input.model ?? "";
    if (model === AGY_VERIFIED_MODELS.agy_gpt_oss_120b) return "agy_gpt_oss_120b";
    if (model === AGY_VERIFIED_MODELS.agy_claude_sonnet_4_6) return "agy_claude_sonnet_4_6";
    return /pro/i.test(model) ? "agy_deep" : "agy_fast";
  }
  if (input.openrouterMode === "nemotron_planning") return "openrouter_nemotron_planning";
  if (input.openrouterMode === "qwen3_code_draft") return "openrouter_qwen3_code_draft";
  throw new Error("routing_lane_unresolved: openrouter_api handoff requires an openrouterMode");
}

export class LaneNotAllowedInModeError extends Error {
  readonly reason = "lane_not_allowed_in_mode";
  readonly modeId: RoutingModeId;
  readonly lane: RoutingLaneId;

  constructor(modeId: RoutingModeId, lane: RoutingLaneId) {
    super(`lane_not_allowed_in_mode: ${lane} is not allowed in ${modeId} mode`);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    this.modeId = modeId;
    this.lane = lane;
  }
}

export function assertLaneAllowedInMode(id: RoutingModeId, lane: RoutingLaneId): void {
  if (!isLaneAllowedInMode(id, lane)) {
    throw new LaneNotAllowedInModeError(id, lane);
  }
}
