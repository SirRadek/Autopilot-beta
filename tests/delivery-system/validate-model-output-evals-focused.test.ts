import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  modelOutputEvalValidationExitCode,
  validateModelOutputEvalRecord,
  type ModelOutputEvalValidationIssue,
  type ModelOutputEvalValidationReport
} from "../../scripts/validate-model-output-evals";

const sourceIds = new Set([
  "local-agents-md",
  "token-efficiency-operating-model",
  "prompt-library-policy"
]);

describe("model-output eval record validation", () => {
  it("accepts a valid record and maps it to a zero exit code", () => {
    const issues = validateRecord(validRecord());

    expect(issues).toEqual([]);
    expect(modelOutputEvalValidationExitCode(reportFor(issues))).toBe(0);
  });

  it("rejects a record missing a required field and maps it to a failing exit code", () => {
    const record = validRecord();
    delete record.privacy_review;

    const issues = validateRecord(record);

    expect(issues).toContainEqual({
      file: "record.json",
      message: "$.privacy_review: is required"
    });
    expect(modelOutputEvalValidationExitCode(reportFor(issues))).toBe(1);
  });

  it("rejects accepted records whose accepted_state is not accepted", () => {
    const record = validRecord();
    record.accepted_state = "not_accepted";

    const issues = validateRecord(record);

    expect(issues).toContainEqual({
      file: "record.json",
      message: "Accepted records must set accepted_state to accepted."
    });
    expect(modelOutputEvalValidationExitCode(reportFor(issues))).toBe(1);
  });

  it("rejects forbidden raw prompt content", () => {
    const record = validRecord();
    record.raw_prompt = "unredacted prompt text";

    const issues = validateRecord(record);

    expect(issues).toContainEqual({
      file: "record.json",
      message: "$.raw_prompt: forbidden raw or sensitive field."
    });
    expect(modelOutputEvalValidationExitCode(reportFor(issues))).toBe(1);
  });
});

function validateRecord(record: Record<string, unknown>): readonly ModelOutputEvalValidationIssue[] {
  return validateModelOutputEvalRecord({
    record,
    schema: schema(),
    sourceIds,
    file: "record.json"
  });
}

function reportFor(issues: readonly ModelOutputEvalValidationIssue[]): ModelOutputEvalValidationReport {
  return {
    ok: issues.length === 0,
    checkedFiles: ["record.json"],
    checkedRecords: 1,
    errors: issues
  };
}

function validRecord(): Record<string, unknown> {
  return readRepoJson("model-output-evals/examples/learning-loop.accepted.example.json");
}

function schema(): Record<string, unknown> {
  return readRepoJson("model-output-evals/model-output-eval-record.schema.json");
}

function readRepoJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as Record<string, unknown>;
}
