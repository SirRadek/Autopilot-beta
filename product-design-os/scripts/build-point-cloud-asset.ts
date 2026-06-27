import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { imageToPointCloud } from "../../src/lib/image-point-cloud";
import type { EncodedPointCloud, ImageToPointCloudOptions } from "../../src/lib/image-point-cloud";

/**
 * build-point-cloud-asset — the brand-image → formation-target pipeline.
 *
 * The point-cloud-background pattern's distinctiveness (the "moat" from the
 * 3-source brainstorm) comes from the brand's OWN asset being the cloud the
 * field resolves into: the same scene_preset produces a structurally different
 * hero per brand because the formation target differs. This turns any brand PNG
 * into a registered `<id>.cloud.json` EncodedPointCloud asset the renderer can
 * inline via ResolvedAsset.dataRef.
 *
 * Deterministic (seeded), so re-running on the same image + options reproduces
 * the committed asset byte-for-byte — no drift. The result is gated like any
 * cloud by validatePointCloudScene when the hero renders.
 */

export interface BuildPointCloudAssetOptions {
  /** Where to write the EncodedPointCloud JSON. Should end in `.cloud.json`. */
  readonly outPath: string;
  readonly imagePath?: string;
  readonly imageBuffer?: Uint8Array;
  readonly sampleStep?: number;
  readonly alphaThreshold?: number;
  readonly brightnessFloor?: number;
  readonly depthAmp?: number;
  readonly targetCount?: number;
  readonly facetCount?: number;
  readonly edgeNeighbors?: number;
  readonly maxEdges?: number;
  readonly includeSizes?: boolean;
  readonly seed?: string | number;
}

export async function buildPointCloudAsset(options: BuildPointCloudAssetOptions): Promise<EncodedPointCloud> {
  if (!/\.json$/i.test(options.outPath)) {
    throw new Error("buildPointCloudAsset: outPath must end with .json (preferably .cloud.json).");
  }
  if (options.imagePath === undefined && options.imageBuffer === undefined) {
    throw new Error("buildPointCloudAsset: provide imagePath or imageBuffer.");
  }

  const sampling: ImageToPointCloudOptions = {
    ...(options.imagePath !== undefined ? { imagePath: options.imagePath } : {}),
    ...(options.imageBuffer !== undefined ? { imageBuffer: options.imageBuffer } : {}),
    ...(options.sampleStep !== undefined ? { sampleStep: options.sampleStep } : {}),
    ...(options.alphaThreshold !== undefined ? { alphaThreshold: options.alphaThreshold } : {}),
    ...(options.brightnessFloor !== undefined ? { brightnessFloor: options.brightnessFloor } : {}),
    ...(options.depthAmp !== undefined ? { depthAmp: options.depthAmp } : {}),
    ...(options.targetCount !== undefined ? { targetCount: options.targetCount } : {}),
    ...(options.facetCount !== undefined ? { facetCount: options.facetCount } : {}),
    ...(options.edgeNeighbors !== undefined ? { edgeNeighbors: options.edgeNeighbors } : {}),
    ...(options.maxEdges !== undefined ? { maxEdges: options.maxEdges } : {}),
    ...(options.includeSizes !== undefined ? { includeSizes: options.includeSizes } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {})
  };

  const encoded = await imageToPointCloud(sampling);
  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, JSON.stringify(encoded));
  return encoded;
}

/**
 * A ready-to-paste asset-manifest entry for the built cloud. The cloud is
 * internal/owned by construction here; for an external brand image record the
 * real provenance (library_source_id, source_url, provenance_status) instead.
 */
export function suggestAssetManifestEntry(
  id: string,
  source: string,
  encoded: EncodedPointCloud
): Record<string, unknown> {
  return {
    id,
    type: "point_cloud",
    style: ["motion", "immersive", "depth-field", "generative", "brand-atmosphere"],
    use_case: ["marketing_web", "portfolio", "landing_page", "experimental"],
    target: ["founder", "small-business", "tech-curious-customer"],
    creativity: 9,
    trust: 6,
    motion_level: 7,
    performance_cost: encoded.pointCount > 8000 ? 6 : 5,
    mobile_safe: true,
    avoid_with_tags: ["primary-content-inside-canvas", "checkout", "critical-form", "reduced-motion-missing"],
    template_risk: 3,
    license: "internal-cc0-style-seed",
    source,
    provenance_status: "internal",
    notes: `Formation-target point cloud (${encoded.pointCount} points, ${encoded.dims.width}x${encoded.dims.height}) for the point-cloud-background pattern. Decorative; readable content stays in DOM.`
  };
}

function parseArgs(argv: readonly string[]): BuildPointCloudAssetOptions {
  let imagePath: string | undefined;
  let outPath: string | undefined;
  let sampleStep: number | undefined;
  let brightnessFloor: number | undefined;
  let depthAmp: number | undefined;
  let targetCount: number | undefined;
  let facetCount: number | undefined;
  let edgeNeighbors: number | undefined;
  let maxEdges: number | undefined;
  let seed: string | undefined;
  let includeSizes = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      outPath = argv[index + 1];
      index += 1;
    } else if (arg === "--step") {
      sampleStep = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--brightness") {
      brightnessFloor = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--depth") {
      depthAmp = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--target-count") {
      targetCount = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--facets") {
      facetCount = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--edges") {
      edgeNeighbors = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--max-edges") {
      maxEdges = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--seed") {
      seed = argv[index + 1];
      index += 1;
    } else if (arg === "--sizes") {
      includeSizes = true;
    } else if (arg !== undefined && !arg.startsWith("--") && imagePath === undefined) {
      imagePath = arg;
    }
  }

  if (imagePath === undefined || outPath === undefined) {
    throw new Error("Usage: tsx build-point-cloud-asset.ts <imagePath> --out <id.cloud.json> [--step n --brightness 0..1 --depth n --target-count n --seed s --sizes]");
  }

  return {
    imagePath,
    outPath,
    includeSizes,
    ...(sampleStep !== undefined ? { sampleStep } : {}),
    ...(brightnessFloor !== undefined ? { brightnessFloor } : {}),
    ...(depthAmp !== undefined ? { depthAmp } : {}),
    ...(targetCount !== undefined ? { targetCount } : {}),
    ...(facetCount !== undefined ? { facetCount } : {}),
    ...(edgeNeighbors !== undefined ? { edgeNeighbors } : {}),
    ...(maxEdges !== undefined ? { maxEdges } : {}),
    ...(seed !== undefined ? { seed } : {})
  };
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  buildPointCloudAsset(parseArgs(process.argv.slice(2)))
    .then((encoded) => {
      console.log(JSON.stringify({ pointCount: encoded.pointCount, dims: encoded.dims }, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
