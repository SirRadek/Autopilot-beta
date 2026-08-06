import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeProviderError, type ProviderErrorCode } from "./providerQuota";
import { resolveProviderCliRuntime } from "./providerCliRuntime";
import { expandQuotaLabel, isCanonicalModelId } from "./providerModelId";

export type UsageProbeProvider = "codex_cli" | "claude_cli" | "agy_cli";

export interface ParsedUsage {
  readonly five_hour: { readonly limit: number | null; readonly used: number | null; readonly remaining: number | null; readonly resets_at: string | null };
  readonly weekly: { readonly limit: number; readonly used: number; readonly remaining: number; readonly resets_at: string | null };
  readonly models: readonly { readonly model_id: string; readonly available: boolean }[];
}

export interface TmuxCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type TmuxCommandExecutor = (
  command: "tmux",
  args: readonly string[],
  signal: AbortSignal,
  environment: Readonly<Record<string, string>>
) => Promise<TmuxCommandResult>;

const MAX_CAPTURE_BYTES = 128 * 1024;
const CLEANUP_TIMEOUT_MS = 1_000;
const PROBE_ENVIRONMENT_KEYS = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TERM", "TMPDIR"] as const;
const CLI: Readonly<Record<UsageProbeProvider, { readonly args: readonly string[]; readonly slashCommand: "/status" | "/usage" }>> = {
  codex_cli: { args: ["--no-alt-screen"], slashCommand: "/status" },
  claude_cli: { args: ["--ax-screen-reader"], slashCommand: "/usage" },
  agy_cli: { args: [], slashCommand: "/usage" }
};

export function parseCodexStatus(raw: string): ParsedUsage | null {
  const text = terminalText(raw);
  const five = text.match(/5h\s+limit:[^\r\n%]*?([0-9]+(?:\.[0-9]+)?)%\s+left\s*\(resets\s+([^\r\n)]+)\)/i);
  const week = text.match(/weekly\s+limit:[^\r\n%]*?([0-9]+(?:\.[0-9]+)?)%\s+left\s*\(resets\s+([^\r\n)]+)\)/i);
  if (!week) return null;
  const five_hour = five
    ? percentWindow(five[1]!, five[2]!)
    : { limit: null, used: null, remaining: null, resets_at: null };
  const activeModel = text.match(/Model:\s*([^\r\n(]+?)\s*\(/i)?.[1];
  const namedModels = [...text.matchAll(/^(?:\s*\S\s+)?([A-Za-z][A-Za-z0-9.-]*)(?:\r?\n\s*|\s+)Weekly limit:[^\r\n%]*?([0-9]+(?:\.[0-9]+)?)%\s+left/gim)];
  const activeNamedRow = activeModel ? namedModels.find((match) => match[1] === activeModel) : undefined;
  const activeWeeklyPercent = activeNamedRow ? activeNamedRow[2]! : week[1]!;
  const seenModelIds = new Set<string>();
  const models = [
    ...(activeModel ? [{ model_id: activeModel, available: boundedPercent(activeWeeklyPercent) > 0 }] : []),
    ...namedModels.map((match) => ({ model_id: match[1]!, available: boundedPercent(match[2]!) > 0 }))
  ].filter((model) => isCanonicalModelId(model.model_id))
    .filter((model) => (seenModelIds.has(model.model_id) ? false : (seenModelIds.add(model.model_id), true)));
  return { five_hour, weekly: percentWindow(week[1]!, week[2]!), models };
}

export function parseAgyUsage(raw: string): ParsedUsage | null {
  const text = terminalText(raw);
  const headings = ["GEMINI MODELS", "CLAUDE AND GPT MODELS"] as const;
  const groups = headings.flatMap((heading, index) => {
    const start = text.indexOf(heading);
    if (start < 0) return [];
    const next = index + 1 < headings.length ? text.indexOf(headings[index + 1]!, start + heading.length) : -1;
    const section = text.slice(start, next < 0 ? undefined : next);
    const models = section.match(/Models within this group:\s*([^\r\n]+)/i)?.[1]
      ?.split(",").map((model) => model.trim()).filter(Boolean) ?? [];
    const weekly = section.match(/Weekly Limit[\s\S]*?([0-9]+(?:\.[0-9]+)?)%/i)?.[1];
    const five = section.match(/Five Hour Limit[\s\S]*?([0-9]+(?:\.[0-9]+)?)%/i)?.[1];
    if (weekly === undefined || five === undefined || models.length === 0) return [];
    return [{ models, weekly: boundedPercent(weekly), five: boundedPercent(five) }];
  });
  if (groups.length !== headings.length) return null;
  const weekly = Math.min(...groups.map((group) => group.weekly));
  const five = Math.min(...groups.map((group) => group.five));
  const modelAvailability = new Map<string, boolean>();
  for (const group of groups) {
    const available = group.weekly > 0 && group.five > 0;
    for (const label of group.models) {
      for (const modelId of expandQuotaLabel("agy_cli", label)) {
        modelAvailability.set(modelId, (modelAvailability.get(modelId) ?? true) && available);
      }
    }
  }
  return {
    five_hour: percentWindow(String(five), null),
    weekly: percentWindow(String(weekly), null),
    models: [...modelAvailability].map(([model_id, available]) => ({ model_id, available }))
      .slice(0, 256)
  };
}

export function parseClaudeUsage(raw: string): ParsedUsage | null {
  const text = terminalText(raw);
  const session = text.match(/Current session[\s\S]*?([0-9]+(?:\.[0-9]+)?)%\s+used\s+Resets\s+([^\r\n]+)/i);
  const week = text.match(/Current week \(all models\)[\s\S]*?([0-9]+(?:\.[0-9]+)?)%\s+used\s+Resets\s+([^\r\n]+)/i);
  if (!session || !week) return null;
  const sessionUsed = boundedPercent(session[1]!);
  const weeklyUsed = boundedPercent(week[1]!);
  const sharedAvailable = weeklyUsed < 100 && sessionUsed < 100;
  // The screen-reader /usage screen names models in three places: the header model line
  // ("Opus 4.8 (1M context) · Claude Max"), the extended-limit banner ("Extended: Fable 5 is
  // included in your weekly limit"), and per-family sections ("Current week (Fable)") that
  // carry that family's own weekly percentage on top of the all-models window.
  const labelled = [
    ...[
      text.match(/^([A-Za-z]+\s+\d+(?:\.\d+)?)\s+\([^\r\n]*context\)\s+·\s+Claude/im)?.[1],
      text.match(/Extended:\s+([A-Za-z]+\s+\d+(?:\.\d+)?)/i)?.[1]
    ].filter((label): label is string => label !== undefined)
      .map((label) => ({ label, available: sharedAvailable })),
    ...[...text.matchAll(/Current week \((?!all models\))([A-Za-z][A-Za-z0-9 .-]{0,40})\)[\s\S]*?([0-9]+(?:\.[0-9]+)?)%\s+used/gi)]
      .slice(0, 32)
      .map((match) => ({ label: match[1]!.trim(), available: sharedAvailable && boundedPercent(match[2]!) < 100 }))
  ];
  const modelAvailability = new Map<string, boolean>();
  for (const { label, available } of labelled) {
    for (const model_id of expandQuotaLabel("claude_cli", label)) {
      modelAvailability.set(model_id, (modelAvailability.get(model_id) ?? true) && available);
    }
  }
  return {
    five_hour: usedPercentWindow(sessionUsed, session[2]!),
    weekly: usedPercentWindow(weeklyUsed, week[2]!),
    models: [...modelAvailability].map(([model_id, available]) => ({ model_id, available })).slice(0, 256)
  };
}

export async function runTmuxUsageProbe(
  provider: UsageProbeProvider,
  options: {
    readonly executable: string;
    readonly execute?: TmuxCommandExecutor;
    readonly timeoutMs?: number;
    readonly sessionId?: string;
    readonly signal?: AbortSignal;
    readonly runtimeRoot?: string;
    /** Test-only timing override; production probes use the bounded TUI readiness delays. */
    readonly delayMs?: number;
  }
): Promise<TmuxCommandResult> {
  const execute = options.execute ?? executeTmux;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const sessionId = options.sessionId ?? `autopilot-quota-${randomBytes(6).toString("hex")}`;
  const delayMs = options.delayMs;
  const socketName = `autopilot-probe-${sessionId}`;
  const environment = sanitizedProbeEnvironment(process.env);
  let workingDirectory: string;
  try {
    workingDirectory = await mkdtemp(join(options.runtimeRoot ?? tmpdir(), "autopilot-provider-probe-"));
  } catch {
    return failureResult("provider_runtime_denied");
  }

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const target = `${sessionId}:0.0`;
  const spec = CLI[provider];
  let result: TmuxCommandResult;
  try {
    if (controller.signal.aborted) throw new Error("timeout");
    if (options.executable.length === 0) throw new Error("provider_executable_missing");
    await checked(execute, withSocket(socketName, [
      "new-session",
      "-d",
      "-s", sessionId,
      "-x", "160",
      "-y", "50",
      ...sessionEnvironmentArguments(environment),
      "-c", workingDirectory,
      options.executable,
      ...spec.args
    ]), controller.signal, environment);
    await pause(delayMs ?? (provider === "agy_cli" ? 6_000 : 4_000), controller.signal);
    await checked(execute, withSocket(socketName, ["send-keys", "-t", target, "-l", spec.slashCommand]), controller.signal, environment);
    await pause(delayMs ?? 250, controller.signal);
    await checked(execute, withSocket(socketName, ["send-keys", "-t", target, "C-m"]), controller.signal, environment);
    await pause(delayMs ?? 4_000, controller.signal);
    const captured = await checked(execute, withSocket(socketName, ["capture-pane", "-p", "-J", "-S", "-300", "-t", target]), controller.signal, environment);
    const stdout = Buffer.from(captured.stdout).subarray(0, MAX_CAPTURE_BYTES).toString("utf8");
    const parsed = provider === "codex_cli" ? parseCodexStatus(stdout) : provider === "agy_cli" ? parseAgyUsage(stdout) : parseClaudeUsage(stdout);
    if (parsed === null) {
      const missing = provider === "claude_cli" && /login|sign in|authentication/i.test(stdout);
      result = failureResult(missing ? "missing_credential" : "malformed_response");
    } else {
      result = { stdout: JSON.stringify(parsed), stderr: "", exitCode: 0 };
    }
  } catch (error) {
    result = failureResult(controller.signal.aborted ? "timeout" : normalizeProviderError(error));
  }

  clearTimeout(timer);
  options.signal?.removeEventListener("abort", onExternalAbort);
  const serverTerminated = await terminateAndVerifyServer(execute, socketName, environment);
  let workingDirectoryRemoved = true;
  try {
    await rm(workingDirectory, { recursive: true, force: true });
  } catch {
    workingDirectoryRemoved = false;
  }
  return serverTerminated && workingDirectoryRemoved
    ? result
    : failureResult("provider_runtime_denied");
}

async function checked(
  execute: TmuxCommandExecutor,
  args: readonly string[],
  signal: AbortSignal,
  environment: Readonly<Record<string, string>>
): Promise<TmuxCommandResult> {
  // The signal-aware executor settles only after its tmux client has exited. Await that
  // acknowledgement before cleanup so a late new-session cannot recreate the isolated server.
  const result = await execute("tmux", args, signal, environment);
  if (result.exitCode !== 0) throw new Error(normalizeProviderError(result.stderr || "provider_unavailable"));
  return result;
}

function executeTmux(
  command: "tmux",
  args: readonly string[],
  signal: AbortSignal,
  environment: Readonly<Record<string, string>>
): Promise<TmuxCommandResult> {
  return new Promise((resolve) => {
    execFile(command, [...args], { encoding: "utf8", env: { ...environment }, maxBuffer: MAX_CAPTURE_BYTES, signal }, (error, stdout, stderr) => {
      const code = (error as NodeJS.ErrnoException & { code?: number })?.code;
      resolve({ stdout: stdout ?? "", stderr: stderr ?? (error?.message ?? ""), exitCode: typeof code === "number" ? code : error ? 1 : 0 });
    });
  });
}

async function terminateAndVerifyServer(
  execute: TmuxCommandExecutor,
  socketName: string,
  environment: Readonly<Record<string, string>>
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLEANUP_TIMEOUT_MS);
  try {
    try {
      await abortable(execute("tmux", withSocket(socketName, ["kill-server"]), controller.signal, environment), controller.signal);
    } catch {
      // Verification below is authoritative: kill-server may fail because no server remains.
    }
    if (controller.signal.aborted) return false;
    try {
      const verification = await abortable(
        execute("tmux", withSocket(socketName, ["has-session"]), controller.signal, environment),
        controller.signal
      );
      return !controller.signal.aborted && isExpectedAbsentServer(verification);
    } catch {
      return false;
    }
  } finally {
    clearTimeout(timer);
  }
}

function isExpectedAbsentServer(result: TmuxCommandResult): boolean {
  if (result.exitCode === 0) return false;
  return /^(?:(?:tmux:\s*)?no server(?: running)?(?:\s|$)|failed to connect[^\r\n]*(?:no such file|connection refused))/i.test(result.stderr);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("timeout"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function sanitizedProbeEnvironment(environment: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  const sanitized: Record<string, string> = {};
  for (const key of PROBE_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (value !== undefined) sanitized[key] = value;
  }
  return sanitized;
}

function sessionEnvironmentArguments(environment: Readonly<Record<string, string>>): string[] {
  return PROBE_ENVIRONMENT_KEYS.flatMap((key) => environment[key] === undefined ? [] : ["-e", `${key}=${environment[key]}`]);
}

function withSocket(socketName: string, args: readonly string[]): string[] {
  return ["-L", socketName, ...args];
}

function failureResult(errorCode: ProviderErrorCode): TmuxCommandResult {
  return { stdout: "", stderr: errorCode, exitCode: 1 };
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("timeout"));
    const timer = setTimeout(done, milliseconds);
    const abort = () => { clearTimeout(timer); reject(new Error("timeout")); };
    function done() { signal.removeEventListener("abort", abort); resolve(); }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function terminalText(raw: string): string {
  return raw.slice(0, MAX_CAPTURE_BYTES).replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "").replace(/\r/g, "");
}

function boundedPercent(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}

function percentWindow(value: string, resetsAt: string | null) {
  const remaining = boundedPercent(value);
  return { limit: 100, used: 100 - remaining, remaining, resets_at: resetsAt?.trim().slice(0, 200) ?? null };
}

function usedPercentWindow(used: number, resetsAt: string | null) {
  return { limit: 100, used, remaining: 100 - used, resets_at: resetsAt?.trim().slice(0, 200) ?? null };
}

if (process.argv[1]?.endsWith("providerUsageProbe.ts")) {
  const provider = process.argv[2];
  if (provider !== "codex_cli" && provider !== "claude_cli" && provider !== "agy_cli") {
    throw new Error("usage: providerUsageProbe.ts codex_cli|claude_cli|agy_cli");
  }
  const runtime = resolveProviderCliRuntime(provider);
  const result = runtime.status === "available"
    ? await runTmuxUsageProbe(provider, { executable: runtime.executable })
    : failureResult(runtime.error_code);
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.exitCode;
}
