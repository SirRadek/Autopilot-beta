import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path, { basename, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderCompositionPage } from "../../renderer/render-composition";
import {
  FIT_PROBE_BREAKPOINT_WIDTHS,
  FIT_PROBE_VOR_SWEEP,
  buildVorSweepWidths,
  classifyFitProbeViewport,
  computeVorMetric,
  maxOverflowPx,
  selectWorstOffenders,
  viewportHeightForWidth,
  viewportNameForWidth,
  type FitProbeElementMeasurement,
  type FitProbeFailure,
  type FitProbeInvariantCode,
  type FitProbeOffender,
  type FitProbeRect,
  type FitProbeViewportMeasurement,
  type FitProbeViewportResult,
  type FitProbeVorMetric,
  type PdosTextFitVisualQaViewportRecord
} from "./fit-probe-core";

declare const document: BrowserDocument;
declare const window: BrowserWindow;
declare function getComputedStyle(element: BrowserElement): BrowserComputedStyle;
declare function requestAnimationFrame(callback: (time: number) => void): number;

export type FitProbeReportStatus = "passed" | "failed" | "skipped";
export type FitProbeSourceKind = "composition" | "html";

export interface FitProbeRunInput {
  readonly sourcePath: string;
  readonly sourceKind: FitProbeSourceKind;
  readonly outputDir?: string;
  readonly screenshot?: boolean;
}

export interface FitProbeViewportReport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly passed: boolean;
  readonly max_overflow_px: number;
  readonly clipped_text_count: number;
  readonly overflowing_text_count: number;
  readonly min_font_px: number;
  readonly max_line_length_ch: number;
  readonly fit_scale_min: number;
  readonly failures: readonly FitProbeFailure[];
}

export interface FitProbeReport {
  readonly schema: "autopilot-beta/pdos-fit-probe-report@1";
  readonly status: FitProbeReportStatus;
  readonly source_kind: FitProbeSourceKind;
  readonly source_path: string;
  readonly html_path: string;
  readonly report_path: string;
  readonly screenshot_paths: readonly string[];
  readonly checked_viewports: readonly number[];
  readonly vor_sweep: {
    readonly start: number;
    readonly end: number;
    readonly step: number;
  };
  readonly vor: FitProbeVorMetric;
  readonly breakpoints: readonly FitProbeViewportReport[];
  readonly text_fit_records: readonly PdosTextFitVisualQaViewportRecord[];
  readonly worst_offenders: readonly FitProbeOffender[];
  readonly failures_by_invariant: Readonly<Record<FitProbeInvariantCode, number>>;
  readonly errors: readonly string[];
}

export interface FitProbeCliRun {
  readonly report: FitProbeReport;
  readonly output: string;
  readonly exitCode: 0 | 1;
}

interface BrowserLike {
  readonly newPage: (options: {
    readonly viewport: { readonly width: number; readonly height: number };
    readonly deviceScaleFactor: number;
  }) => Promise<PageLike>;
  readonly close: () => Promise<void>;
}

interface PlaywrightModule {
  readonly chromium?: {
    readonly launch: (options: { readonly headless: boolean }) => Promise<BrowserLike>;
  };
}

interface PageLike {
  readonly goto: (url: string, options: { readonly waitUntil: "load" }) => Promise<unknown>;
  readonly setViewportSize: (viewport: { readonly width: number; readonly height: number }) => Promise<unknown>;
  readonly emulateMedia: (options: { readonly reducedMotion: "reduce" }) => Promise<unknown>;
  readonly evaluate: <T, Arg>(
    pageFunction: (arg: Arg) => T | Promise<T>,
    arg: Arg
  ) => Promise<T>;
  readonly screenshot: (options: { readonly path: string; readonly fullPage: boolean }) => Promise<unknown>;
}

interface BrowserViewportInput {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

interface BrowserDocument {
  readonly documentElement: BrowserElement;
  readonly body: BrowserElement | null;
  readonly fonts?: {
    readonly ready: Promise<unknown>;
  };
  readonly querySelectorAll: (selector: string) => ArrayLike<BrowserElement>;
  readonly createRange: () => BrowserRange;
  readonly createElement: (tagName: "canvas") => BrowserCanvas;
}

interface BrowserWindow {
  readonly innerWidth: number;
  readonly innerHeight: number;
}

interface BrowserElement {
  readonly tagName: string;
  readonly id: string;
  readonly className: string | { readonly baseVal?: string };
  readonly textContent: string | null;
  readonly parentElement: BrowserElement | null;
  readonly previousElementSibling: BrowserElement | null;
  readonly clientWidth: number;
  readonly scrollWidth: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly getAttribute: (name: string) => string | null;
  readonly matches: (selector: string) => boolean;
  readonly contains: (element: BrowserElement) => boolean;
  readonly closest: (selector: string) => BrowserElement | null;
  readonly getBoundingClientRect: () => BrowserDomRect;
}

interface BrowserDomRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly right: number;
  readonly bottom: number;
}

interface BrowserRange {
  readonly selectNodeContents: (element: BrowserElement) => void;
  readonly getClientRects: () => ArrayLike<BrowserDomRect>;
  readonly detach?: () => void;
}

interface BrowserCanvas {
  readonly getContext: (contextId: "2d") => BrowserCanvasContext | null;
}

interface BrowserCanvasContext {
  font: string;
  readonly measureText: (text: string) => { readonly width: number };
}

interface BrowserComputedStyle {
  readonly display: string;
  readonly visibility: string;
  readonly opacity: string;
  readonly font: string;
  readonly fontSize: string;
  readonly lineHeight: string;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly textOverflow: string;
  readonly whiteSpace: string;
  readonly webkitLineClamp?: string;
}

interface PreparedFitProbeSource {
  readonly id: string;
  readonly sourcePath: string;
  readonly htmlPath: string;
  readonly reportPath: string;
  readonly outputDir: string;
}

type FitProbeFormat = "json" | "markdown";

const dynamicImport = new Function("specifier", "return import(specifier)") as <T>(specifier: string) => Promise<T>;

export async function createFitProbeCliRun(cliArgs: readonly string[], repoRoot = process.cwd()): Promise<FitProbeCliRun> {
  const args = parseArgs(cliArgs);
  if (args.sourcePath === undefined || args.sourceKind === undefined) {
    const report = skippedReport({
      id: "",
      sourcePath: "",
      htmlPath: "",
      reportPath: "",
      outputDir: resolve(repoRoot, args.outputDir ?? "output/fit-probe")
    }, "Missing input. Use --composition <file> or --html <file>.");
    return {
      report,
      output: printUsage(),
      exitCode: 1
    };
  }

  const runInput: {
    sourcePath: string;
    sourceKind: FitProbeSourceKind;
    outputDir?: string;
    screenshot?: boolean;
  } = {
    sourcePath: args.sourcePath,
    sourceKind: args.sourceKind
  };
  if (args.outputDir !== undefined) {
    runInput.outputDir = args.outputDir;
  }
  if (args.screenshot !== undefined) {
    runInput.screenshot = args.screenshot;
  }

  const report = await runFitProbe(runInput, repoRoot);

  return {
    report,
    output: formatFitProbeReport(report, args.format),
    exitCode: report.status === "passed" ? 0 : 1
  };
}

export async function runFitProbe(input: FitProbeRunInput, repoRoot = process.cwd()): Promise<FitProbeReport> {
  const prepared = prepareFitProbeSource(input, repoRoot);
  const playwright = await optionalImport<PlaywrightModule>("@playwright/test");

  if (playwright.status === "missing" || playwright.module.chromium === undefined) {
    return writeReport(
      prepared.reportPath,
      skippedReport(prepared, `Playwright is unavailable: ${playwright.message}`)
    );
  }

  let browser: BrowserLike | undefined;
  try {
    const sweepWidths = Array.from(
      new Set<number>([...buildVorSweepWidths(), ...FIT_PROBE_BREAKPOINT_WIDTHS])
    ).sort((a, b) => a - b);
    const firstWidth = sweepWidths[0] ?? FIT_PROBE_VOR_SWEEP.start;
    browser = await playwright.module.chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: firstWidth, height: viewportHeightForWidth(firstWidth) },
      deviceScaleFactor: 1
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(pathToFileURL(prepared.htmlPath).href, { waitUntil: "load" });

    const sweepResults: FitProbeViewportResult[] = [];
    for (const width of sweepWidths) {
      const measurement = await measureViewport(page, {
        name: viewportNameForWidth(width),
        width,
        height: viewportHeightForWidth(width)
      });
      sweepResults.push(classifyFitProbeViewport(measurement));
    }

    const breakpoints = FIT_PROBE_BREAKPOINT_WIDTHS.map((width) => {
      const result = sweepResults.find((candidate) => candidate.width === width);
      if (result === undefined) {
        throw new Error(`Missing measured breakpoint ${width}.`);
      }
      return result;
    });

    const screenshotPaths = input.screenshot === true
      ? await captureFailureScreenshot(page, prepared, breakpoints)
      : [];
    const report = buildFitProbeReport({
      prepared,
      sourceKind: input.sourceKind,
      sweepResults,
      breakpointResults: breakpoints,
      screenshotPaths
    });

    return writeReport(prepared.reportPath, report);
  } catch (error) {
    return writeReport(
      prepared.reportPath,
      skippedReport(prepared, `Playwright browser probe failed: ${errorMessage(error)}`)
    );
  } finally {
    await browser?.close();
  }
}

export function formatFitProbeReport(report: FitProbeReport, format: FitProbeFormat = "json"): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  const failedBreakpoints = report.breakpoints.filter((viewport) => !viewport.passed);
  return `${[
    "# Product Design OS Fit Probe",
    "",
    `- Status: ${report.status}`,
    `- Source: ${report.source_kind} ${report.source_path || "<missing>"}`,
    `- HTML: ${report.html_path || "<missing>"}`,
    `- Report: ${report.report_path || "<missing>"}`,
    `- Viewport matrix: ${report.checked_viewports.join(", ")}`,
    `- VOR sweep: ${report.vor_sweep.start}->${report.vor_sweep.end} step ${report.vor_sweep.step}px (${report.vor.checkedWidthCount} widths)`,
    `- VOR: ${report.vor.ratePercent}% (${report.vor.failedWidthCount}/${report.vor.checkedWidthCount})`,
    `- Failed breakpoints: ${failedBreakpoints.length === 0 ? "none" : failedBreakpoints.map((viewport) => viewport.name).join(", ")}`,
    "",
    "## Breakpoints",
    ...report.breakpoints.map(formatBreakpointLine),
    "",
    "## Failures By Invariant",
    ...formatInvariantCounts(report.failures_by_invariant),
    "",
    "## Worst Offenders",
    ...formatOffenders(report.worst_offenders),
    "",
    "## Errors",
    ...(report.errors.length === 0 ? ["- None."] : report.errors.map((error) => `- ${error}`))
  ].join("\n").trimEnd()}\n`;
}

export function applyFitProbeCliExitCode(report: FitProbeReport): 0 | 1 {
  const exitCode = report.status === "passed" ? 0 : 1;
  process.exitCode = exitCode;
  return exitCode;
}

async function measureViewport(page: PageLike, viewport: BrowserViewportInput): Promise<FitProbeViewportMeasurement> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.evaluate<null, null>(async () => {
    if (document.fonts !== undefined) {
      await document.fonts.ready;
    }
    await new Promise<void>((resolvePromise) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()));
    });
    return null;
  }, null);

  return page.evaluate<FitProbeViewportMeasurement, BrowserViewportInput>((currentViewport) => {
    const selector = "[data-contract-prop], h1, h2, h3, h4, h5, h6, p, a, button";
    const rawElements = uniqueElements(Array.from(document.querySelectorAll(selector)));
    const measuredElementPairs = rawElements
      .map((browserElement) => ({
        browserElement,
        measurement: measureElement(browserElement)
      }))
      .filter((pair) => pair.measurement.textLength > 0);
    const elements = measuredElementPairs.map((pair) => pair.measurement);
    const overlaps = measureOverlaps(measuredElementPairs);
    const body = document.body;

    return {
      name: currentViewport.name,
      width: currentViewport.width,
      height: currentViewport.height,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: body?.clientWidth ?? 0,
      bodyScrollWidth: body?.scrollWidth ?? 0,
      elements,
      overlaps
    };

    function measureElement(element: BrowserElement): FitProbeElementMeasurement {
      const style = getComputedStyle(element);
      const text = normalizeText(element.textContent ?? "");
      const rect = toProbeRect(element.getBoundingClientRect());
      const fontPx = parseCssPx(style.fontSize);
      const lineHeightPx = parseLineHeight(style.lineHeight, fontPx);
      const lineRects = text.length === 0 ? [] : textLineRects(element);
      const maxLineWidth = maxNumber(lineRects.map((lineRect) => lineRect.width)) ?? rect.width;
      const longestToken = longestUnbreakableToken(text);
      const maxTokenPx = measureTextWidth(longestToken, style.font);
      const tagName = element.tagName.toLowerCase();
      const contractProp = element.getAttribute("data-contract-prop") ?? "";
      const role = elementRole(element, tagName, contractProp);

      return {
        selector: readableSelector(element, tagName, contractProp),
        role,
        tagName,
        textPreview: previewText(text),
        textLength: text.length,
        visible: isVisible(element, style, rect),
        isHeading: /^h[1-6]$/.test(tagName),
        isCta: tagName === "a" || tagName === "button" || classNameOf(element).split(/\s+/).includes("cta"),
        isCaption: isCaptionLike(element, tagName, contractProp),
        rect,
        clientWidth: round2(element.clientWidth),
        scrollWidth: round2(element.scrollWidth),
        clientHeight: round2(element.clientHeight),
        scrollHeight: round2(element.scrollHeight),
        fontPx: round2(fontPx),
        lineHeightPx: round2(lineHeightPx),
        lineCount: lineRects.length,
        maxLineLengthCh: round2(maxLineWidth / Math.max(fontPx * 0.5, 1)),
        maxUnbreakableTokenPx: round2(maxTokenPx),
        longestUnbreakableToken: previewText(longestToken),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        textOverflow: style.textOverflow,
        webkitLineClamp: style.webkitLineClamp ?? "none"
      };
    }

    function textLineRects(element: BrowserElement): readonly FitProbeRect[] {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = Array.from(range.getClientRects()).map(toProbeRect).filter((rect) => rect.width > 0 && rect.height > 0);
      range.detach?.();
      return groupLineRects(rects);
    }

    function groupLineRects(rects: readonly FitProbeRect[]): readonly FitProbeRect[] {
      const lines: FitProbeRect[] = [];
      const sorted = [...rects].sort((first, second) => first.y - second.y || first.x - second.x);
      for (const rect of sorted) {
        const existing = lines.find((line) => Math.abs(line.y - rect.y) <= 2);
        if (existing === undefined) {
          lines.push(rect);
          continue;
        }
        const x = Math.min(existing.x, rect.x);
        const y = Math.min(existing.y, rect.y);
        const right = Math.max(existing.right, rect.right);
        const bottom = Math.max(existing.bottom, rect.bottom);
        const merged = { x, y, width: right - x, height: bottom - y, right, bottom };
        lines.splice(lines.indexOf(existing), 1, merged);
      }
      return lines;
    }

    function measureOverlaps(measuredElementPairsForContainment: readonly {
      readonly browserElement: BrowserElement;
      readonly measurement: FitProbeElementMeasurement;
    }[]) {
      const output = [];
      for (let firstIndex = 0; firstIndex < measuredElementPairsForContainment.length; firstIndex += 1) {
        const firstPair = measuredElementPairsForContainment[firstIndex];
        if (firstPair === undefined || !firstPair.measurement.visible) {
          continue;
        }
        const first = firstPair.measurement;
        const firstElement = firstPair.browserElement;
        for (let secondIndex = firstIndex + 1; secondIndex < measuredElementPairsForContainment.length; secondIndex += 1) {
          const secondPair = measuredElementPairsForContainment[secondIndex];
          if (secondPair === undefined || !secondPair.measurement.visible) {
            continue;
          }
          const second = secondPair.measurement;
          const secondElement = secondPair.browserElement;
          if (isSameTextContainerPair(firstElement, secondElement)) {
            continue;
          }
          const intersection = intersectRect(first.rect, second.rect);
          if (intersection === undefined || intersection.width * intersection.height <= 4) {
            continue;
          }
          output.push({
            firstSelector: first.selector,
            secondSelector: second.selector,
            firstPreview: first.textPreview,
            secondPreview: second.textPreview,
            areaPx: round2(intersection.width * intersection.height),
            rect: intersection
          });
        }
      }
      return output;
    }

    function isSameTextContainerPair(firstElement: BrowserElement, secondElement: BrowserElement): boolean {
      return (
        firstElement.contains(secondElement) ||
        secondElement.contains(firstElement) ||
        (firstElement.parentElement !== null && firstElement.parentElement === secondElement.parentElement)
      );
    }

    function readableSelector(element: BrowserElement, tagName: string, contractProp: string): string {
      if (element.id.length > 0) {
        return `#${cssToken(element.id)}`;
      }
      const pattern = element.closest("[data-pattern-id]")?.getAttribute("data-pattern-id");
      if (contractProp.length > 0 && pattern !== undefined && pattern !== null && pattern.length > 0) {
        return `[data-pattern-id="${attrToken(pattern)}"] [data-contract-prop="${attrToken(contractProp)}"]`;
      }
      if (contractProp.length > 0) {
        return `[data-contract-prop="${attrToken(contractProp)}"]`;
      }
      const classes = classNameOf(element).split(/\s+/).filter(Boolean).slice(0, 2);
      if (classes.length > 0) {
        return `${tagName}.${classes.map(cssToken).join(".")}`;
      }
      return `${tagName}:nth-of-type(${nthOfType(element)})`;
    }

    function elementRole(element: BrowserElement, tagName: string, contractProp: string): string {
      if (/^h[1-6]$/.test(tagName)) {
        return "heading";
      }
      if (tagName === "a" || tagName === "button" || classNameOf(element).split(/\s+/).includes("cta")) {
        return "cta";
      }
      if (isCaptionLike(element, tagName, contractProp)) {
        return "caption";
      }
      return tagName === "p" ? "paragraph" : "text";
    }

    function isCaptionLike(element: BrowserElement, tagName: string, contractProp: string): boolean {
      const signal = `${tagName} ${contractProp} ${classNameOf(element)}`.toLowerCase();
      return (
        tagName === "small" ||
        signal.includes("caption") ||
        signal.includes("kicker") ||
        signal.includes("eyebrow") ||
        signal.includes("source")
      );
    }

    function isVisible(element: BrowserElement, style: BrowserComputedStyle, rect: FitProbeRect): boolean {
      const text = normalizeText(element.textContent ?? "");
      return (
        text.length > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0
      );
    }

    function measureTextWidth(text: string, font: string): number {
      if (text.length === 0) {
        return 0;
      }
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (context === null) {
        return 0;
      }
      context.font = font;
      return context.measureText(text).width;
    }

    function longestUnbreakableToken(text: string): string {
      return text.split(/\s+/).reduce((longest, token) => token.length > longest.length ? token : longest, "");
    }

    function parseCssPx(value: string): number {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function parseLineHeight(value: string, fontPx: number): number {
      const parsed = Number.parseFloat(value);
      if (!Number.isFinite(parsed)) {
        return fontPx * 1.2;
      }
      return value.trim().endsWith("px") ? parsed : parsed * fontPx;
    }

    function intersectRect(first: FitProbeRect, second: FitProbeRect): FitProbeRect | undefined {
      const x = Math.max(first.x, second.x);
      const y = Math.max(first.y, second.y);
      const right = Math.min(first.right, second.right);
      const bottom = Math.min(first.bottom, second.bottom);
      if (right <= x || bottom <= y) {
        return undefined;
      }
      return { x: round2(x), y: round2(y), width: round2(right - x), height: round2(bottom - y), right: round2(right), bottom: round2(bottom) };
    }

    function toProbeRect(rect: BrowserDomRect): FitProbeRect {
      return {
        x: round2(rect.x),
        y: round2(rect.y),
        width: round2(rect.width),
        height: round2(rect.height),
        right: round2(rect.right),
        bottom: round2(rect.bottom)
      };
    }

    function uniqueElements(elementsToDedupe: readonly BrowserElement[]): readonly BrowserElement[] {
      const output: BrowserElement[] = [];
      for (const element of elementsToDedupe) {
        if (!output.includes(element)) {
          output.push(element);
        }
      }
      return output;
    }

    function classNameOf(element: BrowserElement): string {
      return typeof element.className === "string" ? element.className : element.className.baseVal ?? "";
    }

    function nthOfType(element: BrowserElement): number {
      let index = 1;
      let sibling = element.previousElementSibling;
      while (sibling !== null) {
        if (sibling.tagName.toLowerCase() === element.tagName.toLowerCase()) {
          index += 1;
        }
        sibling = sibling.previousElementSibling;
      }
      return index;
    }

    function previewText(text: string): string {
      return text.length <= 96 ? text : `${text.slice(0, 93)}...`;
    }

    function normalizeText(text: string): string {
      return text.replace(/\s+/g, " ").trim();
    }

    function attrToken(value: string): string {
      return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    function cssToken(value: string): string {
      return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    }

    function maxNumber(values: readonly number[]): number | undefined {
      const finite = values.filter((value) => Number.isFinite(value));
      return finite.length === 0 ? undefined : Math.max(...finite);
    }

    function round2(value: number): number {
      return Math.round(value * 100) / 100;
    }
  }, viewport);
}

async function captureFailureScreenshot(
  page: PageLike,
  prepared: PreparedFitProbeSource,
  breakpoints: readonly FitProbeViewportResult[]
): Promise<readonly string[]> {
  const target = breakpoints.find((breakpoint) => breakpoint.failures.length > 0) ?? breakpoints[breakpoints.length - 1];
  if (target === undefined) {
    return [];
  }

  await page.setViewportSize({ width: target.width, height: target.height });
  const screenshotPath = path.join(prepared.outputDir, `${prepared.id}-${target.width}.fit-probe.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return [toRepoPath(process.cwd(), screenshotPath)];
}

function buildFitProbeReport(input: {
  readonly prepared: PreparedFitProbeSource;
  readonly sourceKind: FitProbeSourceKind;
  readonly sweepResults: readonly FitProbeViewportResult[];
  readonly breakpointResults: readonly FitProbeViewportResult[];
  readonly screenshotPaths: readonly string[];
}): FitProbeReport {
  const vor = computeVorMetric(input.sweepResults);
  const breakpointReports = input.breakpointResults.map(toViewportReport);
  const allBreakpointFailures = input.breakpointResults.flatMap((result) => result.failures);
  const hardFailures = allBreakpointFailures.filter((failure) =>
    failure.kind === "font_below_legible_floor" ||
    failure.kind === "clipped_text" ||
    failure.kind === "document_horizontal_overflow" ||
    failure.kind === "element_horizontal_overflow" ||
    failure.kind === "text_control_overlap" ||
    failure.kind === "unbreakable_token_overflow"
  );

  return {
    schema: "autopilot-beta/pdos-fit-probe-report@1",
    status: vor.ratePercent === 0 && hardFailures.length === 0 ? "passed" : "failed",
    source_kind: input.sourceKind,
    source_path: toRepoPath(process.cwd(), input.prepared.sourcePath),
    html_path: toRepoPath(process.cwd(), input.prepared.htmlPath),
    report_path: toRepoPath(process.cwd(), input.prepared.reportPath),
    screenshot_paths: input.screenshotPaths,
    checked_viewports: FIT_PROBE_BREAKPOINT_WIDTHS,
    vor_sweep: FIT_PROBE_VOR_SWEEP,
    vor,
    breakpoints: breakpointReports,
    text_fit_records: input.breakpointResults.map((result) => result.textFitRecord),
    worst_offenders: selectWorstOffenders(input.breakpointResults),
    failures_by_invariant: countFailuresByInvariant(allBreakpointFailures),
    errors: []
  };
}

function toViewportReport(result: FitProbeViewportResult): FitProbeViewportReport {
  return {
    name: result.name,
    width: result.width,
    height: result.height,
    passed: result.failures.length === 0,
    max_overflow_px: maxOverflowPx(result),
    clipped_text_count: result.failures.filter((failure) => failure.kind === "clipped_text").length,
    overflowing_text_count: result.failures.filter((failure) =>
      failure.kind === "document_horizontal_overflow" ||
      failure.kind === "element_horizontal_overflow" ||
      failure.kind === "unbreakable_token_overflow"
    ).length,
    min_font_px: result.textFitRecord.min_font_px,
    max_line_length_ch: result.textFitRecord.max_line_length_ch,
    fit_scale_min: result.textFitRecord.fit_scale_min,
    failures: result.failures
  };
}

function countFailuresByInvariant(failures: readonly FitProbeFailure[]): Readonly<Record<FitProbeInvariantCode, number>> {
  return {
    fits_viewport_range: failures.filter((failure) => failure.invariantCode === "fits_viewport_range").length,
    no_text_overflow_at_breakpoints: failures.filter((failure) => failure.invariantCode === "no_text_overflow_at_breakpoints").length,
    min_legible_text: failures.filter((failure) => failure.invariantCode === "min_legible_text").length
  };
}

function prepareFitProbeSource(input: FitProbeRunInput, repoRoot: string): PreparedFitProbeSource {
  const outputDir = resolve(repoRoot, input.outputDir ?? "output/fit-probe");
  mkdirSync(outputDir, { recursive: true });

  const sourcePath = resolve(repoRoot, input.sourcePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Fit-probe source does not exist: ${input.sourcePath}`);
  }

  if (input.sourceKind === "html") {
    const id = safeFileStem(basename(sourcePath, path.extname(sourcePath)));
    return {
      id,
      sourcePath,
      htmlPath: sourcePath,
      reportPath: path.join(outputDir, `${id}.fit-probe.json`),
      outputDir
    };
  }

  const spec = JSON.parse(readFileSync(sourcePath, "utf8")) as unknown;
  const id = isRecord(spec) && typeof spec.id === "string" ? safeFileStem(spec.id) : safeFileStem(basename(sourcePath, ".composition.json"));
  const page = renderCompositionPage(spec, path.join(repoRoot, "product-design-os"));
  const htmlPath = path.join(outputDir, `${id}.fit-probe.html`);
  writeFileSync(htmlPath, page.html, "utf8");

  return {
    id,
    sourcePath,
    htmlPath,
    reportPath: path.join(outputDir, `${id}.fit-probe.json`),
    outputDir
  };
}

function skippedReport(prepared: PreparedFitProbeSource, error: string): FitProbeReport {
  return {
    schema: "autopilot-beta/pdos-fit-probe-report@1",
    status: "skipped",
    source_kind: "composition",
    source_path: prepared.sourcePath.length === 0 ? "" : toRepoPath(process.cwd(), prepared.sourcePath),
    html_path: prepared.htmlPath.length === 0 ? "" : toRepoPath(process.cwd(), prepared.htmlPath),
    report_path: prepared.reportPath.length === 0 ? "" : toRepoPath(process.cwd(), prepared.reportPath),
    screenshot_paths: [],
    checked_viewports: FIT_PROBE_BREAKPOINT_WIDTHS,
    vor_sweep: FIT_PROBE_VOR_SWEEP,
    vor: {
      checkedWidthCount: 0,
      failedWidthCount: 0,
      passedWidthCount: 0,
      ratePercent: 0,
      failedWidths: []
    },
    breakpoints: [],
    text_fit_records: [],
    worst_offenders: [],
    failures_by_invariant: {
      fits_viewport_range: 0,
      no_text_overflow_at_breakpoints: 0,
      min_legible_text: 0
    },
    errors: [error]
  };
}

function writeReport(reportPath: string, report: FitProbeReport): FitProbeReport {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function optionalImport<T>(
  specifier: string
): Promise<{ readonly status: "loaded"; readonly module: T; readonly message: "" } | { readonly status: "missing"; readonly message: string }> {
  try {
    return {
      status: "loaded",
      module: await dynamicImport<T>(specifier),
      message: ""
    };
  } catch (error) {
    return {
      status: "missing",
      message: errorMessage(error)
    };
  }
}

function parseArgs(args: readonly string[]): {
  readonly sourceKind?: FitProbeSourceKind;
  readonly sourcePath?: string;
  readonly outputDir?: string;
  readonly format?: FitProbeFormat;
  readonly screenshot?: boolean;
} {
  const result: {
    sourceKind?: FitProbeSourceKind;
    sourcePath?: string;
    outputDir?: string;
    format?: FitProbeFormat;
    screenshot?: boolean;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];

    if (key === "--screenshot") {
      result.screenshot = true;
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (key === "--composition") {
      result.sourceKind = "composition";
      result.sourcePath = value;
      index += 1;
    } else if (key === "--html") {
      result.sourceKind = "html";
      result.sourcePath = value;
      index += 1;
    } else if (key === "--out") {
      result.outputDir = value;
      index += 1;
    } else if (key === "--format" && (value === "json" || value === "markdown")) {
      result.format = value;
      index += 1;
    }
  }

  return result;
}

function printUsage(): string {
  return [
    "Usage:",
    "  tsx product-design-os/qa/fit-probe/check-fit-probe-product-design-os.ts --composition product-design-os/specs/examples/buildable-marketing.composition.json --format markdown",
    "  tsx product-design-os/qa/fit-probe/check-fit-probe-product-design-os.ts --html output/render/landing-page.html --format json",
    ""
  ].join("\n");
}

function formatBreakpointLine(viewport: FitProbeViewportReport): string {
  const status = viewport.passed ? "pass" : "fail";
  return `- ${viewport.name}: ${status}; overflow=${viewport.max_overflow_px}px; clipped=${viewport.clipped_text_count}; overflowing=${viewport.overflowing_text_count}; min_font=${viewport.min_font_px}px; max_line=${viewport.max_line_length_ch}ch; fit_scale_min=${viewport.fit_scale_min}`;
}

function formatInvariantCounts(counts: Readonly<Record<FitProbeInvariantCode, number>>): readonly string[] {
  return [
    `- fits_viewport_range: ${counts.fits_viewport_range}`,
    `- no_text_overflow_at_breakpoints: ${counts.no_text_overflow_at_breakpoints}`,
    `- min_legible_text: ${counts.min_legible_text}`
  ];
}

function formatOffenders(offenders: readonly FitProbeOffender[]): readonly string[] {
  if (offenders.length === 0) {
    return ["- None."];
  }
  return offenders.map((offender) => {
    const selector = offender.selector ?? "<document>";
    const preview = offender.textPreview === undefined ? "" : ` "${offender.textPreview}"`;
    const rect = offender.rect === undefined
      ? ""
      : ` rect=${offender.rect.x},${offender.rect.y},${offender.rect.width}x${offender.rect.height}`;
    const dims = offender.clientWidth === undefined || offender.scrollWidth === undefined
      ? ""
      : ` scroll/client=${offender.scrollWidth}/${offender.clientWidth}`;
    return `- ${offender.viewport} ${offender.kind} ${selector}${preview}${rect}${dims}`;
  });
}

function safeFileStem(value: string): string {
  const stem = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem.length > 0 ? stem : "fit-probe";
}

function toRepoPath(repoRoot: string, filePath: string): string {
  return relative(repoRoot, filePath).replace(/\\/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runCli(): void {
  createFitProbeCliRun(process.argv.slice(2), process.cwd())
    .then((cliRun) => {
      process.stdout.write(cliRun.output);
      applyFitProbeCliExitCode(cliRun.report);
    })
    .catch((error: unknown) => {
      console.error(`Fit probe failed: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (basename(invokedFile) === basename(currentFile) && invokedFile === currentFile) {
  runCli();
}
