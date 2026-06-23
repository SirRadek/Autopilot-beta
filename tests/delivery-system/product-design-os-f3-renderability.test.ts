import { describe, expect, it } from "vitest";

import {
  analyzeProductDesignRenderability,
  type PdosRenderabilityReport
} from "../../product-design-os/scripts/check-renderability-product-design-os";

const repoRoot = process.cwd();
const fixtureInput = {
  contractManifestPath: "product-design-os/qa/renderability/fixtures/component-contract-manifest.fixture.json",
  targetPaths: [
    "product-design-os/qa/renderability/fixtures/buildable-marketing.json",
    "product-design-os/qa/renderability/fixtures/nonbuildable-motion.json"
  ]
} as const;

function byId(report: PdosRenderabilityReport, id: string) {
  const composition = report.compositions.find((candidate) => candidate.id === id);
  if (composition === undefined) {
    throw new Error(`Missing composition report for ${id}`);
  }
  return composition;
}

describe("Product Design OS F3 renderability", () => {
  it("keeps the fixture report shape stable and does not throw", () => {
    let report: PdosRenderabilityReport | undefined;

    expect(() => {
      report = analyzeProductDesignRenderability(fixtureInput, repoRoot);
    }).not.toThrow();

    expect(report).toEqual(
      expect.objectContaining({
        ok: false,
        checked_files: expect.any(Array),
        compositions: expect.any(Array),
        summary: expect.objectContaining({
          target_count: 2,
          buildable_count: 1,
          non_buildable_count: 1
        })
      })
    );
  });

  it("reports buildable-marketing as buildable", () => {
    const report = analyzeProductDesignRenderability(fixtureInput, repoRoot);
    const composition = byId(report, "buildable-marketing");

    expect(composition.buildable).toBe(true);
    expect(composition.non_buildable).toEqual([]);
  });

  it("reports the intentional motion fixture failures", () => {
    const report = analyzeProductDesignRenderability(fixtureInput, repoRoot);
    const composition = byId(report, "nonbuildable-motion");
    const codes = new Set(composition.non_buildable.map((issue) => issue.code));

    expect(composition.buildable).toBe(false);
    expect(codes).toEqual(
      new Set(["CONTRACT_MISSING", "SLOT_MISSING", "INVARIANT_UNDECLARED", "VISUAL_QA_ERROR"])
    );
  });
});
