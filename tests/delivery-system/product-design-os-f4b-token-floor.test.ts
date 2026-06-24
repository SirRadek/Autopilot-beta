import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TOKEN_FLOOR,
  validateCompositionSpecs,
  validateProductDesignOs,
  validateTokenFloor,
  type PdosValidationIssue
} from "../../product-design-os/scripts/validate-product-design-os";

const repoRoot = process.cwd();
const pdosRoot = join(repoRoot, "product-design-os");
const compositionSchemaFile = join(pdosRoot, "specs", "composition.schema.json");
const compositionExampleFile = join(pdosRoot, "specs", "examples", "buildable-marketing.composition.json");

const expectedTokenFloor = {
  "color.json": [
    "background",
    "surface",
    "text",
    "muted_text",
    "border",
    "accent",
    "accent_secondary",
    "accent_soft",
    "accent_text",
    "focus_ring"
  ],
  "typography.json": [
    "font_body",
    "font_heading",
    "size_body",
    "size_heading",
    "line_height_body",
    "weight_regular",
    "weight_bold"
  ],
  "spacing.json": ["space_1", "space_2", "space_3", "space_4", "space_6", "space_8"],
  "radius.json": ["none", "sm", "md", "lg"],
  "shadow.json": ["none", "sm", "md"],
  "motion.json": ["duration_fast", "duration_base", "duration_slow", "easing_standard", "reduced_motion"],
  "style.json": ["decoration_intensity", "accent_angle_deg", "corner_style", "heading_case", "surface_treatment"]
} as const;

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

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function writeTempTokenFloor(
  tempPdosRoot: string,
  mutateTokens?: (fileName: string, tokens: Record<string, unknown>) => void
): void {
  const tokensRoot = join(tempPdosRoot, "tokens");
  mkdirSync(tokensRoot, { recursive: true });

  for (const [fileName, requiredKeys] of Object.entries(TOKEN_FLOOR)) {
    const tokens = Object.fromEntries(requiredKeys.map((key) => [key, tempTokenValue(fileName, key)]));
    mutateTokens?.(fileName, tokens);
    writeJson(join(tokensRoot, fileName), {
      version: 1,
      tokens,
      notes: "Temp F4b token floor fixture."
    });
  }
}

function tempTokenValue(fileName: string, key: string): unknown {
  if (fileName === "color.json") {
    return (
      {
        background: "#FFFFFF",
        surface: "#F8FAFC",
        text: "#111827",
        muted_text: "#4B5563",
        border: "#D1D5DB",
        accent: "#1D4ED8",
        accent_secondary: "#0F766E",
        accent_soft: "#DBEAFE",
        accent_text: "#FFFFFF",
        focus_ring: "#0F766E"
      } as Record<string, string>
    )[key];
  }

  if (fileName === "style.json") {
    return (
      {
        decoration_intensity: "bold",
        accent_angle_deg: "-8deg",
        corner_style: "sharp",
        heading_case: "none",
        surface_treatment: "gradient"
      } as Record<string, string>
    )[key];
  }

  return `temp-${key}`;
}

function specWithTokenOverridesEnabled(): Record<string, unknown> {
  const spec = cloneRecord(readJsonRecord(compositionExampleFile));
  spec.token_overrides = { enabled: true, values: [] };
  return spec;
}

function validateTempSpecWithTokenFloor(floorComplete: boolean): readonly string[] {
  const tempRoot = mkdtempSync(join(tmpdir(), "pdos-f4b-"));
  const tempPdosRoot = join(tempRoot, "product-design-os");
  const allowedPatternIds = ["sharp-positioning-hero", "theme-crossed-direction", "proof-led-section", "outcome-cta"];
  const assetIds = ["editorial-motion-hero", "theme-calm-prism-grid", "proof-strip-case-study"];

  try {
    mkdirSync(join(tempPdosRoot, "specs", "examples"), { recursive: true });
    mkdirSync(join(tempPdosRoot, "recipes"), { recursive: true });
    mkdirSync(join(tempPdosRoot, "patterns"), { recursive: true });
    mkdirSync(join(tempPdosRoot, "assets"), { recursive: true });

    writeJson(join(tempPdosRoot, "specs", "composition.schema.json"), readJson(compositionSchemaFile));
    writeJson(join(tempPdosRoot, "specs", "examples", "test.composition.json"), specWithTokenOverridesEnabled());
    writeJson(join(tempPdosRoot, "recipes", "marketing-premium.json"), {
      id: "marketing-premium",
      allowed_pattern_ids: allowedPatternIds
    });
    writeJson(join(tempPdosRoot, "patterns", "pattern-manifest.json"), {
      patterns: allowedPatternIds.map((id) => ({ id }))
    });
    writeJson(join(tempPdosRoot, "assets", "asset-manifest.json"), {
      assets: assetIds.map((id) => ({ id }))
    });
    writeTempTokenFloor(
      tempPdosRoot,
      floorComplete
        ? undefined
        : (fileName, tokens) => {
            if (fileName === "color.json") {
              delete tokens.focus_ring;
            }
          }
    );

    const errors: PdosValidationIssue[] = [];
    validateCompositionSpecs(tempPdosRoot, tempRoot, errors);
    return errors.map((error) => error.message);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe("Product Design OS F4b token floor", () => {
  it("keeps the validator floor map aligned with TOKEN_FLOOR.md", () => {
    expect(TOKEN_FLOOR).toEqual(expectedTokenFloor);
  });

  it("fills every committed token file with all floor keys", () => {
    for (const [fileName, requiredKeys] of Object.entries(TOKEN_FLOOR)) {
      const value = readJsonRecord(join(pdosRoot, "tokens", fileName));
      const tokens = value.tokens;

      expect(isRecord(tokens), fileName).toBe(true);
      if (!isRecord(tokens)) {
        throw new Error("Expected tokens object in " + fileName);
      }

      for (const requiredKey of requiredKeys) {
        expect(tokens, `${fileName} missing ${requiredKey}`).toHaveProperty(requiredKey);
      }
    }
  });

  it("validates the committed Product Design OS with no errors or warnings", () => {
    const report = validateProductDesignOs(repoRoot);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(0);
  });

  it("reports an incomplete token floor in temp token files", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pdos-f4b-token-"));
    const tempPdosRoot = join(tempRoot, "product-design-os");

    try {
      writeTempTokenFloor(tempPdosRoot, (fileName, tokens) => {
        if (fileName === "color.json") {
          delete tokens.focus_ring;
        }
      });

      const errors: PdosValidationIssue[] = [];
      validateTokenFloor(tempPdosRoot, tempRoot, errors);

      expect(errors).toEqual([
        {
          file: "product-design-os/tokens/color.json",
          message: "PDOS_TOKEN_FLOOR_INCOMPLETE: color.json missing focus_ring"
        }
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("allows token overrides only after the token floor is complete", () => {
    const completeFloorMessages = validateTempSpecWithTokenFloor(true);
    const incompleteFloorMessages = validateTempSpecWithTokenFloor(false);

    expect(completeFloorMessages).not.toEqual(
      expect.arrayContaining([expect.stringContaining("PDOS_SPEC_TOKEN_OVERRIDES_BEFORE_FLOOR")])
    );
    expect(incompleteFloorMessages).toEqual(
      expect.arrayContaining([expect.stringContaining("PDOS_SPEC_TOKEN_OVERRIDES_BEFORE_FLOOR")])
    );
  });
});
