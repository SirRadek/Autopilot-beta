import { encodeFloat32Base64, encodeUint8Base64, encodeUint16Base64 } from "./pack";
import { readPngImage, toPngImageSource } from "./png";
import type {
  ColorHistogramSummary,
  EncodedPointCloud,
  ImageToPointCloudOptions,
  PointCloudBounds,
  PointCloudOptionsSummary,
  PointCloudRegion,
  PointCloudShape,
  RgbaImage
} from "./types";

/**
 * Generous library sanity bound for depthAmp. xy is normalized to [-0.5, 0.5], so
 * even 64 lets z reach ±32 (extreme). Web/render budgets are far stricter and are
 * enforced at the gate (POINT_CLOUD_SCENE_BUDGETS.maxDepthAmp). This only removes
 * the unbounded-above foothold (the assert was previously min-only).
 */
const MAX_DEPTH_AMP = 64;
/** Lowpoly-facet bake ceiling: facets are a sparse decimation, never a second full cloud. */
const POINT_CLOUD_FACET_CEILING = 4000;
/** Capped k-NN edge bake ceiling (pair count). Mirrors the renderer's maxEdges gate. */
const POINT_CLOUD_EDGE_CEILING = 18_000;

interface NormalizedOptions {
  readonly sampleStep: number;
  readonly alphaThreshold: number;
  readonly brightnessFloor: number;
  readonly depthAmp: number;
  readonly seed: string;
  readonly targetCount?: number;
  readonly facetCount?: number;
  readonly edgeNeighbors?: number;
  readonly maxEdges?: number;
  readonly includeSizes: boolean;
  readonly basePointSize: number;
  readonly histogramBuckets: number;
  readonly regions: readonly PointCloudRegion[];
  readonly shapes: readonly PointCloudShape[];
}

interface CandidatePoint {
  readonly pixelX: number;
  readonly pixelY: number;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly luma: number;
  readonly pointSize: number;
  readonly hash: number;
  readonly priority: number;
  readonly regionIndexes: readonly number[];
}

interface CandidateSelection {
  readonly selected: readonly CandidatePoint[];
  readonly quotaSkippedCount: number;
  readonly targetThinnedCount: number;
}

export async function imageToPointCloud(options: ImageToPointCloudOptions): Promise<EncodedPointCloud> {
  const image = await readPngImage(toPngImageSource(options), options);
  return imageToPointCloudFromImage(image, normalizeOptions(options));
}

function imageToPointCloudFromImage(image: RgbaImage, options: NormalizedOptions): EncodedPointCloud {
  const maxDimension = Math.max(image.width, image.height);
  const candidates: CandidatePoint[] = [];
  let sampledPixelCount = 0;
  let maskedPixelCount = 0;
  let shapeExcludedCount = 0;
  let weightThinnedCount = 0;
  const hasRegionalWeightThinning = options.regions.some(
    (region) => region.weight !== undefined && region.weight >= 0 && region.weight < 1
  );

  for (let pixelY = 0; pixelY < image.height; pixelY += options.sampleStep) {
    for (let pixelX = 0; pixelX < image.width; pixelX += options.sampleStep) {
      sampledPixelCount += 1;

      const pixel = readPixel(image, pixelX, pixelY);
      const luma = getLuma(pixel.red, pixel.green, pixel.blue);
      if (pixel.alpha < options.alphaThreshold || luma < options.brightnessFloor) {
        maskedPixelCount += 1;
        continue;
      }

      const normalizedX = (pixelX + 0.5) / image.width;
      const normalizedY = (pixelY + 0.5) / image.height;
      if (!matchesShapes(options.shapes, normalizedX, normalizedY)) {
        shapeExcludedCount += 1;
        continue;
      }

      const hash = hashPoint(options.seed, pixelX, pixelY);
      const hashUnit = hashToUnit(hash);
      const regionIndexes = getRegionIndexes(options.regions, normalizedX, normalizedY);
      const weight = getCandidateWeight(options.regions, regionIndexes);
      if (weight <= 0 || (hasRegionalWeightThinning && hashUnit > weight)) {
        weightThinnedCount += 1;
        continue;
      }

      const pointSize = getCandidatePointSize(options, regionIndexes);
      candidates.push({
        pixelX,
        pixelY,
        positionX: (pixelX - (image.width - 1) / 2) / maxDimension,
        positionY: ((image.height - 1) / 2 - pixelY) / maxDimension,
        positionZ: (luma - 0.5) * options.depthAmp,
        red: pixel.red,
        green: pixel.green,
        blue: pixel.blue,
        luma,
        pointSize,
        hash,
        priority: hashUnit / weight,
        regionIndexes
      });
    }
  }

  const selection = selectCandidates(candidates, options);
  const selected = selection.selected;
  const positions = new Float32Array(selected.length * 3);
  const colors = new Uint8Array(selected.length * 3);
  const sizes = options.includeSizes ? new Uint8Array(selected.length) : undefined;
  let selectedLumaSum = 0;

  for (let index = 0; index < selected.length; index += 1) {
    const point = selected[index];
    if (point === undefined) {
      continue;
    }

    positions[index * 3] = point.positionX;
    positions[index * 3 + 1] = point.positionY;
    positions[index * 3 + 2] = point.positionZ;
    colors[index * 3] = point.red;
    colors[index * 3 + 1] = point.green;
    colors[index * 3 + 2] = point.blue;
    selectedLumaSum += point.luma;
    if (sizes !== undefined) {
      sizes[index] = clampByte(point.pointSize);
    }
  }

  const thinnedCount = weightThinnedCount + selection.quotaSkippedCount + selection.targetThinnedCount;
  const eligiblePixelCount = sampledPixelCount - maskedPixelCount - shapeExcludedCount;
  const stats = {
    pointCount: selected.length,
    candidateCount: candidates.length,
    sampledPixelCount,
    maskedPixelCount,
    shapeExcludedCount,
    thinnedCount,
    weightThinnedCount,
    quotaSkippedCount: selection.quotaSkippedCount,
    targetThinnedCount: selection.targetThinnedCount,
    maskedRatio: sampledPixelCount === 0 ? 0 : maskedPixelCount / sampledPixelCount,
    thinnedRatio: eligiblePixelCount === 0 ? 0 : thinnedCount / eligiblePixelCount,
    aspectRatio: image.width / image.height,
    averageLuma: selected.length === 0 ? 0 : selectedLumaSum / selected.length,
    seed: options.seed,
    optionsSummary: getOptionsSummary(options),
    bbox: getBounds(positions),
    dims: {
      width: image.width,
      height: image.height
    },
    sampleStep: options.sampleStep,
    colorHistogram: getColorHistogram(colors, selected.length, options.histogramBuckets)
  };

  const facets = options.facetCount === undefined ? undefined : bakeFacets(selected, options.facetCount);
  const edges = options.edgeNeighbors !== undefined && options.edgeNeighbors > 0
    ? buildCappedEdges(positions, selected.length, options.edgeNeighbors, options.maxEdges ?? POINT_CLOUD_EDGE_CEILING)
    : undefined;
  const hasEdges = edges !== undefined && edges.length > 0;

  const encoding = {
    positions: "base64:f32le" as const,
    colors: "base64:u8" as const,
    ...(sizes !== undefined ? { sizes: "base64:u8" as const } : {}),
    ...(facets !== undefined ? { facetPositions: "base64:f32le" as const, facetColors: "base64:u8" as const } : {}),
    ...(hasEdges ? { edges: "base64:u16le" as const } : {})
  };

  return {
    schemaVersion: 1 as const,
    encoding,
    pointCount: selected.length,
    dims: {
      width: image.width,
      height: image.height
    },
    sampleStep: options.sampleStep,
    positions: encodeFloat32Base64(positions),
    colors: encodeUint8Base64(colors),
    stats,
    ...(sizes !== undefined ? { sizes: encodeUint8Base64(sizes) } : {}),
    ...(facets !== undefined
      ? { facetCount: facets.facetCount, facetPositions: facets.facetPositions, facetColors: facets.facetColors }
      : {}),
    ...(hasEdges ? { edgeCount: (edges as Uint16Array).length / 2, edges: encodeUint16Base64(edges as Uint16Array) } : {})
  };
}

/**
 * Capped k-nearest-neighbour edge bake over the SELECTED points (must run AFTER the
 * final selection+sort so indices match the committed point order). A uniform spatial
 * grid yields O(N) neighbour candidates; each point keeps its k≤3 nearest, pairs are
 * deduped (lo·N+hi) and globally capped shortest-first at maxEdges. The sort tiebreaks
 * on point index so the byte output is reproducible. Edges connect the brand cloud's
 * OWN points — a hairline web over the silhouette, never new geometry.
 */
function buildCappedEdges(positions: Float32Array, pointCount: number, k: number, maxEdges: number): Uint16Array {
  if (k < 1 || pointCount < 2 || maxEdges < 1) {
    return new Uint16Array(0);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pointCount; i += 1) {
    const x = positions[i * 3] ?? 0;
    const y = positions[i * 3 + 1] ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const cell = span / Math.max(1, Math.sqrt(pointCount));
  const cellKey = (gx: number, gy: number): number => (gx * 73856093) ^ (gy * 19349663);
  const grid = new Map<number, number[]>();
  for (let i = 0; i < pointCount; i += 1) {
    const gx = Math.floor(((positions[i * 3] ?? 0) - minX) / cell);
    const gy = Math.floor(((positions[i * 3 + 1] ?? 0) - minY) / cell);
    const key = cellKey(gx, gy);
    let bucket = grid.get(key);
    if (bucket === undefined) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(i);
  }
  const seen = new Set<number>();
  const candidates: { a: number; b: number; d2: number }[] = [];
  for (let i = 0; i < pointCount; i += 1) {
    const x = positions[i * 3] ?? 0;
    const y = positions[i * 3 + 1] ?? 0;
    const gx = Math.floor((x - minX) / cell);
    const gy = Math.floor((y - minY) / cell);
    const near: { j: number; d2: number }[] = [];
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const bucket = grid.get(cellKey(gx + ox, gy + oy));
        if (bucket === undefined) {
          continue;
        }
        for (const j of bucket) {
          if (j === i) {
            continue;
          }
          const dx = x - (positions[j * 3] ?? 0);
          const dy = y - (positions[j * 3 + 1] ?? 0);
          near.push({ j, d2: dx * dx + dy * dy });
        }
      }
    }
    near.sort((p, q) => p.d2 - q.d2 || p.j - q.j); // stable tiebreak on index ⇒ deterministic
    const limit = Math.min(k, near.length);
    for (let n = 0; n < limit; n += 1) {
      const j = (near[n] as { j: number; d2: number }).j;
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const id = lo * pointCount + hi;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      candidates.push({ a: lo, b: hi, d2: (near[n] as { j: number; d2: number }).d2 });
    }
  }
  candidates.sort((p, q) => p.d2 - q.d2 || p.a - q.a || p.b - q.b); // shortest-first, stable
  const kept = candidates.slice(0, maxEdges);
  const out = new Uint16Array(kept.length * 2);
  for (let e = 0; e < kept.length; e += 1) {
    const pair = kept[e] as { a: number; b: number };
    out[e * 2] = pair.a;
    out[e * 2 + 1] = pair.b;
  }
  return out;
}

/**
 * Lowpoly-facet bake: a DETERMINISTIC decimation of the SAME selected points into
 * cell-centroid facets (mean position + mean colour over a uniform XY grid). Because
 * every facet is the mean of a subset of the brand cloud's own points, the facet set
 * is a strict subset of the cloud's convex hull (bbox ⊆ full bbox) and strictly fewer
 * points — it is the client's own image re-sampled, never synthetic geometry. No RNG:
 * grid bucketization + sorted-key emission make the bytes reproducible.
 */
function bakeFacets(
  selected: readonly CandidatePoint[],
  targetFacets: number
): { facetCount: number; facetPositions: string; facetColors: string } | undefined {
  if (!Number.isFinite(targetFacets) || targetFacets < 1 || selected.length === 0) {
    return undefined;
  }
  const grid = Math.max(1, Math.round(Math.sqrt(targetFacets)));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of selected) {
    if (point.positionX < minX) minX = point.positionX;
    if (point.positionX > maxX) maxX = point.positionX;
    if (point.positionY < minY) minY = point.positionY;
    if (point.positionY > maxY) maxY = point.positionY;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const cells = new Map<number, { n: number; x: number; y: number; z: number; r: number; g: number; b: number }>();
  for (const point of selected) {
    const gx = Math.min(grid - 1, Math.floor(((point.positionX - minX) / spanX) * grid));
    const gy = Math.min(grid - 1, Math.floor(((point.positionY - minY) / spanY) * grid));
    const key = gy * grid + gx;
    let cell = cells.get(key);
    if (cell === undefined) {
      cell = { n: 0, x: 0, y: 0, z: 0, r: 0, g: 0, b: 0 };
      cells.set(key, cell);
    }
    cell.n += 1;
    cell.x += point.positionX;
    cell.y += point.positionY;
    cell.z += point.positionZ;
    cell.r += point.red;
    cell.g += point.green;
    cell.b += point.blue;
  }
  const keys = Array.from(cells.keys()).sort((a, b) => a - b);
  const facetPositions = new Float32Array(keys.length * 3);
  const facetColors = new Uint8Array(keys.length * 3);
  for (let index = 0; index < keys.length; index += 1) {
    const cell = cells.get(keys[index] as number) as { n: number; x: number; y: number; z: number; r: number; g: number; b: number };
    facetPositions[index * 3] = cell.x / cell.n;
    facetPositions[index * 3 + 1] = cell.y / cell.n;
    facetPositions[index * 3 + 2] = cell.z / cell.n;
    facetColors[index * 3] = clampByte(cell.r / cell.n);
    facetColors[index * 3 + 1] = clampByte(cell.g / cell.n);
    facetColors[index * 3 + 2] = clampByte(cell.b / cell.n);
  }
  return {
    facetCount: keys.length,
    facetPositions: encodeFloat32Base64(facetPositions),
    facetColors: encodeUint8Base64(facetColors)
  };
}

function normalizeOptions(options: ImageToPointCloudOptions): NormalizedOptions {
  const sampleStep = assertInteger("sampleStep", options.sampleStep ?? 1, 1);
  const alphaThreshold = assertNumberRange("alphaThreshold", options.alphaThreshold ?? 1, 0, 255);
  const brightnessFloor = assertNumberRange("brightnessFloor", options.brightnessFloor ?? 0, 0, 1);
  const depthAmp = assertNumberRange("depthAmp", options.depthAmp ?? 1, 0, MAX_DEPTH_AMP);
  const basePointSize = assertInteger("basePointSize", options.basePointSize ?? 1, 1, 255);
  const histogramBuckets = assertInteger("histogramBuckets", options.histogramBuckets ?? 16, 1, 256);
  const targetCount = options.targetCount === undefined
    ? undefined
    : assertInteger("targetCount", options.targetCount, 0);
  const facetCount = options.facetCount === undefined
    ? undefined
    : assertInteger("facetCount", options.facetCount, 1, POINT_CLOUD_FACET_CEILING);
  const edgeNeighbors = options.edgeNeighbors === undefined
    ? undefined
    : assertInteger("edgeNeighbors", options.edgeNeighbors, 0, 3);
  const maxEdges = options.maxEdges === undefined
    ? undefined
    : assertInteger("maxEdges", options.maxEdges, 0, POINT_CLOUD_EDGE_CEILING);

  return {
    sampleStep,
    alphaThreshold,
    brightnessFloor,
    depthAmp,
    seed: String(options.seed ?? "image-point-cloud"),
    ...(targetCount !== undefined ? { targetCount } : {}),
    ...(facetCount !== undefined ? { facetCount } : {}),
    ...(edgeNeighbors !== undefined ? { edgeNeighbors } : {}),
    ...(maxEdges !== undefined ? { maxEdges } : {}),
    includeSizes: options.includeSizes ?? false,
    basePointSize,
    histogramBuckets,
    regions: validateRegions(options.regions ?? []),
    shapes: validateShapes(options.shapes ?? [])
  };
}

function readPixel(image: RgbaImage, pixelX: number, pixelY: number): {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
} {
  const offset = (pixelY * image.width + pixelX) * 4;

  return {
    red: image.data[offset] ?? 0,
    green: image.data[offset + 1] ?? 0,
    blue: image.data[offset + 2] ?? 0,
    alpha: image.data[offset + 3] ?? 0
  };
}

function getLuma(red: number, green: number, blue: number): number {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function matchesShapes(shapes: readonly PointCloudShape[], normalizedX: number, normalizedY: number): boolean {
  if (shapes.length === 0) {
    return true;
  }

  const includeShapes = shapes.filter((shape) => (shape.mode ?? "include") === "include");
  const excludeShapes = shapes.filter((shape) => shape.mode === "exclude");

  if (includeShapes.length > 0 && !includeShapes.some((shape) => containsShape(shape, normalizedX, normalizedY))) {
    return false;
  }

  return !excludeShapes.some((shape) => containsShape(shape, normalizedX, normalizedY));
}

function containsShape(shape: PointCloudShape, normalizedX: number, normalizedY: number): boolean {
  if (shape.kind === "rect") {
    return (
      normalizedX >= shape.x &&
      normalizedX <= shape.x + shape.width &&
      normalizedY >= shape.y &&
      normalizedY <= shape.y + shape.height
    );
  }

  const dx = normalizedX - shape.cx;
  const dy = normalizedY - shape.cy;
  return dx * dx + dy * dy <= shape.radius * shape.radius;
}

function getRegionIndexes(
  regions: readonly PointCloudRegion[],
  normalizedX: number,
  normalizedY: number
): readonly number[] {
  const indexes: number[] = [];

  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];
    if (region === undefined) {
      continue;
    }

    if (
      normalizedX >= region.x &&
      normalizedX <= region.x + region.width &&
      normalizedY >= region.y &&
      normalizedY <= region.y + region.height
    ) {
      indexes.push(index);
    }
  }

  return indexes;
}

function getCandidateWeight(regions: readonly PointCloudRegion[], regionIndexes: readonly number[]): number {
  let weight: number | undefined;

  for (const index of regionIndexes) {
    const region = regions[index];
    if (region?.weight !== undefined) {
      weight = Math.max(weight ?? 0, region.weight);
    }
  }

  return weight ?? 1;
}

function getCandidatePointSize(options: NormalizedOptions, regionIndexes: readonly number[]): number {
  let pointSize = options.basePointSize;

  for (const index of regionIndexes) {
    const region = options.regions[index];
    if (region?.pointSize !== undefined) {
      pointSize = Math.max(pointSize, region.pointSize);
    }
  }

  return pointSize;
}

function selectCandidates(candidates: readonly CandidatePoint[], options: NormalizedOptions): CandidateSelection {
  const hasQuota = options.regions.some((region) => region.quota !== undefined);
  if (options.targetCount === undefined && !hasQuota) {
    return {
      selected: candidates,
      quotaSkippedCount: 0,
      targetThinnedCount: 0
    };
  }

  const sorted = [...candidates].sort((left, right) => {
    const priorityDelta = left.priority - right.priority;
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const hashDelta = left.hash - right.hash;
    if (hashDelta !== 0) {
      return hashDelta;
    }

    return left.pixelY - right.pixelY || left.pixelX - right.pixelX;
  });
  const selected: CandidatePoint[] = [];
  const usedByRegion = new Map<number, number>();
  let quotaSkippedCount = 0;

  for (const candidate of sorted) {
    if (options.targetCount !== undefined && selected.length >= options.targetCount) {
      break;
    }

    if (!withinRegionQuotas(candidate, options.regions, usedByRegion)) {
      quotaSkippedCount += 1;
      continue;
    }

    selected.push(candidate);
    for (const regionIndex of candidate.regionIndexes) {
      if (options.regions[regionIndex]?.quota !== undefined) {
        usedByRegion.set(regionIndex, (usedByRegion.get(regionIndex) ?? 0) + 1);
      }
    }
  }

  return {
    selected: selected.sort((left, right) => left.pixelY - right.pixelY || left.pixelX - right.pixelX),
    quotaSkippedCount,
    targetThinnedCount: options.targetCount === undefined ? 0 : candidates.length - selected.length - quotaSkippedCount
  };
}

function withinRegionQuotas(
  candidate: CandidatePoint,
  regions: readonly PointCloudRegion[],
  usedByRegion: ReadonlyMap<number, number>
): boolean {
  for (const regionIndex of candidate.regionIndexes) {
    const quota = regions[regionIndex]?.quota;
    if (quota !== undefined && (usedByRegion.get(regionIndex) ?? 0) >= quota) {
      return false;
    }
  }

  return true;
}

function getBounds(positions: Float32Array): PointCloudBounds {
  if (positions.length === 0) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 }
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const y = positions[index + 1] ?? 0;
    const z = positions[index + 2] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ }
  };
}

function getColorHistogram(colors: Uint8Array, pointCount: number, bucketCount: number): ColorHistogramSummary {
  if (pointCount === 0) {
    return {
      bucketSize: Math.ceil(256 / bucketCount),
      bucketCount: 0,
      top: []
    };
  }

  const bucketSize = Math.ceil(256 / bucketCount);
  const counts = new Map<string, { rgb: readonly [number, number, number]; count: number }>();

  for (let index = 0; index < pointCount; index += 1) {
    const red = getBucketValue(colors[index * 3] ?? 0, bucketSize);
    const green = getBucketValue(colors[index * 3 + 1] ?? 0, bucketSize);
    const blue = getBucketValue(colors[index * 3 + 2] ?? 0, bucketSize);
    const key = `${red},${green},${blue}`;
    const existing = counts.get(key);
    if (existing === undefined) {
      counts.set(key, { rgb: [red, green, blue], count: 1 });
    } else {
      existing.count += 1;
    }
  }

  const top = [...counts.values()]
    .sort((left, right) => right.count - left.count || compareRgb(left.rgb, right.rgb))
    .slice(0, 8)
    .map((bucket) => ({
      rgb: bucket.rgb,
      count: bucket.count,
      ratio: bucket.count / pointCount
    }));

  return {
    bucketSize,
    bucketCount: counts.size,
    top
  };
}

function getBucketValue(value: number, bucketSize: number): number {
  const bucketStart = Math.floor(value / bucketSize) * bucketSize;
  return Math.min(255, bucketStart + Math.floor(bucketSize / 2));
}

function compareRgb(left: readonly [number, number, number], right: readonly [number, number, number]): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function getOptionsSummary(options: NormalizedOptions): PointCloudOptionsSummary {
  return {
    sampleStep: options.sampleStep,
    alphaThreshold: options.alphaThreshold,
    brightnessFloor: options.brightnessFloor,
    depthAmp: options.depthAmp,
    includeSizes: options.includeSizes,
    basePointSize: options.basePointSize,
    histogramBuckets: options.histogramBuckets,
    regionCount: options.regions.length,
    shapeCount: options.shapes.length,
    ...(options.targetCount !== undefined ? { targetCount: options.targetCount } : {})
  };
}

function hashPoint(seed: string, pixelX: number, pixelY: number): number {
  let hash = 2166136261;
  const text = `${seed}:${pixelX}:${pixelY}`;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function hashToUnit(hash: number): number {
  return (hash + 1) / 4294967297;
}

function validateRegions(regions: readonly PointCloudRegion[]): readonly PointCloudRegion[] {
  return regions.map((region, index) => {
    assertUnitRange(`regions[${index}].x`, region.x);
    assertUnitRange(`regions[${index}].y`, region.y);
    assertNumberRange(`regions[${index}].width`, region.width, 0, 1);
    assertNumberRange(`regions[${index}].height`, region.height, 0, 1);
    if (region.x + region.width > 1 || region.y + region.height > 1) {
      throw new Error(`regions[${index}] must fit within normalized image bounds`);
    }

    if (region.weight !== undefined) {
      assertFiniteNumber(`regions[${index}].weight`, region.weight, 0);
    }

    if (region.quota !== undefined) {
      assertInteger(`regions[${index}].quota`, region.quota, 0);
    }

    if (region.pointSize !== undefined) {
      assertInteger(`regions[${index}].pointSize`, region.pointSize, 1, 255);
    }

    return region;
  });
}

function validateShapes(shapes: readonly PointCloudShape[]): readonly PointCloudShape[] {
  return shapes.map((shape, index) => {
    if (shape.kind === "rect") {
      assertUnitRange(`shapes[${index}].x`, shape.x);
      assertUnitRange(`shapes[${index}].y`, shape.y);
      assertNumberRange(`shapes[${index}].width`, shape.width, 0, 1);
      assertNumberRange(`shapes[${index}].height`, shape.height, 0, 1);
      if (shape.x + shape.width > 1 || shape.y + shape.height > 1) {
        throw new Error(`shapes[${index}] must fit within normalized image bounds`);
      }
    } else {
      assertUnitRange(`shapes[${index}].cx`, shape.cx);
      assertUnitRange(`shapes[${index}].cy`, shape.cy);
      assertNumberRange(`shapes[${index}].radius`, shape.radius, 0, 1);
    }

    return shape;
  });
}

function assertInteger(name: string, value: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return value;
}

function assertFiniteNumber(name: string, value: number, min: number): number {
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`${name} must be a finite number >= ${min}`);
  }

  return value;
}

function assertNumberRange(name: string, value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a finite number between ${min} and ${max}`);
  }

  return value;
}

function assertUnitRange(name: string, value: number): number {
  return assertNumberRange(name, value, 0, 1);
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}
