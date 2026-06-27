import { describe, expect, it } from "vitest";

import {
  assertComponentColorContrastWcagAA,
  colorContrastRatio,
  extractRootCssVars,
  resolveColor,
  WcagContrastError
} from "../../product-design-os/renderer/wcag-contrast";

// Real owner-selected zednik "Pískovec & Šalvěj" palette (specs/examples/zednik.composition.json).
// The hero badge and surface-panel pairs below are the two component pairs that shipped as
// color-mix() fills and were hand-fixed to pass AA — the gate must now keep them passing.
const zednikTokens: Record<string, string> = {
  background: "#FAF6F0",
  surface: "#F2EAE1",
  text: "#2C2B29",
  muted_text: "#6E6962",
  border: "#DDD3C7",
  accent: "#2C5E43",
  accent_secondary: "#A34C32",
  accent_soft: "#E6F0EA",
  accent_text: "#FFFFFF"
};

const badgeFill = "color-mix(in srgb, var(--color-text) 92%, var(--color-accent))";
const badgeText = "color-mix(in srgb, var(--color-background) 92%, var(--color-surface))";
const surfacePanel = "color-mix(in srgb, var(--color-surface) 78%, var(--color-background))";
const heroImageMarker = "tactile-shadow-hero__stone--image";

describe("resolveColor", () => {
  it("resolves plain hex to an sRGB triple", () => {
    const vars = rootVars(zednikTokens);
    expect(resolveColor("#2C5E43", vars)).toEqual([44, 94, 67]);
  });

  it("resolves var(--color-*) recursively against the :root vars", () => {
    const vars = rootVars(zednikTokens);
    expect(resolveColor("var(--color-text)", vars)).toEqual([44, 43, 41]);
  });

  it("falls back when a var() name is missing and a fallback is supplied", () => {
    const vars = rootVars(zednikTokens);
    expect(resolveColor("var(--color-missing, #FFFFFF)", vars)).toEqual([255, 255, 255]);
  });

  it("resolves an opaque color-mix() as a premultiplied weighted average", () => {
    const vars = rootVars(zednikTokens);
    // text #2C2B29 (44,43,41) at 92% + accent #2C5E43 (44,94,67) at 8%.
    const [red, green, blue] = resolveColor(badgeFill, vars);
    expect(red).toBeCloseTo(44, 5);
    expect(green).toBeCloseTo(47.08, 5);
    expect(blue).toBeCloseTo(43.08, 5);
  });

  it("composites color-mix(..., transparent) over a supplied opaque backdrop", () => {
    const vars = rootVars(zednikTokens);
    // accent #2C5E43 (44,94,67) at 30% opacity over white -> 0.3*accent + 0.7*white.
    const [red, green, blue] = resolveColor(
      "color-mix(in srgb, var(--color-accent) 30%, transparent)",
      vars,
      [255, 255, 255]
    );
    expect(red).toBeCloseTo(191.7, 5);
    expect(green).toBeCloseTo(206.7, 5);
    expect(blue).toBeCloseTo(198.6, 5);
  });

  it("throws when the result is translucent and no backdrop is supplied", () => {
    const vars = rootVars(zednikTokens);
    expect(() => resolveColor("color-mix(in srgb, var(--color-accent) 30%, transparent)", vars)).toThrow(
      /translucent/
    );
  });
});

describe("assertComponentColorContrastWcagAA", () => {
  it("passes the real zednik color-mix component pairs (badge + surface panel)", () => {
    const report = assertComponentColorContrastWcagAA(rootCss(zednikTokens));

    expect(report.results.map((result) => result.pair)).toEqual([
      "hero_badge_fill/hero_badge_text",
      "surface_panel/muted_text"
    ]);
    for (const result of report.results) {
      expect(result.ratio).toBeGreaterThanOrEqual(4.5);
    }
    // Badge is light-on-dark (clearly passing); muted-on-panel is the marginal AA pair.
    expect(report.results[0]?.ratio ?? 0).toBeGreaterThan(7);
    expect(report.warnings).toEqual([]);
  });

  it("warns (does not throw) for hero text layered over the uncontrolled photo", () => {
    const html = `${rootCss(zednikTokens)}\n<figure class="tactile-shadow-hero__stone ${heroImageMarker}"><img src="./wall.jpg"></figure>`;
    const report = assertComponentColorContrastWcagAA(html);

    expect(report.warnings.map((warning) => warning.pair)).toEqual([
      "hero_headline/hero_photo",
      "hero_eyebrow/hero_photo"
    ]);
    // The throwing component pairs still pass; the photo warning is additive.
    expect(report.results.map((result) => result.pair)).toEqual([
      "hero_badge_fill/hero_badge_text",
      "surface_panel/muted_text"
    ]);
  });

  it("throws WcagContrastError when a color-mix component pair drops below AA", () => {
    // muted_text lightened to #AAAAAA over a near-white surface panel -> ~2.3:1.
    const failingTokens: Record<string, string> = {
      ...zednikTokens,
      background: "#FFFFFF",
      surface: "#FFFFFF",
      text: "#111111",
      muted_text: "#AAAAAA"
    };

    let thrown: unknown;
    try {
      assertComponentColorContrastWcagAA(rootCss(failingTokens));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(WcagContrastError);
    expect((thrown as WcagContrastError).pair).toBe("surface_panel/muted_text");
    expect((thrown as WcagContrastError).ratio).toBeLessThan(4.5);
  });
});

describe("colorContrastRatio", () => {
  it("measures a passing color-mix-on-color-mix pair above AA", () => {
    const vars = rootVars(zednikTokens);
    expect(colorContrastRatio(badgeText, badgeFill, vars)).toBeGreaterThanOrEqual(4.5);
  });

  it("measures a failing light-on-light color-mix pair below AA", () => {
    const vars = rootVars(zednikTokens);
    // Both sides resolve to near-white -> the gate must see this as a failure, not skip it.
    const ratio = colorContrastRatio(badgeText, surfacePanel, vars);
    expect(ratio).toBeLessThan(4.5);
  });
});

function rootCss(tokens: Record<string, string>): string {
  const declarations = Object.entries(tokens)
    .map(([key, value]) => `--color-${key.replace(/_/g, "-")}: ${value};`)
    .join("\n");
  return `:root{\n${declarations}\n}`;
}

function rootVars(tokens: Record<string, string>): ReadonlyMap<string, string> {
  return extractRootCssVars(rootCss(tokens));
}
