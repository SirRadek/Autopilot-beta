import {
  buildOpenRouterHealthReport,
  type OpenRouterHealthFetch
} from "../../../scripts/openrouter-health";
import {
  normalizeProviderError,
  normalizeQuotaWindow,
  type ProviderHealth,
  type ProviderModelAvailability,
  type ProviderQuotaAdapter,
  type ProviderSnapshot
} from "./providerQuota";
import { isCanonicalModelId } from "./providerModelId";
import { runTmuxUsageProbe, type UsageProbeProvider } from "./providerUsageProbe";

export interface ProviderCommandResult {
  readonly stdout: string;
  readonly stderr?: string;
  readonly exitCode?: number | null;
}

export type ProviderCommandRunner = (input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly signal: AbortSignal;
}) => Promise<ProviderCommandResult>;

export type ProviderCliCapability =
  | { readonly command: string; readonly args: readonly string[] }
  | { readonly kind: "tmux_usage" };

export interface ProviderQuotaAdapterDependencies {
  readonly runCommand: ProviderCommandRunner;
  readonly commands?: Partial<Record<UsageProbeProvider, ProviderCliCapability>>;
  readonly runUsageProbe?: (provider: UsageProbeProvider) => Promise<ProviderCommandResult>;
  readonly fetchImpl?: OpenRouterHealthFetch;
  readonly timeoutMs?: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export function createProviderQuotaAdapters(
  dependencies: ProviderQuotaAdapterDependencies
): Readonly<Record<"codex_cli" | "claude_cli" | "agy_cli" | "openrouter_api", ProviderQuotaAdapter>> {
  return {
    codex_cli: createCliAdapter("codex_cli", dependencies),
    claude_cli: createCliAdapter("claude_cli", dependencies),
    agy_cli: createCliAdapter("agy_cli", dependencies),
    openrouter_api: createOpenRouterAdapter(dependencies)
  };
}

function createCliAdapter(
  provider: "codex_cli" | "claude_cli" | "agy_cli",
  dependencies: ProviderQuotaAdapterDependencies
): ProviderQuotaAdapter {
  return {
    provider,
    fetchSnapshot: async ({ now, signal }) => {
      try {
        const spec = dependencies.commands?.[provider];
        if (!spec) {
          return errorSnapshot(provider, "cli", now, "provider_unavailable");
        }
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        signal.addEventListener("abort", onAbort, { once: true });
        let result: ProviderCommandResult;
        try {
          const execution = "kind" in spec
            ? (dependencies.runUsageProbe ?? runTmuxUsageProbe)(provider)
            : dependencies.runCommand({ command: spec.command, args: spec.args, signal: controller.signal });
          result = await withTimeout(
            execution,
            dependencies.timeoutMs ?? ("kind" in spec ? 25_000 : 10_000),
            controller
          );
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
        if ((result.exitCode ?? 0) !== 0) {
          const stderr = result.stderr ?? "";
          throw new Error(/login|auth|credential|api[ _-]?key|token/i.test(stderr) ? "missing_credential" : stderr || "provider_unavailable");
        }
        const parsed = parseQuotaPayload(result.stdout);
        if (parsed === null) {
          throw new Error("malformed_response");
        }
        return snapshotFromPayload(provider, "cli", now, parsed);
      } catch (error) {
        return errorSnapshot(provider, "cli", now, normalizeProviderError(error));
      }
    }
  };
}

function createOpenRouterAdapter(dependencies: ProviderQuotaAdapterDependencies): ProviderQuotaAdapter {
  return {
    provider: "openrouter_api",
    fetchSnapshot: async ({ now, signal }) => {
      if (!(dependencies.environment ?? process.env).OPENROUTER_API_KEY) {
        return errorSnapshot("openrouter_api", "api", now, "missing_credential");
      }
      try {
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        signal.addEventListener("abort", onAbort, { once: true });
        let report: Awaited<ReturnType<typeof buildOpenRouterHealthReport>>;
        try {
          report = await withTimeout(
            buildOpenRouterHealthReport(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl, signal: controller.signal } : { signal: controller.signal }),
            dependencies.timeoutMs ?? 10_000,
            controller
          );
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
        const fetchImpl = dependencies.fetchImpl ?? (globalThis.fetch as OpenRouterHealthFetch | undefined);
        if (!fetchImpl) throw new Error("provider_unavailable");
        signal.addEventListener("abort", onAbort, { once: true });
        let creditsResponse: Awaited<ReturnType<OpenRouterHealthFetch>>;
        try {
          creditsResponse = await withTimeout(
            fetchImpl("https://openrouter.ai/api/v1/credits", {
              method: "GET",
              headers: { accept: "application/json", authorization: `Bearer ${(dependencies.environment ?? process.env).OPENROUTER_API_KEY}` },
              signal: controller.signal
            }),
            dependencies.timeoutMs ?? 10_000,
            controller
          );
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
        if (!creditsResponse.ok) {
          throw new Error(creditsResponse.status === 401 || creditsResponse.status === 403 ? "missing_credential" : creditsResponse.status >= 500 ? "provider_unavailable" : "provider_error");
        }
        const creditsText = await readBoundedResponseText(creditsResponse, 64 * 1024);
        if (creditsText === null) throw new Error("malformed_response");
        const credits = asRecord(JSON.parse(creditsText));
        const creditsData = asRecord(credits?.data) ?? credits;
        const totalCredits = numberOrNull(creditsData?.total_credits);
        const totalUsage = numberOrNull(creditsData?.total_usage);
        const models: ProviderModelAvailability[] = report.models.map((model) => ({
          model_id: model.model_id,
          available: model.usable,
          health: model.usable ? "healthy" : "degraded",
          source: "api"
        }));
        const anyUsable = models.some((model) => model.available);
        return {
          provider: "openrouter_api",
          source: "api",
          fetched_at: now,
          observed_at: now,
          five_hour: normalizeQuotaWindow({}),
          weekly: normalizeQuotaWindow({}),
          api_spend: totalUsage,
          currency: "USD",
          models,
          health: anyUsable ? "healthy" : "unavailable",
          error_code: anyUsable ? null : "provider_unavailable"
        };
      } catch (error) {
        return errorSnapshot("openrouter_api", "api", now, normalizeProviderError(error));
      }
    }
  };
}

function parseQuotaPayload(text: string): Record<string, unknown> | null {
  if (text.length > 128 * 1024) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function snapshotFromPayload(provider: string, source: "cli", now: string, payload: Record<string, unknown>): ProviderSnapshot {
  const five = windowFrom(payload, ["five_hour", "fiveHour", "5h", "five-hour"]);
  const weekly = windowFrom(payload, ["weekly", "week", "7d"]);
  const modelsValue = payload.models;
  const models: ProviderModelAvailability[] = Array.isArray(modelsValue)
      ? modelsValue.slice(0, 256).flatMap((value) => {
        const row = asRecord(value);
        if (row === null) return [];
        const id = typeof row?.model_id === "string" ? row.model_id : typeof row?.model === "string" ? row.model : null;
        if (id === null || !isCanonicalModelId(id)) return [];
        const available = row.available !== false && row.health !== "unavailable";
        return [{ model_id: id, available, health: available ? "healthy" : "degraded", source: "cli" }];
      })
    : [];
  const unavailable = payload.available === false || payload.status === "unavailable";
  return {
    provider,
    source,
    fetched_at: now,
    observed_at: now,
    five_hour: five,
    weekly,
    api_spend: numberOrNull(payload.api_spend ?? payload.spend),
    currency: typeof payload.currency === "string" ? payload.currency : null,
    models,
    health: unavailable ? "unavailable" : "healthy",
    error_code: unavailable ? "provider_unavailable" : null
  };
}

async function readBoundedResponseText(response: { readonly body?: ReadableStream<Uint8Array> | null; text(): Promise<string> }, maxBytes: number): Promise<string | null> {
  if (response.body === undefined || response.body === null) {
    const text = await response.text();
    return text.length <= maxBytes ? text : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return null; }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function windowFrom(payload: Record<string, unknown>, keys: readonly string[]) {
  const value = keys.map((key) => payload[key]).find((candidate) => asRecord(candidate) !== null);
  const record = asRecord(value) ?? payload;
  return normalizeQuotaWindow({
    limit: numberOrNull(record.limit ?? record.max ?? record.total),
    used: numberOrNull(record.used ?? record.usage),
    remaining: numberOrNull(record.remaining ?? record.left),
    resets_at: boundedString(record.resets_at) ?? boundedString(record.reset_at)
  });
}

function boundedString(value: unknown): string | null {
  return typeof value === "string" && value.length <= 200 ? value : null;
}

function errorSnapshot(provider: string, source: "cli" | "api", now: string, errorCode: ProviderSnapshot["error_code"]): ProviderSnapshot {
  return {
    provider,
    source,
    fetched_at: now,
    observed_at: now,
    five_hour: normalizeQuotaWindow({}),
    weekly: normalizeQuotaWindow({}),
    api_spend: null,
    currency: null,
    models: [],
    health: "unavailable",
    error_code: errorCode
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  if (controller.signal.aborted) throw new Error("aborted");
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
    const abort = () => reject(new Error("aborted"));
    controller.signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
