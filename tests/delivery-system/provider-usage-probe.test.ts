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
  type TmuxCommandResult,
  type TmuxCommandExecutor
} from "../../src/data/delivery-system/providerUsageProbe";

// The codex-status-0.144.5-* files are verbatim sanitized renderer snapshots from
// openai/codex tag rust-v0.144.5 under codex-rs/tui/src/status/snapshots/, except
// codex-status-0.144.5-live-* which are sanitized captures from the deployed VM TUI.
const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`../fixtures/provider-usage/${name}`, import.meta.url)), "utf8");
const runtimeRoots: string[] = [];

function codexComposerWith(command: string): string {
  return fixture("codex-status-0.144.5-live-preamble.txt")
    .replace("› Find and fix a bug in @filename", `› ${command}`);
}

function temporaryRuntimeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "provider-usage-probe-"));
  runtimeRoots.push(root);
  return root;
}

function tmuxSubcommand(args: readonly string[]): string | undefined {
  return args[2];
}

function codexTuiResponder(finalCapture: TmuxCommandResult): (args: readonly string[]) => TmuxCommandResult | undefined {
  let commandAccepted = false;
  let submitted = false;
  return (args) => {
    const subcommand = tmuxSubcommand(args);
    if (subcommand === "send-keys") {
      const sendsCommand = args.includes("/status");
      const sendsEnter = args.includes("Enter") || args.includes("C-m");
      if (sendsCommand && !sendsEnter) commandAccepted = true;
      if (sendsEnter && !sendsCommand && commandAccepted) submitted = true;
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    if (subcommand !== "capture-pane") return undefined;
    return submitted
      ? finalCapture
      : {
          stdout: commandAccepted ? codexComposerWith("/status") : fixture("codex-status-0.144.5-live-preamble.txt"),
          stderr: "",
          exitCode: 0
        };
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of runtimeRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("provider usage parsers", () => {
  it("parses the exact Codex 0.144.5 five-hour and weekly status snapshot", () => {
    expect(parseCodexStatus(fixture("codex-status-0.144.5-standard.txt"))).toEqual({
      five_hour: { limit: 100, used: 45, remaining: 55, resets_at: "09:25" },
      weekly: { limit: 100, used: 30, remaining: 70, resets_at: "09:55" },
      models: [{ model_id: "gpt-5.1-codex", available: true }]
    });
  });

  it("accepts the renderer's optional reset shape without inventing a reset timestamp", () => {
    expect(parseCodexStatus("Weekly limit:     [██████████████░░░░░░] 70% left")).toEqual({
      five_hour: { limit: null, used: null, remaining: null, resets_at: null },
      weekly: { limit: 100, used: 30, remaining: 70, resets_at: null },
      models: []
    });
  });

  it("parses the real Codex status behind update and bubblewrap preamble", () => {
    expect(parseCodexStatus(fixture("codex-status-0.144.5-live-status.txt"))).toEqual({
      five_hour: { limit: null, used: null, remaining: null, resets_at: null },
      weekly: { limit: 100, used: 58, remaining: 42, resets_at: "12:34 on 9 Aug" },
      models: [
        { model_id: "gpt-5.6-sol", available: true },
        { model_id: "GPT-5.3-Codex-Spark", available: true }
      ]
    });
  });

  it("keeps account and session fields out of parsed Codex usage", () => {
    const raw = fixture("codex-status-0.144.5-live-status.txt")
      .replace("[[account]]", "probe-owner@example.invalid")
      .replace("[[session]]", "00000000-0000-4000-8000-000000000001");

    const parsed = parseCodexStatus(raw);
    expect(parsed).not.toBeNull();
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("probe-owner@example.invalid");
    expect(serialized).not.toContain("00000000-0000-4000-8000-000000000001");
  });

  it("stores only scrubbed account and session placeholders in Codex fixtures", () => {
    const liveStatus = fixture("codex-status-0.144.5-live-status.txt");
    expect(liveStatus).toContain("Account:                            [[account]] ([[plan]])");
    expect(liveStatus).toContain("Session:                            [[session]]");
    expect(liveStatus).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(liveStatus).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
  });

  it.each([
    ["monthly", "codex-status-0.144.5-monthly.txt"],
    ["enterprise monthly credit", "codex-status-0.144.5-enterprise-monthly-credit.txt"],
    ["generic", "codex-status-0.144.5-generic.txt"]
  ])("accepts the exact Codex 0.144.5 %s status shape without mislabeling its windows", (_label, name) => {
    expect(parseCodexStatus(fixture(name))).toEqual({
      five_hour: { limit: null, used: null, remaining: null, resets_at: null },
      weekly: { limit: null, used: null, remaining: null, resets_at: null },
      models: [{ model_id: "gpt-5.1-codex-max", available: true }]
    });
  });

  it("fails closed on the exact Codex 0.144.5 stale status shape", () => {
    expect(parseCodexStatus(fixture("codex-status-0.144.5-stale.txt"))).toBeNull();
  });

  it("does not misclassify the exact Codex 0.144.5 unavailable status shape as usage", () => {
    expect(parseCodexStatus(fixture("codex-status-0.144.5-unavailable.txt"))).toBeNull();
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
    const codexTui = codexTuiResponder({ stdout: fixture("codex-status.txt"), stderr: "", exitCode: 0 });
    const execute: TmuxCommandExecutor = async (_command, args, _signal, env) => {
      calls.push({ args: [...args], env: { ...env } });
      if (tmuxSubcommand(args) === "new-session") {
        const cwdIndex = args.indexOf("-c");
        launchCwd = args[cwdIndex + 1];
        expect(launchCwd).toBeDefined();
        expect(readdirSync(launchCwd!)).toEqual([]);
      }
      const tuiResponse = codexTui(args);
      if (tuiResponse !== undefined) return tuiResponse;
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
    expect(newSession?.args.slice(-6)).toEqual([
      "/provider-bin/codex",
      "--no-alt-screen",
      "-c",
      `projects={${JSON.stringify(launchCwd!)}={trust_level="untrusted"}}`,
      "-c",
      `sqlite_home=${JSON.stringify(launchCwd!)}`
    ]);
    expect(newSession?.args).not.toContain("codex --no-alt-screen");
    expect(calls.some(({ args }) => args.includes("/status"))).toBe(true);
    expect(calls.slice(-2).map(({ args }) => tmuxSubcommand(args))).toEqual(["kill-server", "has-session"]);
    const statusIndex = calls.findIndex(({ args }) => args.includes("/status"));
    const enterSendsAfterStatus = calls.slice(statusIndex + 1).filter(({ args }) => args.includes("Enter")).length;
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

  it("waits for the composer to accept /status before sending Enter as a separate keystroke", async () => {
    const runtimeRoot = temporaryRuntimeRoot();
    let state: "trust" | "ready" | "typing" | "accepted" | "submitted" | "status" = "trust";
    let launchArgs: readonly string[] = [];
    const calls: (readonly string[])[] = [];
    let captureCalls = 0;
    let typingCaptures = 0;
    const privateAccount = "probe-owner@example.invalid";
    const privateSession = "00000000-0000-4000-8000-000000000001";
    const execute: TmuxCommandExecutor = async (_command, args) => {
      calls.push([...args]);
      const subcommand = tmuxSubcommand(args);
      if (subcommand === "new-session") {
        const executableIndex = args.indexOf("/provider-bin/codex");
        launchArgs = args.slice(executableIndex);
        const workingDirectory = args[args.indexOf("-c") + 1]!;
        const trustOverride = `projects={${JSON.stringify(workingDirectory)}={trust_level="untrusted"}}`;
        const sqliteOverride = `sqlite_home=${JSON.stringify(workingDirectory)}`;
        state = launchArgs.includes(trustOverride) && launchArgs.includes(sqliteOverride) ? "ready" : "trust";
      } else if (subcommand === "send-keys") {
        const sendsCommand = args.includes("/status");
        const sendsEnter = args.includes("Enter") || args.includes("C-m");
        if (sendsCommand && !sendsEnter && state === "ready") state = "typing";
        if (sendsEnter && !sendsCommand && state === "accepted") state = "submitted";
      } else if (subcommand === "capture-pane") {
        captureCalls += 1;
        if (state === "trust") {
          return { stdout: fixture("codex-status-0.144.5-live-trust-gate.txt"), stderr: "", exitCode: 0 };
        }
        if (state === "typing") {
          typingCaptures += 1;
          if (typingCaptures >= 2) state = "accepted";
          return {
            stdout: state === "accepted" ? codexComposerWith("/status") : fixture("codex-status-0.144.5-live-preamble.txt"),
            stderr: "",
            exitCode: 0
          };
        }
        if (state === "accepted") {
          return { stdout: codexComposerWith("/status"), stderr: "", exitCode: 0 };
        }
        if (state === "submitted") {
          state = "status";
          return { stdout: codexComposerWith("/status"), stderr: "", exitCode: 0 };
        }
        if (state === "status") {
          return {
            stdout: fixture("codex-status-0.144.5-live-status.txt")
              .replace("[[account]]", privateAccount)
              .replace("[[session]]", privateSession),
            stderr: "",
            exitCode: 0
          };
        }
        return { stdout: fixture("codex-status-0.144.5-live-preamble.txt"), stderr: "", exitCode: 0 };
      } else if (subcommand === "has-session") {
        return { stdout: "", stderr: "no server", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const result = await runTmuxUsageProbe("codex_cli", {
      executable: "/provider-bin/codex",
      execute,
      timeoutMs: 1_000,
      sessionId: "live-trust-gate",
      delayMs: 5,
      runtimeRoot
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      weekly: { remaining: 42 },
      models: [
        { model_id: "gpt-5.6-sol", available: true },
        { model_id: "GPT-5.3-Codex-Spark", available: true }
      ]
    });
    expect(result.stdout).not.toContain(privateAccount);
    expect(result.stdout).not.toContain(privateSession);
    expect(launchArgs).toEqual([
      "/provider-bin/codex",
      "--no-alt-screen",
      "-c",
      expect.stringMatching(/^projects=\{".*autopilot-provider-probe-.*"=\{trust_level="untrusted"\}\}$/),
      "-c",
      expect.stringMatching(/^sqlite_home=".*autopilot-provider-probe-.*"$/)
    ]);
    const inputCalls = calls.filter((args) => tmuxSubcommand(args) === "send-keys");
    expect(inputCalls).toHaveLength(2);
    expect(inputCalls[0]).toEqual(expect.arrayContaining(["-l", "/status"]));
    expect(inputCalls[0]).not.toContain("Enter");
    expect(inputCalls[0]).not.toContain("C-m");
    expect(inputCalls[1]?.at(-1)).toBe("Enter");
    expect(inputCalls[1]).not.toContain("/status");
    const commandIndex = calls.findIndex((args) => args.includes("/status"));
    const enterIndex = calls.findIndex((args) => args.at(-1) === "Enter");
    expect(commandIndex).toBeGreaterThanOrEqual(0);
    expect(enterIndex).toBeGreaterThan(commandIndex);
    expect(calls.slice(commandIndex + 1, enterIndex).some((args) => tmuxSubcommand(args) === "capture-pane")).toBe(true);
    expect(captureCalls).toBeGreaterThanOrEqual(5);
  });

  // Measured on the VM against Codex 0.144.5: an Enter sent right after the composer echoes
  // clears the composer but never opens the status panel. The probe must notice the empty
  // composer and submit again rather than reporting malformed_response.
  it("retries the whole submission when the first Enter empties the composer without rendering status", async () => {
    const runtimeRoot = temporaryRuntimeRoot();
    const calls: (readonly string[])[] = [];
    let composerHoldsCommand = false;
    let entersSent = 0;
    let launched = false;
    const execute: TmuxCommandExecutor = async (_command, args) => {
      calls.push([...args]);
      const subcommand = tmuxSubcommand(args);
      if (subcommand === "new-session") {
        launched = true;
      } else if (subcommand === "send-keys") {
        if (args.includes("/status")) composerHoldsCommand = true;
        else if (args.includes("Enter")) {
          entersSent += 1;
          // The first submission is swallowed: the composer empties, no status panel.
          composerHoldsCommand = false;
        }
      } else if (subcommand === "capture-pane") {
        if (!launched) return { stdout: "", stderr: "", exitCode: 0 };
        if (entersSent >= 2) {
          return { stdout: fixture("codex-status-0.144.5-live-status.txt"), stderr: "", exitCode: 0 };
        }
        return {
          stdout: composerHoldsCommand
            ? codexComposerWith("/status")
            : fixture("codex-status-0.144.5-live-preamble.txt"),
          stderr: "",
          exitCode: 0
        };
      } else if (subcommand === "has-session") {
        return { stdout: "", stderr: "no server", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const result = await runTmuxUsageProbe("codex_cli", {
      executable: "/provider-bin/codex",
      execute,
      timeoutMs: 5_000,
      sessionId: "resubmit",
      delayMs: 1,
      runtimeRoot
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ weekly: { remaining: 42 } });
    expect(entersSent).toBe(2);
    // The command is retyped only after the composer emptied, so `/status/status` is impossible.
    const typed = calls.filter((args) => tmuxSubcommand(args) === "send-keys" && args.includes("/status"));
    expect(typed).toHaveLength(2);
    const enters = calls.filter((args) => tmuxSubcommand(args) === "send-keys" && args.at(-1) === "Enter");
    expect(enters).toHaveLength(2);
  });

  it("classifies an unrecognized post-launch capture failure as malformed_response", async () => {
    const privateAccount = "probe-owner@example.invalid";
    const privateSession = "00000000-0000-4000-8000-000000000001";
    const codexTui = codexTuiResponder({
      stdout: "",
      stderr: `unexpected capture failure for ${privateAccount}, session ${privateSession}`,
      exitCode: 1
    });
    const execute: TmuxCommandExecutor = async (_command, args) => {
      const subcommand = tmuxSubcommand(args);
      const tuiResponse = codexTui(args);
      if (tuiResponse !== undefined) return tuiResponse;
      if (subcommand === "has-session") return { stdout: "", stderr: "no server", exitCode: 1 };
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const result = await runTmuxUsageProbe("codex_cli", {
      executable: "/provider-bin/codex",
      execute,
      timeoutMs: 100,
      sessionId: "capture-error",
      delayMs: 0,
      runtimeRoot: temporaryRuntimeRoot()
    });

    expect(result).toEqual({ stdout: "", stderr: "malformed_response", exitCode: 1 });
    expect(JSON.stringify(result)).not.toContain(privateAccount);
    expect(JSON.stringify(result)).not.toContain(privateSession);
  });

  it("returns malformed_response when bounded captures never contain Codex status", async () => {
    let captureCalls = 0;
    const codexTui = codexTuiResponder({
      stdout: fixture("codex-status-0.144.5-live-preamble.txt"),
      stderr: "",
      exitCode: 0
    });
    const execute: TmuxCommandExecutor = async (_command, args) => {
      const subcommand = tmuxSubcommand(args);
      if (subcommand === "capture-pane") captureCalls += 1;
      const tuiResponse = codexTui(args);
      if (tuiResponse !== undefined) return tuiResponse;
      if (subcommand === "has-session") return { stdout: "", stderr: "no server", exitCode: 1 };
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const result = await runTmuxUsageProbe("codex_cli", {
      executable: "/provider-bin/codex",
      execute,
      timeoutMs: 1_000,
      sessionId: "missing-status",
      delayMs: 0,
      runtimeRoot: temporaryRuntimeRoot()
    });

    expect(result).toEqual({ stdout: "", stderr: "malformed_response", exitCode: 1 });
    expect(captureCalls).toBeGreaterThan(1);
  });

  it("preserves a successful probe when tmux 3.4 reports the removed socket as absent", async () => {
    const codexTui = codexTuiResponder({ stdout: fixture("codex-status.txt"), stderr: "", exitCode: 0 });
    const execute: TmuxCommandExecutor = async (_command, args) => {
      const tuiResponse = codexTui(args);
      if (tuiResponse !== undefined) return tuiResponse;
      return tmuxSubcommand(args) === "has-session"
        ? {
            stdout: "",
            stderr: `error connecting to ${args[1]} (No such file or directory)`,
            exitCode: 1
          }
        : { stdout: "", stderr: "", exitCode: 0 };
    };

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
    const codexTui = codexTuiResponder({ stdout: fixture("codex-status.txt"), stderr: "", exitCode: 0 });
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
      return codexTui(args) ?? { stdout: "", stderr: "", exitCode: 0 };
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

  it.each([
    ["stale", "codex-status-0.144.5-stale.txt"],
    ["unavailable", "codex-status-0.144.5-unavailable.txt"],
    ["not-yet-loaded", "codex-status-0.144.5-missing.txt"]
  ])("reports the exact Codex 0.144.5 %s status as bounded provider unavailability", async (label, name) => {
    const codexTui = codexTuiResponder({ stdout: fixture(name), stderr: "", exitCode: 0 });
    const execute: TmuxCommandExecutor = async (_command, args) => {
      const tuiResponse = codexTui(args);
      if (tuiResponse !== undefined) return tuiResponse;
      return tmuxSubcommand(args) === "has-session"
        ? { stdout: "", stderr: "no server", exitCode: 1 }
        : { stdout: "", stderr: "", exitCode: 0 };
    };

    const result = await runTmuxUsageProbe("codex_cli", {
      executable: "/provider-bin/codex",
      execute,
      timeoutMs: 100,
      sessionId: `${label}-status-test`,
      delayMs: 0,
      runtimeRoot: temporaryRuntimeRoot()
    });

    expect(result).toEqual({ stdout: "", stderr: "provider_unavailable", exitCode: 1 });
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
    const codexTui = codexTuiResponder({ stdout: fixture("codex-status.txt"), stderr: "", exitCode: 0 });
    const execute: TmuxCommandExecutor = async (_command, args) => {
      if (tmuxSubcommand(args) === "new-session") workingDirectory = args[args.indexOf("-c") + 1];
      return codexTui(args) ?? { stdout: "", stderr: "", exitCode: 0 };
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
    const codexTui = codexTuiResponder({ stdout: fixture("codex-status.txt"), stderr: "", exitCode: 0 });
    const execute: TmuxCommandExecutor = async (_command, args) => {
      const subcommand = tmuxSubcommand(args);
      if (subcommand === "kill-server" || subcommand === "has-session") {
        return { stdout: "", stderr: "error connecting to /private/tmux/socket (Permission denied)", exitCode: 1 };
      }
      return codexTui(args) ?? { stdout: "", stderr: "", exitCode: 0 };
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

  it("maps an unclassified launch failure to bounded provider unavailability without raw stderr", async () => {
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

    expect(result).toEqual({ stdout: "", stderr: "provider_unavailable", exitCode: 1 });
    expect(JSON.stringify(result)).not.toContain("/private/provider/path");
  });
});
