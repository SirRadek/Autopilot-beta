export interface PointCloudDimensions {
  readonly width: number;
  readonly height: number;
}

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PointCloudBounds {
  readonly min: Vector3;
  readonly max: Vector3;
}

export interface ColorHistogramBucket {
  readonly rgb: readonly [number, number, number];
  readonly count: number;
  readonly ratio: number;
}

export interface ColorHistogramSummary {
  readonly bucketSize: number;
  readonly bucketCount: number;
  readonly top: readonly ColorHistogramBucket[];
}

export interface PointCloudOptionsSummary {
  readonly sampleStep: number;
  readonly alphaThreshold: number;
  readonly brightnessFloor: number;
  readonly depthAmp: number;
  readonly includeSizes: boolean;
  readonly basePointSize: number;
  readonly histogramBuckets: number;
  readonly regionCount: number;
  readonly shapeCount: number;
  readonly targetCount?: number;
}

export interface PointCloudStats {
  readonly pointCount: number;
  readonly candidateCount: number;
  readonly sampledPixelCount: number;
  readonly maskedPixelCount: number;
  readonly shapeExcludedCount: number;
  readonly thinnedCount: number;
  readonly weightThinnedCount: number;
  readonly quotaSkippedCount: number;
  readonly targetThinnedCount: number;
  readonly maskedRatio: number;
  readonly thinnedRatio: number;
  readonly aspectRatio: number;
  readonly averageLuma: number;
  readonly seed: string;
  readonly optionsSummary: PointCloudOptionsSummary;
  readonly bbox: PointCloudBounds;
  readonly dims: PointCloudDimensions;
  readonly sampleStep: number;
  readonly colorHistogram: ColorHistogramSummary;
}

export interface EncodedPointCloud {
  readonly schemaVersion: 1;
  readonly encoding: {
    readonly positions: "base64:f32le";
    readonly colors: "base64:u8";
    readonly sizes?: "base64:u8";
  };
  readonly pointCount: number;
  readonly dims: PointCloudDimensions;
  readonly sampleStep: number;
  readonly positions: string;
  readonly colors: string;
  readonly sizes?: string;
  readonly stats: PointCloudStats;
}

export interface DecodedPointCloud {
  readonly pointCount: number;
  readonly dims: PointCloudDimensions;
  readonly positions: Float32Array;
  readonly colors: Uint8Array;
  readonly sizes?: Uint8Array;
  readonly stats: PointCloudStats;
}

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface PngDecodeLimits {
  /**
   * Maximum compressed PNG input size accepted before decoding.
   * Defaults are intentionally bounded to avoid accidental decode-time DoS.
   */
  readonly maxInputBytes?: number;
  /**
   * Maximum width * height accepted from the PNG IHDR header before decoding.
   * Defaults are intentionally bounded to avoid excessive RGBA allocation.
   */
  readonly maxPixels?: number;
}

export type PointCloudShapeMode = "include" | "exclude";

export interface RectPointCloudShape {
  readonly kind: "rect";
  readonly mode?: PointCloudShapeMode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CirclePointCloudShape {
  readonly kind: "circle";
  readonly mode?: PointCloudShapeMode;
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}

/**
 * Optional geometric filters are off by default. Enabling them changes the
 * faithful pixel-to-point relationship and should be treated as a deliberate
 * artistic or budget control.
 */
export type PointCloudShape = RectPointCloudShape | CirclePointCloudShape;

/**
 * Optional region weighting is off by default. It can help fit a point budget,
 * but it distorts faithful sampling and can miss visual features. Prefer the
 * default unweighted sampler unless a downstream budget requires thinning.
 */
export interface PointCloudRegion {
  readonly id?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly weight?: number;
  readonly quota?: number;
  readonly pointSize?: number;
}

export interface ImageToPointCloudOptions extends PngDecodeLimits {
  readonly imagePath?: string;
  readonly imageBuffer?: Uint8Array;
  readonly sampleStep?: number;
  readonly alphaThreshold?: number;
  readonly brightnessFloor?: number;
  readonly depthAmp?: number;
  readonly seed?: string | number;
  /**
   * Opt-in thinning budget. Enabling it can distort the faithful pixel-to-point
   * relationship and may remove visual features.
   */
  readonly targetCount?: number;
  readonly includeSizes?: boolean;
  readonly basePointSize?: number;
  readonly histogramBuckets?: number;
  /**
   * Opt-in region weighting/quotas. Enabling them can distort faithful sampling
   * and should be reserved for explicit downstream budget or art-direction needs.
   */
  readonly regions?: readonly PointCloudRegion[];
  /**
   * Opt-in geometric filters. Enabling them changes the source image coverage
   * and can remove source detail.
   */
  readonly shapes?: readonly PointCloudShape[];
}

export interface DebugOverlayOptions extends PngDecodeLimits {
  readonly imagePath?: string;
  readonly imageBuffer?: Uint8Array;
  readonly pointCloud: EncodedPointCloud | DecodedPointCloud;
  readonly outputPath: string;
  readonly markerRadius?: number;
  readonly markerColor?: readonly [number, number, number, number];
}
