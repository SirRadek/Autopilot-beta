import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path, { basename, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderCompositionPage } from "../../renderer/render-composition";
import {
  applyVisualQaBrowserCliExitCode,
  buildVisualQaBrowserReport,
  formatVisualQaBrowserReport,
  skippedVisualQaBrowserReport,
  type VisualQaBrowserAxeImpact,
  type VisualQaBrowserAxeViolation,
  type VisualQaBrowserFormat,
  type VisualQaBrowserReport,
  type VisualQaBrowserSnapshot,
  type VisualQaBrowserSourceKind,
  type VisualQaBrowserViewportSnapshot
} from "./visual-qa-browser-core";

declare const document: BrowserDocument;
declare const window: BrowserWindow;
declare function getComputedStyle(element: BrowserElement): BrowserComputedStyle;
declare function requestAnimationFrame(callback: (time: number) => void): number;

export interface VisualQaBrowserRunInput {
  readonly sourcePath: string;
  readonly sourceKind: VisualQaBrowserSourceKind;
  readonly outputDir?: string;
  readonly format?: VisualQaBrowserFormat;
}

export interface VisualQaBrowserCliRun {
  readonly report: VisualQaBrowserReport;
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
  readonly addScriptTag: (options: { readonly content: string }) => Promise<unknown>;
  readonly evaluate: <T, Arg>(
    pageFunction: (arg: Arg) => T | Promise<T>,
    arg: Arg
  ) => Promise<T>;
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
  readonly styleSheets: ArrayLike<BrowserStyleSheet>;
  readonly querySelectorAll: (selector: string) => ArrayLike<BrowserElement>;
  readonly createRange: () => BrowserRange;
  readonly createElement: (tagName: "canvas") => BrowserCanvas;
}

interface BrowserWindow {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly axe?: AxeInjectedRuntime;
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
}

interface BrowserStyleSheet {
  readonly cssRules?: ArrayLike<BrowserCssRule>;
}

interface BrowserCssRule {
  readonly conditionText?: string;
  readonly cssRules?: ArrayLike<BrowserCssRule>;
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
  readonly color: string;
  readonly backgroundColor: string;
  readonly font: string;
  readonly fontSize: string;
  readonly lineHeight: string;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly animationDelay: string;
  readonly animationDuration: string;
  readonly animationName: string;
  readonly transitionDelay: string;
  readonly transitionDuration: string;
  readonly transitionProperty: string;
}

interface PreparedVisualQaBrowserSource {
  readonly id: string;
  readonly sourcePath: string;
  readonly htmlPath: string;
  readonly reportPath: string;
  readonly outputDir: string;
  readonly snapshotMetadata: VisualQaBrowserSnapshotMetadata;
}

interface VisualQaBrowserSnapshotMetadata {
  readonly url?: string;
  readonly project_type?: string;
  readonly primary_goal?: string;
  readonly target_users?: readonly string[];
  readonly headings?: readonly string[];
  readonly ctas?: readonly string[];
  readonly template_signals?: readonly string[];
}

interface MeasuredVisualQaViewport extends VisualQaBrowserViewportSnapshot {
  readonly headings: readonly string[];
  readonly ctas: readonly string[];
}

interface AxeCoreBundle {
  readonly source: string;
}

interface AxeInjectedRuntime {
  readonly run: (context: BrowserDocument, options: { readonly resultTypes: readonly ["violations"] }) => Promise<AxeRunResult>;
}

interface AxeRunResult {
  readonly violations: readonly AxeRawViolation[];
}

interface AxeRawViolation {
  readonly id: string;
  readonly impact?: string | null;
  readonly help: string;
  readonly nodes: readonly AxeRawNode[];
}

interface AxeRawNode {
  readonly target: readonly unknown[];
  readonly html: string;
  readonly failureSummary?: string;
}

const dynamicImport = new Function("specifier", "return import(specifier)") as <T>(specifier: string) => Promise<T>;
const nodeRequire = createRequire(import.meta.url);
const browserViewports: readonly BrowserViewportInput[] = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-414", width: 414, height: 896 },
  { name: "mobile-390", width: 390, height: 844 },
  // Phone floor cohort so the R1a fluid_floor (<=360) + R5 touch-target analyzers actually
  // run — they were dead before because the runner only captured 1440/390.
  { name: "mobile-360", width: 360, height: 640 },
  { name: "mobile-320", width: 320, height: 568 }
];

export async function createVisualQaBrowserCliRun(
  cliArgs: readonly string[],
  repoRoot = process.cwd()
): Promise<VisualQaBrowserCliRun> {
  const args = parseArgs(cliArgs);
  if (args.sourcePath === undefined || args.sourceKind === undefined) {
    const report = skippedVisualQaBrowserReport({
      source_kind: "composition",
      source_path: "",
      html_path: "",
      report_path: toRepoPath(repoRoot, resolve(repoRoot, args.outputDir ?? "output/visual-qa-browser")),
      checked_viewports: browserViewports.map((viewport) => viewport.width),
      message: "Missing input. Use --composition <file> or --html <file>."
    });
    return {
      report,
      output: printUsage(),
      exitCode: 1
    };
  }

  const runInput: {
    sourcePath: string;
    sourceKind: VisualQaBrowserSourceKind;
    outputDir?: string;
    format?: VisualQaBrowserFormat;
  } = {
    sourcePath: args.sourcePath,
    sourceKind: args.sourceKind
  };
  if (args.outputDir !== undefined) {
    runInput.outputDir = args.outputDir;
  }
  if (args.format !== undefined) {
    runInput.format = args.format;
  }

  const report = await runVisualQaBrowser(runInput, repoRoot);
  return {
    report,
    output: formatVisualQaBrowserReport(report, args.format),
    exitCode: report.status === "passed" ? 0 : 1
  };
}

export async function runVisualQaBrowser(
  input: VisualQaBrowserRunInput,
  repoRoot = process.cwd()
): Promise<VisualQaBrowserReport> {
  const prepared = prepareVisualQaBrowserSource(input, repoRoot);
  const checkedViewports = browserViewports.map((viewport) => viewport.width);
  const playwright = await optionalImport<PlaywrightModule>("@playwright/test");

  if (playwright.status === "missing" || playwright.module.chromium === undefined) {
    return writeReport(
      prepared.reportPath,
      skippedVisualQaBrowserReport({
        source_kind: input.sourceKind,
        source_path: toRepoPath(repoRoot, prepared.sourcePath),
        html_path: toRepoPath(repoRoot, prepared.htmlPath),
        report_path: toRepoPath(repoRoot, prepared.reportPath),
        checked_viewports: checkedViewports,
        message: `Playwright is unavailable: ${playwright.message}`
      }),
      input.format
    );
  }

  let axeSource: string;
  try {
    axeSource = loadAxeSource();
  } catch (error) {
    return writeReport(
      prepared.reportPath,
      skippedVisualQaBrowserReport({
        source_kind: input.sourceKind,
        source_path: toRepoPath(repoRoot, prepared.sourcePath),
        html_path: toRepoPath(repoRoot, prepared.htmlPath),
        report_path: toRepoPath(repoRoot, prepared.reportPath),
        checked_viewports: checkedViewports,
        message: `axe-core is unavailable: ${errorMessage(error)}`
      }),
      input.format
    );
  }

  let browser: BrowserLike | undefined;
  try {
    const firstViewport = browserViewports[0] ?? { name: "desktop-1440", width: 1440, height: 900 };
    browser = await playwright.module.chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: firstViewport.width, height: firstViewport.height },
      deviceScaleFactor: 1
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(pathToFileURL(prepared.htmlPath).href, { waitUntil: "load" });
    await page.addScriptTag({ content: axeSource });

    const measuredViewports: MeasuredVisualQaViewport[] = [];
    const axeViolations: VisualQaBrowserAxeViolation[] = [];

    for (const viewport of browserViewports) {
      const measured = await measureVisualQaViewport(page, viewport);
      measuredViewports.push(measured);
      const axeResults = await runAxe(page);
      axeViolations.push(...mapAxeViolations(axeResults, viewport.name));
    }

    const snapshot = buildSnapshot(prepared.snapshotMetadata, measuredViewports);
    const report = buildVisualQaBrowserReport({
      source_kind: input.sourceKind,
      source_path: toRepoPath(repoRoot, prepared.sourcePath),
      html_path: toRepoPath(repoRoot, prepared.htmlPath),
      report_path: toRepoPath(repoRoot, prepared.reportPath),
      checked_viewports: checkedViewports,
      snapshot,
      axe_violations: mergeAxeViolations(axeViolations)
    });

    return writeReport(prepared.reportPath, report, input.format);
  } catch (error) {
    return writeReport(
      prepared.reportPath,
      skippedVisualQaBrowserReport({
        source_kind: input.sourceKind,
        source_path: toRepoPath(repoRoot, prepared.sourcePath),
        html_path: toRepoPath(repoRoot, prepared.htmlPath),
        report_path: toRepoPath(repoRoot, prepared.reportPath),
        checked_viewports: checkedViewports,
        message: `Playwright browser visual QA failed: ${errorMessage(error)}`
      }),
      input.format
    );
  } finally {
    await browser?.close();
  }
}

export function applyVisualQaBrowserExitCode(report: VisualQaBrowserReport): 0 | 1 {
  return applyVisualQaBrowserCliExitCode(report);
}

async function measureVisualQaViewport(
  page: PageLike,
  viewport: BrowserViewportInput
): Promise<MeasuredVisualQaViewport> {
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

  return page.evaluate<MeasuredVisualQaViewport, BrowserViewportInput>((currentViewport) => {
    interface BrowserRect {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly right: number;
      readonly bottom: number;
    }

    interface RgbaColor {
      readonly red: number;
      readonly green: number;
      readonly blue: number;
      readonly alpha: number;
    }

    interface TextMeasurement {
      readonly element: BrowserElement;
      readonly selector: string;
      readonly tagName: string;
      readonly textPreview: string;
      readonly textLength: number;
      readonly contractProp: string;
      readonly contractSlot: string;
      readonly visible: boolean;
      readonly isHeading: boolean;
      readonly isH1: boolean;
      readonly isCta: boolean;
      readonly rect: BrowserRect;
      readonly clientWidth: number;
      readonly scrollWidth: number;
      readonly clientHeight: number;
      readonly scrollHeight: number;
      readonly fontPx: number;
      readonly maxLineLengthCh: number;
      readonly clipped: boolean;
      readonly fitScale: number;
      readonly foreground: string;
      readonly background: string;
      readonly contrastRatio: number;
    }

    const textSelector = [
      "[data-contract-prop]",
      "[data-contract-slot]",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "a",
      "button",
      "[role=\"button\"]",
      "li",
      "span",
      "small",
      "strong",
      "em"
    ].join(",");
    const rawTextElements = uniqueElements(Array.from(document.querySelectorAll(textSelector)));
    const measurements = rawTextElements.map(measureTextElement).filter((measurement) => measurement.visible);
    const headingMeasurements = measurements.filter((measurement) => measurement.isHeading);
    const ctaMeasurements = measurements.filter((measurement) => measurement.isCta);
    const overlapCount = measureTextOverlaps(measurements);
    const documentOverflowPx = maxNumber([
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body === null ? 0 : document.body.scrollWidth - document.body.clientWidth
    ]) ?? 0;
    const elementOverflowPx = maxNumber(
      measurements.map((measurement) => {
        return Math.max(
          measurement.scrollWidth - measurement.clientWidth,
          measurement.rect.right - currentViewport.width,
          -measurement.rect.x
        );
      })
    ) ?? 0;
    const overflowPx = round2(Math.max(0, documentOverflowPx, elementOverflowPx));
    const clippedTextCount = measurements.filter((measurement) => measurement.clipped).length;
    const minFontPx = minNumber(measurements.map((measurement) => measurement.fontPx)) ?? 0;
    const maxLineLengthCh = maxNumber(measurements.map((measurement) => measurement.maxLineLengthCh)) ?? 0;
    const fitScaleMin = minNumber(measurements.map((measurement) => measurement.fitScale)) ?? 1;
    const contrastFailures = measurements
      .filter((measurement) => measurement.contrastRatio < 4.5)
      .map((measurement) => ({
        selector: measurement.selector,
        text_preview: measurement.textPreview,
        ratio: measurement.contrastRatio,
        min_ratio: 4.5,
        foreground: measurement.foreground,
        background: measurement.background
      }));
    const minCtaTargetPx = ctaMeasurements.length === 0
      ? 0
      : minNumber(ctaMeasurements.map((measurement) => Math.min(measurement.rect.width, measurement.rect.height))) ?? 0;
    const primaryCtaMeasurement = selectPrimaryCtaMeasurement(ctaMeasurements);
    const viewportHeightPx = round2(window.innerHeight);
    const ctaTopPx = primaryCtaMeasurement === undefined ? 0 : round2(primaryCtaMeasurement.rect.y);
    const canvasCount = Array.from(document.querySelectorAll("canvas")).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return isElementVisible(element, style, toRect(rect));
    }).length;
    const reducedMotionRuleCount = countReducedMotionRules();
    const activeMotionElementCount = countActiveMotionElements();
    const visibleTextCharacters = measurements.reduce((total, measurement) => total + measurement.textLength, 0);
    const hasVisibleH1 = headingMeasurements.some((measurement) => measurement.isH1);
    const hasVisibleCta = ctaMeasurements.length > 0;
    const primaryContentInCanvas = canvasCount > 0 && visibleTextCharacters < 120 && (!hasVisibleH1 || !hasVisibleCta);
    const headingTexts = uniqueStrings(headingMeasurements.map((measurement) => measurement.textPreview));
    const ctaTexts = uniqueStrings(ctaMeasurements.map((measurement) => measurement.textPreview));

    return {
      name: currentViewport.name,
      width: currentViewport.width,
      height: currentViewport.height,
      heading_count: headingMeasurements.length,
      cta_count: ctaMeasurements.length,
      visible_text_characters: visibleTextCharacters,
      repeated_card_count: countRepeatedCards(),
      text_overlap: overlapCount > 0,
      horizontal_overflow: overflowPx > 1,
      low_contrast: contrastFailures.length > 0,
      primary_content_in_canvas: primaryContentInCanvas,
      motion_level: Math.min(10, activeMotionElementCount + canvasCount),
      reduced_motion_supported: reducedMotionRuleCount > 0 || activeMotionElementCount === 0,
      text_fit: clippedTextCount === 0 && overflowPx <= 1 && overlapCount === 0,
      clipped_text_count: clippedTextCount,
      min_font_px: round2(minFontPx),
      max_line_length_ch: round2(maxLineLengthCh),
      fit_scale_min: round2(fitScaleMin),
      h1_visible: hasVisibleH1,
      cta_target_min_44: ctaMeasurements.length > 0 && minCtaTargetPx >= 44,
      min_cta_target_px: round2(minCtaTargetPx),
      cta_top_px: ctaTopPx,
      viewport_height_px: viewportHeightPx,
      above_fold_mobile: primaryCtaMeasurement !== undefined && ctaTopPx < viewportHeightPx,
      overlap_count: overlapCount,
      overflow_px: overflowPx,
      canvas_count: canvasCount,
      active_motion_element_count: activeMotionElementCount,
      reduce_motion_rule_count: reducedMotionRuleCount,
      contrast_failures: contrastFailures,
      headings: headingTexts,
      ctas: ctaTexts
    };

    function measureTextElement(element: BrowserElement): TextMeasurement {
      const style = getComputedStyle(element);
      const tagName = element.tagName.toLowerCase();
      const rect = toRect(element.getBoundingClientRect());
      const text = normalizeText(element.textContent ?? "");
      const fontPx = parseCssPx(style.fontSize);
      const lineRects = text.length === 0 ? [] : textLineRects(element);
      const maxLineWidth = maxNumber(lineRects.map((lineRect) => lineRect.width)) ?? rect.width;
      const clientWidth = round2(element.clientWidth);
      const scrollWidth = round2(element.scrollWidth);
      const clientHeight = round2(element.clientHeight);
      const scrollHeight = round2(element.scrollHeight);
      const clippedX = scrollWidth - clientWidth > 1 && style.overflowX !== "visible";
      const clippedY = scrollHeight - clientHeight > 1 && style.overflowY !== "visible";
      const textWidth = measureTextWidth(longestUnbreakableToken(text), style.font);
      const fitScale = textWidth <= 0 || clientWidth <= 0 ? 1 : Math.min(1, round2(clientWidth / textWidth));
      const background = effectiveBackground(element);
      const foreground = parseCssColor(style.color) ?? { red: 0, green: 0, blue: 0, alpha: 1 };
      const foregroundOnBackground = foreground.alpha >= 1 ? foreground : compositeColor(foreground, background);
      const contrast = contrastRatio(foregroundOnBackground, background);
      const contractProp = element.getAttribute("data-contract-prop") ?? "";
      const contractSlot = element.getAttribute("data-contract-slot") ?? "";

      return {
        element,
        selector: readableSelector(element, tagName, contractProp),
        tagName,
        textPreview: previewText(text),
        textLength: text.length,
        contractProp,
        contractSlot,
        visible: isElementVisible(element, style, rect) && text.length > 0,
        isHeading: /^h[1-6]$/.test(tagName),
        isH1: tagName === "h1",
        isCta: isCtaElement(element, tagName, contractProp, contractSlot),
        rect,
        clientWidth,
        scrollWidth,
        clientHeight,
        scrollHeight,
        fontPx: round2(fontPx),
        maxLineLengthCh: round2(maxLineWidth / Math.max(fontPx * 0.5, 1)),
        clipped: clippedX || clippedY,
        fitScale,
        foreground: formatColor(foregroundOnBackground),
        background: formatColor(background),
        contrastRatio: round2(contrast)
      };
    }

    function textLineRects(element: BrowserElement): readonly BrowserRect[] {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = Array.from(range.getClientRects()).map(toRect).filter((rect) => rect.width > 0 && rect.height > 0);
      range.detach?.();
      return groupLineRects(rects);
    }

    function groupLineRects(rects: readonly BrowserRect[]): readonly BrowserRect[] {
      const lines: BrowserRect[] = [];
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

    function measureTextOverlaps(measuredElements: readonly TextMeasurement[]): number {
      let count = 0;
      for (let firstIndex = 0; firstIndex < measuredElements.length; firstIndex += 1) {
        const first = measuredElements[firstIndex];
        if (first === undefined) {
          continue;
        }
        for (let secondIndex = firstIndex + 1; secondIndex < measuredElements.length; secondIndex += 1) {
          const second = measuredElements[secondIndex];
          if (second === undefined) {
            continue;
          }
          if (isSameTextContainerPair(first.element, second.element)) {
            continue;
          }
          if (first.rect.width <= 0 || second.rect.width <= 0 || first.rect.height <= 0 || second.rect.height <= 0) {
            continue;
          }
          const intersection = intersectRect(first.rect, second.rect);
          if (intersection !== undefined && intersection.width * intersection.height > 4) {
            count += 1;
          }
        }
      }
      return count;
    }

    function isSameTextContainerPair(firstElement: BrowserElement, secondElement: BrowserElement): boolean {
      return (
        firstElement.contains(secondElement) ||
        secondElement.contains(firstElement) ||
        (firstElement.parentElement !== null && firstElement.parentElement === secondElement.parentElement)
      );
    }

    function effectiveBackground(element: BrowserElement): RgbaColor {
      const chain: BrowserElement[] = [];
      let current: BrowserElement | null = element;
      while (current !== null) {
        chain.push(current);
        current = current.parentElement;
      }

      let result: RgbaColor = { red: 255, green: 255, blue: 255, alpha: 1 };
      for (const candidate of chain.reverse()) {
        const color = parseCssColor(getComputedStyle(candidate).backgroundColor);
        if (color !== undefined && color.alpha > 0) {
          result = compositeColor(color, result);
        }
      }
      return result;
    }

    function parseCssColor(value: string): RgbaColor | undefined {
      const trimmed = value.trim().toLowerCase();
      if (trimmed === "transparent") {
        return { red: 0, green: 0, blue: 0, alpha: 0 };
      }
      const rgb = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+%?))?\s*\)$/.exec(trimmed);
      if (rgb !== null) {
        return {
          red: clamp255(Number(rgb[1])),
          green: clamp255(Number(rgb[2])),
          blue: clamp255(Number(rgb[3])),
          alpha: parseAlpha(rgb[4])
        };
      }
      const spaceRgb = /^rgba?\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+%?))?\s*\)$/.exec(trimmed);
      if (spaceRgb !== null) {
        return {
          red: clamp255(Number(spaceRgb[1])),
          green: clamp255(Number(spaceRgb[2])),
          blue: clamp255(Number(spaceRgb[3])),
          alpha: parseAlpha(spaceRgb[4])
        };
      }
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
      if (hex !== null && hex[1] !== undefined) {
        const normalized = hex[1].length === 3
          ? `${hex[1][0]}${hex[1][0]}${hex[1][1]}${hex[1][1]}${hex[1][2]}${hex[1][2]}`
          : hex[1];
        return {
          red: Number.parseInt(normalized.slice(0, 2), 16),
          green: Number.parseInt(normalized.slice(2, 4), 16),
          blue: Number.parseInt(normalized.slice(4, 6), 16),
          alpha: 1
        };
      }
      return undefined;
    }

    function parseAlpha(value: string | undefined): number {
      if (value === undefined) {
        return 1;
      }
      const trimmed = value.trim();
      if (trimmed.endsWith("%")) {
        return Math.max(0, Math.min(1, Number(trimmed.slice(0, -1)) / 100));
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 1;
    }

    function compositeColor(foreground: RgbaColor, background: RgbaColor): RgbaColor {
      const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
      if (alpha <= 0) {
        return { red: 255, green: 255, blue: 255, alpha: 1 };
      }
      return {
        red: Math.round((foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha),
        green: Math.round((foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) / alpha),
        blue: Math.round((foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) / alpha),
        alpha
      };
    }

    function contrastRatio(first: RgbaColor, second: RgbaColor): number {
      const firstLuminance = relativeLuminance(first);
      const secondLuminance = relativeLuminance(second);
      const lighter = Math.max(firstLuminance, secondLuminance);
      const darker = Math.min(firstLuminance, secondLuminance);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function relativeLuminance(color: RgbaColor): number {
      const red = linearizedChannel(color.red);
      const green = linearizedChannel(color.green);
      const blue = linearizedChannel(color.blue);
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    }

    function linearizedChannel(channel: number): number {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }

    function countReducedMotionRules(): number {
      let count = 0;
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          count += countRules(sheet.cssRules);
        } catch {
          continue;
        }
      }
      return count;
    }

    function countRules(rules: ArrayLike<BrowserCssRule> | undefined): number {
      if (rules === undefined) {
        return 0;
      }
      let count = 0;
      for (const rule of Array.from(rules)) {
        if ((rule.conditionText ?? "").toLowerCase().includes("prefers-reduced-motion")) {
          count += 1;
        }
        count += countRules(rule.cssRules);
      }
      return count;
    }

    function countActiveMotionElements(): number {
      const allElements = Array.from(document.querySelectorAll("*"));
      let count = 0;
      for (const element of allElements) {
        const style = getComputedStyle(element);
        const hasAnimation = style.animationName !== "none" && maxDurationMs(style.animationDuration, style.animationDelay) > 16;
        const hasTransition = style.transitionProperty !== "none" && maxDurationMs(style.transitionDuration, style.transitionDelay) > 16;
        if (hasAnimation || hasTransition || element.matches("[data-dot-stage]")) {
          count += 1;
        }
      }
      return count;
    }

    function maxDurationMs(durationList: string, delayList: string): number {
      const durations = durationList.split(",").map(parseTimeMs);
      const delays = delayList.split(",").map(parseTimeMs);
      const totals = durations.map((duration, index) => duration + (delays[index] ?? 0));
      return maxNumber(totals) ?? 0;
    }

    function parseTimeMs(value: string): number {
      const trimmed = value.trim();
      if (trimmed.endsWith("ms")) {
        const parsed = Number.parseFloat(trimmed);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      if (trimmed.endsWith("s")) {
        const parsed = Number.parseFloat(trimmed);
        return Number.isFinite(parsed) ? parsed * 1000 : 0;
      }
      const parsed = Number.parseFloat(trimmed);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function countRepeatedCards(): number {
      const cards = uniqueElements(Array.from(document.querySelectorAll("article,[data-card],[class*=\"card\"]")));
      if (cards.length > 0) {
        return cards.length;
      }
      const panelGrids = Array.from(document.querySelectorAll("[data-pdos-panel-grid],.pdos-panel-grid"));
      return maxNumber(panelGrids.map((grid) => Array.from(document.querySelectorAll("[data-pdos-panel-grid] > *, .pdos-panel-grid > *")).filter((child) => grid.contains(child)).length)) ?? 0;
    }

    function isElementVisible(element: BrowserElement, style: BrowserComputedStyle, rect: BrowserRect): boolean {
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0
      );
    }

    function selectPrimaryCtaMeasurement(ctaMeasurementsToRank: readonly TextMeasurement[]): TextMeasurement | undefined {
      return (
        ctaMeasurementsToRank.find((measurement) => measurement.contractSlot === "above_fold_mobile") ??
        ctaMeasurementsToRank.find((measurement) => measurement.contractProp === "primary_cta") ??
        ctaMeasurementsToRank.find((measurement) => measurement.contractProp === "cta_label") ??
        ctaMeasurementsToRank[0]
      );
    }

    function isCtaElement(element: BrowserElement, tagName: string, contractProp: string, contractSlot: string): boolean {
      const classes = classNameOf(element).split(/\s+/);
      return (
        tagName === "button" ||
        tagName === "a" ||
        element.getAttribute("role") === "button" ||
        classes.includes("cta") ||
        contractSlot === "above_fold_mobile" ||
        contractProp === "primary_cta" ||
        contractProp === "cta_label"
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

    function intersectRect(first: BrowserRect, second: BrowserRect): BrowserRect | undefined {
      const x = Math.max(first.x, second.x);
      const y = Math.max(first.y, second.y);
      const right = Math.min(first.right, second.right);
      const bottom = Math.min(first.bottom, second.bottom);
      if (right <= x || bottom <= y) {
        return undefined;
      }
      return { x: round2(x), y: round2(y), width: round2(right - x), height: round2(bottom - y), right: round2(right), bottom: round2(bottom) };
    }

    function toRect(rect: BrowserDomRect): BrowserRect {
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

    function uniqueStrings(values: readonly string[]): readonly string[] {
      const output: string[] = [];
      for (const value of values) {
        if (value.length > 0 && !output.includes(value)) {
          output.push(value);
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

    function parseCssPx(value: string): number {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function attrToken(value: string): string {
      return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    function cssToken(value: string): string {
      return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    }

    function formatColor(color: RgbaColor): string {
      return `rgba(${Math.round(color.red)}, ${Math.round(color.green)}, ${Math.round(color.blue)}, ${round2(color.alpha)})`;
    }

    function clamp255(value: number): number {
      return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : 0;
    }

    function minNumber(values: readonly number[]): number | undefined {
      const finite = values.filter((value) => Number.isFinite(value));
      return finite.length === 0 ? undefined : Math.min(...finite);
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

async function runAxe(page: PageLike): Promise<AxeRunResult> {
  return page.evaluate<AxeRunResult, null>(async () => {
    if (window.axe === undefined) {
      throw new Error("axe-core did not attach window.axe.");
    }
    return window.axe.run(document, { resultTypes: ["violations"] });
  }, null);
}

function mapAxeViolations(results: AxeRunResult, viewportName: string): readonly VisualQaBrowserAxeViolation[] {
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: normalizeAxeImpact(violation.impact),
    help: violation.help,
    nodes: violation.nodes.map((node) => {
      const mapped: {
        target: readonly string[];
        html: string;
        failure_summary?: string;
      } = {
        target: node.target.map(formatAxeTarget),
        html: previewString(node.html, 600)
      };
      const summary = node.failureSummary === undefined
        ? `[${viewportName}]`
        : `[${viewportName}] ${node.failureSummary}`;
      mapped.failure_summary = previewString(summary, 900);
      return mapped;
    })
  }));
}

function mergeAxeViolations(violations: readonly VisualQaBrowserAxeViolation[]): readonly VisualQaBrowserAxeViolation[] {
  const merged = new Map<string, VisualQaBrowserAxeViolation>();
  for (const violation of violations) {
    const key = `${violation.impact}\u0000${violation.id}\u0000${violation.help}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, violation);
      continue;
    }
    merged.set(key, {
      ...existing,
      nodes: [...existing.nodes, ...violation.nodes]
    });
  }
  return [...merged.values()];
}

function normalizeAxeImpact(value: string | null | undefined): VisualQaBrowserAxeImpact {
  return value === "critical" || value === "serious" || value === "moderate" || value === "minor" ? value : "unknown";
}

function formatAxeTarget(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(formatAxeTarget).join(" ");
  }
  return String(value);
}

function buildSnapshot(
  metadata: VisualQaBrowserSnapshotMetadata,
  viewports: readonly MeasuredVisualQaViewport[]
): VisualQaBrowserSnapshot {
  const snapshot: {
    url?: string;
    project_type?: string;
    primary_goal?: string;
    target_users?: readonly string[];
    viewports: readonly VisualQaBrowserViewportSnapshot[];
    headings?: readonly string[];
    ctas?: readonly string[];
    template_signals?: readonly string[];
  } = {
    viewports: viewports.map(stripMeasuredGlobals)
  };

  assignDefined(snapshot, "url", metadata.url);
  assignDefined(snapshot, "project_type", metadata.project_type);
  assignDefined(snapshot, "primary_goal", metadata.primary_goal);
  assignDefined(snapshot, "target_users", metadata.target_users);
  assignDefined(snapshot, "headings", metadata.headings ?? uniqueStrings(viewports.flatMap((viewport) => viewport.headings)));
  assignDefined(snapshot, "ctas", metadata.ctas ?? uniqueStrings(viewports.flatMap((viewport) => viewport.ctas)));
  assignDefined(snapshot, "template_signals", metadata.template_signals);
  return snapshot;
}

function stripMeasuredGlobals(viewport: MeasuredVisualQaViewport): VisualQaBrowserViewportSnapshot {
  const { headings: _headings, ctas: _ctas, ...snapshot } = viewport;
  return snapshot;
}

function prepareVisualQaBrowserSource(
  input: VisualQaBrowserRunInput,
  repoRoot: string
): PreparedVisualQaBrowserSource {
  const format = input.format ?? "json";
  const outputDir = resolve(repoRoot, input.outputDir ?? "output/visual-qa-browser");
  mkdirSync(outputDir, { recursive: true });

  const sourcePath = resolve(repoRoot, input.sourcePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Visual-QA browser source does not exist: ${input.sourcePath}`);
  }

  if (input.sourceKind === "html") {
    const id = safeFileStem(basename(sourcePath, path.extname(sourcePath)));
    return {
      id,
      sourcePath,
      htmlPath: sourcePath,
      reportPath: path.join(outputDir, reportFileName(id, format)),
      outputDir,
      snapshotMetadata: {}
    };
  }

  const spec = JSON.parse(readFileSync(sourcePath, "utf8")) as unknown;
  const id = isRecord(spec) && typeof spec.id === "string" ? safeFileStem(spec.id) : safeFileStem(basename(sourcePath, ".composition.json"));
  const page = renderCompositionPage(spec, path.join(repoRoot, "product-design-os"));
  const htmlPath = path.join(outputDir, `${id}.visual-qa-browser.html`);
  writeFileSync(htmlPath, page.html, "utf8");

  return {
    id,
    sourcePath,
    htmlPath,
    reportPath: path.join(outputDir, reportFileName(id, format)),
    outputDir,
    snapshotMetadata: readSnapshotMetadata(spec)
  };
}

function readSnapshotMetadata(spec: unknown): VisualQaBrowserSnapshotMetadata {
  if (!isRecord(spec) || !isRecord(spec.visual_qa_probe)) {
    return {};
  }

  const probe = spec.visual_qa_probe;
  const metadata: {
    url?: string;
    project_type?: string;
    primary_goal?: string;
    target_users?: readonly string[];
    headings?: readonly string[];
    ctas?: readonly string[];
    template_signals?: readonly string[];
  } = {};
  assignString(metadata, "url", probe.url);
  assignString(metadata, "project_type", probe.project_type);
  assignString(metadata, "primary_goal", probe.primary_goal);
  assignStringArray(metadata, "target_users", probe.target_users);
  assignStringArray(metadata, "headings", probe.headings);
  assignStringArray(metadata, "ctas", probe.ctas);
  assignStringArray(metadata, "template_signals", probe.template_signals);
  return metadata;
}

function writeReport(
  reportPath: string,
  report: VisualQaBrowserReport,
  format: VisualQaBrowserFormat = "json"
): VisualQaBrowserReport {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, formatVisualQaBrowserReport(report, format), "utf8");
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

function loadAxeSource(): string {
  const bundle = nodeRequire("axe-core") as AxeCoreBundle;
  if (typeof bundle.source !== "string" || bundle.source.length === 0) {
    throw new Error("axe-core did not expose a source string.");
  }
  return bundle.source;
}

function parseArgs(args: readonly string[]): {
  readonly sourceKind?: VisualQaBrowserSourceKind;
  readonly sourcePath?: string;
  readonly outputDir?: string;
  readonly format?: VisualQaBrowserFormat;
} {
  const result: {
    sourceKind?: VisualQaBrowserSourceKind;
    sourcePath?: string;
    outputDir?: string;
    format?: VisualQaBrowserFormat;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
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
    "  tsx product-design-os/qa/visual-qa-browser/check-visual-qa-browser-product-design-os.ts --composition product-design-os/specs/examples/local-bricklayer.composition.json --format markdown",
    "  tsx product-design-os/qa/visual-qa-browser/check-visual-qa-browser-product-design-os.ts --html output/render/landing-page.html --format json",
    ""
  ].join("\n");
}

function reportFileName(id: string, format: VisualQaBrowserFormat): string {
  return `${id}.visual-qa-browser.${format === "markdown" ? "md" : "json"}`;
}

function safeFileStem(value: string): string {
  const stem = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem.length > 0 ? stem : "visual-qa-browser";
}

function previewString(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const output: string[] = [];
  for (const value of values) {
    if (value.length > 0 && !output.includes(value)) {
      output.push(value);
    }
  }
  return output;
}

function toRepoPath(repoRoot: string, filePath: string): string {
  return relative(repoRoot, filePath).replace(/\\/g, "/");
}

function assignDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function assignString<T extends Record<string, unknown>>(target: T, key: keyof T, value: unknown): void {
  if (typeof value === "string") {
    target[key] = value as T[keyof T];
  }
}

function assignStringArray<T extends Record<string, unknown>>(target: T, key: keyof T, value: unknown): void {
  if (Array.isArray(value)) {
    target[key] = value.filter((item): item is string => typeof item === "string") as T[keyof T];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runCli(): void {
  createVisualQaBrowserCliRun(process.argv.slice(2), process.cwd())
    .then((cliRun) => {
      process.stdout.write(cliRun.output);
      applyVisualQaBrowserCliExitCode(cliRun.report);
    })
    .catch((error: unknown) => {
      console.error(`Visual-QA browser failed: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (basename(invokedFile) === basename(currentFile) && invokedFile === currentFile) {
  runCli();
}
