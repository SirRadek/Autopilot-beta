import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";

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
  signal: AbortSignal
) => Promise<TmuxCommandResult>;

const MAX_CAPTURE_BYTES = 128 * 1024;
const CLI: Readonly<Record<UsageProbeProvider, { readonly command: string; readonly slashCommand: "/status" | "/usage" }>> = {
  codex_cli: { command: "codex --no-alt-screen", slashCommand: "/status" },
  claude_cli: { command: "claude --ax-screen-reader", slashCommand: "/usage" },
  agy_cli: { command: "agy", slashCommand: "/usage" }
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
  const models = [
    text.match(/^([A-Za-z]+\s+\d+(?:\.\d+)?)\s+\([^\r\n]*context\)\s+·\s+Claude/im)?.[1],
    text.match(/Extended:\s+([A-Za-z]+\s+\d+(?:\.\d+)?)/i)?.[1]
  ].filter((value): value is string => value !== undefined);
  const seenModelIds = new Set<string>();
  const available = weeklyUsed < 100 && sessionUsed < 100;
  return {
    five_hour: usedPercentWindow(sessionUsed, session[2]!),
    weekly: usedPercentWindow(weeklyUsed, week[2]!),
    models: models.flatMap((label) => expandQuotaLabel("claude_cli", label)
      .map((model_id) => ({ model_id, available })))
      .filter((model) => (seenModelIds.has(model.model_id) ? false : (seenModelIds.add(model.model_id), true)))
  };
}

export async function runTmuxUsageProbe(
  provider: UsageProbeProvider,
  options: {
    readonly execute?: TmuxCommandExecutor;
    readonly timeoutMs?: number;
    readonly sessionId?: string;
    /** Test-only timing override; production probes use the bounded TUI readiness delays. */
    readonly delayMs?: number;
  } = {}
): Promise<TmuxCommandResult> {
  const execute = options.execute ?? executeTmux;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const sessionId = options.sessionId ?? `autopilot-quota-${randomBytes(6).toString("hex")}`;
  const delayMs = options.delayMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const target = `${sessionId}:0.0`;
  const spec = CLI[provider];
  try {
    await checked(execute, ["new-session", "-d", "-s", sessionId, "-x", "160", "-y", "50", "-c", process.cwd(), spec.command], controller.signal);
    await pause(delayMs ?? (provider === "agy_cli" ? 6_000 : 4_000), controller.signal);
    await checked(execute, ["send-keys", "-t", target, "-l", spec.slashCommand], controller.signal);
    await pause(delayMs ?? 250, controller.signal);
    await checked(execute, ["send-keys", "-t", target, "C-m"], controller.signal);
    await pause(delayMs ?? 4_000, controller.signal);
    const captured = await checked(execute, ["capture-pane", "-p", "-J", "-S", "-300", "-t", target], controller.signal);
    const stdout = Buffer.from(captured.stdout).subarray(0, MAX_CAPTURE_BYTES).toString("utf8");
    const parsed = provider === "codex_cli" ? parseCodexStatus(stdout) : provider === "agy_cli" ? parseAgyUsage(stdout) : parseClaudeUsage(stdout);
    if (parsed === null) {
      const missing = provider === "claude_cli" && /login|sign in|authentication/i.test(stdout);
      return { stdout: "", stderr: missing ? "missing_credential" : "malformed_response", exitCode: 1 };
    }
    return { stdout: JSON.stringify(parsed), stderr: "", exitCode: 0 };
  } catch (error) {
    return { stdout: "", stderr: controller.signal.aborted ? "timeout" : error instanceof Error ? error.message : "provider_unavailable", exitCode: 1 };
  } finally {
    clearTimeout(timer);
    const cleanup = new AbortController();
    const cleanupTimer = setTimeout(() => cleanup.abort(), 1_000);
    try { await execute("tmux", ["kill-session", "-t", sessionId], cleanup.signal); } catch { /* best-effort bounded cleanup */ }
    finally { clearTimeout(cleanupTimer); }
  }
}

async function checked(execute: TmuxCommandExecutor, args: readonly string[], signal: AbortSignal): Promise<TmuxCommandResult> {
  const result = await execute("tmux", args, signal);
  if (result.exitCode !== 0) throw new Error(result.stderr || "provider_unavailable");
  return result;
}

function executeTmux(command: "tmux", args: readonly string[], signal: AbortSignal): Promise<TmuxCommandResult> {
  return new Promise((resolve) => {
    execFile(command, [...args], { encoding: "utf8", maxBuffer: MAX_CAPTURE_BYTES, signal }, (error, stdout, stderr) => {
      const code = (error as NodeJS.ErrnoException & { code?: number })?.code;
      resolve({ stdout: stdout ?? "", stderr: stderr ?? (error?.message ?? ""), exitCode: typeof code === "number" ? code : error ? 1 : 0 });
    });
  });
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
  const result = await runTmuxUsageProbe(provider);
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.exitCode;
}
