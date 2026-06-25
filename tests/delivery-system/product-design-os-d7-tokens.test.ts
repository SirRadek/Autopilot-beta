import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkRenderedContract } from "../../product-design-os/renderer/check-render-contract";
import { mapTokensToCss, TokenOverrideValidationError } from "../../product-design-os/renderer/map-tokens";
import {
  assertRenderedWcagAA,
  brandRenderExamples,
  buildBrandCompositionSpec,
  type BrandTokenOverride
} from "../../product-design-os/renderer/render-brand-examples";
import { renderComposition, RenderCompositionSpecError } from "../../product-design-os/renderer/render-composition";
import type { ComponentContract } from "../../product-design-os/renderer/types";

const pdosRoot = path.join(process.cwd(), "product-design-os");
const baseCompositionFile = path.join(pdosRoot, "specs", "examples", "buildable-marketing.composition.json");

describe("Product Design OS D7 brand token overrides", () => {
  it("flows composition token_overrides into rendered CSS variables", () => {
    const result = renderComposition(
      compositionSpecWithOverrides([
        override("color", "accent", "#0F766E"),
        override("style", "corner_style", "pill"),
        override("style", "surface_treatment", "flat")
      ]),
      pdosRoot
    );
    const vars = extractRootCssVars(result.html);

    expect(vars.get("color-accent")).toBe("#0F766E");
    expect(vars.get("style-corner-style")).toBe("pill");
    expect(vars.get("style-corner-radius")).toBe("999px");
    expect(vars.get("style-surface-treatment")).toBe("flat");
    expect(vars.get("style-surface-background")).toBe("var(--color-background)");
  });

  it("rejects bad token override keys and values before CSS emission", () => {
    expect(() =>
      mapTokensToCss(pdosRoot, {
        color: {
          unknown_accent: "#111827"
        }
      })
    ).toThrow(TokenOverrideValidationError);

    expect(() =>
      mapTokensToCss(pdosRoot, {
        style: {
          corner_style: "squircle"
        }
      })
    ).toThrow(TokenOverrideValidationError);

    expect(() =>
      renderComposition(
        compositionSpecWithOverrides([override("style", "accent_angle_deg", "rotate(999deg)")]),
        pdosRoot
      )
    ).toThrow(TokenOverrideValidationError);
  });

  it("rejects unsafe base token values before CSS emission", () => {
    const tempPdosRoot = mkdtempSync(path.join(tmpdir(), "pdos-unsafe-base-token-"));

    try {
      const tokensDir = path.join(tempPdosRoot, "tokens");
      mkdirSync(tokensDir, { recursive: true });
      writeFileSync(
        path.join(tokensDir, "motion.json"),
        JSON.stringify(
          {
            version: 1,
            tokens: {
              duration_fast: "0deg} body{display:none"
            }
          },
          null,
          2
        ),
        "utf8"
      );

      let thrown: unknown;
      try {
        mapTokensToCss(tempPdosRoot);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(TokenOverrideValidationError);
      if (!(thrown instanceof TokenOverrideValidationError)) {
        throw new Error("Expected TokenOverrideValidationError.");
      }
      expect(thrown.issues).toContainEqual(
        expect.objectContaining({
          code: "unsafe_base_token_value",
          tokenFile: "motion",
          tokenKey: "duration_fast"
        })
      );
    } finally {
      rmSync(tempPdosRoot, { recursive: true, force: true });
    }
  });

  it("rejects composition color overrides that fall below WCAG-AA contrast", () => {
    let thrown: unknown;
    try {
      renderComposition(
        compositionSpecWithOverrides([override("color", "background", "#FFFFFF"), override("color", "text", "#FFFFFF")]),
        pdosRoot
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RenderCompositionSpecError);
    if (!(thrown instanceof RenderCompositionSpecError)) {
      throw new Error("Expected RenderCompositionSpecError.");
    }
    expect(thrown.code).toBe("token_color_contrast_below_aa");
    expect(thrown.message).toContain("background/text");
  });

  it("renders two brand sets with different root CSS and zero contract errors", () => {
    const baseSpec = readJson(baseCompositionFile);
    const contract = readSharpPositioningHeroContract();
    const rendered = brandRenderExamples.map((example) => {
      const result = renderComposition(buildBrandCompositionSpec(baseSpec, example), pdosRoot);
      const report = checkRenderedContract(result.html, contract);
      return {
        example,
        html: result.html,
        report,
        rootBlock: extractRootCssBlock(result.html),
        vars: extractRootCssVars(result.html),
        contrast: assertRenderedWcagAA(result.html)
      };
    });
    const calm = rendered.find((result) => result.example.id === "calm-corporate");
    const bold = rendered.find((result) => result.example.id === "bold-editorial");

    if (calm === undefined || bold === undefined) {
      throw new Error("Missing D7 brand render examples.");
    }

    expect(calm.report.errors).toEqual([]);
    expect(bold.report.errors).toEqual([]);
    expect(calm.contrast.map((result) => result.pair)).toEqual(expectedContrastPairs());
    expect(bold.contrast.map((result) => result.pair)).toEqual(expectedContrastPairs());
    expect(calm.rootBlock).not.toBe(bold.rootBlock);
    expect(calm.vars.get("color-background")).toBe("#F8FAFC");
    expect(bold.vars.get("color-background")).toBe("#0B0F19");
    expect(calm.vars.get("style-corner-radius")).toBe("var(--radius-lg)");
    expect(bold.vars.get("style-corner-radius")).toBe("var(--radius-none)");
  });

  it("changes rendered look variables from style tokens", () => {
    const roundedCss = mapTokensToCss(pdosRoot, {
      style: {
        corner_style: "rounded",
        heading_case: "none"
      }
    });
    const editorialCss = mapTokensToCss(pdosRoot, {
      style: {
        corner_style: "pill",
        heading_case: "upper"
      }
    });
    const roundedVars = extractRootCssVars(roundedCss);
    const editorialVars = extractRootCssVars(editorialCss);

    expect(roundedVars.get("style-corner-radius")).toBe("var(--radius-lg)");
    expect(editorialVars.get("style-corner-radius")).toBe("999px");
    expect(roundedVars.get("style-heading-transform")).toBe("none");
    expect(editorialVars.get("style-heading-transform")).toBe("uppercase");
  });

  it("keeps the committed color floor at WCAG-AA contrast", () => {
    const contrast = assertRenderedWcagAA(mapTokensToCss(pdosRoot));

    expect(contrast.map((result) => result.pair)).toEqual(expectedContrastPairs());
    for (const result of contrast) {
      expect(result.ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
});

function expectedContrastPairs(): readonly string[] {
  return [
    "background/text",
    "background/muted_text",
    "surface/text",
    "surface/muted_text",
    "accent/accent_text",
    "accent_secondary/accent_text"
  ];
}

function compositionSpecWithOverrides(overrides: readonly BrandTokenOverride[]): unknown {
  return {
    ...cloneJsonRecord(readJsonRecord(baseCompositionFile)),
    token_overrides: {
      enabled: true,
      values: overrides
    }
  };
}

function override(tokenFile: string, tokenKey: string, value: string): BrandTokenOverride {
  return {
    token_file: tokenFile,
    token_key: tokenKey,
    value,
    reason: `D7 test override for ${tokenFile}.${tokenKey}.`
  };
}

function readSharpPositioningHeroContract(): ComponentContract {
  const manifest = readJson<{ readonly contracts: readonly ComponentContract[] }>(
    path.join(pdosRoot, "contracts", "component-contract-manifest.json")
  );
  const contract = manifest.contracts.find(
    (candidate) => candidate.target_kind === "pattern" && candidate.target_id === "sharp-positioning-hero"
  );
  if (contract === undefined) {
    throw new Error("Missing sharp-positioning-hero contract fixture.");
  }
  return contract;
}

function extractRootCssBlock(value: string): string {
  const rootBlock = /:root\{([\s\S]*?)\n\}/.exec(value)?.[1];
  if (rootBlock === undefined) {
    throw new Error("Missing :root CSS block.");
  }
  return rootBlock;
}

function extractRootCssVars(value: string): ReadonlyMap<string, string> {
  const vars = new Map<string, string>();
  const declarationPattern = /--([a-z0-9-]+):\s*([^;]+);/gi;
  let match: RegExpExecArray | null;
  const rootBlock = extractRootCssBlock(value);
  while ((match = declarationPattern.exec(rootBlock)) !== null) {
    const key = match[1];
    const cssValue = match[2];
    if (key !== undefined && cssValue !== undefined) {
      vars.set(key, cssValue.trim());
    }
  }

  return vars;
}

function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  const value = readJson(filePath);
  if (!isRecord(value)) {
    throw new Error(`${filePath} must contain an object.`);
  }
  return value;
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
