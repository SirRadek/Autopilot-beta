import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  sampleProductDesignVariants,
  type PdosProductDesignVariantsReport
} from "../../product-design-os/qa/variants/sample-product-design-variants";
import {
  scoreProductDesignOs,
  type PdosAssetCandidate,
  type PdosPatternCandidate,
  type PdosRecipeCandidate,
  type PdosScoreInput,
  type PdosScoreReport
} from "../../product-design-os/scripts/score-product-design-os";

const repoRoot = process.cwd();
const baselineRoot = join(repoRoot, "tests", "fixtures", "score-baseline");
const originalAllowedPatternEnv = process.env.PDOS_ENFORCE_ALLOWED_PATTERNS;

const marketingRecipe: PdosRecipeCandidate = {
  id: "marketing-premium",
  project_types: ["marketing_web", "landing_page"],
  priorities: ["conversion"],
  logic_priority: 5,
  design_priority: 8,
  motion_level: 4,
  allowed_pattern_ids: ["sharp-positioning-hero", "theme-crossed-direction", "proof-led-section", "outcome-cta"],
  blocked_assets: [],
  tests_required: ["visual-qa"]
};

const contractedMarketingPatterns: readonly PdosPatternCandidate[] = [
  marketingPattern("outcome-cta", "conversion_pattern", 3, 9, 9),
  marketingPattern("sharp-positioning-hero", "conversion_pattern", 3, 9, 9),
  marketingPattern("proof-led-section", "conversion_pattern", 4, 8, 8),
  marketingPattern("theme-crossed-direction", "layout_pattern", 6, 7, 7)
];

const contractedMarketingAssets: readonly PdosAssetCandidate[] = [
  marketingAsset("editorial-motion-hero", "hero", 9, 7, 7, 3),
  marketingAsset("theme-calm-prism-grid", "background", 7, 8, 1, 1),
  marketingAsset("proof-strip-case-study", "section", 6, 9, 2, 1)
];

const contractedMarketingInput: PdosScoreInput = {
  text: "marketing service landing page with proof and request CTA",
  project_type: "marketing_web",
  logic_priority: 5,
  design_priority: 8,
  motion_level: 4,
  recipes: [marketingRecipe],
  patterns: contractedMarketingPatterns,
  assets: contractedMarketingAssets
};

const noContractInput: PdosScoreInput = {
  text: "internal admin table workflow",
  project_type: "admin_panel",
  logic_priority: 9,
  design_priority: 3,
  motion_level: 1,
  recipes: [
    {
      id: "internal-ops-clean",
      project_types: ["admin_panel", "internal_system"],
      priorities: ["operations"],
      logic_priority: 9,
      design_priority: 3,
      motion_level: 1,
      allowed_pattern_ids: ["status-badges", "table-first", "saved-filters"],
      blocked_assets: [],
      tests_required: ["visual-qa"]
    }
  ],
  patterns: [
    {
      id: "status-badges",
      type: "ux_pattern",
      use_case: ["admin_panel", "internal_system"],
      good_for: ["state clarity"],
      bad_for: [],
      complexity: 3,
      usability: 9,
      mobile_quality: 9,
      requires: ["state labels"],
      risks: []
    },
    {
      id: "table-first",
      type: "data_pattern",
      use_case: ["admin_panel", "internal_system"],
      good_for: ["operator throughput"],
      bad_for: [],
      complexity: 6,
      usability: 10,
      mobile_quality: 6,
      requires: ["table structure"],
      risks: []
    },
    {
      id: "saved-filters",
      type: "ux_pattern",
      use_case: ["admin_panel", "internal_system"],
      good_for: ["repeat workflows"],
      bad_for: [],
      complexity: 5,
      usability: 8,
      mobile_quality: 7,
      requires: ["named views"],
      risks: []
    }
  ],
  assets: []
};

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function readJsonRecord(file: string): Record<string, unknown> {
  const value = readJson(file);
  if (!isRecord(value)) {
    throw new Error("Expected JSON object in " + file);
  }
  return value;
}

function readBaselineInputs(): readonly string[] {
  const inputs = readJsonRecord(join(baselineRoot, "inputs.json")).inputs;
  if (!Array.isArray(inputs) || !inputs.every((input): input is string => typeof input === "string")) {
    throw new Error("Score baseline inputs must be an array of strings.");
  }
  return inputs;
}

function stripReportMarkdown(report: PdosScoreReport): Omit<PdosScoreReport, "report_markdown"> {
  const { report_markdown: _reportMarkdown, ...jsonReport } = report;
  return jsonReport;
}

function patternIds(report: PdosScoreReport): readonly string[] {
  return report.selected.patterns.map((pattern) => pattern.id);
}

function variantPatternProjection(report: PdosProductDesignVariantsReport): readonly {
  readonly id: string;
  readonly selected_patterns: readonly string[];
}[] {
  return report.variants.map((variant) => ({
    id: variant.id,
    selected_patterns: variant.selected_patterns
  }));
}

function marketingPattern(
  id: string,
  type: string,
  complexity: number,
  usability: number,
  mobileQuality: number
): PdosPatternCandidate {
  return {
    id,
    type,
    use_case: ["marketing_web", "landing_page"],
    good_for: ["conversion"],
    bad_for: [],
    complexity,
    usability,
    mobile_quality: mobileQuality,
    requires: ["contracted"],
    risks: []
  };
}

function marketingAsset(
  id: string,
  type: string,
  creativity: number,
  trust: number,
  motionLevel: number,
  performanceCost: number
): PdosAssetCandidate {
  return {
    id,
    type,
    style: ["marketing"],
    use_case: ["marketing_web", "landing_page"],
    target: ["founder"],
    creativity,
    trust,
    motion_level: motionLevel,
    performance_cost: performanceCost,
    mobile_safe: true,
    template_risk: 1
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("Product Design OS F7 variants sampler", () => {
  beforeEach(() => {
    delete process.env.PDOS_ENFORCE_ALLOWED_PATTERNS;
  });

  afterEach(() => {
    if (originalAllowedPatternEnv === undefined) {
      delete process.env.PDOS_ENFORCE_ALLOWED_PATTERNS;
      return;
    }
    process.env.PDOS_ENFORCE_ALLOWED_PATTERNS = originalAllowedPatternEnv;
  });

  it("keeps the seven committed score fixtures byte-compatible and variant-free", () => {
    readBaselineInputs().forEach((input, index) => {
      const actual = stripReportMarkdown(scoreProductDesignOs(input, repoRoot));
      const expected = readJson(join(baselineRoot, `score-${index + 1}.json`));

      expect(actual).toEqual(expected);
      expect(actual).not.toHaveProperty("variants");
    });
  });

  it("returns today's top-limit selected patterns for N=1", () => {
    const report = sampleProductDesignVariants("marketing website for a startup with bold motion", {
      variant_count: 1,
      limit: 3
    }, repoRoot);
    const score = scoreProductDesignOs({ text: "marketing website for a startup with bold motion", limit: 3 }, repoRoot);

    expect(report.requested).toBe(1);
    expect(report.returned).toBe(1);
    expect(report.variants[0]?.selected_patterns).toEqual(patternIds(score));
  });

  it("returns distinct floor-passing variants for contracted marketing bundles", () => {
    const report = sampleProductDesignVariants(contractedMarketingInput, { variant_count: 2, limit: 3 }, repoRoot);

    expect(report.returned).toBeGreaterThanOrEqual(1);
    expect(report.returned).toBeLessThanOrEqual(2);
    expect(new Set(report.variants.map((variant) => variant.id)).size).toBe(report.variants.length);
    expect(new Set(report.variants.map((variant) => variant.selected_patterns.join("|"))).size).toBe(
      report.variants.length
    );
    expect(report.variants.every((variant) => variant.build_floor_passed)).toBe(true);
  });

  it("reports shortfall without fabricating variants when top patterns have no contracts", () => {
    const report = sampleProductDesignVariants(noContractInput, { variant_count: 3, limit: 3 }, repoRoot);

    expect(report.requested).toBe(3);
    expect(report.returned).toBe(0);
    expect(report.shortfall).toBe(3);
    expect(report.variants).toEqual([]);
  });

  it("is deterministic for identical inputs", () => {
    const first = sampleProductDesignVariants(contractedMarketingInput, { variant_count: 3, limit: 3 }, repoRoot);
    const second = sampleProductDesignVariants(contractedMarketingInput, { variant_count: 3, limit: 3 }, repoRoot);

    expect(variantPatternProjection(first)).toEqual(variantPatternProjection(second));
  });
});
