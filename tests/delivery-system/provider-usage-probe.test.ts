import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseAgyUsage,
  parseClaudeUsage,
  parseCodexStatus,
  runTmuxUsageProbe,
  type TmuxCommandExecutor
} from "../../src/data/delivery-system/providerUsageProbe";

const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`../fixtures/provider-usage/${name}`, import.meta.url)), "utf8");
const runtimeRoots: string[] = [];

function temporaryRuntimeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "provider-usage-probe-"));
  runtimeRoots.push(root);
  return root;
}

function tmuxSubcommand(args: readonly string[]): string | undefined {
  return args[2];
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of runtimeRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("provider usage parsers", () => {
  it("parses Codex five-hour and weekly percentages with reset labels", () => {
    expect(parseCodexStatus(fixture("codex-status.txt"))).toEqual({
      five_hour: { limit: 100, used: 2, remaining: 98, resets_at: "11:43" },
      weekly: { limit: 100, used: 7, remaining: 93, resets_at: "12:05 on 18 Jul" },
      models: []
    });
  });

  it("parses weekly-only Codex status without fabricating a 5h window", () => {
    expect(parseCodexStatus(fixture("codex-status-weekly-only.txt"))).toEqual({
      five_hour: { limit: null, used: null, remaining: null, resets_at: null },
      weekly: { limit: 100, used: 91, remaining: 9, resets_at: "16:25 on 30 Jul" },
      models: [
        { model_id: "gpt-5.5-sol", available: true },
        { model_id: "GPT-5.5-Codex-Spark", available: true }
      ]
    });
  });

  it("drops non-canonical Codex model IDs", () => {
    const raw = [
      "OpenAI Codex (v0.144.5)",
      "",
      "Model: Opus 4.8 (reasoning low, summaries auto)",
      "Weekly limit:    [████████████████░░░░] 40% left (resets 12:05 on 18 Jul)",
      ""
    ].join("\n");

    expect(parseCodexStatus(raw)?.models).toEqual([]);
  });

  it("deduplicates a model that is both the active model and an explicitly named weekly row, preferring the named row's availability", () => {
    const raw = [
      "OpenAI Codex (v0.144.5)",
      "",
      "Model: gpt-5.5-sol (reasoning low, summaries auto)",
      "5h limit:    [████████████████████] 2% left (resets 11:43)",
      "Weekly limit:    [████████████████░░░░] 40% left (resets 12:05 on 18 Jul)",
      "gpt-5.5-sol Weekly limit:    [░░░░░░░░░░░░░░░░░░░░] 0% left (resets 16:25 on 30 Jul)",
      ""
    ].join("\n");
    expect(parseCodexStatus(raw)).toEqual({
      five_hour: { limit: 100, used: 98, remaining: 2, resets_at: "11:43" },
      weekly: { limit: 100, used: 60, remaining: 40, resets_at: "12:05 on 18 Jul" },
      models: [{ model_id: "gpt-5.5-sol", available: false }]
    });
  });

  it("exposes the conservative minimum AGY group balance and expands group labels to canonical models", () => {
    expect(parseAgyUsage(fixture("agy-usage.txt"))).toEqual({
      five_hour: { limit: 100, used: 0, remaining: 100, resets_at: null },
      weekly: { limit: 100, used: 0, remaining: 100, resets_at: null },
      models: [
        { model_id: "gemini-3.5-flash-medium", available: true },
        { model_id: "gemini-3.5-flash-high", available: true },
        { model_id: "gemini-3.1-pro-high", available: true },
        { model_id: "claude-4.6-sonnet", available: true },
        { model_id: "gpt-oss-120b", available: true }
      ]
    });
  });

  it("deduplicates repeated AGY group labels and preserves negative availability", () => {
    const raw = [
      "Models & Quota",
      "",
      "GEMINI MODELS",
      "  Models within this group: Gemini Flash",
      "  Weekly Limit 100%",
      "  Five Hour Limit 100%",
      "",
      "CLAUDE AND GPT MODELS",
      "  Models within this group: Gemini Flash",
      "  Weekly Limit 0%",
      "  Five Hour Limit 100%",
      ""
    ].join("\n");

    expect(parseAgyUsage(raw)?.models).toEqual([
      { model_id: "gemini-3.5-flash-medium", available: false },
      { model_id: "gemini-3.5-flash-high", available: false }
    ]);
  });

  it("normalizes authenticated Claude model labels, including the extended-limit banner model", () => {
    expect(parseClaudeUsage(fixture("claude-usage.txt"))).toEqual({
      five_hour: { limit: 100, used: 12, remaining: 88, resets_at: "11:40am (UTC)" },
      weekly: { limit: 100, used: 34, remaining: 66, resets_at: "Jul 17, 6pm (UTC)" },
      models: [
        { model_id: "claude-opus-4-8", available: true },
        { model_id: "claude-fable-5", available: true }
      ]
    });
  });

  it("returns no Claude models when every extracted label is unmapped", () => {
    const raw = fixture("claude-usage.txt")
      .replaceAll("Opus 4.8", "Zephyr 9")
      .replaceAll("Fable 5", "Zephyr 9")
      .replaceAll("Fable", "Zephyr");

    expect(parseClaudeUsage(raw)?.models).toEqual([]);
  });

  it("marks a model unavailable when its per-family weekly section is exhausted", () => {
    const raw = fixture("claude-usage.txt").replace(
      "Current week (Fable)\n0% 0% used",
      "Current week (Fable)\n0% 100% used"
    );
    expect(parseClaudeUsage(raw)?.models).toEqual([
      { model_id: "claude-opus-4-8", available: true },
      { model_id: "claude-fable-5", available: false }
    ]);
  });

  it("marks every Claude model unavailable when the all-models weekly window is exhausted", () => {
    const raw = fixture("claude-usage.txt").replace("0% 34% used", "0% 100% used");
    expect(parseClaudeUsage(raw)?.models).toEqual([
      { model_id: "claude-opus-4-8", available: false },
      { model_id: "claude-fable-5", available: false }
    ]);
  });

  it("does not infer Claude quota from an unauthenticated login screen", () => {
    expect(parseClaudeUsage("Choose a login method\nSign in with Claude.ai")).toBeNull();
  });
});

describe("tmux usage probe", () => {
  it("isolates every tmux call, launches the resolved executable, sanitizes env, and removes its empty cwd", async () => {
    vi.stubEnv("CONTROL_PLANE_SECRET", "must-not-reach-tmux");
    vi.stubEnv("OPENROUTER_API_KEY", "must-not-reach-provider");
    vi.stubEnv("UNRELATED_PROBE_SECRET", "must-also-be-omitted");
    const runtimeRoot = temporaryRuntimeRoot();
    const calls: { readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> }[] = [];
    let launchCwd: string | undefined;
    const execute: TmuxCommandExecutor = async (_command, args, _signal, env) => {
      calls.push({ args: [...args], env: { ...env } });
      if (tmuxSubcommand(args) === "new-session") {
        const cwdIndex = args.indexOf("-c");
        launchCwd = args[cwdIndex + 1];
        expect(launchCwd).toBeDefined();
        expect(readdirSync(launchCwd!)).toEqual([]);
      }
      if (tmuxSubcommand(args) === "capture-pane") {
        return { stdout: fixture("codex-status.txt"), stderr: "", exitCode: 0 };
      }
      if (tmuxSubcommand(args) === "has-session") {
        return { stdout: "", stderr: "no server", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const result = await runTmuxUsageProbe("codex_cli", {
      executable: "/provider-bin/codex",
      execute,
      timeoutMs: 100,
      sessionId: "autopilot-quota-test",
      delayMs: 0,
      runtimeRoot
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeLessThanOrEqual(128 * 1024);
    expect(calls.every(({ args }) => args[0] === "-S" && args[1] === join(launchCwd!, "tmux.sock"))).toBe(true);
    const newSession = calls.find(({ args }) => tmuxSubcommand(args) === "new-session");
    expect(newSession?.args.slice(-2)).toEqual(["/provider-bin/codex", "--no-alt-screen"]);
    expect(newSession?.args).not.toContain("codex --no-alt-screen");
    expect(calls.some(({ args }) => args.includes("/status"))).toBe(true);
    expect(calls.slice(-2).map(({ args }) => tmuxSubcommand(args))).toEqual(["kill-server", "has-session"]);
    const statusIndex = calls.findIndex(({ args }) => args.includes("/status"));
    const enterSendsAfterStatus = calls.slice(statusIndex + 1).filter(({ args }) => args.includes("C-m")).length;
    expect(enterSendsAfterStatus).toBe(1);
    expect(launchCwd).toBeDefined();
    expect(relative(runtimeRoot, launchCwd!)).not.toMatch(/^\.\.(?:\/|$)/);
    expect(existsSync(launchCwd!)).toBe(false);

    const allowedEnvironment = new Set(["PATH", "HOME", "USER", "LOGNAME", "LANG", "TERM", "TMPDIR"]);
    for (const call of calls) {
      expect(Object.keys(call.env).every((key) => allowedEnvironment.has(key))).toBe(true);
      expect(call.env).not.toHaveProperty("CONTROL_PLANE_SECRET");
      expect(call.env).not.toHaveProperty("OPENROUTER_API_KEY");
      expect(call.env).not.toHaveProperty("UNRELATED_PROBE_SECRET");
    }
    for (const [key, value] of Object.entries(newSession?.env ?? {})) {
      expect(newSession?.args).toContain(`${key}=${value}`);
    }
  });

  it("preserves a successful probe when tmux 3.4 reports the removed socket as absent", async () => {
    const execute: TmuxCommandExecutor = async (_command, args) => tmuxSubcommand(args) === "capture-pane"
      ? { stdout: fixture("codex-status.txt"), stderr: "", exitCode: 0 }
      : tmuxSubcommand(args) === "has-session"
        ? {
            stdout: "",
            stderr: `error connecting to ${args[1]} (No such file or directory)`,
            exitCode: 1
          }
        : { stdout: "", stderr: "", exitCode: 0 };

    const result = await runTmuxUsageProbe("codex_cli", {
      executable: "/provider-bin/codex",
      execute,
      timeoutMs: 100,
      sessionId: "vm-tmux-3-4",
      delayMs: 0,
      runtimeRoot: temporaryRuntimeRoot()
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      five_hour: { remaining: 98 },
      weekly: { remaining: 93 }
    });
  });

  it("creates the isolated tmux socket inside the service writable runtime directory", async () => {
    const runtimeRoot = temporaryRuntimeRoot();
    const socketPaths = new Set<string>();
    let launchCwd: string | undefined;
    const execute: TmuxCommandExecutor = async (_command, args) => {
      const subcommand = tmuxSubcommand(args);
      if (subcommand === "new-session") launchCwd = args[args.indexOf("-c") + 1];
      const socketPath = args[1]!;
      const relativeSocketPath = launchCwd === undefined ? ".." : relative(launchCwd, socketPath);
      const socketIsWritable = args[0] === "-S"
        && isAbsolute(socketPath)
        && relativeSocketPath !== ""
        && !relativeSocketPath.match(/^\.\.(?:\/|$)/);

      if (subcommand === "has-session") {
        return {
          stdout: "",
          stderr: `error connecting to ${socketPath} (No such file or directory)`,
          exitCode: 1
        };
      }
      if (!socketIsWritable) {
        return {
          stdout: "",
          stderr: "error creating /tmp/tmux-1000/autopilot-probe-systemd (Read-only file system)",
          exitCode: 1
        };
      }
      socketPaths.add(socketPath);
      return subcommand === "capture-pane"
        ? { stdout: fixture("codex-status.txt"), stderr: "", exitCode: 0 }
        : { stdout: "", stderr: "", exitCode: 0 };
    };

    const result = await runTmuxUsageProbe("codex_cli", {
      executable: "/provider-bin/codex",
      execute,
      timeoutMs: 100,
      sessionId: "systemd-read-only-tmp",
      delayMs: 0,
      runtimeRoot
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(socketPaths.size).toBe(1);
    expect([...socketPaths][0]).toMatch(/\/autopilot-provider-probe-[^/]+\/tmux\.sock$/);
  });

  it("reports missing credentials for Claude login without fabricating quota", async () => {
    const execute: TmuxCommandExecutor = async (_command, args) => tmuxSubcommand(args) === "capture-pane"
      ? { stdout: "Choose a login method\nSign in with Claude.ai", stderr: "", exitCode: 0 }
      : tmuxSubcommand(args) === "has-session"
        ? { stdout: "", stderr: "no server", exitCode: 1 }
        : { stdout: "", stderr: "", exitCode: 0 };
    const result = await runTmuxUsageProbe("claude_cli", {
      executable: "/provider-bin/claude",
      execute,
      timeoutMs: 100,
      sessionId: "autopilot-quota-test",
      delayMs: 0,
      runtimeRoot: temporaryRuntimeRoot()
    });
    expect(result).toMatchObject({ exitCode: 1, stderr: "missing_credential" });
  });

  it("links an external abort to the in-flight probe and still performs verified cleanup", async () => {
    const external = new AbortController();
    const runtimeRoot = temporaryRuntimeRoot();
    const subcommands: string[] = [];
    let workingDirectory: string | undefined;
    let launchSignal: AbortSignal | undefined;
    let launchSettled = false;
    let cleanupStartedBeforeLaunchSettled = false;
    const execute: TmuxCommandExecutor = async (_command, args, commandSignal) => {
      const subcommand = tmuxSubcommand(args)!;
      subcommands.push(subcommand);
      if (subcommand === "new-session") {
        launchSignal = commandSignal;
        workingDirectory = args[args.indexOf("-c") + 1];
        queueMicrotask(() => external.abort());
        await new Promise<void>((resolve) => {
          if (commandSignal.aborted) resolve();
          else commandSignal.addEventListener("abort", () => resolve(), { once: true });
        });
        launchSettled = true;
        return { stdout: "", stderr: "private provider failure", exitCode: 1 };
      }
      if (subcommand === "kill-server") cleanupStartedBeforeLaunchSettled = !launchSettled;
      return subcommand === "has-session"
        ? { stdout: "", stderr: "no server", exitCode: 1 }
        : { stdout: "", stderr: "", exitCode: 0 };
    };

    const result = await runTmuxUsageProbe("agy_cli", {
      executable: "/provider-bin/agy",
      execute,
      signal: external.signal,
      timeoutMs: 10_000,
      sessionId: "abort-test",
      delayMs: 0,
      runtimeRoot
    });

    expect(result).toEqual({ stdout: "", stderr: "timeout", exitCode: 1 });
    expect(launchSignal?.aborted).toBe(true);
    expect(cleanupStartedBeforeLaunchSettled).toBe(false);
    expect(subcommands.slice(-2)).toEqual(["kill-server", "has-session"]);
    expect(workingDirectory).toBeDefined();
    expect(existsSync(workingDirectory!)).toBe(false);
  });

  it("fails closed and retains the socket when isolated tmux-server termination cannot be verified", async () => {
    let workingDirectory: string | undefined;
    const execute: TmuxCommandExecutor = async (_command, args) => {
      if (tmuxSubcommand(args) === "new-session") workingDirectory = args[args.indexOf("-c") + 1];
      return tmuxSubcommand(args) === "capture-pane"
        ? { stdout: fixture("codex-status.txt"), stderr: "", exitCode: 0 }
        : { stdout: "", stderr: "", exitCode: 0 };
    };

    const result = await runTmuxUsageProbe("codex_cli", {
      executable: "/provider-bin/codex",
      execute,
      timeoutMs: 100,
      sessionId: "cleanup-failure-test",
      delayMs: 0,
      runtimeRoot: temporaryRuntimeRoot()
    });

    expect(result).toEqual({ stdout: "", stderr: "provider_runtime_denied", exitCode: 1 });
    expect(workingDirectory).toBeDefined();
    expect(existsSync(workingDirectory!)).toBe(true);
  });

  it("does not mistake a cleanup permission failure for verified termination", async () => {
    const execute: TmuxCommandExecutor = async (_command, args) => {
      const subcommand = tmuxSubcommand(args);
      if (subcommand === "capture-pane") return { stdout: fixture("codex-status.txt"), stderr: "", exitCode: 0 };
      if (subcommand === "kill-server" || subcommand === "has-session") {
        return { stdout: "", stderr: "error connecting to /private/tmux/socket (Permission denied)", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const result = await runTmuxUsageProbe("codex_cli", {
      executable: "/provider-bin/codex",
      execute,
      timeoutMs: 100,
      sessionId: "cleanup-denied-test",
      delayMs: 0,
      runtimeRoot: temporaryRuntimeRoot()
    });

    expect(result).toEqual({ stdout: "", stderr: "provider_runtime_denied", exitCode: 1 });
    expect(JSON.stringify(result)).not.toContain("/private/tmux/socket");
  });

  it("never returns raw tmux stderr", async () => {
    const execute: TmuxCommandExecutor = async (_command, args) => tmuxSubcommand(args) === "new-session"
      ? { stdout: "", stderr: "unexpected failure containing /private/provider/path", exitCode: 1 }
      : tmuxSubcommand(args) === "has-session"
        ? { stdout: "", stderr: "no server", exitCode: 1 }
        : { stdout: "", stderr: "", exitCode: 0 };

    const result = await runTmuxUsageProbe("codex_cli", {
      executable: "/provider-bin/codex",
      execute,
      timeoutMs: 100,
      sessionId: "stderr-test",
      delayMs: 0,
      runtimeRoot: temporaryRuntimeRoot()
    });

    expect(result).toEqual({ stdout: "", stderr: "provider_error", exitCode: 1 });
    expect(JSON.stringify(result)).not.toContain("/private/provider/path");
  });
});
