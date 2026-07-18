import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("review memory operating contract", () => {
  it("documents bounded delta and complete release review", () => {
    const guidance = readFileSync("AGENTS.md", "utf8");
    const runbook = readFileSync(
      "docs/operations/review-memory-runbook.md",
      "utf8",
    );
    const combined = `${guidance}\n${runbook}`;

    for (const required of [
      "review memory",
      "affected invariant IDs",
      "focused delta",
      "complete branch review",
      "regression test",
      "new or amended invariant",
    ]) {
      expect(combined).toContain(required);
    }

    expect(runbook).toContain("contains_raw_content");
    expect(runbook).toContain("does not activate routing");
    expect(runbook).toContain("--no-memory-reason");
    expect(runbook).toContain("20 ordinary and 5 high-risk");
  });
});
