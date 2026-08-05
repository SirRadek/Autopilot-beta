/** Normalized quota data used by provider polling and the control plane. */

export type ProviderQuotaSource = "cli" | "api" | "manual-fallback";
export type ProviderHealth = "healthy" | "degraded" | "unavailable";
export type ProviderFreshness = "fresh" | "stale" | "unavailable";
export type ProviderErrorCode =
  | "timeout"
  | "missing_credential"
  | "malformed_response"
  | "provider_executable_missing"
  | "provider_runtime_denied"
  | "provider_unavailable"
  | "provider_error";

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
  readonly health: ProviderHealth;
  readonly error_code: ProviderErrorCode | null;
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
