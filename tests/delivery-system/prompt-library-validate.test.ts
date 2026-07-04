import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validatePromptLibrary } from "../../scripts/validate-prompt-library";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("prompt-library validator", () => {
  it("accepts a conforming prompt fixture", () => {
    const root = createPromptLibraryFixture();
    writePrompt(root, "01-gpt/valid.md", validFrontmatter());

    const report = validatePromptLibrary(root);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it("rejects a prompt missing a required frontmatter field", () => {
    const root = createPromptLibraryFixture();
    writePrompt(root, "01-gpt/missing-required.md", validFrontmatter().replace("last_reviewed: 2026-07-04\n", ""));

    const report = validatePromptLibrary(root);

    expect(report.ok).toBe(false);
    expect(report.errors).toContainEqual({
      file: "prompt-library/01-gpt/missing-required.md",
      message: "$.last_reviewed: is required"
    });
  });

  it("rejects a prompt file without frontmatter", () => {
    const root = createPromptLibraryFixture();
    writePrompt(root, "01-gpt/no-frontmatter.md", "# No Frontmatter\n\nBody.\n");

    const report = validatePromptLibrary(root);

    expect(report.ok).toBe(false);
    expect(report.errors).toContainEqual({
      file: "prompt-library/01-gpt/no-frontmatter.md",
      message: "Missing YAML frontmatter."
    });
  });
});

function createPromptLibraryFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "prompt-library-validate-"));
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
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function validFrontmatter(): string {
  return `---
id: valid-prompt
title: Valid Prompt
model_family: gpt
task_type: analysis
version: v1.0.0
status: draft
last_reviewed: 2026-07-04
sources:
  - local-agents-md
risk_level: low
expected_output: A valid prompt-library fixture.
evals:
  - tests/delivery-system/prompt-library-validate.test.ts
---

# Valid Prompt

Body.
`;
}

function copyRepoFile(from: string, to: string): void {
  writeFileSync(to, readFileSync(join(process.cwd(), from), "utf8"));
}
