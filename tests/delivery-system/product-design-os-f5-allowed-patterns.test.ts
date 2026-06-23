import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  computeAllowedPatternShadowDiff,
  scoreProductDesignOs,
  type PdosScoreReport
} from "../../product-design-os/scripts/score-product-design-os";
import { validateProductDesignOs } from "../../product-design-os/scripts/validate-product-design-os";

const repoRoot = process.cwd();
const baselineRoot = join(repoRoot, "tests", "fixtures", "score-baseline");
const originalAllowedPatternEnv = process.env.PDOS_ENFORCE_ALLOWED_PATTERNS;

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

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
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

function selectedPatternIds(report: PdosScoreReport): readonly string[] {
  return report.selected.patterns.map((pattern) => pattern.id);
}

function scorePatternIdsWithEnv(value: string | undefined): readonly string[] {
  if (value === undefined) {
    delete process.env.PDOS_ENFORCE_ALLOWED_PATTERNS;
  } else {
    process.env.PDOS_ENFORCE_ALLOWED_PATTERNS = value;
  }

  return selectedPatternIds(scoreProductDesignOs("", repoRoot));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("Product Design OS F5 allowed pattern gating", () => {
  afterEach(() => {
    if (originalAllowedPatternEnv === undefined) {
      delete process.env.PDOS_ENFORCE_ALLOWED_PATTERNS;
      return;
    }

    process.env.PDOS_ENFORCE_ALLOWED_PATTERNS = originalAllowedPatternEnv;
  });

  it("keeps default scoring byte-identical to committed baseline fixtures", () => {
    delete process.env.PDOS_ENFORCE_ALLOWED_PATTERNS;

    readBaselineInputs().forEach((input, index) => {
      const actual = stripReportMarkdown(scoreProductDesignOs(input, repoRoot));
      const expected = readJson(join(baselineRoot, "score-" + (index + 1) + ".json"));
      expect(actual).toEqual(expected);
    });
  });

  it("computes an allowed-pattern shadow diff without mutating the score report shape", () => {
    const diff = computeAllowedPatternShadowDiff("marketing website for a startup with bold motion", repoRoot);

    expect(Object.keys(diff)).toEqual([
      "recipe_id",
      "allowed_pattern_ids",
      "current_selected",
      "gated_selected",
      "added",
      "removed"
    ]);
    expect(diff.recipe_id.length).toBeGreaterThan(0);
    expect(diff.gated_selected.every((patternId) => diff.allowed_pattern_ids.includes(patternId))).toBe(true);
    expect(diff.added).toEqual(diff.gated_selected.filter((patternId) => !diff.current_selected.includes(patternId)));
    expect(diff.removed).toEqual(diff.current_selected.filter((patternId) => !diff.gated_selected.includes(patternId)));
  });

  it("gates selected patterns against the top recipe when enforcement is enabled", () => {
    delete process.env.PDOS_ENFORCE_ALLOWED_PATTERNS;
    const unsetReport = scoreProductDesignOs("", repoRoot);
    const unsetPatternIds = selectedPatternIds(unsetReport);
    const diff = computeAllowedPatternShadowDiff("", repoRoot);

    process.env.PDOS_ENFORCE_ALLOWED_PATTERNS = "1";
    const gatedReport = scoreProductDesignOs("", repoRoot);
    const gatedPatternIds = selectedPatternIds(gatedReport);

    expect(gatedPatternIds.every((patternId) => diff.allowed_pattern_ids.includes(patternId))).toBe(true);
    if (unsetPatternIds.some((patternId) => !diff.allowed_pattern_ids.includes(patternId))) {
      expect(gatedPatternIds).not.toEqual(unsetPatternIds);
    }
    expect(gatedReport.rejected.patterns.every((pattern) => pattern.selected === false)).toBe(true);
  });

  it("parses only 1 and true as enforcement truthy values at call time", () => {
    const defaultIds = scorePatternIdsWithEnv(undefined);
    const enabledIds = scorePatternIdsWithEnv("1");

    expect(scorePatternIdsWithEnv("true")).toEqual(enabledIds);
    expect(scorePatternIdsWithEnv("0")).toEqual(defaultIds);
    expect(scorePatternIdsWithEnv("no")).toEqual(defaultIds);
    expect(scorePatternIdsWithEnv(undefined)).toEqual(defaultIds);
  });

  it("reports ghost recipe patterns as validator errors", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pdos-f5-"));
    const tempPdosRoot = join(tempRoot, "product-design-os");

    try {
      mkdirSync(join(tempPdosRoot, "recipes"), { recursive: true });
      mkdirSync(join(tempPdosRoot, "patterns"), { recursive: true });
      mkdirSync(join(tempPdosRoot, "scope"), { recursive: true });
      mkdirSync(join(tempPdosRoot, "rules"), { recursive: true });

      writeFileSync(
        join(tempPdosRoot, "scope", "PROJECT_SCOPE.md"),
        [
          "# Temp Project Scope",
          "## Typ projektu",
          "## Primarni cil",
          "## Cilovi uzivatele",
          "## Kriticke workflow",
          "## Definition Of Done"
        ].join("\n")
      );
      writeFileSync(
        join(tempPdosRoot, "rules", "strict-process.md"),
        [
          "# Strict Process",
          "select_capabilities",
          "get_relevant_subgraph",
          "build_agent_packet",
          "build_project_mesh_packet",
          "Project Type Lock",
          "QA Lock"
        ].join("\n")
      );
      writeJson(join(tempPdosRoot, "recipes", "recipe.schema.json"), {});
      writeJson(join(tempPdosRoot, "patterns", "pattern-manifest.json"), {
        version: 1,
        patterns: [{ id: "known-pattern" }]
      });

      const recipeFile = join(tempPdosRoot, "recipes", "marketing-premium.json");
      writeJson(recipeFile, {
        id: "marketing-premium",
        project_types: ["marketing_web"],
        priorities: ["conversion"],
        logic_priority: 5,
        design_priority: 8,
        motion_level: 4,
        allowed_pattern_ids: ["known-pattern", "missing-f5-pattern"],
        blocked_assets: ["blocked"],
        tests_required: ["visual-qa"]
      });

      const report = validateProductDesignOs(tempRoot);
      const ghostError = report.errors.find((error) => error.message.includes("PDOS_GHOST_PATTERN"));

      expect(ghostError).toBeDefined();
      expect(ghostError?.message).toContain("PDOS_GHOST_PATTERN: ");
      expect(ghostError).not.toHaveProperty("code");
      expect(report.warnings.some((warning) => warning.code === "PDOS_GHOST_PATTERN")).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
