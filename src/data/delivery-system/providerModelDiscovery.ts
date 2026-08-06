import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ProviderCommandResult, ProviderCommandRunner } from "./providerQuotaAdapters";
import { expandQuotaLabel, isCanonicalModelId } from "./providerModelId";

const COMMAND_TIMEOUT_MS = 5_000;
const MAX_DISCOVERY_BYTES = 256 * 1024;
const MAX_DISCOVERED_MODELS = 256;
const COMMAND_ENVIRONMENT_KEYS = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TERM", "TMPDIR"] as const;

// Phase 3 must verify both the ~/.codex/models_cache.json shape and the `agy models`
// output format on the production VM; these parsers intentionally fail closed until then.

export interface DiscoveredProviderModel {
  readonly model_id: string;
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

export function discoverCodexModels(homeDir: string): readonly DiscoveredProviderModel[] {
  try {
    const path = join(homeDir, ".codex", "models_cache.json");
    const metadata = statSync(path);
    if (!metadata.isFile() || metadata.size > MAX_DISCOVERY_BYTES) return [];
    const contents = readFileSync(path, "utf8");
    if (Buffer.byteLength(contents, "utf8") > MAX_DISCOVERY_BYTES) return [];
    const parsed = asRecord(JSON.parse(contents));
    if (parsed === null || !Array.isArray(parsed.models)) return [];

    // Until VM verification, accept only bounded canonical identifiers from known fields.
    return uniqueModels(parsed.models.flatMap((value) => {
      if (typeof value === "string") return isCanonicalModelId(value) ? [{ model_id: value }] : [];
      const row = asRecord(value);
      if (row === null) return [];
      const modelId = [row.slug, row.model_id, row.id].find((candidate): candidate is string => typeof candidate === "string");
      return modelId !== undefined && isCanonicalModelId(modelId) ? [{ model_id: modelId }] : [];
    }));
  } catch {
    return [];
  }
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
