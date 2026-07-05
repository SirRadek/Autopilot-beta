import { readFileSync, unlinkSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLI_WORKER_MAX_PROMPT_CHARS,
  buildAgyArgs,
  writePromptFile
} from "../../src/data/delivery-system/cliWorkerCapture";
import { contextWidthSpecs } from "../../src/data/delivery-system/tokenEfficiency";

describe("CLI worker prompt limit", () => {
  it("derives the default limit from the large context-width spec", () => {
    expect(DEFAULT_CLI_WORKER_MAX_PROMPT_CHARS).toBe(
      contextWidthSpecs.large.maxContextLines * contextWidthSpecs.large.maxFilesInPacket
    );
  });

  it("writes an under-limit prompt unchanged", () => {
    const prompt = "bounded governance prompt";
    const path = writePromptFile(prompt, "hp-prompt-limit", { maxPromptChars: prompt.length });

    try {
      expect(readFileSync(path, "utf8")).toBe(prompt);
    } finally {
      unlinkSync(path);
    }
  });

  it("builds vendor args with an under-limit prompt unchanged", () => {
    const prompt = "send exactly this";

    // agy runs read-only by construction: --sandbox is forced after the prompt (agitated security default).
    expect(buildAgyArgs(prompt, { maxPromptChars: prompt.length })).toEqual([
      "--print",
      prompt,
      "--sandbox"
    ]);
  });

  it("throws with the limit and actual size when the prompt is over limit", () => {
    expect(() => writePromptFile("123456", "hp-prompt-limit", { maxPromptChars: 5 }))
      .toThrow(/actual size 6 chars exceeds maxPromptChars limit 5 chars/);
  });
});
