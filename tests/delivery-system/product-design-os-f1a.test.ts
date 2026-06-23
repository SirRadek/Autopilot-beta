import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveAllowedPatternIds,
  scoreProductDesignOs,
  type PdosRecipeCandidate,
  type PdosScoreReport
} from "../../product-design-os/scripts/score-product-design-os";
import { validateProductDesignOs } from "../../product-design-os/scripts/validate-product-design-os";
import { validateJsonSchema } from "../../src/lib/delivery-system/validation";

const repoRoot = process.cwd();

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripReportMarkdown(report: PdosScoreReport): Omit<PdosScoreReport, "report_markdown"> {
  const { report_markdown: _reportMarkdown, ...jsonReport } = report;
  return jsonReport;
}

describe("Product Design OS F1a contracts", () => {
  it("preserves the F0 validation baseline", () => {
    const report = validateProductDesignOs(repoRoot);
    const countsByCode = new Map<string, number>();

    for (const warning of report.warnings) {
      const code = warning.code;
      expect(code).toBeDefined();
      if (code === undefined) {
        throw new Error("Warning is missing code: " + warning.file);
      }
      countsByCode.set(code, (countsByCode.get(code) ?? 0) + 1);
    }

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(Object.fromEntries([...countsByCode.entries()].sort())).toEqual({
      PDOS_ASSET_REF_TAG_MIX: 3,
      PDOS_EMPTY_TOKENS: 6,
      // F2 batch 1 registered demo-world-hub → its 2 ghost occurrences resolved (13 → 11).
      PDOS_GHOST_PATTERN: 11
    });
  });

  it("validates all committed recipes against recipe.schema.json", () => {
    const recipesRoot = join(repoRoot, "product-design-os", "recipes");
    const schema = readJson(join(recipesRoot, "recipe.schema.json"));
    const recipeFiles = readdirSync(recipesRoot)
      .filter((file) => file.endsWith(".json") && file !== "recipe.schema.json")
      .sort();

    expect(recipeFiles).toHaveLength(7);
    for (const recipeFile of recipeFiles) {
      const issues = validateJsonSchema(readJson(join(recipesRoot, recipeFile)), schema);
      expect(issues, recipeFile).toEqual([]);
    }
  });

  it("rejects invalid recipe contract shapes", () => {
    const recipesRoot = join(repoRoot, "product-design-os", "recipes");
    const schema = readJson(join(recipesRoot, "recipe.schema.json"));
    const baseRecipe = readJsonRecord(join(recipesRoot, "marketing-premium.json"));

    const missingRequired = { ...baseRecipe };
    delete missingRequired.project_types;
    expect(validateJsonSchema(missingRequired, schema)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "$.project_types" })])
    );

    expect(validateJsonSchema({ ...baseRecipe, id: "Bad_ID" }, schema)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "$.id" })])
    );

    expect(validateJsonSchema({ ...baseRecipe, schema_version: "1" }, schema)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "$.schema_version" })])
    );
  });

  it("validates F1a asset reference and tag split fields", () => {
    const schema = readJson(join(repoRoot, "product-design-os", "assets", "asset.schema.json"));
    const asset = {
      id: "synthetic-asset",
      type: "component",
      style: ["plain"],
      use_case: ["marketing_web"],
      target: ["founder"],
      creativity: 5,
      trust: 8,
      motion_level: 1,
      performance_cost: 2,
      mobile_safe: true,
      dependencies: [],
      works_with: [],
      avoid_with: [],
      dependency_ids: ["theme-calm-prism-grid"],
      works_with_tags: ["checkout"],
      template_risk: 1,
      license: "internal",
      source: "internal",
      provenance_status: "internal"
    };

    expect(validateJsonSchema(asset, schema)).toEqual([]);
    expect(validateJsonSchema({ ...asset, dependency_ids: ["Bad-ID"] }, schema)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "$.dependency_ids[0]" })])
    );
  });

  it("resolves dual-read allowed pattern ids without affecting scoring", () => {
    expect(resolveAllowedPatternIds({ allowed_patterns: ["legacy"] } as unknown as PdosRecipeCandidate)).toEqual([
      "legacy"
    ]);
    expect(resolveAllowedPatternIds({ allowed_pattern_ids: ["next"] } as unknown as PdosRecipeCandidate)).toEqual([
      "next"
    ]);
    expect(
      resolveAllowedPatternIds({
        allowed_patterns: ["a", "b"],
        allowed_pattern_ids: ["b", "c"]
      } as unknown as PdosRecipeCandidate)
    ).toEqual(["a", "b", "c"]);
  });

  it("keeps score output identical to the committed F1a baseline fixtures", () => {
    const baselineRoot = join(repoRoot, "tests", "fixtures", "score-baseline");
    const inputsFile = readJsonRecord(join(baselineRoot, "inputs.json"));
    const inputs = inputsFile.inputs;

    expect(inputs).toEqual([
      "",
      "marketing website for a startup with bold motion",
      "internal admin dashboard with heavy data tables",
      "ecommerce checkout conversion store",
      "accessible public sector portal",
      "client portal trust login",
      "creative portfolio animated hero"
    ]);
    if (!Array.isArray(inputs) || !inputs.every((input) => typeof input === "string")) {
      throw new Error("Score baseline inputs must be an array of strings.");
    }

    inputs.forEach((input, index) => {
      const actual = stripReportMarkdown(scoreProductDesignOs(input, repoRoot));
      const expected = readJson(join(baselineRoot, "score-" + (index + 1) + ".json"));
      expect(actual).toEqual(expected);
    });
  });
});
