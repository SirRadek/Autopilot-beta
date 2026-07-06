import { execSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { platform } from "node:process";

import { contextWidthSpecs } from "./tokenEfficiency";

// ─── ANSI stripping ───────────────────────────────────────────────────────────

/**
 * Strips ANSI/VT100 escape sequences from raw PTY output.
 * Handles: CSI (color, cursor, private mode), OSC (window title), lone ESC.
 */
export function stripAnsi(raw: string): string {
  return raw
    .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "") // CSI sequences
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC with BEL or ST
    .replace(/\x1b\][^\r\n]*/g, "") // OSC without terminator (trailing)
    .replace(/\x1b[@-Z\\-_]/g, "") // 2-char ESC sequences
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

// ─── JSON extraction ──────────────────────────────────────────────────────────

/**
 * Extracts the first JSON object or array from clean (ANSI-stripped) PTY output.
 * Handles markdown code fences. Returns null if no JSON found.
 */
export function extractJsonFromPtyOutput(clean: string): unknown {
  // strip markdown code fences
  const stripped = clean.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");

  // find first { ... } or [ ... ] block
  for (const pattern of [/\{[\s\S]*?\}/g, /\[[\s\S]*?\]/g]) {
    const candidates = stripped.match(pattern);
    if (candidates) {
      for (const candidate of candidates) {
        try {
          return JSON.parse(candidate);
        } catch {
          // try next candidate
        }
      }
    }
  }

  return null;
}

// ─── PTY capture for agy ─────────────────────────────────────────────────────

export interface AgyCaptureOptions {
  readonly model?: string;
  readonly cwd?: string;
  /** Extra directories to grant the worker (agy --add-dir) — real repo/data access. */
  readonly addDirs?: readonly string[];
  /** Image files to attach; their containing dirs are granted via --add-dir. */
  readonly images?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxPromptChars?: number;
  /**
   * Opt in to agy's `--dangerously-skip-permissions` (full host-permission bypass). Default OFF:
   * agy runs with `--sandbox`, the secure default the audit asked for. `--add-dir` is kept
   * independent of the bypass (it's an explicit access grant, not a bypass), so only set this when
   * a caller has proven agy needs the bypass — keeping any bypass visible at the call site.
   */
  readonly dangerouslySkipPermissions?: boolean;
}

export interface AgyCaptureResult {
  readonly exitCode: number;
  readonly rawOutput: string;
  readonly cleanOutput: string;
  readonly parsedJson: unknown;
  readonly durationMs: number;
}

export interface PromptLimitOptions {
  readonly maxPromptChars?: number;
}

export interface VendorArtifactEntry {
  readonly path: string;
  readonly mtimeMs: number;
  readonly name?: string;
}

export interface VendorArtifactSweepOptions {
  readonly ttlDays?: number;
  readonly now?: number;
}

export type CodexDispatchMode = "codex_implement" | "codex_review" | "codex_research";
export type OpenRouterMode = "qwen3_code_draft" | "nemotron_planning";
export type OpenRouterModel = "qwen/qwen3-coder:free" | "nvidia/nemotron-3-ultra-550b-a55b:free";

export const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_MODE_MODEL_MAP: Readonly<Record<OpenRouterMode, OpenRouterModel>> = {
  qwen3_code_draft: "qwen/qwen3-coder:free",
  nemotron_planning: "nvidia/nemotron-3-ultra-550b-a55b:free"
};
export const OPENROUTER_ATTEMPT_COUNTER_FILE = "openrouter-api-attempts.jsonl";

// ADR openrouter-free-lane Decision 4: free lane budget is 50/day + 20/minute.
// UNVERIFIED at runtime: pricing and free limits must be rechecked before routing activation.
export const OPENROUTER_FREE_DAILY_ATTEMPT_LIMIT = 50;
export const OPENROUTER_FREE_MINUTE_ATTEMPT_LIMIT = 20;
export const DEFAULT_VENDOR_ARTIFACT_TTL_DAYS = 7;
export const VENDOR_ARTIFACT_TEMP_DIR_NAMES = ["autopilot-handoffs", "autopilot-codex-captures"] as const;

export interface OpenRouterAttemptCounts {
  readonly day: number;
  readonly minute: number;
  readonly day_limit: number;
  readonly minute_limit: number;
}

export interface OpenRouterRedactionPattern {
  readonly id: string;
  readonly pattern: RegExp;
}

export const OPENROUTER_PRE_SEND_REDACTION_PATTERNS: readonly OpenRouterRedactionPattern[] = [
  {
    id: "secret_key_value",
    pattern: /(api[_-]?key|secret|token|password)\s*[:=]\s*\S+/i
  },
  {
    id: "pem_private_material",
    pattern: /-----BEGIN/i
  },
  {
    id: "openrouter_key",
    pattern: /sk-or-v1-/i
  },
  {
    id: "aws_access_key",
    pattern: /AKIA[0-9A-Z]{16}/
  },
  {
    id: "windows_absolute_path",
    pattern: /[A-Za-z]:\\/
  }
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// No stable eval-retention filename marker exists yet. When tiered-eval artifacts
// gain one, add it here so flagged full records are preserved while stale raw
// prompt/output artifacts continue to expire by TTL.
const EVAL_FLAGGED_ARTIFACT_MARKERS: readonly RegExp[] = [];

export type OpenRouterMissingReason = "openrouter_api_key_missing";

export class OpenRouterGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OpenRouterModeGuardError extends OpenRouterGuardError {}
export class OpenRouterModelGuardError extends OpenRouterGuardError {}
export class OpenRouterAccessTierError extends OpenRouterGuardError {}
export class OpenRouterRedactionError extends OpenRouterGuardError {
  readonly patternId: string;

  constructor(patternId: string) {
    super(`openrouter_redaction_rejected: prompt packet matched ${patternId}`);
    this.patternId = patternId;
  }
}
export class OpenRouterBudgetError extends OpenRouterGuardError {
  readonly attemptCounts: OpenRouterAttemptCounts;

  constructor(attemptCounts: OpenRouterAttemptCounts) {
    super("openrouter_budget_exceeded: free lane attempt budget exhausted");
    this.attemptCounts = attemptCounts;
  }
}
export class OpenRouterZeroCostAssertionError extends OpenRouterGuardError {}
export class OpenRouterProviderError extends OpenRouterGuardError {}

export interface OpenRouterFetchInit {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal?: AbortSignal;
}

export interface OpenRouterFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type OpenRouterFetch = (
  url: typeof OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
  init: OpenRouterFetchInit
) => Promise<OpenRouterFetchResponse>;

export interface OpenRouterProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens?: number;
}

export interface OpenRouterCaptureOptions extends PromptLimitOptions {
  readonly openrouterMode: OpenRouterMode;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: OpenRouterFetch;
  readonly recordAttempt?: () => OpenRouterAttemptCounts;
  readonly cwd?: unknown;
  readonly addDirs?: unknown;
  readonly images?: unknown;
}

export interface OpenRouterCaptureResult {
  readonly exitCode: number;
  readonly rawOutput: string;
  readonly parsedJson: unknown;
  readonly durationMs: number;
  readonly errorOutput: string;
  readonly timedOut: boolean;
  readonly model: OpenRouterModel;
  readonly openrouterMode: OpenRouterMode;
  readonly providerUsage?: OpenRouterProviderUsage;
  readonly attemptCounts?: OpenRouterAttemptCounts;
  readonly missing?: {
    readonly status: "MISSING";
    readonly provider: "openrouter";
    readonly reason: OpenRouterMissingReason;
  };
}

export interface CodexDispatchConfig {
  readonly sandboxMode: "read-only" | "workspace-write";
  readonly approvalPolicy: "never";
  readonly webSearch?: boolean;
}

// Reuse the largest existing context-width budget as the vendor prompt ceiling:
// 8,000 max context lines across 60 packet files = 480,000 chars. This keeps
// normal handoff packets well above current tests while still refusing dumps.
export const DEFAULT_CLI_WORKER_MAX_PROMPT_CHARS =
  contextWidthSpecs.large.maxContextLines * contextWidthSpecs.large.maxFilesInPacket;

function resolveAgyPath(): string {
  try {
    return execSync("where agy", { encoding: "utf8" }).trim().split("\n")[0]?.trim() ?? "agy";
  } catch {
    return "agy";
  }
}

function resolveCodexCommand(): { codexPath: string; bashPath: string | null } {
  let codexPath = "codex";
  let bashPath: string | null = null;

  if (platform === "win32") {
    try {
      const found = execSync("where codex.cmd", { encoding: "utf8" }).trim().split("\n")[0]?.trim();
      if (found) codexPath = found.replace(/\\/g, "/");
    } catch { /* fall through */ }

    // Prefer Git Bash for reliable stdin piping on Windows
    const candidates = [
      "C:/Program Files/Git/bin/bash.exe",
      "C:/Program Files (x86)/Git/bin/bash.exe"
    ];
    for (const candidate of candidates) {
      try {
        execSync(`"${candidate}" --version`, { encoding: "utf8", timeout: 3000 });
        bashPath = candidate;
        break;
      } catch { /* try next */ }
    }
  }

  return { codexPath, bashPath };
}

/**
 * Allowlisted environment for vendor CLI spawns. Passing the full `process.env`
 * leaks host secrets (API keys, tokens, cloud creds) into the vendor's shell, which
 * runs with --dangerously-skip-permissions / an external sandbox. The vendor CLIs
 * authenticate via their own config dirs (~/.codex, ~/.gemini) reached through
 * HOME/USERPROFILE/APPDATA — not through env secrets — so an OS-essentials allowlist
 * keeps them working while default-denying everything else (GITHUB_TOKEN, *_API_KEY, …).
 */
export function buildVendorEnv(): NodeJS.ProcessEnv {
  const allow = new Set([
    "path", "pathext", "home", "userprofile", "homedrive", "homepath",
    "appdata", "localappdata", "programdata",
    "systemroot", "systemdrive", "windir", "comspec",
    "temp", "tmp", "tmpdir",
    "username", "user", "logname",
    "os", "lang", "lc_all", "term",
    "programfiles", "programfiles(x86)", "programw6432",
    "number_of_processors", "processor_architecture"
  ]);
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allow.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out;
}

// OpenRouter stage-1 guard helpers. These run before any network call.
export function resolveOpenRouterModel(
  openrouterMode: OpenRouterMode | string | undefined,
  requestedModel?: string
): OpenRouterModel {
  if (!isOpenRouterMode(openrouterMode)) {
    throw new OpenRouterModeGuardError("openrouter_mode_required: openrouter_api requires an allowlisted openrouterMode");
  }

  const expected = OPENROUTER_MODE_MODEL_MAP[openrouterMode];
  if (requestedModel !== undefined && requestedModel !== expected) {
    throw new OpenRouterModelGuardError("openrouter_model_rejected: requested model is not allowlisted for openrouterMode");
  }

  return expected;
}

export function assertOpenRouterAccessTierOptions(opts: Record<string, unknown>): void {
  for (const key of ["cwd", "addDirs", "images"] as const) {
    if (Object.hasOwn(opts, key)) {
      throw new OpenRouterAccessTierError(`openrouter_access_tier_violation: ${key} is not accepted by openrouter_api`);
    }
  }
}

export function assertOpenRouterPromptIsSendable(prompt: string): void {
  for (const redactionPattern of OPENROUTER_PRE_SEND_REDACTION_PATTERNS) {
    redactionPattern.pattern.lastIndex = 0;
    if (redactionPattern.pattern.test(prompt)) {
      throw new OpenRouterRedactionError(redactionPattern.id);
    }
  }
}

export function openRouterAttemptCounterPathForStateDir(stateDir: string): string {
  return join(dirname(stateDir), OPENROUTER_ATTEMPT_COUNTER_FILE);
}

export function incrementOpenRouterAttemptBudget(input: {
  readonly stateDir: string;
  readonly openrouterMode: OpenRouterMode;
  readonly model: OpenRouterModel;
  readonly taskPacketRef: string;
  readonly now?: Date;
}): OpenRouterAttemptCounts {
  const now = input.now ?? new Date();
  const recordedAt = now.toISOString();
  const counterPath = openRouterAttemptCounterPathForStateDir(input.stateDir);
  mkdirSync(dirname(counterPath), { recursive: true });
  appendFileSync(counterPath, `${JSON.stringify({
    schema_version: "v1",
    recorded_at: recordedAt,
    provider: "openrouter",
    openrouter_mode: input.openrouterMode,
    model: input.model,
    task_packet_ref: input.taskPacketRef
  })}\n`, "utf8");

  const counts = countOpenRouterAttempts(counterPath, recordedAt);
  if (
    counts.day > OPENROUTER_FREE_DAILY_ATTEMPT_LIMIT ||
    counts.minute > OPENROUTER_FREE_MINUTE_ATTEMPT_LIMIT
  ) {
    throw new OpenRouterBudgetError(counts);
  }

  return counts;
}

export function openRouterErrorReason(err: unknown): string | null {
  if (!(err instanceof OpenRouterGuardError)) {
    return null;
  }

  return `${err.name}: ${err.message}`;
}

export function redactOpenRouterApiKey(value: string): string {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return value;
  }

  return value.split(apiKey).join("[REDACTED_OPENROUTER_API_KEY]");
}

function isOpenRouterMode(value: OpenRouterMode | string | undefined): value is OpenRouterMode {
  return value === "qwen3_code_draft" || value === "nemotron_planning";
}

function countOpenRouterAttempts(counterPath: string, recordedAt: string): OpenRouterAttemptCounts {
  const dayKey = recordedAt.slice(0, 10);
  const minuteKey = recordedAt.slice(0, 16);
  let day = 0;
  let minute = 0;

  for (const line of readJsonlLines(counterPath)) {
    const timestamp = readRecordedAt(line);
    if (!timestamp) {
      continue;
    }

    if (timestamp.slice(0, 10) === dayKey) {
      day += 1;
    }

    if (timestamp.slice(0, 16) === minuteKey) {
      minute += 1;
    }
  }

  return {
    day,
    minute,
    day_limit: OPENROUTER_FREE_DAILY_ATTEMPT_LIMIT,
    minute_limit: OPENROUTER_FREE_MINUTE_ATTEMPT_LIMIT
  };
}

function readJsonlLines(path: string): readonly string[] {
  try {
    return readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

function readRecordedAt(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as { readonly recorded_at?: unknown };
    return typeof parsed.recorded_at === "string" ? parsed.recorded_at : null;
  } catch {
    return null;
  }
}

/**
 * POSIX single-quote escape: wrap in '...' and rewrite each ' as '\'' so a caller-supplied
 * value can never break out of the quotes into shell command position.
 */
export function shq(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the Git-Bash `-c` command line for `codex exec`. Two hardenings vs the old inline
 * string: (1) sandbox + never-approve are forced as args, so the vendor is
 * governed by the caller's dispatch mode rather than trusting an ambient ~/.codex/config.toml; and
 * (2) every caller-supplied value (model, images, schema, paths) is shq-escaped, closing the
 * Windows command-injection sink the audit flagged. The prompt is still passed via `< file`.
 */
export function buildCodexBashCommand(
  codexPath: string,
  opts: {
    readonly model?: string;
    readonly outputSchemaPath?: string;
    readonly images?: readonly string[];
    readonly codexMode?: CodexDispatchMode;
  },
  outFile: string,
  promptFile: string
): string {
  const dispatchArgs = buildCodexConfigArgs(opts.codexMode);
  const parts = [
    shq(codexPath),
    "exec",
    ...dispatchArgs
  ];
  if (opts.outputSchemaPath) parts.push("--output-schema", shq(opts.outputSchemaPath.replace(/\\/g, "/")));
  if (opts.model) parts.push("-m", shq(opts.model));
  for (const img of opts.images ?? []) parts.push("-i", shq(img.replace(/\\/g, "/")));
  parts.push("-o", shq(outFile.replace(/\\/g, "/")), "-", "<", shq(promptFile.replace(/\\/g, "/")));
  return parts.join(" ");
}

export function resolveCodexDispatchConfig(mode: CodexDispatchMode | undefined): CodexDispatchConfig {
  switch (mode) {
    case "codex_implement":
      return {
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        webSearch: false
      };
    case "codex_review":
      return {
        sandboxMode: "read-only",
        approvalPolicy: "never",
        webSearch: false
      };
    case "codex_research":
      return {
        sandboxMode: "read-only",
        approvalPolicy: "never",
        webSearch: true
      };
    case undefined:
      return {
        sandboxMode: "read-only",
        approvalPolicy: "never"
      };
  }
}

export function buildCodexConfigArgs(mode: CodexDispatchMode | undefined): string[] {
  const config = resolveCodexDispatchConfig(mode);
  const args = [
    "-c",
    `sandbox_mode=${config.sandboxMode}`,
    "-c",
    `approval_policy=${config.approvalPolicy}`
  ];

  if (config.webSearch !== undefined) {
    args.push("-c", `tools.web_search=${config.webSearch ? "true" : "false"}`);
  }

  return args;
}

/**
 * Windows: a PTY child's `kill()` does NOT terminate the ConPTY grandchildren, which keep
 * handles open and hang the supervising task after the answer is already captured. Tree-kill
 * by pid. No-op on POSIX (the group is handled by the caller) and when the tree is already gone.
 */
function killProcessTree(pid: number | undefined): void {
  if (!pid || platform !== "win32") return;
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
  } catch {
    // tree may already be gone
  }
}

/**
 * Build the agy `--print` argv. `--sandbox` is forced by default; `--dangerously-skip-permissions`
 * (full host-permission bypass) is opt-in and mutually exclusive with the sandbox. `--add-dir`
 * access grants stay independent of the bypass, so any bypass is explicit at the call site.
 */
export function buildAgyArgs(prompt: string, opts: AgyCaptureOptions = {}): string[] {
  assertPromptWithinLimit(prompt, opts);

  // Grant real repo/data access: each extra dir + each image's containing dir.
  const accessDirs = [
    ...(opts.addDirs ?? []),
    ...(opts.images ?? []).map((img) => dirname(img))
  ];
  // Keep `--print <prompt>` adjacent (the prompt directly follows --print, as the working lane
  // always had it); place the sandbox/bypass flag AFTER the prompt where --dangerously-skip-permissions
  // already lived, so we never risk --print swallowing a flag as its value.
  return [
    "--print",
    prompt,
    ...(opts.dangerouslySkipPermissions === true ? ["--dangerously-skip-permissions"] : ["--sandbox"]),
    ...(opts.model ? ["--model", opts.model] : []),
    ...accessDirs.flatMap((dir) => ["--add-dir", dir])
  ];
}

export async function captureAgyResponse(
  prompt: string,
  opts: AgyCaptureOptions = {}
): Promise<AgyCaptureResult> {
  assertPromptWithinLimit(prompt, opts);

  // Dynamic import so TS compile doesn't fail in environments without node-pty
  const ptyModule = await import("node-pty");
  const pty = ptyModule.default ?? ptyModule;

  const agyPath = resolveAgyPath();
  const args = buildAgyArgs(prompt, opts);

  const startedAt = Date.now();
  let collected = "";
  let settled = false;

  return new Promise((resolve, reject) => {
    const proc = pty.spawn(agyPath, args, {
      name: "xterm-color",
      cols: 220,
      rows: 30,
      cwd: opts.cwd ?? process.cwd(),
      env: buildVendorEnv() as Record<string, string>
    });

    proc.onData((data: string) => {
      collected += data;
    });

    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          proc.kill();
        } catch {
          // process may already be dead
        }
        killProcessTree(proc.pid); // proc.kill() leaves ConPTY grandchildren alive
        reject(new Error(`agy capture timed out after ${opts.timeoutMs ?? 120000}ms`));
      }
    }, opts.timeoutMs ?? 120000);

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutHandle);
        const durationMs = Date.now() - startedAt;
        const cleanOutput = stripAnsi(collected);
        resolve({
          exitCode,
          rawOutput: collected,
          cleanOutput,
          parsedJson: extractJsonFromPtyOutput(cleanOutput),
          durationMs
        });
      }
    });
  });
}

// ─── File-based capture for codex exec ────────────────────────────────────────

export interface CodexCaptureOptions {
  readonly model?: string;
  readonly outputSchemaPath?: string;
  readonly codexMode?: CodexDispatchMode;
  readonly cwd?: string;
  /** Extra directories (codex works in cwd; recorded for parity with agy). */
  readonly addDirs?: readonly string[];
  /** Image files to attach to the prompt (codex exec -i). */
  readonly images?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxPromptChars?: number;
  /** Retries on a transient empty-output exit (default 1; timeouts are never retried). */
  readonly retries?: number;
}

export interface CodexCaptureResult {
  readonly exitCode: number;
  readonly outputFilePath: string;
  readonly rawFileContent: string;
  readonly parsedJson: unknown;
  readonly durationMs: number;
  readonly errorOutput: string;
  readonly timedOut: boolean;
  /** How many spawn attempts ran (1 = succeeded first try; >1 = a transient empty-output retry). */
  readonly attempts: number;
}

export async function captureCodexResponse(
  prompt: string,
  opts: CodexCaptureOptions = {}
): Promise<CodexCaptureResult> {
  assertPromptWithinLimit(prompt, opts);

  const { spawnSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");

  const outputDir = join(tmpdir(), "autopilot-codex-captures");
  mkdirSync(outputDir, { recursive: true });
  const schemaArgs = opts.outputSchemaPath
    ? ["--output-schema", opts.outputSchemaPath]
    : [];

  const { codexPath, bashPath } = resolveCodexCommand();

  // Write prompt to a temp file — avoids shell quoting issues with JSON prompts.
  const promptFile = join(outputDir, `prompt-${Date.now()}.txt`);
  writeFileSync(promptFile, prompt, "utf8");

  // codex sometimes exits non-zero with an EMPTY -o on a transient sandbox/exec hiccup — the
  // exact failure that needed manual reruns this session. Retry once, bounded, with a fresh
  // output file; a timeout is never retried (it would just time out again).
  const maxAttempts = Math.max(1, (opts.retries ?? 1) + 1);
  const startedAt = Date.now();
  let result!: ReturnType<typeof spawnSync>;
  let outputFile = "";
  let rawFileContent = "";
  let parsedJson: unknown = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    outputFile = join(outputDir, `codex-${Date.now()}-${attempt}.json`);

    if (bashPath) {
      // Windows: Git Bash for reliable stdin redirection. Dispatch sandbox + never-approve
      // are forced and every caller value is shq-escaped (see buildCodexBashCommand).
      const bashCmd = buildCodexBashCommand(codexPath, opts, outputFile, promptFile);
      result = spawnSync(bashPath, ["-c", bashCmd], {
        encoding: "utf8",
        cwd: opts.cwd ?? process.cwd(),
        timeout: opts.timeoutMs ?? 120000,
        env: buildVendorEnv()
      });
    } else {
      // POSIX: direct spawnSync with stdin input (dispatch sandbox + never-approve forced)
      result = spawnSync("codex", [
        "exec",
        ...buildCodexConfigArgs(opts.codexMode),
        ...schemaArgs, "-o", outputFile,
        ...(opts.model ? ["-m", opts.model] : []),
        ...(opts.images ?? []).flatMap((img) => ["-i", img]), "-"
      ], {
        input: prompt,
        encoding: "utf8",
        cwd: opts.cwd ?? process.cwd(),
        timeout: opts.timeoutMs ?? 120000,
        env: buildVendorEnv()
      });
    }

    rawFileContent = "";
    parsedJson = null;
    try {
      rawFileContent = readFileSync(outputFile, "utf8").trim();
      if (rawFileContent) {
        parsedJson = JSON.parse(rawFileContent);
      }
    } catch {
      // file absent or not valid JSON — caller checks exitCode
    }

    const timedOut = isSpawnTimeout(result.error);
    const emptyOutput = rawFileContent.length === 0;
    if (!shouldRetryCodex({ emptyOutput, timedOut, attempt, maxAttempts })) break;
  }

  const durationMs = Date.now() - startedAt;

  return {
    exitCode: result.status ?? 1,
    outputFilePath: outputFile,
    rawFileContent,
    parsedJson,
    durationMs,
    errorOutput: collectSpawnErrorOutput(result),
    timedOut: isSpawnTimeout(result.error),
    attempts
  };
}

export async function captureOpenRouterResponse(
  prompt: string,
  opts: OpenRouterCaptureOptions
): Promise<OpenRouterCaptureResult> {
  const startedAt = Date.now();
  assertPromptWithinLimit(prompt, opts);
  assertOpenRouterAccessTierOptions(opts as unknown as Record<string, unknown>);
  const model = resolveOpenRouterModel(opts.openrouterMode, opts.model);
  assertOpenRouterPromptIsSendable(prompt);

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return {
      exitCode: -1,
      rawOutput: "",
      parsedJson: null,
      durationMs: Date.now() - startedAt,
      errorOutput: "MISSING: openrouter_api_key_missing",
      timedOut: false,
      model,
      openrouterMode: opts.openrouterMode,
      missing: {
        status: "MISSING",
        provider: "openrouter",
        reason: "openrouter_api_key_missing"
      }
    };
  }

  const fetchImpl = opts.fetchImpl ?? defaultOpenRouterFetch;
  const attemptCounts = opts.recordAttempt?.();
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 120000;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  let response: OpenRouterFetchResponse;

  try {
    response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      }),
      signal: controller.signal
    });
  } catch (err) {
    if (isAbortError(err)) {
      throw new OpenRouterProviderError(`openrouter_timeout: request timed out after ${timeoutMs}ms`);
    }
    throw new OpenRouterProviderError("openrouter_fetch_failed: request failed");
  } finally {
    clearTimeout(timeoutHandle);
  }

  const responseText = await response.text();
  const payload = parseOpenRouterPayload(responseText);

  if (!response.ok) {
    throw new OpenRouterProviderError(`openrouter_http_error: status ${response.status}`);
  }

  assertOpenRouterResponseModel(payload, model);
  assertOpenRouterZeroCost(payload);

  const rawOutput = extractOpenRouterOutput(payload);
  const providerUsage = extractOpenRouterUsage(payload);
  return {
    exitCode: 0,
    rawOutput,
    parsedJson: extractJsonFromPtyOutput(rawOutput),
    durationMs: Date.now() - startedAt,
    errorOutput: "",
    timedOut: false,
    model,
    openrouterMode: opts.openrouterMode,
    ...(providerUsage ? { providerUsage } : {}),
    ...(attemptCounts ? { attemptCounts } : {})
  };
}

function defaultOpenRouterFetch(
  url: typeof OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
  init: OpenRouterFetchInit
): Promise<OpenRouterFetchResponse> {
  if (typeof globalThis.fetch !== "function") {
    throw new OpenRouterProviderError("openrouter_fetch_unavailable: global fetch is unavailable");
  }

  return globalThis.fetch(url, init) as Promise<OpenRouterFetchResponse>;
}

function parseOpenRouterPayload(responseText: string): unknown {
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    throw new OpenRouterProviderError("openrouter_invalid_json: response body was not valid JSON");
  }
}

function assertOpenRouterResponseModel(payload: unknown, expectedModel: OpenRouterModel): void {
  const record = asUnknownRecord(payload);
  const echoedModel = record ? record.model : undefined;

  if (echoedModel !== expectedModel) {
    throw new OpenRouterModelGuardError("openrouter_model_rejected: response model did not match allowlisted model");
  }
}

function assertOpenRouterZeroCost(payload: unknown): void {
  const usage = asUnknownRecord(payload)?.usage;
  if (hasNonZeroCostField(usage)) {
    throw new OpenRouterZeroCostAssertionError("openrouter_nonzero_cost_detected: response usage reported nonzero cost");
  }
}

function extractOpenRouterOutput(payload: unknown): string {
  const choices = asUnknownRecord(payload)?.choices;
  if (!Array.isArray(choices)) {
    return "";
  }

  const firstChoice = asUnknownRecord(choices[0]);
  const message = asUnknownRecord(firstChoice?.message);
  const content = message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const partRecord = asUnknownRecord(part);
        return typeof partRecord?.text === "string" ? partRecord.text : "";
      })
      .join("")
      .trim();
  }

  if (content === undefined || content === null) {
    return "";
  }

  return JSON.stringify(content);
}

function extractOpenRouterUsage(payload: unknown): OpenRouterProviderUsage | undefined {
  const usage = asUnknownRecord(asUnknownRecord(payload)?.usage);
  if (!usage) {
    return undefined;
  }

  const inputTokens = safeOpenRouterUsageCount(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = safeOpenRouterUsageCount(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = safeOpenRouterUsageCount(usage.total_tokens);

  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    ...(totalTokens > 0 ? { totalTokens } : {})
  };
}

function hasNonZeroCostField(value: unknown): boolean {
  const record = asUnknownRecord(value);
  if (!record) {
    return false;
  }

  for (const [key, item] of Object.entries(record)) {
    if (/cost/i.test(key)) {
      const cost = numericCostValue(item);
      if (cost !== null && cost !== 0) {
        return true;
      }
    }

    if (hasNonZeroCostField(item)) {
      return true;
    }
  }

  return false;
}

function numericCostValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function safeOpenRouterUsageCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.ceil(value);
}

function asUnknownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function shouldRetryCodex(input: {
  readonly emptyOutput: boolean;
  readonly timedOut: boolean;
  readonly attempt: number;
  readonly maxAttempts: number;
}): boolean {
  return input.emptyOutput && !input.timedOut && input.attempt < input.maxAttempts;
}

function collectSpawnErrorOutput(result: ReturnType<typeof import("node:child_process").spawnSync>): string {
  return [
    outputToString(result.stderr),
    outputToString(result.stdout),
    result.error?.message ?? ""
  ].filter((value) => value.length > 0).join("\n");
}

function outputToString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8").trim();
  }

  return "";
}

function isSpawnTimeout(error: Error | undefined): boolean {
  if (!error) {
    return false;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return code === "ETIMEDOUT" || /\b(?:timed out|timeout|etimedout)\b/i.test(error.message);
}

// ─── Prompt file writer (shared) ──────────────────────────────────────────────

export function vendorArtifactDirectories(baseTempDir = tmpdir()): readonly string[] {
  return VENDOR_ARTIFACT_TEMP_DIR_NAMES.map((directory) => join(baseTempDir, directory));
}

export function filesToPurge(
  entries: readonly VendorArtifactEntry[],
  ttlMs = DEFAULT_VENDOR_ARTIFACT_TTL_DAYS * MS_PER_DAY,
  now = Date.now()
): readonly string[] {
  const effectiveTtlMs = Number.isFinite(ttlMs) && ttlMs >= 0
    ? ttlMs
    : DEFAULT_VENDOR_ARTIFACT_TTL_DAYS * MS_PER_DAY;

  return entries
    .filter((entry) => {
      if (!Number.isFinite(entry.mtimeMs) || isEvalFlaggedVendorArtifact(entry)) {
        return false;
      }

      return now - entry.mtimeMs > effectiveTtlMs;
    })
    .map((entry) => entry.path);
}

export function sweepStaleVendorArtifacts(
  dir: string,
  options: VendorArtifactSweepOptions = {}
): readonly string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const entries: VendorArtifactEntry[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const path = join(dir, entry.name);
    try {
      entries.push({ path, name: entry.name, mtimeMs: statSync(path).mtimeMs });
    } catch {
      // best-effort sweep: disappearing files should not fail vendor dispatch
    }
  }

  const ttlMs = ttlDaysToMs(options.ttlDays ?? DEFAULT_VENDOR_ARTIFACT_TTL_DAYS);
  const staleFiles = filesToPurge(entries, ttlMs, options.now ?? Date.now());
  const purgedFiles: string[] = [];

  for (const file of staleFiles) {
    try {
      unlinkSync(file);
      purgedFiles.push(file);
    } catch {
      // best-effort sweep: permission races should not fail vendor dispatch
    }
  }

  return purgedFiles;
}

export function sweepStaleVendorArtifactDirectories(
  options: VendorArtifactSweepOptions = {}
): readonly string[] {
  const purgedFiles: string[] = [];

  for (const dir of vendorArtifactDirectories()) {
    try {
      purgedFiles.push(...sweepStaleVendorArtifacts(dir, options));
    } catch {
      // best-effort sweep: one temp directory must not block another
    }
  }

  return purgedFiles;
}

export function assertPromptWithinLimit(prompt: string, opts: PromptLimitOptions = {}): void {
  const maxPromptChars = resolveMaxPromptChars(opts.maxPromptChars);
  const actualChars = prompt.length;

  if (actualChars > maxPromptChars) {
    throw new Error(
      `prompt_size_exceeded: prompt actual size ${actualChars} chars exceeds maxPromptChars limit ${maxPromptChars} chars`
    );
  }
}

function resolveMaxPromptChars(maxPromptChars: number | undefined): number {
  if (maxPromptChars === undefined) {
    return DEFAULT_CLI_WORKER_MAX_PROMPT_CHARS;
  }

  if (!Number.isInteger(maxPromptChars) || maxPromptChars <= 0) {
    throw new Error(`invalid_maxPromptChars: maxPromptChars must be a positive integer, got ${maxPromptChars}`);
  }

  return maxPromptChars;
}

function ttlDaysToMs(ttlDays: number): number {
  return Number.isFinite(ttlDays) && ttlDays >= 0
    ? ttlDays * MS_PER_DAY
    : DEFAULT_VENDOR_ARTIFACT_TTL_DAYS * MS_PER_DAY;
}

function isEvalFlaggedVendorArtifact(entry: VendorArtifactEntry): boolean {
  const name = entry.name ?? basename(entry.path);
  return EVAL_FLAGGED_ARTIFACT_MARKERS.some((marker) => marker.test(name));
}

export function writePromptFile(
  prompt: string,
  handoffSlug: string,
  opts: PromptLimitOptions = {}
): string {
  assertPromptWithinLimit(prompt, opts);

  const dir = join(tmpdir(), "autopilot-handoffs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${handoffSlug}-${Date.now()}.md`);
  writeFileSync(path, prompt, "utf8");
  return path;
}
