import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { RUN_REASONING_EFFORTS, type RunReasoningEffort } from "./executionProfile";
import type { ProviderCommandResult, ProviderCommandRunner } from "./providerQuotaAdapters";
import { expandQuotaLabel, isCanonicalModelId } from "./providerModelId";

const COMMAND_TIMEOUT_MS = 5_000;
const MAX_DISCOVERY_BYTES = 1024 * 1024;
const MAX_DISCOVERED_MODELS = 256;
export const CODEX_MODEL_CACHE_TTL_MS = 300_000;
const COMMAND_ENVIRONMENT_KEYS = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TERM", "TMPDIR"] as const;

// The Codex cache shape was verified against CLI 0.144.5 and its ModelInfo source.
// `agy models` still fails closed on any decorated or unrecognized output.

export interface DiscoveredProviderModel {
  readonly model_id: string;
  readonly reasoning_efforts?: readonly RunReasoningEffort[];
}

export interface DiscoveredCodexModelCatalog {
  readonly models: readonly DiscoveredProviderModel[];
  readonly fetched_at: string;
  readonly freshness: "fresh" | "stale";
  readonly age_ms: number;
}

export interface CodexModelCacheAge {
  readonly fetched_at: string;
  readonly freshness: "fresh" | "stale";
  readonly age_ms: number;
}

export async function captureCliVersion(
  executable: string,
  runCommand: ProviderCommandRunner,
  signal: AbortSignal
): Promise<string | null> {
  try {
    const result = await runBoundedCommand(executable, ["--version"], runCommand, signal);
    if (result === null || (result.exitCode ?? 0) !== 0) return null;
    const firstLine = result.stdout.split(/\r?\n/, 1)[0]?.trim() ?? "";
    return firstLine.length > 0
      && firstLine.length <= 100
      && /^[A-Za-z0-9 ._()/-]+$/.test(firstLine)
      ? firstLine
      : null;
  } catch {
    return null;
  }
}

// There is deliberately no discoverClaudeModels here. The installed Claude CLI exposes no
// non-interactive model listing: `claude --help` has no `models` subcommand (only `agents`,
// `auth`, `mcp`, `doctor`, …), the model picker is the interactive `/model` command, and the
// CLI keeps no on-disk models cache equivalent to ~/.codex/models_cache.json. Claude model
// discovery therefore flows exclusively from the tmux usage probe, whose screen labels are
// normalised through expandQuotaLabel("claude_cli", …) — provenance "usage_probe".

export function discoverCodexModels(
  homeDir: string,
  expectedClientVersion: string,
  now = new Date()
): DiscoveredCodexModelCatalog | null {
  try {
    if (homeDir.length === 0 || expectedClientVersion.length === 0 || !Number.isFinite(now.getTime())) return null;
    const path = join(homeDir, ".codex", "models_cache.json");
    const metadata = statSync(path);
    if (!metadata.isFile() || metadata.size > MAX_DISCOVERY_BYTES) return null;
    const contents = readFileSync(path, "utf8");
    if (Buffer.byteLength(contents, "utf8") > MAX_DISCOVERY_BYTES) return null;
    const parsed = asRecord(JSON.parse(contents));
    if (parsed === null || !Array.isArray(parsed.models)) return null;
    if (parsed.client_version !== expectedClientVersion || typeof parsed.fetched_at !== "string") return null;
    const cacheAge = codexModelCacheAge(parsed.fetched_at, now);
    if (cacheAge === null) return null;

    // This mirrors Codex model/list's default picker view. Hidden internal rows are
    // not proof of an owner-selectable dispatch route and remain excluded. The
    // quota probe is a ChatGPT-account surface, so picker-visible ChatGPT-only rows
    // (`supported_in_api: false`) remain valid for this CLI lane.
    const models = uniqueModels(parsed.models.flatMap((value) => {
      const row = asRecord(value);
      if (row === null || row.visibility !== "list") return [];
      const modelId = row.slug;
      if (typeof modelId !== "string" || !isCanonicalModelId(modelId)) return [];
      return [{
        model_id: modelId,
        reasoning_efforts: codexReasoningEfforts(row.supported_reasoning_levels)
      }];
    }));
    return { ...cacheAge, models };
  } catch {
    return null;
  }
}

export function codexModelCacheAge(fetchedAt: string, now = new Date()): CodexModelCacheAge | null {
  const normalized = fetchedAt.replace(/(\.\d{3})\d+(?=Z$)/, "$1");
  const fetchedAtMs = Date.parse(normalized);
  const nowMs = now.getTime();
  const age = nowMs - fetchedAtMs;
  if (!Number.isFinite(fetchedAtMs) || !Number.isFinite(nowMs) || age < 0) return null;
  return {
    fetched_at: new Date(fetchedAtMs).toISOString(),
    freshness: age <= CODEX_MODEL_CACHE_TTL_MS ? "fresh" : "stale",
    age_ms: age
  };
}

function codexReasoningEfforts(value: unknown): readonly RunReasoningEffort[] {
  if (!Array.isArray(value)) return [];
  const advertised = new Set<RunReasoningEffort>();
  for (const candidate of value) {
    const row = asRecord(candidate);
    if (row === null || typeof row.effort !== "string") continue;
    if (RUN_REASONING_EFFORTS.includes(row.effort as RunReasoningEffort)) {
      advertised.add(row.effort as RunReasoningEffort);
    }
  }
  return RUN_REASONING_EFFORTS.filter((effort) => advertised.has(effort));
}

export async function discoverAgyModels(
  executable: string,
  runCommand: ProviderCommandRunner,
  signal: AbortSignal
): Promise<readonly DiscoveredProviderModel[]> {
  try {
    const result = await runBoundedCommand(executable, ["models"], runCommand, signal);
    if (
      result === null
      || (result.exitCode ?? 0) !== 0
      || Buffer.byteLength(result.stdout, "utf8") > MAX_DISCOVERY_BYTES
    ) return [];

    // Until VM verification, fail closed on decorated or unrecognized lines.
    const models = result.stdout.split(/\r?\n/).slice(0, 1_024).flatMap((line) => {
      const candidate = line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "").trim();
      const expanded = expandQuotaLabel("agy_cli", candidate);
      if (expanded.length > 0) {
        return expanded.filter(isCanonicalModelId).map((model_id) => ({ model_id }));
      }
      return isCanonicalModelId(candidate) ? [{ model_id: candidate }] : [];
    });
    return uniqueModels(models);
  } catch {
    return [];
  }
}

async function runBoundedCommand(
  executable: string,
  args: readonly string[],
  runCommand: ProviderCommandRunner,
  signal: AbortSignal
): Promise<ProviderCommandResult | null> {
  if (signal.aborted || executable.length === 0) return null;
  const controller = new AbortController();
  let resolveAbort: (() => void) | undefined;
  const aborted = new Promise<null>((resolve) => {
    resolveAbort = () => resolve(null);
  });
  const onAbort = () => {
    controller.abort();
    resolveAbort?.();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, COMMAND_TIMEOUT_MS);
  });
  try {
    const command = Promise.resolve()
      .then(() => runCommand({
        command: executable,
        args,
        signal: controller.signal,
        environment: sanitizedCommandEnvironment(process.env)
      }))
      .catch(() => null);
    return await Promise.race([command, timeout, aborted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

function sanitizedCommandEnvironment(environment: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  const sanitized: Record<string, string> = {};
  for (const key of COMMAND_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (value !== undefined) sanitized[key] = value;
  }
  return sanitized;
}

function uniqueModels(models: readonly DiscoveredProviderModel[]): readonly DiscoveredProviderModel[] {
  const seen = new Set<string>();
  return models.filter(({ model_id }) => {
    if (seen.has(model_id)) return false;
    seen.add(model_id);
    return true;
  }).slice(0, MAX_DISCOVERED_MODELS);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
