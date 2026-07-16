import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Codex efficiency operating baseline", () => {
  it("documents every acceptance and rollback gate", () => {
    const text = readFileSync(
      "docs/operations/codex-efficiency-runbook.md",
      "utf8",
    );

    for (const required of [
      "30 percent",
      "150k",
      "20 ordinary",
      "5 high-risk",
      "Critical",
      "High",
      "rollback",
      "insufficient_evidence",
      "routing remains shadow-only",
    ]) {
      expect(text).toContain(required);
    }
  });

  it("records an aggregate-only initial baseline without inventing samples", () => {
    const baseline = JSON.parse(
      readFileSync(
        "docs/autopilot/codex-efficiency-baseline-2026-07-15.json",
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(baseline).toMatchObject({
      schema_version: "autopilot-codex-efficiency-baseline-v1",
      coverage: "insufficient_evidence",
      contains_raw_content: false,
      method: "replay-aware-positive-counter-delta",
      samples: { ordinary: 0, high_risk: 0, completed: 0 },
      routing: {
        mode: "shadow_only",
        recommended_model: null,
        recommended_reasoning_effort: null,
      },
    });
    expect(JSON.stringify(baseline)).not.toMatch(
      /prompt|response|secret|environment|tool_payload/i,
    );
  });

  it("keeps the routing handoff explicitly non-activating", () => {
    const architecture = readFileSync(
      "docs/projects/autopilot-control-plane/architecture.md",
      "utf8",
    );
    const contextPolicy = readFileSync(
      "mesh/nodes/context_economy_policy.yaml",
      "utf8",
    );
    const spendPolicy = readFileSync(
      "mesh/nodes/model_spend_policy.yaml",
      "utf8",
    );

    for (const text of [architecture, contextPolicy, spendPolicy]) {
      expect(text).toContain("shadow-only");
      expect(text).toContain("recommended_model");
      expect(text).toContain("recommended_reasoning_effort");
    }
  });

  it("separates the diagnostic initial record from a future matched comparator", () => {
    const text = readFileSync(
      "docs/operations/codex-efficiency-runbook.md",
      "utf8",
    );

    expect(text).toContain("diagnostic initial record");
    expect(text).toContain("<matched-baseline.json>");
    expect(text).toContain("<matched-candidate.json>");
    expect(text).toContain(
      "must not be used as the stage-one acceptance comparator",
    );
  });
});
