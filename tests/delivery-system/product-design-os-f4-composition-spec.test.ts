import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  validateCompositionSpecs,
  validateProductDesignOs,
  type PdosValidationIssue
} from "../../product-design-os/scripts/validate-product-design-os";
import { validateJsonSchema } from "../../src/lib/delivery-system/validation";

const repoRoot = process.cwd();
const pdosRoot = join(repoRoot, "product-design-os");
const compositionSchemaFile = join(pdosRoot, "specs", "composition.schema.json");
const compositionExampleFile = join(pdosRoot, "specs", "examples", "buildable-marketing.composition.json");
const compositionTargetSchemaFile = join(pdosRoot, "composition", "composition-target.schema.json");

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

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecordProperty(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const property = value[key];
  if (!isRecord(property)) {
    throw new Error("Expected object property " + key);
  }
  return property;
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function specWithMutation(mutator: (spec: Record<string, unknown>) => void): Record<string, unknown> {
  const spec = cloneRecord(readJsonRecord(compositionExampleFile));
  mutator(spec);
  return spec;
}

function validateTempSpec(spec: Record<string, unknown>): readonly string[] {
  const tempRoot = mkdtempSync(join(tmpdir(), "pdos-f4-"));
  const tempPdosRoot = join(tempRoot, "product-design-os");
  const allowedPatternIds = ["sharp-positioning-hero", "theme-crossed-direction", "proof-led-section", "outcome-cta"];
  const assetIds = ["editorial-motion-hero", "theme-calm-prism-grid", "proof-strip-case-study"];

  try {
    mkdirSync(join(tempPdosRoot, "specs", "examples"), { recursive: true });
    mkdirSync(join(tempPdosRoot, "recipes"), { recursive: true });
    mkdirSync(join(tempPdosRoot, "patterns"), { recursive: true });
    mkdirSync(join(tempPdosRoot, "assets"), { recursive: true });

    writeJson(join(tempPdosRoot, "specs", "composition.schema.json"), readJson(compositionSchemaFile));
    writeJson(join(tempPdosRoot, "specs", "examples", "test.composition.json"), spec);
    writeJson(join(tempPdosRoot, "recipes", "marketing-premium.json"), {
      id: "marketing-premium",
      allowed_pattern_ids: allowedPatternIds
    });
    writeJson(join(tempPdosRoot, "patterns", "pattern-manifest.json"), {
      patterns: [...allowedPatternIds, "animated-hero"].map((id) => ({ id }))
    });
    writeJson(join(tempPdosRoot, "assets", "asset-manifest.json"), {
      assets: assetIds.map((id) => ({ id }))
    });

    const errors: PdosValidationIssue[] = [];
    validateCompositionSpecs(tempPdosRoot, tempRoot, errors);
    return errors.map((error) => error.message);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe("Product Design OS F4 composition specs", () => {
  it("preserves the validation baseline with the committed F4 example present", () => {
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
      PDOS_EMPTY_TOKENS: 6
    });
  });

  it("validates the buildable marketing example against composition.schema", () => {
    const schema = readJson(compositionSchemaFile);
    const example = readJson(compositionExampleFile);

    expect(validateJsonSchema(example, schema)).toEqual([]);
  });

  it("reports unknown recipe references as spec errors", () => {
    const messages = validateTempSpec(
      specWithMutation((spec) => {
        spec.recipe_id = "missing-recipe";
      })
    );

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_SPEC_UNKNOWN_RECIPE")]));
  });

  it("reports unknown pattern references as spec errors", () => {
    const messages = validateTempSpec(
      specWithMutation((spec) => {
        spec.pattern_ids = ["missing-pattern"];
      })
    );

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_SPEC_UNKNOWN_PATTERN")]));
  });

  it("reports recipe-disallowed patterns as spec errors", () => {
    const messages = validateTempSpec(
      specWithMutation((spec) => {
        spec.pattern_ids = ["animated-hero"];
      })
    );

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_SPEC_PATTERN_NOT_ALLOWED")]));
  });

  it("blocks token overrides until the token floor is filled", () => {
    const messages = validateTempSpec(
      specWithMutation((spec) => {
        spec.token_overrides = { enabled: true, values: [] };
      })
    );

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_SPEC_TOKEN_OVERRIDES_BEFORE_FLOOR")]));
  });

  it("keeps F4 top-level fields as a superset of F3 composition target fields", () => {
    const f3Properties = getRecordProperty(readJsonRecord(compositionTargetSchemaFile), "properties");
    const f4Properties = getRecordProperty(readJsonRecord(compositionSchemaFile), "properties");

    expect(Object.keys(f4Properties).sort()).toEqual(expect.arrayContaining(Object.keys(f3Properties).sort()));
  });
});
