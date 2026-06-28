import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { checkRenderedContract } from "../../product-design-os/renderer/check-render-contract";
import { renderComposition } from "../../product-design-os/renderer/render-composition";
import {
  detectUndeclaredCloudInHtml,
  validatePointCloudScene,
  type PointCloudSceneDeclaration,
  type PointCloudSourceCatalog
} from "../../product-design-os/renderer/check-point-cloud-scene";
import {
  PointCloudBackgroundContractError,
  renderPointCloudBackground
} from "../../product-design-os/renderer/components/point-cloud-background";
import type { ComponentContract, ResolvedAsset } from "../../product-design-os/renderer/types";
import { imageToPointCloud } from "../../src/lib/image-point-cloud";
import type { EncodedPointCloud } from "../../src/lib/image-point-cloud";

const fixturePath = resolve("tests/fixtures/image-point-cloud/faithful-sampling-fixture.png");

const contract: ComponentContract = {
  id: "pattern-point-cloud-background",
  target_kind: "pattern",
  target_id: "point-cloud-background",
  props: [
    { name: "headline", value_type: "text", required: true, min_length: 8 },
    { name: "primary_cta", value_type: "string", required: true, min_length: 3 },
    { name: "trust_cue", value_type: "string", required: true, min_length: 3 },
    { name: "static_fallback_label", value_type: "string", required: true, min_length: 3 },
    { name: "cta_href", value_type: "url", required: false },
    { name: "parallax_gain", value_type: "string", required: false },
    { name: "scene_preset", value_type: "string", required: true, min_length: 3 }
  ],
  slots: [
    {
      name: "point_cloud",
      required: true,
      min_items: 1,
      max_items: 1,
      accepts_target_kinds: ["asset"],
      accepts_asset_types: ["point_cloud"]
    }
  ],
  output_invariants: [
    { code: "visible_h1", required: true, severity: "error" },
    { code: "dom_text_cta", required: true, severity: "error" }
  ]
};

const catalog: PointCloudSourceCatalog = {
  sources: [{ id: "brand-hero", status: "approved_source", commercial_use: "allowed" }]
};

function cloudAsset(encoded: EncodedPointCloud): ResolvedAsset {
  return {
    id: "brand-hero",
    targetKind: "asset",
    assetType: "point_cloud",
    source: "product-design-os/assets/3d/brand-hero.cloud.json",
    license: "CC0",
    sourceUrl: "https://assets.example/hero.png",
    dataRef: { mime: "application/json", inline: JSON.stringify(encoded) }
  };
}

function validProps() {
  return {
    eyebrow: "Studio RadeQ",
    headline: "A fast, accessible site with a living brand backdrop.",
    primary_cta: "Request a walkthrough",
    trust_cue: "Reply within one business day.",
    cta_href: "#kontakt",
    static_fallback_label: "Static resolved depth field with the same offer text.",
    parallax_gain: "1",
    scene_preset: "photographic-drift"
  };
}

function decorativeDeclaration(overrides: Partial<PointCloudSceneDeclaration> = {}): PointCloudSceneDeclaration {
  return {
    role: "decorative",
    aria_hidden: true,
    animated: true,
    parallax_gain: 1,
    text_payload: [],
    static_fallback: { label: "Static resolved depth field" },
    source: { provenance: "internal" },
    ...overrides
  };
}

let encoded: EncodedPointCloud;
let facetEncoded: EncodedPointCloud;

beforeAll(async () => {
  encoded = await imageToPointCloud({
    imagePath: fixturePath,
    sampleStep: 1,
    alphaThreshold: 10,
    brightnessFloor: 0.02,
    depthAmp: 2,
    targetCount: 1200,
    includeSizes: true,
    seed: "phase1"
  });
  facetEncoded = await imageToPointCloud({
    imagePath: fixturePath,
    sampleStep: 1,
    alphaThreshold: 10,
    brightnessFloor: 0.02,
    depthAmp: 2,
    targetCount: 1200,
    includeSizes: true,
    seed: "phase1",
    facetCount: 4
  });
});

describe("point-cloud-background — Phase 1 render + gate integration", () => {
  it("renders a DOM-first cloud background with validated markers and no stored frames", () => {
    const html = renderPointCloudBackground({ props: validProps(), slots: { point_cloud: [cloudAsset(encoded)] }, contract });

    expect(html).toContain("data-point-cloud");
    expect(html).toContain('data-cloud-contract="pattern-point-cloud-background"');
    expect(html).toContain('<script type="application/json" data-dot-cloud>');
    expect(html).toContain('<h1 id="point-cloud-bg-title" data-contract-prop="headline">');
    expect(html).toContain("Request a walkthrough");
    expect(html).toContain("prefers-reduced-motion");
    // The cloud is procedural geometry, not a stored raster frame or data: URI.
    expect(html).not.toMatch(/<(?:img|video)\b/i);
    expect(html).not.toMatch(/data:/i);
  });

  it("passes checkRenderedContract (stamped canvas ⇒ no undeclared_scene_blob, DOM content satisfied)", () => {
    const html = renderPointCloudBackground({ props: validProps(), slots: { point_cloud: [cloudAsset(encoded)] }, contract });
    expect(checkRenderedContract(html, contract).errors).toEqual([]);
  });

  it("passes validatePointCloudScene on the real rendered output", () => {
    const html = renderPointCloudBackground({ props: validProps(), slots: { point_cloud: [cloudAsset(encoded)] }, contract });
    const report = validatePointCloudScene({ scene: { encoded, declaration: decorativeDeclaration() }, html, catalog });
    expect(report.errors).toEqual([]);
  });

  it("the undeclared_scene_blob net fires when the contract stamp is stripped from the rendered cloud", () => {
    const html = renderPointCloudBackground({ props: validProps(), slots: { point_cloud: [cloudAsset(encoded)] }, contract });
    const stripped = html.replace(/ data-cloud-contract="[^"]*"/, "");
    const codes = checkRenderedContract(stripped, contract).errors.map((issue) => issue.code);
    expect(codes).toContain("undeclared_scene_blob");
  });

  it("the scene gate catches text smuggled into the canvas (declared text with no DOM twin)", () => {
    const html = renderPointCloudBackground({ props: validProps(), slots: { point_cloud: [cloudAsset(encoded)] }, contract });
    const declaration = decorativeDeclaration({ text_payload: ["NORTHWIND"] });
    const report = validatePointCloudScene({ scene: { encoded, declaration }, html, catalog });
    expect(report.errors.map((issue) => issue.code)).toContain("canvas_text_dom_twin_cloud");
  });

  it("throws when the point_cloud slot is missing", () => {
    expect(() => renderPointCloudBackground({ props: validProps(), slots: {}, contract })).toThrowError(
      PointCloudBackgroundContractError
    );
  });

  it("throws cloud_pointcount_over_budget when the inline cloud exceeds the budget", () => {
    const overBudget: ResolvedAsset = {
      id: "huge",
      targetKind: "asset",
      assetType: "point_cloud",
      source: "product-design-os/assets/3d/huge.cloud.json",
      dataRef: { mime: "application/json", inline: '{"pointCount":30000}' }
    };
    expect(() => renderPointCloudBackground({ props: validProps(), slots: { point_cloud: [overBudget] }, contract })).toThrowError(
      /cloud_pointcount_over_budget/
    );
  });

  it("throws point_cloud_payload_invalid when the inline dataRef is not valid JSON", () => {
    const broken: ResolvedAsset = {
      id: "broken",
      targetKind: "asset",
      assetType: "point_cloud",
      source: "product-design-os/assets/3d/broken.cloud.json",
      dataRef: { mime: "application/json", inline: "{not json" }
    };
    expect(() => renderPointCloudBackground({ props: validProps(), slots: { point_cloud: [broken] }, contract })).toThrowError(
      /point_cloud_payload_invalid/
    );
  });

  it("escapes any < in the inline JSON so it cannot break out of the script element", () => {
    const sneakyEncoded = { ...encoded, stats: { ...encoded.stats, seed: "</script><script>alert(1)" } };
    const sneaky: ResolvedAsset = {
      id: "sneaky",
      targetKind: "asset",
      assetType: "point_cloud",
      source: "product-design-os/assets/3d/sneaky.cloud.json",
      dataRef: { mime: "application/json", inline: JSON.stringify(sneakyEncoded) }
    };
    const html = renderPointCloudBackground({ props: validProps(), slots: { point_cloud: [sneaky] }, contract });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
  });

  it("the renderer's self-check fires validatePointCloudScene (over-depth cloud throws at render time)", () => {
    const overDepth = {
      ...encoded,
      stats: { ...encoded.stats, optionsSummary: { ...encoded.stats.optionsSummary, depthAmp: 8 } }
    };
    const asset: ResolvedAsset = {
      id: "over-depth",
      targetKind: "asset",
      assetType: "point_cloud",
      source: "product-design-os/assets/3d/over-depth.cloud.json",
      dataRef: { mime: "application/json", inline: JSON.stringify(overDepth) }
    };
    expect(() => renderPointCloudBackground({ props: validProps(), slots: { point_cloud: [asset] }, contract })).toThrowError(
      /cloud_depth_over_budget/
    );
  });

  it("maps each scene_preset to its four-knob choreography on the canvas", () => {
    const expected: Record<string, { topology: string; physics: string; density: string; color: string }> = {
      "architectural-grid": { topology: "grid", physics: "crystalline", density: "sparse", color: "mono" },
      "photographic-drift": { topology: "edge", physics: "floaty", density: "dense", color: "faithful" },
      "wordmark-gather": { topology: "gather", physics: "magnetic", density: "medium", color: "duotone" },
      "lens-bokeh": { topology: "edge", physics: "heavy", density: "dense", color: "faithful" },
      "flow-field": { topology: "flow", physics: "floaty", density: "medium", color: "duotone" }
    };
    for (const [preset, knobs] of Object.entries(expected)) {
      const html = renderPointCloudBackground({
        props: { ...validProps(), scene_preset: preset },
        slots: { point_cloud: [cloudAsset(encoded)] },
        contract
      });
      expect(html).toContain(`data-scene-preset="${preset}"`);
      expect(html).toContain(`data-topology="${knobs.topology}"`);
      expect(html).toContain(`data-physics="${knobs.physics}"`);
      expect(html).toContain(`data-density="${knobs.density}"`);
      expect(html).toContain(`data-color="${knobs.color}"`);
    }
  });

  it("emits a deterministic per-site variety seed derived from the headline", () => {
    const render = (headline: string) =>
      renderPointCloudBackground({ props: { ...validProps(), headline }, slots: { point_cloud: [cloudAsset(encoded)] }, contract });
    const seedOf = (html: string) => html.match(/data-seed="(\d+)"/)?.[1];
    const a = seedOf(render("Headline A — one distinct line of copy"));
    const b = seedOf(render("Headline B — a different line of copy"));
    expect(a).toBeDefined();
    expect(a).not.toBe(b);
  });

  it("rejects an unknown scene_preset", () => {
    expect(() =>
      renderPointCloudBackground({ props: { ...validProps(), scene_preset: "bogus-preset" }, slots: { point_cloud: [cloudAsset(encoded)] }, contract })
    ).toThrowError(/scene_preset_not_allowed/);
  });

  it("requires scene_preset when the contract marks it required", () => {
    expect(() =>
      renderPointCloudBackground({ props: { ...validProps(), scene_preset: "" }, slots: { point_cloud: [cloudAsset(encoded)] }, contract })
    ).toThrowError(/scene_preset_required/);
  });
});

describe("point-cloud-background — engine guards (measure-not-trust, generation-time)", () => {
  const renderedHtml = () =>
    renderPointCloudBackground({ props: validProps(), slots: { point_cloud: [cloudAsset(encoded)] }, contract });
  const sceneErrors = (html: string) =>
    validatePointCloudScene({ scene: { encoded, declaration: decorativeDeclaration() }, html, catalog }).errors.map((issue) => issue.code);

  it("the real rendered engine passes the DPR-clamp and pause-on-hidden guards", () => {
    const codes = sceneErrors(renderedHtml());
    expect(codes).not.toContain("cloud_dpr_unclamped");
    expect(codes).not.toContain("cloud_pause_on_hidden_missing");
  });

  it("FAILS cloud_dpr_unclamped when the DPR clamp is stripped from the engine", () => {
    const stripped = renderedHtml().replace(/Math\.min\([^;]*devicePixelRatio[^;]*\)/, "1");
    expect(sceneErrors(stripped)).toContain("cloud_dpr_unclamped");
  });

  it("FAILS cloud_pause_on_hidden_missing when the hide-branch cancel is removed (locks in the bug fix)", () => {
    const stripped = renderedHtml().replace(/cancelAnimationFrame\(raf\)/g, "noop()");
    expect(sceneErrors(stripped)).toContain("cloud_pause_on_hidden_missing");
  });
});

describe("point-cloud-background — vzory color pilots (aurora / depth-temp / pastel)", () => {
  const colorByPreset: Record<string, string> = {
    "aurora-drift": "aurora",
    "depth-field": "depth-temp",
    "pastel-bokeh": "pastel"
  };
  const renderPreset = (preset: string) =>
    renderPointCloudBackground({ props: { ...validProps(), scene_preset: preset }, slots: { point_cloud: [cloudAsset(encoded)] }, contract });

  it("each new preset emits its token-derived color mode + references --color-accent-secondary", () => {
    for (const [preset, color] of Object.entries(colorByPreset)) {
      const html = renderPreset(preset);
      expect(html).toContain(`data-color="${color}"`);
      expect(html).toContain("--color-accent-secondary");
    }
  });

  it("the new color presets still pass the scene gate (no regression)", () => {
    for (const preset of Object.keys(colorByPreset)) {
      const report = validatePointCloudScene({ scene: { encoded, declaration: decorativeDeclaration() }, html: renderPreset(preset), catalog });
      expect(report.errors).toEqual([]);
    }
  });

  it("colorOf carries no hardcoded brand hue — only token fallbacks (#88ccff / #0a0d0a)", () => {
    const hexes = renderPreset("aurora-drift").match(/#[0-9a-fA-F]{6}/g) ?? [];
    expect(hexes.every((h) => h.toLowerCase() === "#88ccff" || h.toLowerCase() === "#0a0d0a")).toBe(true);
  });
});

describe("point-cloud-background — Stage A: homePose + topo-relief treatment", () => {
  const render = (preset: string) =>
    renderPointCloudBackground({ props: { ...validProps(), scene_preset: preset }, slots: { point_cloud: [cloudAsset(encoded)] }, contract });

  it("the topographic-relief preset emits a bounded data-relief enum and still passes the scene gate", () => {
    const html = render("topographic-relief");
    expect(html).toContain('data-relief="topo"');
    const report = validatePointCloudScene({ scene: { encoded, declaration: decorativeDeclaration() }, html, catalog });
    expect(report.errors).toEqual([]);
  });

  it('non-relief presets emit data-relief="none" (treatment off by default)', () => {
    expect(render("photographic-drift")).toContain('data-relief="none"');
  });

  it("the homePose refactor is behaviour-preserving — the faithful resting projection math is intact", () => {
    const html = render("photographic-drift");
    expect(html).toContain("function homePose(");
    expect(html).toContain("cx+p.x*scale*depth");
  });

  it("cloud_relief_invalid fires on an out-of-enum data-relief AND survives script stripping", () => {
    const tampered = render("topographic-relief").replace('data-relief="topo"', 'data-relief="evil-9000"');
    const errs = validatePointCloudScene({ scene: { encoded, declaration: decorativeDeclaration() }, html: tampered, catalog }).errors.map((e) => e.code);
    expect(errs).toContain("cloud_relief_invalid");
    const stripped = tampered.replace(/<script>[\s\S]*?<\/script>/g, "");
    const errsStripped = validatePointCloudScene({ scene: { encoded, declaration: decorativeDeclaration() }, html: stripped, catalog }).errors.map((e) => e.code);
    expect(errsStripped).toContain("cloud_relief_invalid");
  });
});

describe("point-cloud-background — Stage A: lowpoly-facet (build-time decimation)", () => {
  const errsOf = (e: EncodedPointCloud, html = "") =>
    validatePointCloudScene({ scene: { encoded: e, declaration: decorativeDeclaration() }, html, catalog }).errors.map((x) => x.code);

  it("the lowpoly-facet preset selects the baked facet point-set and passes the gate", () => {
    const html = renderPointCloudBackground({ props: { ...validProps(), scene_preset: "lowpoly-facet" }, slots: { point_cloud: [cloudAsset(facetEncoded)] }, contract });
    expect(html).toContain('data-density="lowpoly"');
    expect(validatePointCloudScene({ scene: { encoded: facetEncoded, declaration: decorativeDeclaration() }, html, catalog }).errors).toEqual([]);
  });

  it("facets are a strict, faithful decimation of the same brand cloud (fewer points, bbox ⊆ full)", () => {
    expect(facetEncoded.facetCount ?? 0).toBeGreaterThan(0);
    expect(facetEncoded.facetCount ?? 0).toBeLessThan(facetEncoded.pointCount);
    const buf = Buffer.from(facetEncoded.facetPositions ?? "", "base64");
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const { min, max } = facetEncoded.stats.bbox;
    for (let i = 0; i < (facetEncoded.facetCount ?? 0); i += 1) {
      const x = view.getFloat32(i * 12, true);
      const y = view.getFloat32(i * 12 + 4, true);
      expect(x).toBeGreaterThanOrEqual(min.x - 1e-4);
      expect(x).toBeLessThanOrEqual(max.x + 1e-4);
      expect(y).toBeGreaterThanOrEqual(min.y - 1e-4);
      expect(y).toBeLessThanOrEqual(max.y + 1e-4);
    }
  });

  it("the facet bake is deterministic (same seed ⇒ byte-identical facets)", async () => {
    const opts = { imagePath: fixturePath, sampleStep: 1, alphaThreshold: 10, brightnessFloor: 0.02, depthAmp: 2, targetCount: 1200, includeSizes: true, seed: "phase1", facetCount: 4 };
    const a = await imageToPointCloud(opts);
    const b = await imageToPointCloud(opts);
    expect(a.facetCount).toBe(b.facetCount);
    expect(a.facetPositions).toBe(b.facetPositions);
    expect(a.facetColors).toBe(b.facetColors);
  });

  it("cloud_facets_invalid rejects partial, non-decimating, and length-mismatched facet payloads", () => {
    expect(errsOf({ ...encoded, facetCount: 10 } as EncodedPointCloud)).toContain("cloud_facets_invalid"); // count without payload
    expect(errsOf({ ...facetEncoded, facetCount: facetEncoded.pointCount } as EncodedPointCloud)).toContain("cloud_facets_invalid"); // not a decimation
    expect(errsOf({ ...facetEncoded, facetCount: 2 } as EncodedPointCloud)).toContain("cloud_facets_invalid"); // understated count vs payload length
  });

  it("the 384KB payload budget now counts facet bytes (the unbudgeted-facet escape is closed)", () => {
    const base = { ...encoded, positions: "A".repeat(390000), colors: "A".repeat(1000) } as EncodedPointCloud;
    expect(errsOf(base)).not.toContain("cloud_payload_over_budget");
    const withFacets = {
      ...base,
      facetCount: 400,
      facetPositions: "A".repeat(6400),
      facetColors: "A".repeat(1600),
      encoding: { ...encoded.encoding, facetPositions: "base64:f32le" as const, facetColors: "base64:u8" as const }
    } as EncodedPointCloud;
    expect(errsOf(withFacets)).toContain("cloud_payload_over_budget");
  });
});

describe("point-cloud-background — Stage B: capped line primitive (edge-wire / blueprint-ribs)", () => {
  const errsOf = (e: EncodedPointCloud, html = "") =>
    validatePointCloudScene({ scene: { encoded: e, declaration: decorativeDeclaration() }, html, catalog }).errors.map((x) => x.code);
  const u16b64 = (arr: number[]) => Buffer.from(new Uint16Array(arr).buffer).toString("base64");
  const catCloud = JSON.parse(readFileSync(resolve("product-design-os/assets/3d/radeq-cat-cloud.cloud.json"), "utf8")) as EncodedPointCloud;

  it("the line presets emit their bounded data-line knob; non-line presets emit \"off\"", () => {
    const render = (preset: string) => renderPointCloudBackground({ props: { ...validProps(), scene_preset: preset }, slots: { point_cloud: [cloudAsset(encoded)] }, contract });
    expect(render("edge-wire")).toContain('data-line="wire"');
    expect(render("blueprint-ribs")).toContain('data-line="ribs"');
    expect(render("photographic-drift")).toContain('data-line="off"');
  });

  it("the real baked cat asset (4000 pts + 7414 k-NN edges) passes the scene gate", () => {
    expect(catCloud.edgeCount).toBeGreaterThan(0);
    expect(catCloud.encoding.edges).toBe("base64:u16le");
    expect(errsOf(catCloud)).not.toContain("cloud_edges_invalid");
  });

  it("the edge bake is deterministic (same seed ⇒ byte-identical edges)", async () => {
    const opts = { imagePath: fixturePath, sampleStep: 1, alphaThreshold: 10, brightnessFloor: 0.02, depthAmp: 2, includeSizes: true, seed: "phase1", edgeNeighbors: 2 } as const;
    const a = await imageToPointCloud(opts);
    const b = await imageToPointCloud(opts);
    expect(a.edges).toBe(b.edges);
    expect(a.edgeCount).toBe(b.edgeCount);
  });

  it("cloud_edges_invalid closes the anti-slop + integrity holes (sub-floor, partial, understated, dangling, wrong-tag)", () => {
    // anti-slop: a wireframe on a sub-glyph-floor cloud could spell lettering
    expect(errsOf({ ...catCloud, pointCount: 1000 } as EncodedPointCloud)).toContain("cloud_edges_invalid");
    // partial payload
    expect(errsOf({ ...catCloud, edges: undefined } as unknown as EncodedPointCloud)).toContain("cloud_edges_invalid");
    // understated count vs decoded payload
    expect(errsOf({ ...catCloud, edgeCount: 2 } as EncodedPointCloud)).toContain("cloud_edges_invalid");
    // dangling endpoint (index >= pointCount)
    expect(errsOf({ ...catCloud, edgeCount: 1, edges: u16b64([0, 5000]), encoding: { ...catCloud.encoding, edges: "base64:u16le" as const } } as EncodedPointCloud)).toContain("cloud_edges_invalid");
    // smuggled alternate encoding tag
    expect(errsOf({ ...catCloud, encoding: { ...catCloud.encoding, edges: "base64:u8" } } as unknown as EncodedPointCloud)).toContain("cloud_edges_invalid");
  });

  it("the 384KB payload budget now counts edge bytes, and an undeclared edge blob is caught in HTML", () => {
    const base = { ...encoded, pointCount: 4000, positions: "A".repeat(388000), colors: "A".repeat(1000), sizes: undefined, encoding: { positions: "base64:f32le" as const, colors: "base64:u8" as const } } as unknown as EncodedPointCloud;
    expect(errsOf(base)).not.toContain("cloud_payload_over_budget");
    const validEdges = Array.from({ length: 6000 }, (_, i) => i % 4000);
    const withEdges = { ...base, edgeCount: 3000, edges: u16b64(validEdges), encoding: { positions: "base64:f32le" as const, colors: "base64:u8" as const, edges: "base64:u16le" as const } } as EncodedPointCloud;
    expect(errsOf(withEdges)).toContain("cloud_payload_over_budget");
    // an edges blob embedded without a validated canvas trips the HTML safety net
    const blob = '<div>{"edges":"AAAA","encoding":{"edges":"base64:u16le"}}</div>';
    expect(detectUndeclaredCloudInHtml(blob)?.code).toBe("undeclared_scene_blob");
  });
});

describe("point-cloud-background — gate hardening: decode buffers, don't trust declared stats", () => {
  const errsOf = (e: EncodedPointCloud, html = "") =>
    validatePointCloudScene({ scene: { encoded: e, declaration: decorativeDeclaration() }, html, catalog }).errors.map((x) => x.code);
  const f32b64 = (arr: number[]) => Buffer.from(new Float32Array(arr).buffer).toString("base64");
  const u8b64 = (arr: number[]) => Buffer.from(new Uint8Array(arr)).toString("base64");
  const u16b64 = (arr: number[]) => Buffer.from(new Uint16Array(arr).buffer).toString("base64");
  const cat = JSON.parse(readFileSync(resolve("product-design-os/assets/3d/radeq-cat-cloud.cloud.json"), "utf8")) as EncodedPointCloud;
  // a minimal cloud with real, in-hull positions (caller overrides specific fields)
  const makeCloud = (pointCount: number, overrides: Record<string, unknown> = {}): EncodedPointCloud => {
    const pos = new Float32Array(pointCount * 3);
    return {
      schemaVersion: 1, encoding: { positions: "base64:f32le", colors: "base64:u8" }, pointCount,
      dims: { width: 10, height: 10 }, sampleStep: 1,
      positions: Buffer.from(pos.buffer).toString("base64"), colors: u8b64(new Array(pointCount * 3).fill(0)),
      stats: cat.stats, ...overrides
    } as EncodedPointCloud;
  };

  it("checkGeometry: declared pointCount disagreeing with the positions buffer is rejected", () => {
    expect(errsOf({ ...cat, pointCount: 99999 } as EncodedPointCloud)).toContain("cloud_geometry_invalid");
  });

  it("checkGeometry: a real z-range over budget is caught even when declared stats lie", () => {
    const forged = makeCloud(2, { positions: f32b64([0, 0, 100, 0, 0, -100]), colors: u8b64([0, 0, 0, 0, 0, 0]) });
    expect(errsOf(forged)).toContain("cloud_geometry_invalid"); // engine drives parallax from these real z floats
  });

  it("checkFacets: a facet centroid outside the cloud bbox is rejected (decode-not-length)", () => {
    const realFacet = [cat.stats.bbox.min.x, cat.stats.bbox.min.y, 0];
    const forged = { ...cat, facetCount: 2, facetPositions: f32b64([...realFacet, 50, 50, 99]), facetColors: u8b64([0, 0, 0, 0, 0, 0]) } as EncodedPointCloud;
    expect(errsOf(forged)).toContain("cloud_facets_invalid");
  });

  it("checkFacets: wrong facet encoding tag and lowpoly-without-facets are both rejected", () => {
    expect(errsOf({ ...cat, encoding: { ...cat.encoding, facetPositions: "base64:u8" } } as unknown as EncodedPointCloud)).toContain("cloud_facets_invalid");
    expect(errsOf(encoded, '<canvas data-point-cloud data-density="lowpoly"></canvas>')).toContain("cloud_facets_invalid");
  });

  it("checkEdges: a self-loop and a cloud-spanning (lettering-capable) edge are rejected", () => {
    const pos = new Float32Array(1500 * 3);
    pos[0] = -0.5; pos[1] = -0.5; pos[3] = 0.5; pos[4] = 0.5; // points 0 and 1 at opposite corners
    const span = makeCloud(1500, { positions: Buffer.from(pos.buffer).toString("base64"), edgeCount: 1, edges: u16b64([0, 1]), encoding: { positions: "base64:f32le", colors: "base64:u8", edges: "base64:u16le" } });
    expect(errsOf(span)).toContain("cloud_edges_invalid"); // long edge
    const loop = makeCloud(1500, { edgeCount: 1, edges: u16b64([5, 5]), encoding: { positions: "base64:f32le", colors: "base64:u8", edges: "base64:u16le" } });
    expect(errsOf(loop)).toContain("cloud_edges_invalid"); // self-loop
  });

  it("detectUndeclaredCloudInHtml: facet-only and mislabeled-encoding-tag blobs are caught", () => {
    expect(detectUndeclaredCloudInHtml('<div>{"pointCount":210,"facetPositions":"AAAA"}</div>')?.code).toBe("undeclared_scene_blob");
    expect(detectUndeclaredCloudInHtml('<div>{"pointCount":4000,"encoding":{"positions":"raw:f32"},"positions":"AAAA"}</div>')?.code).toBe("undeclared_scene_blob");
  });

  it("checkRelief: a decoy data-relief=\"none\" does not shadow a later out-of-enum value", () => {
    const html = '<canvas data-point-cloud data-relief="none"></canvas><canvas data-point-cloud data-relief="evil"></canvas>';
    expect(validatePointCloudScene({ scene: { encoded, declaration: decorativeDeclaration() }, html, catalog }).errors.map((e) => e.code)).toContain("cloud_relief_invalid");
  });
});

describe("point-cloud-background — end-to-end through renderComposition", () => {
  const pdosRoot = join(process.cwd(), "product-design-os");

  function pointCloudContract(): ComponentContract {
    const manifest = JSON.parse(
      readFileSync(join(pdosRoot, "contracts", "component-contract-manifest.json"), "utf8")
    ) as { contracts: ComponentContract[] };
    const found = manifest.contracts.find(
      (candidate) => candidate.target_kind === "pattern" && candidate.target_id === "point-cloud-background"
    );
    if (found === undefined) {
      throw new Error("Missing point-cloud-background contract.");
    }
    return found;
  }

  it("renders the committed composition spec through the full spec→asset→renderer pipeline", () => {
    const spec = JSON.parse(
      readFileSync(join(pdosRoot, "specs", "examples", "point-cloud-background.composition.json"), "utf8")
    ) as unknown;
    const result = renderComposition(spec, pdosRoot);

    expect(result.qaTargets[0]?.patternId).toBe("point-cloud-background");
    expect(result.html).toContain("data-point-cloud");
    expect(result.html).toContain('data-cloud-contract="pattern-point-cloud-background"');
    expect(result.html).toContain('<script type="application/json" data-dot-cloud>');
    // The real EncodedPointCloud asset was inlined via resolveAssetSource → dataRef.
    expect(result.html).toContain('"positions":"base64:f32le"');
    expect(result.html).toContain("Napsat poptávku");
    // The composition's scene_preset flows through to the canvas knobs.
    expect(result.html).toContain('data-scene-preset="photographic-drift"');
    expect(result.html).toContain('data-topology="edge"');
    expect(result.html).not.toMatch(/data:/i);

    expect(checkRenderedContract(result.html, pointCloudContract()).errors).toEqual([]);
  });
});
