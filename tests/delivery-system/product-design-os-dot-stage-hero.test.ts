import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkRenderedContract } from "../../product-design-os/renderer/check-render-contract";
import { renderDotStageHero } from "../../product-design-os/renderer/components/dot-stage-hero";
import { renderSharpPositioningHero } from "../../product-design-os/renderer/components/sharp-positioning-hero";
import { renderComposition } from "../../product-design-os/renderer/render-composition";
import type { ComponentContract, ResolvedAsset } from "../../product-design-os/renderer/types";

// Inline contracts keep this test self-contained: it proves the renderer + the
// two new self-scoping render-contract guards (canvas_text_dom_twin,
// no_stored_frames) without depending on the shared manifests, so it has zero
// impact on the committed scoring baselines.
const dotStageContract: ComponentContract = {
  id: "pattern-dot-stage-hero",
  target_kind: "pattern",
  target_id: "dot-stage-hero",
  props: [
    { name: "headline", value_type: "text", required: true, min_length: 8 },
    { name: "primary_cta", value_type: "string", required: true, min_length: 3 },
    { name: "trust_cue", value_type: "string", required: true, min_length: 3 },
    { name: "display_word", value_type: "string", required: true, min_length: 2 },
    { name: "scene_preset", value_type: "string", required: true, min_length: 3 },
    { name: "motion_intensity", value_type: "integer", required: true },
    { name: "static_fallback_label", value_type: "string", required: true, min_length: 3 },
    { name: "cta_href", value_type: "url", required: false }
  ],
  slots: [],
  output_invariants: [
    { code: "visible_h1", required: true, severity: "error" },
    { code: "dom_text_cta", required: true, severity: "error" },
    { code: "no_primary_content_in_canvas", required: true, severity: "error" },
    { code: "reduced_motion_fallback", required: true, severity: "error" },
    { code: "performance_budget", required: true, severity: "error" },
    { code: "proof_adjacency", required: false, severity: "warning" }
  ]
};

const sharpContract: ComponentContract = {
  id: "pattern-sharp-positioning-hero",
  target_kind: "pattern",
  target_id: "sharp-positioning-hero",
  props: [
    { name: "headline", value_type: "text", required: true, min_length: 8 },
    { name: "primary_cta", value_type: "string", required: true, min_length: 3 },
    { name: "trust_cue", value_type: "string", required: true, min_length: 3 }
  ],
  slots: [
    { name: "hero_asset", required: true, min_items: 1, max_items: 1, allowed_asset_ids: ["editorial-motion-hero"] },
    { name: "theme_background", required: true, min_items: 1, max_items: 1, allowed_asset_ids: ["theme-calm-prism-grid"] }
  ],
  output_invariants: [
    { code: "visible_h1", required: true, severity: "error" },
    { code: "dom_text_cta", required: true, severity: "error" },
    { code: "proof_adjacency", required: false, severity: "warning" }
  ]
};

function validDotStageInput() {
  return {
    props: {
      headline: "Rychlý web, čistý proces, méně provozního šumu.",
      primary_cta: "Napsat poptávku",
      trust_cue: "Odpovídám do 1 pracovního dne.",
      cta_href: "#kontakt",
      display_word: "RadeQ",
      scene_preset: "spotlight-hero",
      motion_intensity: "6",
      static_fallback_label: "Statická scéna"
    },
    slots: {},
    contract: dotStageContract
  } as const;
}

function errorCodes(html: string, contract: ComponentContract): string[] {
  return checkRenderedContract(html, contract).errors.map((issue) => issue.code);
}

describe("dot-stage-hero renderer + render contract", () => {
  it("renders a valid dot-stage hero that passes the render contract", () => {
    const html = renderDotStageHero(validDotStageInput());

    expect(html).toContain("data-dot-stage");
    expect(html).toContain('data-dot-word="RadeQ"');
    expect(html).toContain('data-dot-twin="RadeQ">RadeQ</span>');
    expect(html).toContain('<h1 id="dot-stage-hero-title" data-contract-prop="headline">');
    // No stored frames in the procedural output.
    expect(html).not.toMatch(/<(?:img|video)\b/i);
    expect(html).not.toMatch(/data:/i);

    const report = checkRenderedContract(html, dotStageContract);
    expect(report.errors).toEqual([]);
  });

  it("FAILS canvas_text_dom_twin when the DOM twin text no longer matches the dot word", () => {
    const html = renderDotStageHero(validDotStageInput()).replace(">RadeQ</span>", ">WRONG</span>");
    expect(errorCodes(html, dotStageContract)).toContain("canvas_text_dom_twin");
  });

  it("FAILS canvas_text_dom_twin when the DOM twin is removed entirely", () => {
    const html = renderDotStageHero(validDotStageInput()).replace(
      /<span class="dot-stage-hero__twin"[^>]*>RadeQ<\/span>/,
      ""
    );
    expect(errorCodes(html, dotStageContract)).toContain("canvas_text_dom_twin");
  });

  it("FAILS no_stored_frames when a stored image is injected into the dot stage", () => {
    const html = renderDotStageHero(validDotStageInput()).replace(
      "</section>",
      '<img src="frame.png" alt=""></section>'
    );
    expect(errorCodes(html, dotStageContract)).toContain("no_stored_frames");
  });

  it("FAILS no_stored_frames when a data: URI frame is injected", () => {
    const html = renderDotStageHero(validDotStageInput()).replace(
      "</section>",
      '<div style="background:url(data:image/png;base64,AAAA)"></div></section>'
    );
    expect(errorCodes(html, dotStageContract)).toContain("no_stored_frames");
  });

  it("rejects a missing required display_word at the renderer contract layer", () => {
    const input = validDotStageInput();
    const broken = { ...input, props: { ...input.props, display_word: "" } };
    expect(() => renderDotStageHero(broken)).toThrowError(/canvas_text_dom_twin/);
  });

  it("enforces required scene_preset (missing) and validates allowed values", () => {
    const input = validDotStageInput();
    expect(() => renderDotStageHero({ ...input, props: { ...input.props, scene_preset: "" } })).toThrowError(
      /scene_preset_required/
    );
    expect(() => renderDotStageHero({ ...input, props: { ...input.props, scene_preset: "bogus" } })).toThrowError(
      /scene_preset_not_allowed/
    );
  });

  it("enforces required, integer-valued motion_intensity", () => {
    const input = validDotStageInput();
    expect(() => renderDotStageHero({ ...input, props: { ...input.props, motion_intensity: "" } })).toThrowError(
      /motion_intensity_required/
    );
    expect(() => renderDotStageHero({ ...input, props: { ...input.props, motion_intensity: "NaN" } })).toThrowError(
      /motion_intensity_invalid/
    );
  });

  it("FAILS canvas_text_dom_twin when the only twin is aria-hidden (not accessible)", () => {
    const html = renderDotStageHero(validDotStageInput()).replace(
      'class="dot-stage-hero__twin"',
      'class="dot-stage-hero__twin" aria-hidden="true"'
    );
    expect(errorCodes(html, dotStageContract)).toContain("canvas_text_dom_twin");
  });

  it("FAILS no_stored_frames for an injected svg <image> / <object>", () => {
    const withImage = renderDotStageHero(validDotStageInput()).replace(
      "</section>",
      '<svg><image href="frame.png"></image></svg></section>'
    );
    expect(errorCodes(withImage, dotStageContract)).toContain("no_stored_frames");

    const withObject = renderDotStageHero(validDotStageInput()).replace(
      "</section>",
      '<object data="frame.swf"></object></section>'
    );
    expect(errorCodes(withObject, dotStageContract)).toContain("no_stored_frames");
  });

  it("renders the dot-stage-hero composition end-to-end through renderComposition", () => {
    const pdosRoot = join(process.cwd(), "product-design-os");
    const spec = JSON.parse(
      readFileSync(join(pdosRoot, "specs", "examples", "dot-stage-hero.composition.json"), "utf8")
    ) as unknown;
    const result = renderComposition(spec, pdosRoot);

    expect(result.qaTargets[0]?.patternId).toBe("dot-stage-hero");
    expect(result.html).toContain('data-dot-word="RadeQ"');
    expect(result.html).toContain('data-dot-twin="RadeQ">RadeQ</span>');

    const manifest = JSON.parse(
      readFileSync(join(pdosRoot, "contracts", "component-contract-manifest.json"), "utf8")
    ) as { contracts: ComponentContract[] };
    const contract = manifest.contracts.find(
      (candidate) => candidate.target_kind === "pattern" && candidate.target_id === "dot-stage-hero"
    );
    if (contract === undefined) {
      throw new Error("Missing dot-stage-hero contract.");
    }
    expect(checkRenderedContract(result.html, contract).errors).toEqual([]);
  });

  it("does not fire dot-stage guards on a non-dot pattern (sharp-positioning-hero regression)", () => {
    const asset = (id: string, assetType: string): ResolvedAsset => ({
      id,
      targetKind: "asset",
      assetType,
      source: "product-design-os"
    });

    const html = renderSharpPositioningHero({
      props: {
        headline: "A premium launch page with clear proof before polish",
        primary_cta: "Request a plan",
        trust_cue: "Case-backed launch process",
        cta_href: "#request"
      },
      slots: {
        hero_asset: [asset("editorial-motion-hero", "hero")],
        theme_background: [asset("theme-calm-prism-grid", "background")]
      },
      contract: sharpContract
    });

    const codes = errorCodes(html, sharpContract);
    expect(codes).not.toContain("canvas_text_dom_twin");
    expect(codes).not.toContain("no_stored_frames");
    expect(codes).toEqual([]);
  });
});
