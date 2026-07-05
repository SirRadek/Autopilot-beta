import { describe, expect, it } from "vitest";

import { extractWaivedTargets, findUnwaivedBaselineGrowth } from "../../scripts/check-baseline-waivers.mjs";

// The report-first self-approval gate: a baseline "excuse" (vendor-manifest beta_authored/patched_by,
// fit-safety warn-only component, related-files grandfathered MISSING) that grows without a
// `Baseline-Waiver:` commit trailer is surfaced. These pin the pure core (audit 2026-07-05 §4-B).

const file = "vendor-manifest.json";

function entry(before: string[], after: string[]) {
  return { path: file, before: new Set(before), after: new Set(after) };
}

describe("extractWaivedTargets", () => {
  it("parses a Baseline-Waiver trailer target (filename before the dash)", () => {
    const targets = extractWaivedTargets(["feat: x\n\nBaseline-Waiver: vendor-manifest.json — merging motion assets"]);
    expect(targets.has("vendor-manifest.json")).toBe(true);
  });

  it("collects targets across multiple commits and ignores messages without a trailer", () => {
    const targets = extractWaivedTargets([
      "fix: y\n\nBaseline-Waiver: fit-safety-baseline.json — new hero variant",
      "chore: no waiver here"
    ]);
    expect([...targets].sort()).toEqual(["fit-safety-baseline.json"]);
  });

  it("returns an empty set when no trailer is present", () => {
    expect(extractWaivedTargets(["just a normal commit"]).size).toBe(0);
  });
});

describe("findUnwaivedBaselineGrowth", () => {
  it("flags added excuse entries when no waiver covers the file", () => {
    const findings = findUnwaivedBaselineGrowth([entry(["a"], ["a", "b"])], ["feat: sneak in a beta_authored entry"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: file, added: ["b"] });
  });

  it("does not flag growth waived by the file basename", () => {
    const findings = findUnwaivedBaselineGrowth(
      [entry(["a"], ["a", "b"])],
      ["feat: add asset\n\nBaseline-Waiver: vendor-manifest.json — reviewed: motion pack"]
    );
    expect(findings).toEqual([]);
  });

  it("does not flag growth waived by `all`", () => {
    const findings = findUnwaivedBaselineGrowth([entry(["a"], ["a", "b"])], ["merge\n\nBaseline-Waiver: all — 3-branch consolidation"]);
    expect(findings).toEqual([]);
  });

  it("does not flag when the baseline did not grow (or shrank)", () => {
    expect(findUnwaivedBaselineGrowth([entry(["a", "b"], ["a"])], [])).toEqual([]);
    expect(findUnwaivedBaselineGrowth([entry(["a"], ["a"])], [])).toEqual([]);
  });

  it("flags growth when the waiver names a different file", () => {
    const findings = findUnwaivedBaselineGrowth(
      [entry(["a"], ["a", "b"])],
      ["feat: x\n\nBaseline-Waiver: fit-safety-baseline.json — unrelated"]
    );
    expect(findings).toHaveLength(1);
  });
});
