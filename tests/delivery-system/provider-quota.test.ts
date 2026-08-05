import { describe, expect, it } from "vitest";

import {
  freshnessForSnapshot,
  normalizeProviderError,
  normalizeQuotaWindow,
  type ProviderSnapshot
} from "../../src/data/delivery-system/providerQuota";

const NOW = "2026-07-11T12:00:00.000Z";

describe("provider quota domain", () => {
  it("keeps missing quota values null instead of inventing zeroes", () => {
    expect(normalizeQuotaWindow({ limit: null, used: 0, remaining: null })).toEqual({
      limit: null,
      used: 0,
      remaining: null,
      resets_at: null
    });
  });

  it("classifies snapshots by bounded freshness thresholds", () => {
    const snapshot = (fetched_at: string): ProviderSnapshot => ({
      provider: "codex_cli",
      source: "cli",
      fetched_at,
      observed_at: fetched_at,
      five_hour: normalizeQuotaWindow({ limit: 10, used: 0, remaining: 10 }),
      weekly: normalizeQuotaWindow({ limit: null, used: null, remaining: null }),
      api_spend: null,
      currency: null,
      models: [],
      health: "healthy",
      error_code: null
    });

    expect(freshnessForSnapshot(snapshot(NOW), NOW)).toBe("fresh");
    expect(freshnessForSnapshot(snapshot("2026-07-11T11:54:00.000Z"), NOW)).toBe("stale");
    expect(freshnessForSnapshot(snapshot("2026-07-11T11:30:00.000Z"), NOW)).toBe("stale");
    expect(freshnessForSnapshot(snapshot("2026-07-11T11:29:59.000Z"), NOW)).toBe("unavailable");
  });

  it("returns bounded provider error codes without leaking body text", () => {
    expect(normalizeProviderError(new Error("request timed out with secret body"))).toBe("timeout");
    expect(normalizeProviderError(new Error("OPENROUTER_API_KEY missing"))).toBe("missing_credential");
    expect(normalizeProviderError(new Error("invalid JSON response from provider"))).toBe("malformed_response");
    expect(normalizeProviderError({ status: 503, body: "private response" })).toBe("provider_unavailable");
    expect(normalizeProviderError("unexpected secret payload")).toBe("provider_error");
  });

  it("normalizes executable lookup failures to provider_executable_missing", () => {
    expect(normalizeProviderError(Object.assign(new Error("spawn codex failed"), { code: "ENOENT" })))
      .toBe("provider_executable_missing");
    expect(normalizeProviderError(new Error("codex: command not found")))
      .toBe("provider_executable_missing");
    expect(normalizeProviderError(new Error("executable_missing: provider_unavailable")))
      .toBe("provider_executable_missing");
  });

  it("normalizes runtime permission failures to provider_runtime_denied", () => {
    expect(normalizeProviderError(Object.assign(new Error("spawn codex failed"), { code: "EACCES" })))
      .toBe("provider_runtime_denied");
    expect(normalizeProviderError(new Error("codex: permission denied")))
      .toBe("provider_runtime_denied");
    expect(normalizeProviderError(new Error("runtime_denied: operation unsupported")))
      .toBe("provider_runtime_denied");
  });
});
