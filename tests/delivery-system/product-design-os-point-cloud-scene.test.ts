import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkRenderedContract } from "../../product-design-os/renderer/check-render-contract";
import {
  detectUndeclaredCloudInHtml,
  validatePointCloudScene,
  type PointCloudScene,
  type PointCloudSceneDeclaration,
  type PointCloudSourceCatalog
} from "../../product-design-os/renderer/check-point-cloud-scene";
import type { ComponentContract } from "../../product-design-os/renderer/types";
import { encodeFloat32Base64, encodeUint8Base64 } from "../../src/lib/image-point-cloud/pack";
import type { EncodedPointCloud } from "../../src/lib/image-point-cloud";

// ── Builders ──────────────────────────────────────────────────────────────────

interface CloudOptions {
  readonly pointCount?: number;
  readonly depthAmp?: number;
  readonly dims?: { readonly width: number; readonly height: number };
  readonly bbox?: { readonly minZ: number; readonly maxZ: number };
  readonly histogram?: { readonly bucketCount: number; readonly topRatio: number };
  readonly includeSizes?: boolean;
}

function buildCloud(options: CloudOptions = {}): EncodedPointCloud {
  const pointCount = options.pointCount ?? 1400;
  const depthAmp = options.depthAmp ?? 2;
  const dims = options.dims ?? { width: 800, height: 600 };
  const bbox = options.bbox ?? { minZ: -1, maxZ: 1 };
  const histogram = options.histogram ?? { bucketCount: 40, topRatio: 0.2 };
  const includeSizes = options.includeSizes ?? false;

  const positions = encodeFloat32Base64(new Float32Array(pointCount * 3));
  const colors = encodeUint8Base64(new Uint8Array(pointCount * 3));
  const sizes = includeSizes ? encodeUint8Base64(new Uint8Array(pointCount)) : undefined;

  const stats = {
    pointCount,
    candidateCount: pointCount,
    sampledPixelCount: pointCount,
    maskedPixelCount: 0,
    shapeExcludedCount: 0,
    thinnedCount: 0,
    weightThinnedCount: 0,
    quotaSkippedCount: 0,
    targetThinnedCount: 0,
    maskedRatio: 0,
    thinnedRatio: 0,
    aspectRatio: dims.width / dims.height,
    averageLuma: 0.5,
    seed: "test",
    optionsSummary: {
      sampleStep: 1,
      alphaThreshold: 1,
      brightnessFloor: 0,
      depthAmp,
      includeSizes,
      basePointSize: 1,
      histogramBuckets: 16,
      regionCount: 0,
      shapeCount: 0
    },
    bbox: {
      min: { x: -0.5, y: -0.5, z: bbox.minZ },
      max: { x: 0.5, y: 0.5, z: bbox.maxZ }
    },
    dims,
    sampleStep: 1,
    colorHistogram: {
      bucketSize: 16,
      bucketCount: histogram.bucketCount,
      top: [{ rgb: [120, 120, 120] as const, count: Math.round(pointCount * histogram.topRatio), ratio: histogram.topRatio }]
    }
  };

  const encoding = sizes === undefined
    ? { positions: "base64:f32le" as const, colors: "base64:u8" as const }
    : { positions: "base64:f32le" as const, colors: "base64:u8" as const, sizes: "base64:u8" as const };

  const base = {
    schemaVersion: 1 as const,
    encoding,
    pointCount,
    dims,
    sampleStep: 1,
    positions,
    colors,
    stats
  };

  return sizes === undefined ? base : { ...base, sizes };
}

const approvedSource = {
  provenance: "source-recorded",
  source_id: "approved-brand-photo",
  asset_url: "https://assets.example/brand/hero.png",
  content_hash: "sha256-abc123"
} as const;

/** Minimal valid declaration: decorative, static, attests no text, approved source. */
function decl(overrides: Partial<PointCloudSceneDeclaration> = {}): PointCloudSceneDeclaration {
  return {
    role: "decorative",
    aria_hidden: true,
    animated: false,
    text_payload: [],
    source: approvedSource,
    ...overrides
  };
}

const testCatalog: PointCloudSourceCatalog = {
  sources: [
    { id: "approved-brand-photo", status: "approved_source", commercial_use: "allowed" },
    { id: "attribution-photo", status: "approved_source", commercial_use: "allowed_with_attribution" },
    { id: "candidate-pack", status: "candidate_source", commercial_use: "allowed" },
    { id: "inspo-only", status: "inspiration_only", commercial_use: "inspiration_only" }
  ]
};

function report(
  encoded: EncodedPointCloud,
  declaration: PointCloudSceneDeclaration,
  html = "<main><h1>Real headline</h1></main>",
  catalog: PointCloudSourceCatalog = testCatalog
) {
  const scene: PointCloudScene = { encoded, declaration };
  return validatePointCloudScene({ scene, html, catalog });
}

function errorCodes(
  encoded: EncodedPointCloud,
  declaration: PointCloudSceneDeclaration,
  html?: string,
  catalog?: PointCloudSourceCatalog
): string[] {
  return report(encoded, declaration, html, catalog).errors.map((issue) => issue.code);
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("validatePointCloudScene — fail-closed gate for stored point-cloud scenes", () => {
  it("passes a valid, decorative, abstract cloud within all budgets", () => {
    const result = report(buildCloud(), decl());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("FAILS cloud_pointcount_over_budget for an oversized cloud", () => {
    expect(errorCodes(buildCloud({ pointCount: 30_000 }), decl())).toContain("cloud_pointcount_over_budget");
  });

  it("FAILS cloud_payload_over_budget for an oversized source image (isolated from point count)", () => {
    const codes = errorCodes(buildCloud({ pointCount: 1000, dims: { width: 3000, height: 2000 } }), decl());
    expect(codes).toContain("cloud_payload_over_budget");
    expect(codes).not.toContain("cloud_pointcount_over_budget");
  });

  it("FAILS cloud_depth_over_budget when depthAmp exceeds the budget", () => {
    expect(errorCodes(buildCloud({ pointCount: 1000, depthAmp: 8 }), decl())).toContain("cloud_depth_over_budget");
  });

  it("FAILS cloud_depth_over_budget when depthAmp×parallax_gain exceeds the effective budget", () => {
    const codes = errorCodes(buildCloud({ pointCount: 1000, depthAmp: 3 }), decl({ parallax_gain: 3 }));
    expect(codes).toContain("cloud_depth_over_budget");
  });

  it("FAILS cloud_depth_over_budget when the bbox z-range is too deep", () => {
    expect(errorCodes(buildCloud({ pointCount: 1000, bbox: { minZ: -5, maxZ: 5 } }), decl())).toContain(
      "cloud_depth_over_budget"
    );
  });

  it("passes an internal (in-repo authored) cloud with no catalog", () => {
    const declaration = decl({ source: { provenance: "internal" } });
    const scene: PointCloudScene = { encoded: buildCloud(), declaration };
    expect(validatePointCloudScene({ scene, html: "<main><h1>Real headline</h1></main>" }).errors).toEqual([]);
  });

  it("FAILS cloud_source_unlicensed when the source-recorded adoption record is incomplete", () => {
    const declaration = decl({
      source: { provenance: "source-recorded", source_id: "", asset_url: "", content_hash: "" }
    });
    expect(errorCodes(buildCloud(), declaration)).toContain("cloud_source_unlicensed");
  });

  it("FAILS cloud_source_unlicensed when the source id is not in the catalog", () => {
    const declaration = decl({ source: { ...approvedSource, source_id: "ghost-source" } });
    expect(errorCodes(buildCloud(), declaration)).toContain("cloud_source_unlicensed");
  });

  it("FAILS cloud_source_unlicensed for candidate/inspiration-only sources (not approved for fan-out)", () => {
    const candidate = decl({ source: { ...approvedSource, source_id: "candidate-pack" } });
    expect(errorCodes(buildCloud(), candidate)).toContain("cloud_source_unlicensed");
    const inspo = decl({ source: { ...approvedSource, source_id: "inspo-only" } });
    expect(errorCodes(buildCloud(), inspo)).toContain("cloud_source_unlicensed");
  });

  it("accepts an allowed_with_attribution approved source", () => {
    const declaration = decl({ source: { ...approvedSource, source_id: "attribution-photo" } });
    expect(errorCodes(buildCloud(), declaration)).not.toContain("cloud_source_unlicensed");
  });

  it("FAILS canvas_text_dom_twin_cloud when text_payload is omitted entirely", () => {
    const noPayload: PointCloudSceneDeclaration = {
      role: "decorative",
      aria_hidden: true,
      animated: false,
      source: approvedSource
    };
    expect(errorCodes(buildCloud(), noPayload)).toContain("canvas_text_dom_twin_cloud");
  });

  it("FAILS canvas_text_dom_twin_cloud when declared text has no visible DOM twin", () => {
    const declaration = decl({ text_payload: ["SALE"] });
    expect(errorCodes(buildCloud(), declaration, "<main><h1>Real headline</h1></main>")).toContain(
      "canvas_text_dom_twin_cloud"
    );
  });

  it("FAILS canvas_text_dom_twin_cloud when the only twin is aria-hidden", () => {
    const declaration = decl({ text_payload: ["SALE"] });
    const html = '<main><span data-cloud-twin="SALE" aria-hidden="true">SALE</span></main>';
    expect(errorCodes(buildCloud(), declaration, html)).toContain("canvas_text_dom_twin_cloud");
  });

  it("passes the text-twin check when declared text has a matching visible twin", () => {
    const declaration = decl({ text_payload: ["SALE"] });
    const html = '<main><span data-cloud-twin="SALE">SALE</span></main>';
    expect(errorCodes(buildCloud(), declaration, html)).not.toContain("canvas_text_dom_twin_cloud");
  });

  it("WARNS (does not error) when [] is attested but the cloud is glyph-likely", () => {
    const result = report(buildCloud({ pointCount: 5000 }), decl());
    expect(result.errors.map((issue) => issue.code)).not.toContain("canvas_text_dom_twin_cloud");
    expect(result.warnings.map((issue) => issue.code)).toContain("canvas_text_dom_twin_cloud");
  });

  it("FAILS cloud_reduced_motion_missing when animated with no prefers-reduced-motion guard", () => {
    const declaration = decl({ animated: true, static_fallback: { label: "Resolved still" } });
    expect(errorCodes(buildCloud(), declaration, "<main>no guard here</main>")).toContain(
      "cloud_reduced_motion_missing"
    );
  });

  it("FAILS cloud_reduced_motion_missing when animated with no declared static fallback", () => {
    const declaration = decl({ animated: true });
    const html = "<style>@media (prefers-reduced-motion: reduce){*{animation:none}}</style><main>ok</main>";
    expect(errorCodes(buildCloud(), declaration, html)).toContain("cloud_reduced_motion_missing");
  });

  it("passes an animated cloud that guards reduced-motion AND declares a static fallback", () => {
    const declaration = decl({ animated: true, static_fallback: { label: "Resolved still frame" } });
    const html = "<style>@media (prefers-reduced-motion: reduce){*{animation:none}}</style><main>ok</main>";
    expect(errorCodes(buildCloud(), declaration, html)).not.toContain("cloud_reduced_motion_missing");
  });

  it("FAILS cloud_not_decorative when role is not decorative or the canvas is not aria-hidden", () => {
    expect(errorCodes(buildCloud(), decl({ role: "hero" }))).toContain("cloud_not_decorative");
    expect(errorCodes(buildCloud(), decl({ aria_hidden: false }))).toContain("cloud_not_decorative");
  });

  it("validates against the REAL library/source-catalog.json (approved CC0 source passes provenance)", () => {
    const catalog = JSON.parse(
      readFileSync(join(process.cwd(), "product-design-os", "library", "source-catalog.json"), "utf8")
    ) as PointCloudSourceCatalog;
    const declaration = decl({
      source: {
        provenance: "source-recorded",
        source_id: "open-doodles",
        asset_url: "https://www.opendoodles.com/x.png",
        content_hash: "sha256-real"
      }
    });
    expect(errorCodes(buildCloud(), declaration, "<main>ok</main>", catalog)).not.toContain("cloud_source_unlicensed");
  });
});

describe("detectUndeclaredCloudInHtml — HTML safety net wired into checkRenderedContract", () => {
  const cloudPayloadHtml =
    '<section><canvas></canvas><script type="application/json">{"schemaVersion":1,"encoding":{"positions":"base64:f32le","colors":"base64:u8"},"positions":"AAAA","colors":"AAAA"}</script></section>';

  const validatedCloudHtml =
    '<section><canvas data-point-cloud data-cloud-contract="pattern-point-cloud-bg"></canvas><script type="application/json">{"encoding":{"positions":"base64:f32le"},"positions":"AAAA"}</script></section>';

  const minimalContract: ComponentContract = {
    id: "pattern-test",
    target_kind: "pattern",
    target_id: "test",
    props: [],
    slots: [],
    output_invariants: []
  };

  it("flags an embedded cloud payload with no validated [data-point-cloud][data-cloud-contract] canvas", () => {
    expect(detectUndeclaredCloudInHtml(cloudPayloadHtml)?.code).toBe("undeclared_scene_blob");
  });

  it("does not flag a validated cloud canvas", () => {
    expect(detectUndeclaredCloudInHtml(validatedCloudHtml)).toBeNull();
  });

  it("does not flag ordinary HTML with no cloud payload", () => {
    expect(detectUndeclaredCloudInHtml("<section><h1>Hello</h1></section>")).toBeNull();
  });

  it("surfaces undeclared_scene_blob through checkRenderedContract (live gate)", () => {
    const codes = checkRenderedContract(cloudPayloadHtml, minimalContract).errors.map((issue) => issue.code);
    expect(codes).toContain("undeclared_scene_blob");
  });

  it("flags the payload even when a DECOY [data-point-cloud][data-cloud-contract] sits on an unrelated element (markers must bind to the payload's own scene, not appear anywhere)", () => {
    const decoyHtml =
      '<div>{"schemaVersion":1,"encoding":{"positions":"base64:f32le"},"pointCount":1400,"positions":"AAAA"}</div>' +
      '<span data-point-cloud data-cloud-contract="x"></span>';
    expect(detectUndeclaredCloudInHtml(decoyHtml)?.code).toBe("undeclared_scene_blob");
  });

  it("flags the payload when a REAL validated canvas lives in a SEPARATE section from the payload blob", () => {
    const separateSectionHtml =
      '<section class="point-cloud-bg"><canvas data-point-cloud data-cloud-contract="pattern-x"></canvas></section>' +
      '<div>{"encoding":{"positions":"base64:f32le"},"pointCount":1400,"positions":"AAAA"}</div>';
    expect(detectUndeclaredCloudInHtml(separateSectionHtml)?.code).toBe("undeclared_scene_blob");
  });
});
