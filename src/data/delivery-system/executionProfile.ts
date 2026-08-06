import type { WorkUnitClass, WorkUnitRisk } from "./efficiencyPolicy";
import type { LaneCostTier } from "./routingModes";

export type RunProfile = "dev" | "prod";
export type StoredRunProfile = RunProfile | "legacy";
export const RUN_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type RunReasoningEffort = (typeof RUN_REASONING_EFFORTS)[number];
export type VerificationMode = "diff_scoped" | "full_fail_closed";

export const DEV_DEFAULT_COST_TIERS: readonly LaneCostTier[] = ["free", "mid"];
export const SUPPORTED_REASONING_EFFORTS = {
  // Codex `ultra` may delegate to subagents inside the approved CLI process. It is
  // deliberately an explicit, immutable route choice under the existing owner
  // approval, token-reservation, timeout, and sandbox gates (plus the task-packet
  // gate whenever the write-capable Codex mode is selected).
  codex_cli: ["low", "medium", "high", "xhigh", "max", "ultra"],
  claude_cli: ["low", "medium", "high", "xhigh", "max"],
  agy_cli: ["low", "medium", "high"],
  openrouter_api: [],
} as const satisfies Readonly<Record<string, readonly RunReasoningEffort[]>>;

export function resolveVerificationMode(profile: RunProfile, risk: WorkUnitRisk): VerificationMode {
  return profile === "prod" || risk === "high" ? "full_fail_closed" : "diff_scoped";
}

export function classifyWorkUnitForProfile(
  profile: RunProfile,
  touchesHighRiskBoundary: boolean,
): { readonly class: WorkUnitClass; readonly risk: WorkUnitRisk } {
  if (profile === "prod" || touchesHighRiskBoundary) return { class: "high_risk", risk: "high" };
  return { class: "bounded_implementation", risk: "ordinary" };
}

export interface RouteSnapshot { readonly provider: string; readonly model: string | null; readonly reasoning: RunReasoningEffort | null; }

export function assertNoSilentRouteChange(before: RouteSnapshot, after: RouteSnapshot): void {
  if (before.provider !== after.provider || before.model !== after.model || before.reasoning !== after.reasoning) {
    throw new Error("silent_route_change_forbidden");
  }
}
