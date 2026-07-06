import { OPENROUTER_MODE_MODEL_MAP, type OpenRouterMode } from "./cliWorkerCapture";

export type SubstituteRole = "code_draft" | "planning";

// Re-exported for OUT-OF-LANE consumers (e.g. scripts/openrouter-health.ts): the governed-core
// boundary wall forbids importing cliWorkerCapture from outside the lane, and rightly so — this
// module (inside the lane) is the sanctioned read-only surface for the active allowlisted models.
export const ACTIVE_FREE_MODELS: Readonly<Record<OpenRouterMode, string>> = OPENROUTER_MODE_MODEL_MAP;

export interface SubstituteCandidate {
  /** Exact OpenRouter :free id. */
  readonly model_id: string;
  /** Expected serving provider; the ladder is over (model, provider) pairs. */
  readonly provider_slug: string;
  readonly quality: "eval_passed" | "pending_eval" | "below_floor";
  /** One-line cited quality evidence, or UNVERIFIED. */
  readonly evidence: string;
  readonly notes?: string;
}

/**
 * Catalog only: the dispatch lane can still send only the two allowlisted
 * OPENROUTER_MODE_MODEL_MAP models. A candidate becomes dispatchable only
 * after (1) a supervised smoke, (2) a tiered eval record, and (3) an explicit
 * owner-gated allowlist plus response-model-family entry per candidate.
 * Candidate quality flips to "eval_passed" only after those gates. This
 * mirrors the lane-cost-tiers ADR rule.
 */
export const SUBSTITUTE_LADDERS: Readonly<Record<SubstituteRole, readonly SubstituteCandidate[]>> = {
  code_draft: [
    {
      model_id: "poolside/laguna-m.1:free",
      provider_slug: "Poolside",
      quality: "pending_eval",
      evidence: "72.5% SWE-bench Verified - vendor-run, Poolside blog",
      notes: "Poolside free tier may train on inputs - packet-only redaction required; max_out 32K"
    },
    {
      model_id: "poolside/laguna-xs-2.1:free",
      provider_slug: "Poolside",
      quality: "pending_eval",
      evidence: "70.9% SWE-V - vendor-run, Poolside blog",
      notes: "Poolside free tier may train on inputs - packet-only redaction required"
    },
    {
      model_id: "tencent/hy3:free",
      provider_slug: "Novita",
      quality: "pending_eval",
      evidence: "74.4% SWE-V - Tencent claim, UNVERIFIED independently",
      notes: "De-correlated provider"
    },
    {
      model_id: "cohere/north-mini-code:free",
      provider_slug: "Cohere",
      quality: "pending_eval",
      evidence: "67.6% SWE-V pass@1"
    }
  ],
  planning: [
    {
      model_id: "tencent/hy3:free",
      provider_slug: "Novita",
      quality: "pending_eval",
      evidence: "74.4% SWE-V - Tencent claim, UNVERIFIED independently",
      notes: "De-correlated vs Nvidia primary"
    },
    {
      model_id: "nvidia/nemotron-3-super-120b-a12b:free",
      provider_slug: "Nvidia",
      quality: "pending_eval",
      evidence: "AIME25 90.2 - NVIDIA card",
      notes: "Provider-correlated with the nemotron-ultra primary"
    },
    {
      model_id: "google/gemma-4-31b-it:free",
      provider_slug: "OpenInference",
      quality: "pending_eval",
      evidence: "AA Intelligence Index 29",
      notes: "Only multi-provider free lane - most outage-resilient"
    },
    {
      model_id: "openai/gpt-oss-120b:free",
      provider_slug: "OpenInference",
      quality: "pending_eval",
      evidence: "UNVERIFIED for planning; below_floor for code_draft",
      notes: "Planning only; explicitly below_floor for code_draft, so it is not listed there"
    }
  ]
};

export interface EndpointHealthFields {
  readonly status: number | null;
  readonly uptime_last_5m: number | null;
  readonly uptime_last_30m: number | null;
}

export function isEndpointUsable(e: EndpointHealthFields): boolean {
  return (
    e.status !== null &&
    e.status >= 0 &&
    e.uptime_last_30m !== null &&
    e.uptime_last_30m >= 95 &&
    e.uptime_last_5m !== null
  );
}
