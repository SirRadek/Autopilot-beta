import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";

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
  readonly timeoutMs?: number;
}

export interface AgyCaptureResult {
  readonly exitCode: number;
  readonly rawOutput: string;
  readonly cleanOutput: string;
  readonly parsedJson: unknown;
  readonly durationMs: number;
}

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

export async function captureAgyResponse(
  prompt: string,
  opts: AgyCaptureOptions = {}
): Promise<AgyCaptureResult> {
  // Dynamic import so TS compile doesn't fail in environments without node-pty
  const ptyModule = await import("node-pty");
  const pty = ptyModule.default ?? ptyModule;

  const agyPath = resolveAgyPath();
  const args = [
    "--print",
    prompt,
    "--dangerously-skip-permissions",
    ...(opts.model ? ["--model", opts.model] : [])
  ];

  const startedAt = Date.now();
  let collected = "";
  let settled = false;

  return new Promise((resolve, reject) => {
    const proc = pty.spawn(agyPath, args, {
      name: "xterm-color",
      cols: 220,
      rows: 30,
      cwd: opts.cwd ?? process.cwd(),
      env: process.env as Record<string, string>
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
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export interface CodexCaptureResult {
  readonly exitCode: number;
  readonly outputFilePath: string;
  readonly rawFileContent: string;
  readonly parsedJson: unknown;
  readonly durationMs: number;
}

export async function captureCodexResponse(
  prompt: string,
  opts: CodexCaptureOptions = {}
): Promise<CodexCaptureResult> {
  const { spawnSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");

  const outputDir = join(tmpdir(), "autopilot-codex-captures");
  mkdirSync(outputDir, { recursive: true });
  const outputFile = join(outputDir, `codex-${Date.now()}.json`);
  const schemaArgs = opts.outputSchemaPath
    ? ["--output-schema", opts.outputSchemaPath]
    : [];

  const { codexPath, bashPath } = resolveCodexCommand();

  // Write prompt to a temp file — avoids shell quoting issues with JSON prompts.
  const promptFile = join(outputDir, `prompt-${Date.now()}.txt`);
  writeFileSync(promptFile, prompt, "utf8");

  const schemaFlag = schemaArgs.length > 0 ? `${schemaArgs[0]} "${schemaArgs[1]}" ` : "";
  const modelFlag = opts.model ? `-m "${opts.model}" ` : "";
  const safeOut = outputFile.replace(/\\/g, "/");
  const safePrompt = promptFile.replace(/\\/g, "/");

  const startedAt = Date.now();
  let result: ReturnType<typeof spawnSync>;

  if (bashPath) {
    // Windows: use Git Bash so stdin redirection works reliably
    const bashCmd = `"${codexPath}" exec ${schemaFlag}${modelFlag}-o "${safeOut}" - < "${safePrompt}"`;
    result = spawnSync(bashPath, ["-c", bashCmd], {
      encoding: "utf8",
      cwd: opts.cwd ?? process.cwd(),
      timeout: opts.timeoutMs ?? 120000,
      env: process.env
    });
  } else {
    // POSIX: direct spawnSync with stdin input
    result = spawnSync("codex", [
      "exec", ...schemaArgs, "-o", outputFile,
      ...(opts.model ? ["-m", opts.model] : []), "-"
    ], {
      input: prompt,
      encoding: "utf8",
      cwd: opts.cwd ?? process.cwd(),
      timeout: opts.timeoutMs ?? 120000,
      env: process.env
    });
  }

  const durationMs = Date.now() - startedAt;
  let rawFileContent = "";
  let parsedJson: unknown = null;

  try {
    rawFileContent = readFileSync(outputFile, "utf8").trim();
    if (rawFileContent) {
      parsedJson = JSON.parse(rawFileContent);
    }
  } catch {
    // file absent or not valid JSON — caller checks exitCode
  }

  return {
    exitCode: result.status ?? 1,
    outputFilePath: outputFile,
    rawFileContent,
    parsedJson,
    durationMs
  };
}

// ─── Prompt file writer (shared) ──────────────────────────────────────────────

export function writePromptFile(prompt: string, handoffSlug: string): string {
  const dir = join(tmpdir(), "autopilot-handoffs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${handoffSlug}-${Date.now()}.md`);
  writeFileSync(path, prompt, "utf8");
  return path;
}
