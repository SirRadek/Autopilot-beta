import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import {
  buildPointCloudAsset,
  suggestAssetManifestEntry
} from "../../product-design-os/scripts/build-point-cloud-asset";
import { renderPointCloudBackground } from "../../product-design-os/renderer/components/point-cloud-background";
import type { ComponentContract, ResolvedAsset } from "../../product-design-os/renderer/types";
import type { EncodedPointCloud } from "../../src/lib/image-point-cloud";

const contract: ComponentContract = {
  id: "pattern-point-cloud-background",
  target_kind: "pattern",
  target_id: "point-cloud-background",
  props: [
    { name: "headline", value_type: "text", required: true, min_length: 8 },
    { name: "primary_cta", value_type: "string", required: true, min_length: 3 },
    { name: "trust_cue", value_type: "string", required: true, min_length: 3 },
    { name: "static_fallback_label", value_type: "string", required: true, min_length: 3 },
    { name: "scene_preset", value_type: "string", required: false }
  ],
  slots: [
    { name: "point_cloud", required: true, min_items: 1, max_items: 1, accepts_target_kinds: ["asset"], accepts_asset_types: ["point_cloud"] }
  ],
  output_invariants: [
    { code: "visible_h1", required: true, severity: "error" },
    { code: "dom_text_cta", required: true, severity: "error" }
  ]
};

function heroProps() {
  return {
    headline: "A fast, accessible site with a living brand backdrop.",
    primary_cta: "Get a walkthrough",
    trust_cue: "Reply within a day.",
    static_fallback_label: "Static resolved depth field with the same offer.",
    scene_preset: "wordmark-gather"
  };
}

function cloudAsset(encoded: EncodedPointCloud): ResolvedAsset {
  return {
    id: "brand-mark",
    targetKind: "asset",
    assetType: "point_cloud",
    source: "product-design-os/assets/3d/brand-mark.cloud.json",
    dataRef: { mime: "application/json", inline: JSON.stringify(encoded) }
  };
}

/** A distinct procedural "brand mark" PNG — stand-in for a real brand image. */
function markPng(kind: "orb" | "bands", size = 48): Buffer {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const nx = x / size - 0.5;
      const ny = y / size - 0.5;
      const raw = kind === "orb"
        ? 1 - Math.sqrt(nx * nx + ny * ny) * 2.2
        : 0.5 + 0.4 * Math.sin((x / size) * Math.PI * 5) + 0.1 * Math.sin((y / size) * Math.PI * 3);
      const v = Math.max(0, Math.min(1, raw));
      const c = Math.round(v * 255);
      png.data[i] = c;
      png.data[i + 1] = Math.round(c * 0.7);
      png.data[i + 2] = Math.round(120 + v * 120);
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe("build-point-cloud-asset — brand-image → formation-target pipeline", () => {
  it("same preset, different brand asset ⇒ a structurally different hero (the moat)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pc-build-"));
    try {
      const sampling = { brightnessFloor: 0.12, depthAmp: 2, targetCount: 500, includeSizes: true } as const;
      const a = await buildPointCloudAsset({ imageBuffer: markPng("orb"), outPath: join(dir, "a.cloud.json"), seed: "brand-a", ...sampling });
      const b = await buildPointCloudAsset({ imageBuffer: markPng("bands"), outPath: join(dir, "b.cloud.json"), seed: "brand-b", ...sampling });

      expect(existsSync(join(dir, "a.cloud.json"))).toBe(true);
      // Different source images ⇒ different point geometry.
      expect(a.positions).not.toBe(b.positions);

      const htmlA = renderPointCloudBackground({ props: heroProps(), slots: { point_cloud: [cloudAsset(a)] }, contract });
      const htmlB = renderPointCloudBackground({ props: heroProps(), slots: { point_cloud: [cloudAsset(b)] }, contract });

      // Same preset choreography on both...
      expect(htmlA).toContain('data-topology="gather"');
      expect(htmlB).toContain('data-topology="gather"');
      // ...but a structurally different field, and both pass the render-time gate.
      expect(htmlA).not.toBe(htmlB);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reproduces the committed brand-portrait-cloud byte-identically (deterministic build path)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pc-repro-"));
    try {
      const out = join(dir, "brand-portrait-cloud.cloud.json");
      await buildPointCloudAsset({
        imagePath: resolve("tests/fixtures/image-point-cloud/faithful-sampling-fixture.png"),
        outPath: out,
        sampleStep: 1,
        alphaThreshold: 10,
        brightnessFloor: 0.02,
        depthAmp: 2,
        targetCount: 2000,
        includeSizes: true,
        seed: "brand-portrait-cloud"
      });
      const built = readFileSync(out, "utf8");
      const committed = readFileSync(resolve("product-design-os/assets/3d/brand-portrait-cloud.cloud.json"), "utf8");
      expect(built).toBe(committed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a non-json outPath and a missing source", async () => {
    await expect(buildPointCloudAsset({ imageBuffer: markPng("orb"), outPath: "brand.txt" })).rejects.toThrow(/\.json/);
    await expect(buildPointCloudAsset({ outPath: "brand.cloud.json" })).rejects.toThrow(/imagePath or imageBuffer/);
  });

  it("suggests a paste-ready point_cloud asset-manifest entry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pc-entry-"));
    try {
      const encoded = await buildPointCloudAsset({ imageBuffer: markPng("orb"), outPath: join(dir, "m.cloud.json"), targetCount: 300, brightnessFloor: 0.12 });
      const entry = suggestAssetManifestEntry("brand-mark", "product-design-os/assets/3d/brand-mark.cloud.json", encoded);
      expect(entry.type).toBe("point_cloud");
      expect(entry.provenance_status).toBe("internal");
      expect(entry.id).toBe("brand-mark");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
