import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  normalizeProviderError,
  type ProviderErrorCode,
  type ProviderProbeFailure,
  type ProviderProbeFailurePhase
} from "./providerQuota";
import { resolveProviderCliRuntime } from "./providerCliRuntime";
import { expandQuotaLabel, isCanonicalModelId } from "./providerModelId";

export type UsageProbeProvider = "codex_cli" | "claude_cli" | "agy_cli";

export interface ParsedUsage {
  readonly five_hour: { readonly limit: number | null; readonly used: number | null; readonly remaining: number | null; readonly resets_at: string | null };
  readonly weekly: { readonly limit: number | null; readonly used: number | null; readonly remaining: number | null; readonly resets_at: string | null };
  readonly models: readonly { readonly model_id: string; readonly available: boolean }[];
}

export interface TmuxCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly probe_failure?: ProviderProbeFailure;
}

type SpecificProviderErrorCode = Exclude<ProviderErrorCode, "provider_error">;

export type TmuxCommandExecutor = (
  command: "tmux",
  args: readonly string[],
  signal: AbortSignal,
  environment: Readonly<Record<string, string>>
) => Promise<TmuxCommandResult>;

const MAX_CAPTURE_BYTES = 128 * 1024;
const CLEANUP_TIMEOUT_MS = 1_000;
const CODEX_READY_CAPTURE_ATTEMPTS = 25;
const CODEX_COMMAND_CAPTURE_ATTEMPTS = 25;
// The status panel renders ~0.3 s after an Enter that lands, so a short window per submission
// attempt detects success quickly and hands the remaining budget to the next attempt.
const CODEX_STATUS_CAPTURE_ATTEMPTS = 8;
const CODEX_SUBMIT_ATTEMPTS = 4;
const CODEX_SUBMIT_SETTLE_MS = 500;
// `classified` separates "the panel answered" (final, whatever it said) from "the panel never
// rendered" (a lost submission worth retrying).
interface CodexStatusOutcome {
  readonly result: TmuxCommandResult;
  readonly classified: boolean;
}
const CODEX_CAPTURE_INTERVAL_MS = 250;
const PROBE_ENVIRONMENT_KEYS = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TERM", "TMPDIR"] as const;
const CLI: Readonly<Record<UsageProbeProvider, { readonly args: readonly string[]; readonly slashCommand: "/status" | "/usage" }>> = {
  codex_cli: { args: ["--no-alt-screen"], slashCommand: "/status" },
  claude_cli: { args: ["--ax-screen-reader"], slashCommand: "/usage" },
  agy_cli: { args: [], slashCommand: "/usage" }
};

export function parseCodexStatus(raw: string): ParsedUsage | null {
  const text = terminalText(raw);
  if (codexStatusFailure(text) !== null) return null;
  const five = text.match(/^\s*(?:[│|]\s*)?5h\s+limit:[^\r\n%]*?([0-9]+(?:\.[0-9]+)?)%\s+left(?:\s*\(resets\s+([^\r\n)]+)\))?/im);
  const week = text.match(/^\s*(?:[│|]\s*)?weekly\s+limit:[^\r\n%]*?([0-9]+(?:\.[0-9]+)?)%\s+left(?:\s*\(resets\s+([^\r\n)]+)\))?/im);
  const namedModels = [...text.matchAll(/^\s*(?:[│|]\s*)?([A-Za-z][A-Za-z0-9.-]*)\s+Weekly limit:[^\r\n%]*?([0-9]+(?:\.[0-9]+)?)%\s+left(?:\s*\(resets\s+([^\r\n)]+)\))?/gim)];
  const alternativeWindows = [...text.matchAll(/^\s*(?:[│|]\s*)?(?:(?:primary|secondary)\s+)?(?:usage|monthly(?:\s+credit)?|daily|annual)\s+limit:[^\r\n%]*?([0-9]+(?:\.[0-9]+)?)%\s+left/gim)];
  if (!five && !week && namedModels.length === 0 && alternativeWindows.length === 0) return null;
  const five_hour = five
    ? percentWindow(five[1]!, five[2] ?? null)
    : unknownWindow();
  const weekly = week
    ? percentWindow(week[1]!, week[2] ?? null)
    : unknownWindow();
  const activeModel = text.match(/Model:\s*([^\r\n(]+?)\s*\(/i)?.[1]?.trim();
  const activeNamedRow = activeModel
    ? namedModels.find((match) => match[1]?.toLowerCase() === activeModel.toLowerCase())
    : undefined;
  const activePercents = [
    five?.[1],
    activeNamedRow?.[2] ?? week?.[1],
    ...(five === null && week === null ? alternativeWindows.map((match) => match[1]) : [])
  ].filter((value): value is string => value !== undefined);
  const seenModelIds = new Set<string>();
  const models = [
    ...(activeModel && activePercents.length > 0
      ? [{ model_id: activeModel, available: activePercents.every((percent) => boundedPercent(percent) > 0) }]
      : []),
    ...namedModels.map((match) => ({
      model_id: match[1]!,
      available: boundedPercent(match[2]!) > 0 && (five === null || boundedPercent(five[1]!) > 0)
    }))
  ].filter((model) => isCanonicalModelId(model.model_id))
    .filter((model) => (seenModelIds.has(model.model_id) ? false : (seenModelIds.add(model.model_id), true)));
  return { five_hour, weekly, models };
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
  // Four submission attempts plus the launch wait need more headroom than the previous 20 s,
  // which aborted mid-retry and surfaced as malformed_response.
  const timeoutMs = options.timeoutMs ?? 45_000;
  const sessionId = options.sessionId ?? `autopilot-quota-${randomBytes(6).toString("hex")}`;
  const delayMs = options.delayMs;
  const environment = sanitizedProbeEnvironment(process.env);
  let workingDirectory: string;
  try {
    workingDirectory = await mkdtemp(join(options.runtimeRoot ?? tmpdir(), "autopilot-provider-probe-"));
  } catch {
    return failureResult("provider_runtime_denied", { phase: "launch" });
  }
  const socketPath = join(workingDirectory, "tmux.sock");

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const target = `${sessionId}:0.0`;
  const spec = CLI[provider];
  let result: TmuxCommandResult;
  let fallbackErrorCode: SpecificProviderErrorCode = "provider_unavailable";
  let activeFailure: ProviderProbeFailure = { phase: "launch" };
  const recordFailure = (phase: ProviderProbeFailurePhase, attempts?: number): ProviderProbeFailure => {
    activeFailure = { phase, ...(attempts === undefined ? {} : { attempts }) };
    return activeFailure;
  };
  try {
    if (controller.signal.aborted) throw new Error("timeout");
    if (options.executable.length === 0) throw new Error("provider_executable_missing");
    await checked(execute, withSocket(socketPath, [
      "new-session",
      "-d",
      "-s", sessionId,
      "-x", "160",
      "-y", "50",
      ...sessionEnvironmentArguments(environment),
      "-c", workingDirectory,
      options.executable,
      ...probeCliArguments(provider, spec.args, workingDirectory)
    ]), controller.signal, environment, "provider_unavailable");
    fallbackErrorCode = "malformed_response";
    if (provider === "codex_cli") {
      recordFailure("readiness");
      const ready = await waitForCodexComposer(
        execute,
        socketPath,
        target,
        controller.signal,
        environment,
        delayMs
      );
      if (!ready) {
        result = failureResult("malformed_response", recordFailure("readiness", CODEX_READY_CAPTURE_ATTEMPTS));
      } else {
        result = await submitCodexStatusCommand(
          execute,
          socketPath,
          target,
          spec.slashCommand,
          controller.signal,
          environment,
          delayMs,
          recordFailure
        );
      }
    } else {
      recordFailure("readiness");
      await pause(delayMs ?? (provider === "agy_cli" ? 6_000 : 4_000), controller.signal);
      recordFailure("echo");
      await checked(
        execute,
        withSocket(socketPath, ["send-keys", "-t", target, "-l", spec.slashCommand]),
        controller.signal,
        environment,
        "malformed_response"
      );
      await pause(delayMs ?? 250, controller.signal);
      recordFailure("render");
      await checked(
        execute,
        withSocket(socketPath, ["send-keys", "-t", target, "C-m"]),
        controller.signal,
        environment,
        "malformed_response"
      );
      await pause(delayMs ?? 4_000, controller.signal);
      const stdout = await capturePane(execute, socketPath, target, controller.signal, environment);
      const parsed = provider === "agy_cli" ? parseAgyUsage(stdout) : parseClaudeUsage(stdout);
      if (parsed === null) {
        const missing = provider === "claude_cli" && /login|sign in|authentication/i.test(stdout);
        result = failureResult(missing ? "missing_credential" : "malformed_response", activeFailure);
      } else {
        result = { stdout: JSON.stringify(parsed), stderr: "", exitCode: 0 };
      }
    }
  } catch (error) {
    const normalized = normalizeProviderError(error);
    const errorCode = controller.signal.aborted
      ? "timeout"
      : normalized === "provider_error" ? fallbackErrorCode : normalized;
    result = failureResult(errorCode, activeFailure);
  }

  clearTimeout(timer);
  options.signal?.removeEventListener("abort", onExternalAbort);
  const serverTerminated = await terminateAndVerifyServer(execute, socketPath, environment);
  let workingDirectoryRemoved = false;
  // The socket is inside this directory; keep it reachable if the server may still be alive.
  if (serverTerminated) {
    try {
      await rm(workingDirectory, { recursive: true, force: true });
      workingDirectoryRemoved = true;
    } catch {
      // A private runtime artifact is safer than claiming cleanup succeeded.
    }
  }
  return serverTerminated && workingDirectoryRemoved
    ? result
    : failureResult("provider_runtime_denied", { phase: "cleanup" });
}

function probeCliArguments(
  provider: UsageProbeProvider,
  baseArguments: readonly string[],
  workingDirectory: string
): readonly string[] {
  if (provider !== "codex_cli") return baseArguments;
  // Codex otherwise blocks on a trust prompt for every fresh probe directory and tries to
  // persist that decision under HOME. Mark only this empty, mode-0700 directory untrusted for
  // the invocation so project-local config/hooks stay disabled and no trust state is written.
  // Its mandatory SQLite stores also default to HOME, which is read-only in the service. Keep
  // them beside the private socket so they remain writable and are removed with the probe.
  const projectOverride = `projects={${JSON.stringify(workingDirectory)}={trust_level="untrusted"}}`;
  const sqliteOverride = `sqlite_home=${JSON.stringify(workingDirectory)}`;
  return [...baseArguments, "-c", projectOverride, "-c", sqliteOverride];
}

async function waitForCodexComposer(
  execute: TmuxCommandExecutor,
  socketPath: string,
  target: string,
  signal: AbortSignal,
  environment: Readonly<Record<string, string>>,
  delayMs: number | undefined
): Promise<boolean> {
  for (let attempt = 0; attempt < CODEX_READY_CAPTURE_ATTEMPTS; attempt += 1) {
    const stdout = await capturePane(execute, socketPath, target, signal, environment);
    if (codexComposerReady(stdout)) return true;
    if (attempt + 1 < CODEX_READY_CAPTURE_ATTEMPTS) {
      await pause(delayMs ?? CODEX_CAPTURE_INTERVAL_MS, signal);
    }
  }
  return false;
}

async function waitForCodexStatus(
  execute: TmuxCommandExecutor,
  socketPath: string,
  target: string,
  signal: AbortSignal,
  environment: Readonly<Record<string, string>>,
  delayMs: number | undefined
): Promise<CodexStatusOutcome> {
  for (let attempt = 0; attempt < CODEX_STATUS_CAPTURE_ATTEMPTS; attempt += 1) {
    const stdout = await capturePane(execute, socketPath, target, signal, environment);
    const parsed = parseCodexStatus(stdout);
    if (parsed !== null) {
      return { result: { stdout: JSON.stringify(parsed), stderr: "", exitCode: 0 }, classified: true };
    }
    // The panel rendered and states why usage is unavailable. That is an answer, not a lost
    // submission, so it must be reported as-is instead of being retried.
    const failure = codexStatusFailure(terminalText(stdout));
    if (failure !== null) return { result: failureResult(failure), classified: true };
    if (attempt + 1 < CODEX_STATUS_CAPTURE_ATTEMPTS) {
      await pause(delayMs ?? CODEX_CAPTURE_INTERVAL_MS, signal);
    }
  }
  return { result: failureResult("malformed_response"), classified: false };
}

// Measured against the installed CLI: the composer paints `› /status` within ~0.3 s of the
// keystrokes, but Codex only starts acting on submissions a little later, so an Enter that
// follows the echo immediately clears the composer without opening the status panel. A fixed
// settle tuned on one machine would be a guess, so this instead retries the whole submission
// and re-reads the pane, which converged on the first attempt in every measured run.
async function submitCodexStatusCommand(
  execute: TmuxCommandExecutor,
  socketPath: string,
  target: string,
  slashCommand: string,
  signal: AbortSignal,
  environment: Readonly<Record<string, string>>,
  delayMs: number | undefined,
  recordFailure: (phase: ProviderProbeFailurePhase, attempts?: number) => ProviderProbeFailure
): Promise<TmuxCommandResult> {
  let lastFailure: TmuxCommandResult = failureResult("malformed_response", { phase: "echo", attempts: 1 });
  for (let attempt = 0; attempt < CODEX_SUBMIT_ATTEMPTS; attempt += 1) {
    const attempts = attempt + 1;
    const echoFailure = recordFailure("echo", attempts);
    // Retyping over a composer that still holds the command would submit `/status/status`.
    // Only type when the previous attempt's Enter emptied it.
    const before = await capturePane(execute, socketPath, target, signal, environment);
    if (!codexComposerContains(before, slashCommand)) {
      await checked(
        execute,
        withSocket(socketPath, ["send-keys", "-t", target, "-l", slashCommand]),
        signal,
        environment,
        "malformed_response"
      );
      const echoed = await waitForCodexComposerCommand(
        execute,
        socketPath,
        target,
        slashCommand,
        signal,
        environment,
        delayMs
      );
      if (!echoed) {
        lastFailure = failureResult("malformed_response", echoFailure);
        continue;
      }
    }
    const renderFailure = recordFailure("render", attempts);
    await pause(delayMs ?? CODEX_SUBMIT_SETTLE_MS, signal);
    await checked(
      execute,
      withSocket(socketPath, ["send-keys", "-t", target, "Enter"]),
      signal,
      environment,
      "malformed_response"
    );
    const outcome = await waitForCodexStatus(
      execute,
      socketPath,
      target,
      signal,
      environment,
      delayMs
    );
    // Retry only when the panel never rendered. A classified outcome — parsed usage, or a
    // panel that states usage is unavailable — is final and must not be resubmitted.
    if (outcome.classified) {
      return outcome.result.exitCode === 0
        ? outcome.result
        : { ...outcome.result, probe_failure: renderFailure };
    }
    lastFailure = failureResult("malformed_response", renderFailure);
  }
  return lastFailure;
}

async function waitForCodexComposerCommand(
  execute: TmuxCommandExecutor,
  socketPath: string,
  target: string,
  slashCommand: string,
  signal: AbortSignal,
  environment: Readonly<Record<string, string>>,
  delayMs: number | undefined
): Promise<boolean> {
  for (let attempt = 0; attempt < CODEX_COMMAND_CAPTURE_ATTEMPTS; attempt += 1) {
    const stdout = await capturePane(execute, socketPath, target, signal, environment);
    if (codexComposerContains(stdout, slashCommand)) return true;
    if (attempt + 1 < CODEX_COMMAND_CAPTURE_ATTEMPTS) {
      await pause(delayMs ?? CODEX_CAPTURE_INTERVAL_MS, signal);
    }
  }
  return false;
}

async function capturePane(
  execute: TmuxCommandExecutor,
  socketPath: string,
  target: string,
  signal: AbortSignal,
  environment: Readonly<Record<string, string>>
): Promise<string> {
  const captured = await checked(
    execute,
    withSocket(socketPath, ["capture-pane", "-p", "-J", "-S", "-300", "-t", target]),
    signal,
    environment,
    "malformed_response"
  );
  return Buffer.from(captured.stdout).subarray(0, MAX_CAPTURE_BYTES).toString("utf8");
}

function codexComposerReady(raw: string): boolean {
  const text = terminalText(raw);
  if (/Do you trust the contents of this directory|Press enter to continue/i.test(text)) return false;
  if (parseCodexStatus(text) !== null || codexStatusFailure(text) !== null) return true;
  return />_\s+OpenAI Codex\s+\(v[^\r\n)]+\)/i.test(text) && /^\s*›(?:\s|$)/m.test(text);
}

function codexComposerContains(raw: string, slashCommand: string): boolean {
  return terminalText(raw).split("\n").some((line) => line.trim() === `› ${slashCommand}`);
}

async function checked(
  execute: TmuxCommandExecutor,
  args: readonly string[],
  signal: AbortSignal,
  environment: Readonly<Record<string, string>>,
  fallbackErrorCode: SpecificProviderErrorCode
): Promise<TmuxCommandResult> {
  // The signal-aware executor settles only after its tmux client has exited. Await that
  // acknowledgement before cleanup so a late new-session cannot recreate the isolated server.
  const result = await execute("tmux", args, signal, environment);
  if (result.exitCode !== 0) {
    const normalized = normalizeProviderError(result.stderr || "provider_unavailable");
    throw new Error(normalized === "provider_error" ? fallbackErrorCode : normalized);
  }
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
  socketPath: string,
  environment: Readonly<Record<string, string>>
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLEANUP_TIMEOUT_MS);
  try {
    try {
      await abortable(execute("tmux", withSocket(socketPath, ["kill-server"]), controller.signal, environment), controller.signal);
    } catch {
      // Verification below is authoritative: kill-server may fail because no server remains.
    }
    if (controller.signal.aborted) return false;
    try {
      const verification = await abortable(
        execute("tmux", withSocket(socketPath, ["has-session"]), controller.signal, environment),
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
  return /^(?:(?:tmux:\s*)?no server(?: running)?(?:\s|$)|(?:failed to connect|error connecting to)[^\r\n]*(?:no such file|connection refused))/i.test(result.stderr);
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

function withSocket(socketPath: string, args: readonly string[]): string[] {
  return ["-S", socketPath, ...args];
}

function failureResult(errorCode: ProviderErrorCode, probeFailure?: ProviderProbeFailure): TmuxCommandResult {
  return {
    stdout: "",
    stderr: errorCode,
    exitCode: 1,
    ...(probeFailure === undefined ? {} : { probe_failure: probeFailure })
  };
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

function unknownWindow() {
  return { limit: null, used: null, remaining: null, resets_at: null };
}

function codexStatusFailure(text: string): ProviderErrorCode | null {
  return /limits may be stale/i.test(text)
    || /Limits:\s*(?:not available for this account|data not available yet)/i.test(text)
    || /refresh requested;\s*run \/status again shortly/i.test(text)
    ? "provider_unavailable"
    : null;
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
