import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkRenderedContract } from "../../product-design-os/renderer/check-render-contract";
import {
  renderSharpPositioningHero,
  SharpPositioningHeroContractError
} from "../../product-design-os/renderer/components/sharp-positioning-hero";
import { mapTokensToCss, TokenOverrideValidationError } from "../../product-design-os/renderer/map-tokens";
import { patternComponentRegistry } from "../../product-design-os/renderer/pattern-component-registry";
import { renderComposition, RenderCompositionSpecError } from "../../product-design-os/renderer/render-composition";
import type { ComponentContract, ResolvedAsset } from "../../product-design-os/renderer/types";
// NOTE: visual-qa-playwright (browser-gated) is exercised in slice-1b, not the deterministic suite.

const pdosRoot = path.join(process.cwd(), "product-design-os");

describe("Product Design OS slice 1 renderer", () => {
  it("renders the buildable-marketing hero with zero contract errors", () => {
    const spec = readJson(path.join(pdosRoot, "specs", "examples", "buildable-marketing.composition.json"));
    const contract = readSharpPositioningHeroContract();
    const result = renderComposition(spec, pdosRoot);
    const report = checkRenderedContract(result.html, contract);

    expect(report.errors).toEqual([]);
    expect(result.html).toContain("A premium launch page with clear proof before polish");
    expect(result.qaTargets[0]?.invariants).toEqual(["visible_h1", "dom_text_cta", "proof_adjacency"]);
  });

  it("enforces the visible_h1 contract when the headline is missing or too short", () => {
    const contract = readSharpPositioningHeroContract();

    expect(() =>
      renderSharpPositioningHero({
        props: {
          headline: "Short",
          primary_cta: "Request a plan",
          trust_cue: "Case proof"
        },
        slots: demoSlots(),
        contract
      })
    ).toThrow(SharpPositioningHeroContractError);

    expect(() =>
      renderSharpPositioningHero({
        props: {
          headline: "Short",
          primary_cta: "Request a plan",
          trust_cue: "Case proof"
        },
        slots: demoSlots(),
        contract
      })
    ).toThrow(/visible_h1/);
  });

  it("reports dom_text_cta when the CTA is missing", () => {
    const contract = readSharpPositioningHeroContract();

    expect(() =>
      renderSharpPositioningHero({
        props: {
          headline: "A launch page with visible proof",
          trust_cue: "Case proof"
        },
        slots: demoSlots(),
        contract
      })
    ).toThrow(/dom_text_cta/);

    const report = checkRenderedContract(
      '<section><h1 data-contract-prop="headline">A launch page with visible proof</h1></section>',
      contract
    );
    expect(report.errors.map((issue) => issue.code)).toContain("dom_text_cta");

    const unsafeHrefReport = checkRenderedContract(
      [
        '<section data-pattern-id="sharp-positioning-hero">',
        '<h1 data-contract-prop="headline">A launch page with visible proof</h1>',
        '<a class="cta" data-contract-prop="primary_cta" href="javascript:alert(1)">Request a plan</a>',
        '<p data-contract-prop="trust_cue">Case proof</p>',
        "</section>"
      ].join(""),
      contract
    );
    expect(unsafeHrefReport.errors.map((issue) => issue.code)).toContain("dom_text_cta");
  });

  it("escapes hostile headline text instead of emitting executable markup", () => {
    const contract = readSharpPositioningHeroContract();
    const html = renderSharpPositioningHero({
      props: {
        headline: "Launch </h1><script>alert(1)</script>",
        primary_cta: "Request a plan",
        trust_cue: "Case proof"
      },
      slots: demoSlots(),
      contract
    });

    expect(html).toContain("Launch &lt;/h1&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("rejects unsafe CTA hrefs before attribute escaping", () => {
    const contract = readSharpPositioningHeroContract();

    expect(() =>
      renderSharpPositioningHero({
        props: {
          headline: "A launch page with visible proof",
          primary_cta: "Request a plan",
          trust_cue: "Case proof",
          cta_href: "javascript:alert(1)"
        },
        slots: demoSlots(),
        contract
      })
    ).toThrow(/unsafe_href/);
  });

  it("rejects token override CSS-context breakouts", () => {
    expect(() =>
      mapTokensToCss(pdosRoot, {
        color: {
          accent: '</style><script>alert("xss")</script>'
        }
      })
    ).toThrow(TokenOverrideValidationError);
  });

  it("keeps theme background assets out of the section canvas and ignores hostile inline SVG content", () => {
    const contract = readSharpPositioningHeroContract();
    const slots = demoSlots();
    const themeBackground = slots.theme_background[0];
    if (themeBackground === undefined) {
      throw new Error("Missing theme background test fixture.");
    }

    const html = renderSharpPositioningHero({
      props: {
        headline: "A launch page with visible proof",
        primary_cta: "Request a plan",
        trust_cue: "Case proof"
      },
      slots: {
        hero_asset: slots.hero_asset,
        theme_background: [
          {
            ...themeBackground,
            inlineSvg: '<svg onload="alert(1)"><script>alert(1)</script><foreignObject></foreignObject></svg>'
          }
        ]
      },
      contract
    });

    expect(html).toContain('data-theme-background-id="theme-calm-prism-grid"');
    expect(html).not.toContain('<img src="../../product-design-os/assets/backgrounds/theme-calm-prism-grid.svg"');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("foreignObject");
    expect(html).not.toContain("onload");
  });

  it("ignores commented contract markup", () => {
    const contract = readSharpPositioningHeroContract();
    const report = checkRenderedContract(
      [
        '<!-- <h1 data-contract-prop="headline">A launch page with visible proof</h1> -->',
        '<!-- <a class="cta" data-contract-prop="primary_cta" href="#request">Request a plan</a> -->',
        '<!-- <p data-contract-prop="trust_cue">Case proof</p> -->'
      ].join(""),
      contract
    );

    expect(report.errors.map((issue) => issue.code)).toEqual(expect.arrayContaining(["visible_h1", "dom_text_cta"]));
  });

  it("fails required file-backed assets when their source cannot be resolved", () => {
    const contract = readSharpPositioningHeroContract();
    const slots = demoSlots();
    const themeBackground = slots.theme_background[0];
    if (themeBackground === undefined) {
      throw new Error("Missing theme background test fixture.");
    }
    const { href: _missingHref, ...missingHrefBackground } = themeBackground;

    expect(() =>
      renderSharpPositioningHero({
        props: {
          headline: "A launch page with visible proof",
          primary_cta: "Request a plan",
          trust_cue: "Case proof"
        },
        slots: {
          hero_asset: slots.hero_asset,
          theme_background: [missingHrefBackground]
        },
        contract
      })
    ).toThrow(/slot_asset_source_missing/);

    withTempPdosRootWithBackgroundSource("product-design-os/assets/backgrounds/missing.svg", (tempPdosRoot) => {
      expect(() => renderComposition(compositionSpec(), tempPdosRoot)).toThrow(RenderCompositionSpecError);
    });

    withTempPdosRootWithBackgroundSource("product-design-os", (tempPdosRoot) => {
      expect(() => renderComposition(compositionSpec(), tempPdosRoot)).toThrow(RenderCompositionSpecError);
    });
  });

  it("throws for unknown pattern ids and explicit specs missing required props", () => {
    expect(() =>
      renderComposition(
        {
          pattern_id: "unknown-pattern",
          props: {}
        },
        pdosRoot
      )
    ).toThrow(RenderCompositionSpecError);

    expect(() =>
      renderComposition(
        compositionSpec([
          { name: "primary_cta", string_value: "Request a plan" },
          { name: "trust_cue", string_value: "Case proof" }
        ]),
        pdosRoot
      )
    ).toThrow(SharpPositioningHeroContractError);
  });

  it("resolves sharp-positioning-hero from the component registry", () => {
    expect(patternComponentRegistry["sharp-positioning-hero"].render).toBe(renderSharpPositioningHero);
  });

  it("maps the token floor into deterministic CSS custom properties", () => {
    const css = mapTokensToCss(pdosRoot);

    expect(css.startsWith(":root{\n")).toBe(true);
    expect(css).toContain("  --color-background: #FFFFFF;");
    expect(css).toContain("  --type-font-body: system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;");
    expect(css).toContain("  --space-1: 0.25rem;");
  });
});

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

function demoSlots(): { readonly hero_asset: readonly ResolvedAsset[]; readonly theme_background: readonly ResolvedAsset[] } {
  return {
    hero_asset: [
      {
        id: "editorial-motion-hero",
        targetKind: "asset",
        assetType: "hero",
        source: "product-design-os"
      }
    ],
    theme_background: [
      {
        id: "theme-calm-prism-grid",
        targetKind: "asset",
        assetType: "background",
        source: "product-design-os/assets/backgrounds/theme-calm-prism-grid.svg",
        href: "../../product-design-os/assets/backgrounds/theme-calm-prism-grid.svg"
      }
    ]
  };
}

function compositionSpec(
  props: readonly unknown[] = [
    { name: "headline", string_value: "A launch page with visible proof" },
    { name: "primary_cta", string_value: "Request a plan" },
    { name: "trust_cue", string_value: "Case proof" }
  ]
): unknown {
  return {
    spec_kind: "composition_spec",
    id: "slice-test",
    nodes: [
      {
        node_id: "positioning-hero",
        target_kind: "pattern",
        target_id: "sharp-positioning-hero",
        props,
        slot_fills: [
          {
            slot: "hero_asset",
            fills: [{ target_kind: "asset", target_id: "editorial-motion-hero" }]
          },
          {
            slot: "theme_background",
            fills: [{ target_kind: "asset", target_id: "theme-calm-prism-grid" }]
          }
        ]
      }
    ],
    token_overrides: {
      enabled: false,
      values: []
    }
  };
}

function withTempPdosRootWithBackgroundSource(backgroundSource: string, run: (tempPdosRoot: string) => void): void {
  const tempRepoRoot = mkdtempSync(path.join(tmpdir(), "pdos-render-"));
  const tempPdosRoot = path.join(tempRepoRoot, "product-design-os");

  try {
    mkdirSync(path.join(tempPdosRoot, "contracts"), { recursive: true });
    mkdirSync(path.join(tempPdosRoot, "assets"), { recursive: true });
    copyTokenFiles(path.join(pdosRoot, "tokens"), path.join(tempPdosRoot, "tokens"));
    writeFileSync(
      path.join(tempPdosRoot, "contracts", "component-contract-manifest.json"),
      readFileSync(path.join(pdosRoot, "contracts", "component-contract-manifest.json"), "utf8"),
      "utf8"
    );
    writeFileSync(
      path.join(tempPdosRoot, "assets", "asset-manifest.json"),
      JSON.stringify(
        {
          version: 1,
          assets: [
            {
              id: "editorial-motion-hero",
              type: "hero",
              source: "product-design-os"
            },
            {
              id: "theme-calm-prism-grid",
              type: "background",
              source: backgroundSource
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    run(tempPdosRoot);
  } finally {
    rmSync(tempRepoRoot, { recursive: true, force: true });
  }
}

function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function copyTokenFiles(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    writeFileSync(path.join(targetDir, entry.name), readFileSync(path.join(sourceDir, entry.name)));
  }
}
