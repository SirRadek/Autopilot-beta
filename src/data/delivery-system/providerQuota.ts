/** Normalized quota data used by provider polling and the control plane. */

import type { RunReasoningEffort } from "./executionProfile";

export type ProviderQuotaSource = "cli" | "api" | "manual-fallback";
export type ProviderHealth = "healthy" | "degraded" | "unavailable";
export type ProviderFreshness = "fresh" | "stale" | "unavailable";
export type ProviderModelDiscovery = "usage_probe" | "models_cache" | "cli_list" | "static";
export type ProviderErrorCode =
  | "timeout"
  | "missing_credential"
  | "malformed_response"
  | "provider_executable_missing"
  | "provider_runtime_denied"
  | "provider_unavailable"
  /** The account has no quota windows at all (e.g. Claude API usage billing); nothing to report. */
  | "quota_not_applicable"
  | "provider_error";
export type ProviderProbeFailurePhase = "launch" | "readiness" | "echo" | "render" | "cleanup";

export interface ProviderProbeFailure {
  readonly phase: ProviderProbeFailurePhase;
  readonly attempts?: number;
}

export interface ProviderQuotaWindow {
  readonly limit: number | null;
  readonly used: number | null;
  readonly remaining: number | null;
  readonly resets_at: string | null;
}

export interface ProviderModelAvailability {
  readonly model_id: string;
  readonly available: boolean;
  readonly health: ProviderHealth;
  readonly source: ProviderQuotaSource;
  /** Absent snapshots predate live model-discovery provenance. */
  readonly discovery?: ProviderModelDiscovery;
  /** Absent snapshots predate per-model reasoning discovery. */
  readonly reasoning_efforts?: readonly RunReasoningEffort[];
}

export interface ProviderModelCatalogSnapshot {
  readonly discovery: Extract<ProviderModelDiscovery, "models_cache">;
  readonly fetched_at: string;
}

export interface ProviderSnapshot {
  readonly provider: string;
  readonly source: ProviderQuotaSource;
  readonly fetched_at: string;
  readonly observed_at: string;
  readonly five_hour: ProviderQuotaWindow;
  readonly weekly: ProviderQuotaWindow;
  readonly api_spend: number | null;
  readonly currency: string | null;
  readonly models: readonly ProviderModelAvailability[];
  /** Absent snapshots predate CLI version capture. */
  readonly cli_version?: string | null;
  /** Immutable source timestamp for live model-catalog freshness reporting. */
  readonly model_catalog?: ProviderModelCatalogSnapshot;
  readonly health: ProviderHealth;
  readonly error_code: ProviderErrorCode | null;
  /** Bounded TUI-probe diagnostics. Raw terminal output and identifiers are never stored. */
  readonly probe_failure?: ProviderProbeFailure;
}

export interface ProviderQuotaAdapter {
  readonly provider: string;
  fetchSnapshot(input: { now: string; signal: AbortSignal }): Promise<ProviderSnapshot>;
}

export interface ProviderQuotaWindowInput {
  readonly limit?: number | null;
  readonly used?: number | null;
  readonly remaining?: number | null;
  readonly resets_at?: string | null;
}

/** Converts provider-specific optional values into explicit nulls. */
export function normalizeQuotaWindow(input: ProviderQuotaWindowInput): ProviderQuotaWindow {
  return {
    limit: input.limit ?? null,
    used: input.used ?? null,
    remaining: input.remaining ?? null,
    resets_at: input.resets_at ?? null
  };
}

const FRESH_MAX_AGE_MS = 5 * 60 * 1000;
const STALE_MAX_AGE_MS = 30 * 60 * 1000;

export function freshnessForSnapshot(snapshot: ProviderSnapshot, now: string): ProviderFreshness {
  if (snapshot.health === "unavailable") {
    return "unavailable";
  }
  const fetchedAt = Date.parse(snapshot.fetched_at);
  const nowAt = Date.parse(now);
  if (!Number.isFinite(fetchedAt) || !Number.isFinite(nowAt) || fetchedAt > nowAt) {
    return "unavailable";
  }

  const age = nowAt - fetchedAt;
  if (age <= FRESH_MAX_AGE_MS) {
    return "fresh";
  }
  if (age <= STALE_MAX_AGE_MS) {
    return "stale";
  }
  return "unavailable";
}

/** Maps provider failures to a small allowlisted code; raw responses are never returned. */
export function normalizeProviderError(error: unknown): ProviderErrorCode {
  const message = (error instanceof Error ? error.message : typeof error === "string" ? error : "").toLowerCase();
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code.toLowerCase()
    : "";
  if (code === "enoent" || message.includes("enoent") || message.includes("command not found") || message.includes("executable_missing")) {
    return "provider_executable_missing";
  }
  if (code === "eacces" || message.includes("eacces") || message.includes("permission denied") || message.includes("runtime_denied")) {
    return "provider_runtime_denied";
  }
  if (message.includes("provider_unavailable") || message.includes("unsupported")) {
    return "provider_unavailable";
  }
  if (message.includes("quota_not_applicable")) {
    return "quota_not_applicable";
  }
  if (message.includes("timeout") || message.includes("timed out") || message.includes("abort")) {
    return "timeout";
  }
  if (message.includes("credential") || message.includes("api key") || message.includes("api_key") || message.includes("token")) {
    return "missing_credential";
  }
  if (message.includes("json") || message.includes("parse") || message.includes("malformed")) {
    return "malformed_response";
  }
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && status >= 500) {
      return "provider_unavailable";
    }
  }
  return "provider_error";
}

const PROVIDER_PROBE_FAILURE_PHASES: readonly ProviderProbeFailurePhase[] = [
  "launch",
  "readiness",
  "echo",
  "render",
  "cleanup"
];

/** Keeps only the fixed probe phase and a bounded positive attempt count. */
export function normalizeProviderProbeFailure(value: unknown): ProviderProbeFailure | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!PROVIDER_PROBE_FAILURE_PHASES.includes(row.phase as ProviderProbeFailurePhase)) return null;
  const attempts = row.attempts;
  return {
    phase: row.phase as ProviderProbeFailurePhase,
    ...(Number.isSafeInteger(attempts) && (attempts as number) > 0 && (attempts as number) <= 10_000
      ? { attempts: attempts as number }
      : {})
  };
}
