import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseAgyUsage,
  parseClaudeUsage,
  parseCodexStatus,
  runTmuxUsageProbe,
  type TmuxCommandExecutor
} from "../../src/data/delivery-system/providerUsageProbe";

const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`../fixtures/provider-usage/${name}`, import.meta.url)), "utf8");

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

  it("normalizes authenticated Claude model labels and drops unmapped labels", () => {
    expect(parseClaudeUsage(fixture("claude-usage.txt"))).toEqual({
      five_hour: { limit: 100, used: 12, remaining: 88, resets_at: "11:40am (UTC)" },
      weekly: { limit: 100, used: 34, remaining: 66, resets_at: "Jul 17, 6pm (UTC)" },
      models: [
        { model_id: "claude-opus-4-8", available: true }
      ]
    });
  });

  it("returns no Claude models when every extracted label is unmapped", () => {
    const raw = fixture("claude-usage.txt").replace("Opus 4.8", "Fable 5");

    expect(parseClaudeUsage(raw)?.models).toEqual([]);
  });

  it("does not infer Claude quota from an unauthenticated login screen", () => {
    expect(parseClaudeUsage("Choose a login method\nSign in with Claude.ai")).toBeNull();
  });
});

describe("tmux usage probe", () => {
  it("uses an allowlisted CLI, bounded capture and always removes its session", async () => {
    const calls: string[][] = [];
    const execute: TmuxCommandExecutor = async (_command, args) => {
      calls.push([...args]);
      return args[0] === "capture-pane" ? { stdout: fixture("codex-status.txt"), stderr: "", exitCode: 0 } : { stdout: "", stderr: "", exitCode: 0 };
    };
    const result = await runTmuxUsageProbe("codex_cli", { execute, timeoutMs: 100, sessionId: "autopilot-quota-test", delayMs: 0 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeLessThanOrEqual(128 * 1024);
    expect(calls.some((args) => args.includes("/status"))).toBe(true);
    expect(calls.at(-1)).toEqual(["kill-session", "-t", "autopilot-quota-test"]);
    const statusIndex = calls.findIndex((args) => args.includes("/status"));
    const enterSendsAfterStatus = calls.slice(statusIndex + 1).filter((args) => args.includes("C-m")).length;
    expect(enterSendsAfterStatus).toBe(1);
  });

  it("reports missing credentials for Claude login without fabricating quota", async () => {
    const execute: TmuxCommandExecutor = async (_command, args) => args[0] === "capture-pane"
      ? { stdout: "Choose a login method\nSign in with Claude.ai", stderr: "", exitCode: 0 }
      : { stdout: "", stderr: "", exitCode: 0 };
    const result = await runTmuxUsageProbe("claude_cli", { execute, timeoutMs: 100, sessionId: "autopilot-quota-test", delayMs: 0 });
    expect(result).toMatchObject({ exitCode: 1, stderr: "missing_credential" });
  });
});
