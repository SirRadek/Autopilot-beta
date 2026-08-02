import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ALLOWED_OPS, validateMutationProposals } from "../../scripts/validate-mutation-proposals";
import { validateJsonSchema } from "../../src/lib/delivery-system/validation";

const root = process.cwd();
const schema = JSON.parse(readFileSync(join(root, "design/mutations/mutation-proposal.schema.json"), "utf8")) as unknown;
const example = JSON.parse(readFileSync(join(root, "design/mutations/examples/run-card-frame.proposal.json"), "utf8")) as Record<string, unknown>;

describe("figma mutation proposals", () => {
  it("validates every repo proposal (schema + allowlist + version checkpoint)", () => {
    const report = validateMutationProposals();
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checkedFiles.length).toBeGreaterThan(0);
  });

  it("has no arbitrary-code op in the allowlist", () => {
    for (const op of ALLOWED_OPS) expect(op).not.toMatch(/eval|exec|js|script|run/i);
  });

  it("rejects an op outside the allowlist (schema enum)", () => {
    const bad = { ...example, ops: [{ op: "executeJS", args: { code: "figma.root.remove()" } }] };
    expect(validateJsonSchema(bad, schema).length).toBeGreaterThan(0);
  });

  it("rejects a proposal without a version checkpoint", () => {
    const bad = { ...example, rollbackPlan: { versionCheckpoint: false } };
    expect(validateJsonSchema(bad, schema).length).toBeGreaterThan(0);
  });
});
