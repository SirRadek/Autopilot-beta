import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validatePromptLibrary } from "../../scripts/validate-prompt-library";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("prompt-library source resolution", () => {
  it("rejects prompt source ids missing from source-catalog.json", () => {
    const root = createPromptLibraryFixture();
    writePrompt(root, "01-gpt/unknown-source.md", promptFrontmatter("missing-source-id"));

    const report = validatePromptLibrary(root);

    expect(report.ok).toBe(false);
    expect(report.errors).toContainEqual({
      file: "prompt-library/01-gpt/unknown-source.md",
      message: '$.sources[0]: unknown source id "missing-source-id" in prompt-library/source-catalog.json'
    });
  });
});

function createPromptLibraryFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "prompt-library-source-resolution-"));
  tempRoots.push(root);

  const promptLibraryRoot = join(root, "prompt-library");
  mkdirSync(promptLibraryRoot, { recursive: true });

  copyRepoFile("prompt-library/prompt.schema.json", join(promptLibraryRoot, "prompt.schema.json"));
  copyRepoFile("prompt-library/source-catalog.schema.json", join(promptLibraryRoot, "source-catalog.schema.json"));
  writeFileSync(
    join(promptLibraryRoot, "source-catalog.json"),
    `${JSON.stringify(
      {
        version: 1,
        updated: "2026-06-20",
        sources: [
          {
            id: "local-agents-md",
            kind: "local_docs",
            location: "AGENTS.md",
            authority: "local-contract"
          }
        ]
      },
      null,
      2
    )}\n`
  );

  return root;
}

function writePrompt(root: string, relativePath: string, content: string): void {
  const path = join(root, "prompt-library", relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function promptFrontmatter(sourceId: string): string {
  return `---
id: source-resolution-prompt
title: Source Resolution Prompt
model_family: gpt
task_type: analysis
version: v1.0.0
status: draft
last_reviewed: 2026-07-04
sources:
  - ${sourceId}
risk_level: low
expected_output: A prompt-library fixture with source references.
evals:
  - tests/delivery-system/prompt-library-source-resolution.test.ts
---

# Source Resolution Prompt

Body.
`;
}

function copyRepoFile(from: string, to: string): void {
  writeFileSync(to, readFileSync(join(process.cwd(), from), "utf8"));
}
