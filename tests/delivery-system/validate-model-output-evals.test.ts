import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validateModelOutputEvals } from "../../scripts/validate-model-output-evals";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("model-output eval validator", () => {
  it("accepts a conforming eval record", () => {
    const root = createModelOutputEvalFixture();
    writeRecord(root, "valid.json", readRepoJson("model-output-evals/examples/learning-loop.accepted.example.json"));

    const report = validateModelOutputEvals(root);

    expect(report.ok).toBe(true);
    expect(report.checkedRecords).toBe(1);
    expect(report.errors).toEqual([]);
  });

  it("rejects an eval record missing a required field", () => {
    const root = createModelOutputEvalFixture();
    const record = readRepoJson("model-output-evals/examples/learning-loop.accepted.example.json");
    delete record.privacy_review;
    writeRecord(root, "missing-required.json", record);

    const report = validateModelOutputEvals(root);

    expect(report.ok).toBe(false);
    expect(report.errors).toContainEqual({
      file: "model-output-evals/records/missing-required.json",
      message: "$.privacy_review: is required"
    });
  });
});

function createModelOutputEvalFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "validate-model-output-evals-"));
  tempRoots.push(root);

  const evalRoot = join(root, "model-output-evals");
  const examplesRoot = join(evalRoot, "examples");
  const promptLibraryRoot = join(root, "prompt-library");
  mkdirSync(examplesRoot, { recursive: true });
  mkdirSync(join(evalRoot, "records"), { recursive: true });
  mkdirSync(promptLibraryRoot, { recursive: true });

  copyRepoFile("model-output-evals/model-output-eval-record.schema.json", join(evalRoot, "model-output-eval-record.schema.json"));
  copyRepoFile("model-output-evals/worker-output.schema.json", join(evalRoot, "worker-output.schema.json"));
  copyRepoFile("model-output-evals/reviewer-output.schema.json", join(evalRoot, "reviewer-output.schema.json"));
  copyRepoFile("model-output-evals/examples/valid-worker-output.json", join(examplesRoot, "valid-worker-output.json"));
  copyRepoFile("model-output-evals/examples/invalid-worker-output.json", join(examplesRoot, "invalid-worker-output.json"));
  copyRepoFile("model-output-evals/examples/valid-reviewer-output.json", join(examplesRoot, "valid-reviewer-output.json"));
  copyRepoFile("prompt-library/source-catalog.json", join(promptLibraryRoot, "source-catalog.json"));

  return root;
}

function writeRecord(root: string, fileName: string, record: Record<string, unknown>): void {
  writeFileSync(join(root, "model-output-evals", "records", fileName), `${JSON.stringify(record, null, 2)}\n`);
}

function readRepoJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as Record<string, unknown>;
}

function copyRepoFile(from: string, to: string): void {
  writeFileSync(to, readFileSync(join(process.cwd(), from), "utf8"));
}
