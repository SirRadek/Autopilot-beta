export const FIT_PROBE_BREAKPOINT_WIDTHS = [3840, 2560, 1920, 1440, 1024, 768, 540, 390, 360] as const;

export const FIT_PROBE_VOR_SWEEP = {
  start: 360,
  end: 3840,
  step: 10
} as const;

export type FitProbeInvariantCode =
  | "fits_viewport_range"
  | "no_text_overflow_at_breakpoints"
  | "min_legible_text";

export type FitProbeQaIssueCode =
  | "horizontal_overflow"
  | "text_fit_probe_failed"
  | "clipped_text_detected"
  | "text_overlap"
  | "min_font_below_legible_floor"
  | "line_length_above_readability_band";

export type FitProbeFailureKind =
  | "document_horizontal_overflow"
  | "element_horizontal_overflow"
  | "clipped_text"
  | "text_control_overlap"
  | "font_below_legible_floor"
  | "unbreakable_token_overflow"
  | "excessive_line_length";

export interface FitProbeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly right: number;
  readonly bottom: number;
}

export interface FitProbeElementMeasurement {
  readonly selector: string;
  readonly role: string;
  readonly tagName: string;
  readonly textPreview: string;
  readonly textLength: number;
  readonly visible: boolean;
  readonly isHeading: boolean;
  readonly isCta: boolean;
  readonly isCaption: boolean;
  readonly rect: FitProbeRect;
  readonly clientWidth: number;
  readonly scrollWidth: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly fontPx: number;
  readonly lineHeightPx: number;
  readonly lineCount: number;
  readonly maxLineLengthCh: number;
  readonly maxUnbreakableTokenPx: number;
  readonly longestUnbreakableToken: string;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly textOverflow: string;
  readonly webkitLineClamp: string;
}

export interface FitProbeOverlapMeasurement {
  readonly firstSelector: string;
  readonly secondSelector: string;
  readonly firstPreview: string;
  readonly secondPreview: string;
  readonly areaPx: number;
  readonly rect: FitProbeRect;
}

export interface FitProbeViewportMeasurement {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly documentClientWidth: number;
  readonly documentScrollWidth: number;
  readonly bodyClientWidth: number;
  readonly bodyScrollWidth: number;
  readonly elements: readonly FitProbeElementMeasurement[];
  readonly overlaps: readonly FitProbeOverlapMeasurement[];
}

export interface FitProbeFailure {
  readonly kind: FitProbeFailureKind;
  readonly invariantCode: FitProbeInvariantCode;
  readonly qaIssueCode: FitProbeQaIssueCode;
  readonly message: string;
  readonly selector?: string;
  readonly role?: string;
  readonly textPreview?: string;
  readonly rect?: FitProbeRect;
  readonly overflowPx?: number;
  readonly clientWidth?: number;
  readonly scrollWidth?: number;
  readonly fontPx?: number;
  readonly floorPx?: number;
  readonly lineLengthCh?: number;
}

export interface PdosTextFitVisualQaViewportRecord {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly heading_count: number;
  readonly cta_count: number;
  readonly visible_text_characters: number;
  readonly text_overlap: boolean;
  readonly horizontal_overflow: boolean;
  readonly reduced_motion_supported: boolean;
  readonly text_fit: boolean;
  readonly clipped_text_count: number;
  readonly min_font_px: number;
  readonly max_line_length_ch: number;
  readonly fit_scale_min: number;
}

export interface FitProbeViewportResult {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly measurement: FitProbeViewportMeasurement;
  readonly failures: readonly FitProbeFailure[];
  readonly textFitRecord: PdosTextFitVisualQaViewportRecord;
}

export interface FitProbeVorMetric {
  readonly checkedWidthCount: number;
  readonly failedWidthCount: number;
  readonly passedWidthCount: number;
  readonly ratePercent: number;
  readonly failedWidths: readonly number[];
}

export interface FitProbeOffender {
  readonly width: number;
  readonly viewport: string;
  readonly kind: FitProbeFailureKind;
  readonly invariantCode: FitProbeInvariantCode;
  readonly qaIssueCode: FitProbeQaIssueCode;
  readonly selector?: string;
  readonly role?: string;
  readonly textPreview?: string;
  readonly rect?: FitProbeRect;
  readonly overflowPx?: number;
  readonly clientWidth?: number;
  readonly scrollWidth?: number;
  readonly fontPx?: number;
  readonly floorPx?: number;
  readonly lineLengthCh?: number;
}

const DOCUMENT_OVERFLOW_TOLERANCE_PX = 1;
const ELEMENT_OVERFLOW_TOLERANCE_PX = 1;
const OVERLAP_TOLERANCE_AREA_PX = 4;
const MAX_LINE_LENGTH_CH = 80;
const BODY_MIN_FONT_PX = 16;
const CAPTION_MIN_FONT_PX = 12;

export function buildVorSweepWidths(
  sweep: { readonly start: number; readonly end: number; readonly step: number } = FIT_PROBE_VOR_SWEEP
): readonly number[] {
  const widths: number[] = [];
  for (let width = sweep.start; width <= sweep.end; width += sweep.step) {
    widths.push(width);
  }
  return widths;
}

export function viewportHeightForWidth(width: number): number {
  if (width >= 3840) {
    return 2160;
  }
  if (width >= 2560) {
    return 1440;
  }
  if (width >= 1920) {
    return 1080;
  }
  if (width >= 1024) {
    return 1000;
  }
  if (width >= 768) {
    return 1024;
  }
  return 844;
}

export function viewportNameForWidth(width: number): string {
  if (width >= 1024) {
    return `desktop-${width}`;
  }
  if (width >= 768) {
    return `tablet-${width}`;
  }
  return `mobile-${width}`;
}

export function classifyFitProbeViewport(measurement: FitProbeViewportMeasurement): FitProbeViewportResult {
  const failures = classifyFitProbeFailures(measurement);
  return {
    name: measurement.name,
    width: measurement.width,
    height: measurement.height,
    measurement,
    failures,
    textFitRecord: buildTextFitVisualQaRecord(measurement, failures)
  };
}

export function classifyFitProbeFailures(measurement: FitProbeViewportMeasurement): readonly FitProbeFailure[] {
  const failures: FitProbeFailure[] = [];
  const documentOverflowPx = Math.max(
    0,
    measurement.documentScrollWidth - measurement.documentClientWidth,
    measurement.bodyScrollWidth - measurement.width
  );

  if (documentOverflowPx > DOCUMENT_OVERFLOW_TOLERANCE_PX) {
    failures.push(
      makeFailure("document_horizontal_overflow", {
        message: `Document scroll width exceeds viewport by ${round2(documentOverflowPx)}px.`,
        overflowPx: documentOverflowPx,
        clientWidth: measurement.documentClientWidth,
        scrollWidth: measurement.documentScrollWidth
      })
    );
  }

  for (const overlap of measurement.overlaps) {
    if (overlap.areaPx <= OVERLAP_TOLERANCE_AREA_PX) {
      continue;
    }
    failures.push(
      makeFailure("text_control_overlap", {
        message: `${overlap.firstSelector} overlaps ${overlap.secondSelector} by ${round2(overlap.areaPx)}px2.`,
        selector: `${overlap.firstSelector} + ${overlap.secondSelector}`,
        textPreview: `${overlap.firstPreview} / ${overlap.secondPreview}`,
        rect: overlap.rect,
        overflowPx: overlap.areaPx
      })
    );
  }

  for (const element of measurement.elements.filter((candidate) => candidate.visible)) {
    const horizontalOverflowPx = Math.max(0, element.scrollWidth - element.clientWidth);
    const verticalOverflowPx = Math.max(0, element.scrollHeight - element.clientHeight);
    const clipped = isClippedElement(element, horizontalOverflowPx, verticalOverflowPx);

    if (clipped) {
      failures.push(
        makeFailure("clipped_text", {
          message: `${element.selector} text is clipped or truncated.`,
          selector: element.selector,
          role: element.role,
          textPreview: element.textPreview,
          rect: element.rect,
          overflowPx: Math.max(horizontalOverflowPx, verticalOverflowPx),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth
        })
      );
    } else if (horizontalOverflowPx > ELEMENT_OVERFLOW_TOLERANCE_PX) {
      failures.push(
        makeFailure("element_horizontal_overflow", {
          message: `${element.selector} scroll width exceeds client width by ${round2(horizontalOverflowPx)}px.`,
          selector: element.selector,
          role: element.role,
          textPreview: element.textPreview,
          rect: element.rect,
          overflowPx: horizontalOverflowPx,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth
        })
      );
    }

    const floorPx = legibleFloorPxForElement(element);
    if (element.fontPx > 0 && element.fontPx < floorPx - 0.01) {
      failures.push(
        makeFailure("font_below_legible_floor", {
          message: `${element.selector} font ${round2(element.fontPx)}px is below ${floorPx}px floor.`,
          selector: element.selector,
          role: element.role,
          textPreview: element.textPreview,
          rect: element.rect,
          fontPx: element.fontPx,
          floorPx
        })
      );
    }

    if (
      element.clientWidth > 0 &&
      element.scrollWidth > element.clientWidth + ELEMENT_OVERFLOW_TOLERANCE_PX &&
      element.maxUnbreakableTokenPx > element.clientWidth + ELEMENT_OVERFLOW_TOLERANCE_PX
    ) {
      failures.push(
        makeFailure("unbreakable_token_overflow", {
          message: `${element.selector} has an unbreakable token wider than its container.`,
          selector: element.selector,
          role: element.role,
          textPreview: element.longestUnbreakableToken || element.textPreview,
          rect: element.rect,
          overflowPx: element.maxUnbreakableTokenPx - element.clientWidth,
          clientWidth: element.clientWidth,
          scrollWidth: element.maxUnbreakableTokenPx
        })
      );
    }

    if (element.maxLineLengthCh > MAX_LINE_LENGTH_CH) {
      failures.push(
        makeFailure("excessive_line_length", {
          message: `${element.selector} has a ${round2(element.maxLineLengthCh)}ch line.`,
          selector: element.selector,
          role: element.role,
          textPreview: element.textPreview,
          rect: element.rect,
          lineLengthCh: element.maxLineLengthCh
        })
      );
    }
  }

  return failures;
}

export function buildTextFitVisualQaRecord(
  measurement: FitProbeViewportMeasurement,
  failures: readonly FitProbeFailure[] = classifyFitProbeFailures(measurement)
): PdosTextFitVisualQaViewportRecord {
  const visibleElements = measurement.elements.filter((element) => element.visible);
  const minFontPx = minFinite(visibleElements.map((element) => element.fontPx)) ?? 0;
  const maxLineLengthCh = maxFinite(visibleElements.map((element) => element.maxLineLengthCh)) ?? 0;
  const fitScaleMin = minFinite(
    visibleElements
      .filter((element) => element.fontPx > 0)
      .map((element) => element.fontPx / legibleFloorPxForElement(element))
  ) ?? 1;

  return {
    name: measurement.name,
    width: measurement.width,
    height: measurement.height,
    heading_count: visibleElements.filter((element) => element.isHeading).length,
    cta_count: visibleElements.filter((element) => element.isCta).length,
    visible_text_characters: visibleElements.reduce((total, element) => total + element.textLength, 0),
    text_overlap: failures.some((failure) => failure.kind === "text_control_overlap"),
    horizontal_overflow: failures.some((failure) =>
      failure.kind === "document_horizontal_overflow" ||
      failure.kind === "element_horizontal_overflow" ||
      failure.kind === "unbreakable_token_overflow"
    ),
    reduced_motion_supported: true,
    text_fit: failures.length === 0,
    clipped_text_count: failures.filter((failure) => failure.kind === "clipped_text").length,
    min_font_px: round2(minFontPx),
    max_line_length_ch: round2(maxLineLengthCh),
    fit_scale_min: round3(fitScaleMin)
  };
}

export function computeVorMetric(results: readonly FitProbeViewportResult[]): FitProbeVorMetric {
  const failedWidths = results.filter(hasVorFailure).map((result) => result.width);
  const checkedWidthCount = results.length;
  const failedWidthCount = failedWidths.length;

  return {
    checkedWidthCount,
    failedWidthCount,
    passedWidthCount: checkedWidthCount - failedWidthCount,
    ratePercent: checkedWidthCount === 0 ? 0 : round4((failedWidthCount / checkedWidthCount) * 100),
    failedWidths
  };
}

export function hasVorFailure(result: FitProbeViewportResult): boolean {
  return result.failures.some((failure) =>
    failure.kind === "document_horizontal_overflow" || failure.kind === "clipped_text"
  );
}

export function selectWorstOffenders(
  results: readonly FitProbeViewportResult[],
  limit = 12
): readonly FitProbeOffender[] {
  const seen = new Set<string>();
  const offenders = results
    .flatMap((result) => result.failures.map((failure) => toOffender(result, failure)))
    .sort(compareOffenders);
  const output: FitProbeOffender[] = [];

  for (const offender of offenders) {
    const key = `${offender.kind}:${offender.selector ?? "<document>"}:${offender.textPreview ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(offender);
    if (output.length >= limit) {
      break;
    }
  }

  return output;
}

export function maxOverflowPx(result: FitProbeViewportResult): number {
  return round2(maxFinite(result.failures.map((failure) => failure.overflowPx ?? 0)) ?? 0);
}

function makeFailure(
  kind: FitProbeFailureKind,
  input: {
    readonly message: string;
    readonly selector?: string;
    readonly role?: string;
    readonly textPreview?: string;
    readonly rect?: FitProbeRect;
    readonly overflowPx?: number;
    readonly clientWidth?: number;
    readonly scrollWidth?: number;
    readonly fontPx?: number;
    readonly floorPx?: number;
    readonly lineLengthCh?: number;
  }
): FitProbeFailure {
  const mapping = mapFailureToInvariant(kind);
  const failure: {
    kind: FitProbeFailureKind;
    invariantCode: FitProbeInvariantCode;
    qaIssueCode: FitProbeQaIssueCode;
    message: string;
    selector?: string;
    role?: string;
    textPreview?: string;
    rect?: FitProbeRect;
    overflowPx?: number;
    clientWidth?: number;
    scrollWidth?: number;
    fontPx?: number;
    floorPx?: number;
    lineLengthCh?: number;
  } = {
    kind,
    invariantCode: mapping.invariantCode,
    qaIssueCode: mapping.qaIssueCode,
    message: input.message
  };

  assignDefined(failure, "selector", input.selector);
  assignDefined(failure, "role", input.role);
  assignDefined(failure, "textPreview", input.textPreview);
  assignDefined(failure, "rect", input.rect);
  assignDefined(failure, "overflowPx", input.overflowPx === undefined ? undefined : round2(input.overflowPx));
  assignDefined(failure, "clientWidth", input.clientWidth === undefined ? undefined : round2(input.clientWidth));
  assignDefined(failure, "scrollWidth", input.scrollWidth === undefined ? undefined : round2(input.scrollWidth));
  assignDefined(failure, "fontPx", input.fontPx === undefined ? undefined : round2(input.fontPx));
  assignDefined(failure, "floorPx", input.floorPx);
  assignDefined(failure, "lineLengthCh", input.lineLengthCh === undefined ? undefined : round2(input.lineLengthCh));

  return failure;
}

function mapFailureToInvariant(kind: FitProbeFailureKind): {
  readonly invariantCode: FitProbeInvariantCode;
  readonly qaIssueCode: FitProbeQaIssueCode;
} {
  if (
    kind === "document_horizontal_overflow" ||
    kind === "element_horizontal_overflow" ||
    kind === "unbreakable_token_overflow"
  ) {
    return {
      invariantCode: "no_text_overflow_at_breakpoints",
      qaIssueCode: "horizontal_overflow"
    };
  }

  if (kind === "font_below_legible_floor") {
    return {
      invariantCode: "min_legible_text",
      qaIssueCode: "min_font_below_legible_floor"
    };
  }

  if (kind === "clipped_text") {
    return {
      invariantCode: "fits_viewport_range",
      qaIssueCode: "clipped_text_detected"
    };
  }

  if (kind === "text_control_overlap") {
    return {
      invariantCode: "fits_viewport_range",
      qaIssueCode: "text_overlap"
    };
  }

  return {
    invariantCode: "fits_viewport_range",
    qaIssueCode: "line_length_above_readability_band"
  };
}

function isClippedElement(
  element: FitProbeElementMeasurement,
  horizontalOverflowPx: number,
  verticalOverflowPx: number
): boolean {
  const clipsX = clipsOverflow(element.overflowX) && horizontalOverflowPx > ELEMENT_OVERFLOW_TOLERANCE_PX;
  const clipsY = clipsOverflow(element.overflowY) && verticalOverflowPx > ELEMENT_OVERFLOW_TOLERANCE_PX;
  const ellipsis = element.textOverflow.toLowerCase().includes("ellipsis") && horizontalOverflowPx > ELEMENT_OVERFLOW_TOLERANCE_PX;
  const lineClamp = element.webkitLineClamp !== "none" && element.webkitLineClamp !== "0" && verticalOverflowPx > ELEMENT_OVERFLOW_TOLERANCE_PX;
  return clipsX || clipsY || ellipsis || lineClamp;
}

function clipsOverflow(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === "hidden" || normalized === "clip" || normalized === "scroll" || normalized === "auto";
}

function legibleFloorPxForElement(element: FitProbeElementMeasurement): number {
  return element.isCaption ? CAPTION_MIN_FONT_PX : BODY_MIN_FONT_PX;
}

function minFinite(values: readonly number[]): number | undefined {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length === 0 ? undefined : Math.min(...finite);
}

function maxFinite(values: readonly number[]): number | undefined {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length === 0 ? undefined : Math.max(...finite);
}

function toOffender(result: FitProbeViewportResult, failure: FitProbeFailure): FitProbeOffender {
  const offender: {
    width: number;
    viewport: string;
    kind: FitProbeFailureKind;
    invariantCode: FitProbeInvariantCode;
    qaIssueCode: FitProbeQaIssueCode;
    selector?: string;
    role?: string;
    textPreview?: string;
    rect?: FitProbeRect;
    overflowPx?: number;
    clientWidth?: number;
    scrollWidth?: number;
    fontPx?: number;
    floorPx?: number;
    lineLengthCh?: number;
  } = {
    width: result.width,
    viewport: result.name,
    kind: failure.kind,
    invariantCode: failure.invariantCode,
    qaIssueCode: failure.qaIssueCode
  };

  assignDefined(offender, "selector", failure.selector);
  assignDefined(offender, "role", failure.role);
  assignDefined(offender, "textPreview", failure.textPreview);
  assignDefined(offender, "rect", failure.rect);
  assignDefined(offender, "overflowPx", failure.overflowPx);
  assignDefined(offender, "clientWidth", failure.clientWidth);
  assignDefined(offender, "scrollWidth", failure.scrollWidth);
  assignDefined(offender, "fontPx", failure.fontPx);
  assignDefined(offender, "floorPx", failure.floorPx);
  assignDefined(offender, "lineLengthCh", failure.lineLengthCh);

  return offender;
}

function compareOffenders(first: FitProbeOffender, second: FitProbeOffender): number {
  const priority = failurePriority(second.kind) - failurePriority(first.kind);
  if (priority !== 0) {
    return priority;
  }
  const overflow = (second.overflowPx ?? 0) - (first.overflowPx ?? 0);
  if (overflow !== 0) {
    return overflow;
  }
  return first.width - second.width;
}

function failurePriority(kind: FitProbeFailureKind): number {
  if (kind === "document_horizontal_overflow" || kind === "clipped_text") {
    return 5;
  }
  if (kind === "font_below_legible_floor") {
    return 4;
  }
  if (kind === "element_horizontal_overflow" || kind === "unbreakable_token_overflow") {
    return 3;
  }
  if (kind === "text_control_overlap") {
    return 2;
  }
  return 1;
}

function assignDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
