import { describe, expect, it } from "vitest";

import {
  buildAgyArgs,
  buildClaudeArgs,
  buildCodexBashCommand,
  buildCodexExecArgs
} from "../../src/data/delivery-system/cliWorkerCapture";
import { SUPPORTED_REASONING_EFFORTS } from "../../src/data/delivery-system/executionProfile";

describe("adapter argv builders — owner-selected model/reasoning enforcement", () => {
  it("claude carries exactly one --model and one --effort pair", () => {
    const args = buildClaudeArgs("do it", { model: "opus", effort: "high" });
    expect(args.filter((value) => value === "--model")).toHaveLength(1);
    expect(args.filter((value) => value === "--effort")).toHaveLength(1);
    expect(args).toContain("opus");
    expect(args).toContain("high");
  });

  it("agy carries exactly one --model and one --effort pair", () => {
    const args = buildAgyArgs("ping", { model: "gemini-3-pro", effort: "medium" });
    expect(args.filter((value) => value === "--model")).toHaveLength(1);
    expect(args.filter((value) => value === "--effort")).toHaveLength(1);
    expect(args).toContain("gemini-3-pro");
    expect(args).toContain("medium");
  });

  it.each(["max", "ultra"] as const)("codex carries --model plus the verified %s reasoning config", (effort) => {
    const args = buildCodexExecArgs({ model: "gpt-5.6-sol", effort }, "/tmp/out.json");
    expect(args.filter((value) => value === "--model")).toHaveLength(1);
    expect(args).not.toContain("-m");
    expect(args).toContain("gpt-5.6-sol");
    expect(args).toContain("-c");
    expect(args).toContain(`model_reasoning_effort="${effort}"`);
  });

  it("codex bash-command path also carries the delegation-capable ultra config", () => {
    const cmd = buildCodexBashCommand("codex", { model: "gpt-5.6-sol", effort: "ultra" }, "/tmp/out.json", "/tmp/p.txt");
    expect(cmd).toContain('-c model_reasoning_effort="ultra"');
    expect(cmd).toContain("--model 'gpt-5.6-sol'");
  });

  it("never emits a fallback model flag when no model is supplied", () => {
    const claudeArgs = buildClaudeArgs("do it", {});
    const agyArgs = buildAgyArgs("ping", {});
    const codexArgs = buildCodexExecArgs({}, "/tmp/out.json");
    expect(claudeArgs).not.toContain("--model");
    expect(agyArgs).not.toContain("--model");
    expect(codexArgs).not.toContain("--model");
    expect(codexArgs).not.toContain("-m");
  });

  it("rejects an unsupported agy reasoning effort before any spawn", () => {
    expect(() => buildAgyArgs("ping", { effort: "xhigh" })).toThrow("unsupported_reasoning_effort");
  });

  it("rejects a non-null OpenRouter reasoning effort (no capability yet)", () => {
    // OpenRouter itself never accepts a model/effort argv (guarded upstream in cliWorker's
    // capability-tuple check); this asserts the shared enum used by that guard has no
    // supported efforts for openrouter_api, i.e. any non-null value is unsupported.
    expect(SUPPORTED_REASONING_EFFORTS.openrouter_api).toEqual([]);
  });

  it("rejects an empty model before any spawn", () => {
    expect(() => buildClaudeArgs("do it", { model: "" })).toThrow(/invalid_model/);
    expect(() => buildAgyArgs("ping", { model: "" })).toThrow(/invalid_model/);
    expect(() => buildCodexExecArgs({ model: "" }, "/tmp/out.json")).toThrow(/invalid_model/);
  });

  it("rejects a model value that resembles a duplicate/injected flag", () => {
    expect(() => buildClaudeArgs("do it", { model: "--effort" })).toThrow(/invalid_model/);
    expect(() => buildAgyArgs("ping", { model: "--sandbox" })).toThrow(/invalid_model/);
  });

  it("rejects a model containing whitespace/control characters before any spawn", () => {
    expect(() => buildClaudeArgs("do it", { model: "opus latest" })).toThrow(/invalid_model/);
    expect(() => buildAgyArgs("ping", { model: "gemini pro" })).toThrow(/invalid_model/);
    expect(() => buildCodexExecArgs({ model: "gpt 5" }, "/tmp/out.json")).toThrow(/invalid_model/);
    expect(() => buildClaudeArgs("do it", { model: "opus\n--effort high" })).toThrow(/invalid_model/);
    expect(() => buildAgyArgs("ping", { model: "gemini\t--sandbox" })).toThrow(/invalid_model/);
    expect(() => buildCodexExecArgs({ model: "gpt\x00-5" }, "/tmp/out.json")).toThrow(/invalid_model/);
    expect(() => buildClaudeArgs("do it", { model: "opus\u0085latest" })).toThrow(/invalid_model/);
    expect(() => buildAgyArgs("ping", { model: "gemini\u009flatest" })).toThrow(/invalid_model/);
    expect(() => buildCodexExecArgs({ model: "gpt\u0085-5" }, "/tmp/out.json")).toThrow(/invalid_model/);
  });
});
