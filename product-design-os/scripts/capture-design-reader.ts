import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "@playwright/test";

import {
  analyzeProductDesignVisualQa,
  formatVisualQaReport,
  type PdosVisualQaInput,
  type PdosVisualQaReport,
  type PdosVisualViewportInput
} from "./visual-qa-product-design-os";

export interface PdosReaderViewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

export interface PdosDesignReaderInput {
  readonly url?: string;
  readonly html_file?: string;
  readonly output_dir?: string;
  readonly project_type?: string;
  readonly primary_goal?: string;
  readonly target_users?: readonly string[];
  readonly viewports?: readonly PdosReaderViewport[];
}

export interface PdosDomCssSnapshot {
  readonly title: string;
  readonly headings: readonly string[];
  readonly ctas: readonly string[];
  readonly visible_text_characters: number;
  readonly repeated_card_count: number;
  readonly horizontal_overflow: boolean;
  readonly text_overlap: boolean;
  readonly low_contrast: boolean;
  readonly primary_content_in_canvas: boolean;
  readonly motion_level: number;
  readonly reduced_motion_supported: boolean;
  readonly template_signals: readonly string[];
}

export interface PdosCapturedViewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly screenshot_path: string;
  readonly dom_css: PdosDomCssSnapshot;
}

export interface PdosDesignReaderCapture {
  readonly url: string;
  readonly output_dir: string;
  readonly captured_at: string;
  readonly viewports: readonly PdosCapturedViewport[];
  readonly visual_qa_input: PdosVisualQaInput;
  readonly visual_qa: PdosVisualQaReport;
  readonly snapshot_path?: string;
}

const DEFAULT_VIEWPORTS: readonly PdosReaderViewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 }
];

export async function captureProductDesignReader(input: PdosDesignReaderInput): Promise<PdosDesignReaderCapture> {
  const targetUrl = resolveTargetUrl(input);
  const outputDir = resolve(input.output_dir ?? "output/playwright/product-design-os");
  mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const capturedViewports = await captureViewports(browser, targetUrl, outputDir, input.viewports ?? DEFAULT_VIEWPORTS);
    const visualQaInput = buildVisualQaInputFromCapture(input, targetUrl, capturedViewports);
    const visualQa = analyzeProductDesignVisualQa(visualQaInput);
    const capturedAt = new Date().toISOString();
    const snapshotPath = join(outputDir, "design-reader-snapshot.json");
    const capture: PdosDesignReaderCapture = {
      url: targetUrl,
      output_dir: outputDir,
      captured_at: capturedAt,
      viewports: capturedViewports,
      visual_qa_input: visualQaInput,
      visual_qa: visualQa,
      snapshot_path: snapshotPath
    };

    writeFileSync(snapshotPath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
    writeFileSync(join(outputDir, "visual-qa-report.md"), formatVisualQaReport(visualQa, "markdown"), "utf8");

    return capture;
  } finally {
    await browser.close();
  }
}

export function buildVisualQaInputFromCapture(
  input: PdosDesignReaderInput,
  url: string,
  capturedViewports: readonly PdosCapturedViewport[]
): PdosVisualQaInput {
  const headingSet = new Set<string>();
  const ctaSet = new Set<string>();
  const templateSignalSet = new Set<string>();
  const viewports = capturedViewports.map((viewport) => {
    for (const heading of viewport.dom_css.headings) {
      headingSet.add(heading);
    }
    for (const cta of viewport.dom_css.ctas) {
      ctaSet.add(cta);
    }
    for (const signal of viewport.dom_css.template_signals) {
      templateSignalSet.add(signal);
    }

    const viewportInput: {
      name: string;
      width: number;
      height: number;
      heading_count: number;
      cta_count: number;
      visible_text_characters: number;
      repeated_card_count: number;
      text_overlap: boolean;
      horizontal_overflow: boolean;
      low_contrast: boolean;
      primary_content_in_canvas: boolean;
      motion_level: number;
      reduced_motion_supported: boolean;
    } = {
      name: viewport.name,
      width: viewport.width,
      height: viewport.height,
      heading_count: viewport.dom_css.headings.length,
      cta_count: viewport.dom_css.ctas.length,
      visible_text_characters: viewport.dom_css.visible_text_characters,
      repeated_card_count: viewport.dom_css.repeated_card_count,
      text_overlap: viewport.dom_css.text_overlap,
      horizontal_overflow: viewport.dom_css.horizontal_overflow,
      low_contrast: viewport.dom_css.low_contrast,
      primary_content_in_canvas: viewport.dom_css.primary_content_in_canvas,
      motion_level: viewport.dom_css.motion_level,
      reduced_motion_supported: viewport.dom_css.reduced_motion_supported
    };
    return viewportInput satisfies PdosVisualViewportInput;
  });

  const output: {
    url: string;
    project_type?: string;
    primary_goal?: string;
    target_users?: readonly string[];
    viewports: readonly PdosVisualViewportInput[];
    headings: readonly string[];
    ctas: readonly string[];
    template_signals: readonly string[];
  } = {
    url,
    viewports,
    headings: [...headingSet],
    ctas: [...ctaSet],
    template_signals: [...templateSignalSet]
  };

  assignIfString(output, "project_type", input.project_type);
  assignIfString(output, "primary_goal", input.primary_goal);
  if (input.target_users !== undefined) {
    output.target_users = input.target_users;
  }

  return output;
}

function resolveTargetUrl(input: PdosDesignReaderInput): string {
  if (input.url) {
    return input.url;
  }
  if (input.html_file) {
    return pathToFileURL(resolve(input.html_file)).toString();
  }
  throw new Error("Design Reader capture requires --url or --html-file.");
}

async function captureViewports(
  browser: Browser,
  url: string,
  outputDir: string,
  viewports: readonly PdosReaderViewport[]
): Promise<readonly PdosCapturedViewport[]> {
  const captured: PdosCapturedViewport[] = [];

  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: {
        width: viewport.width,
        height: viewport.height
      }
    });
    try {
      await page.goto(url, { waitUntil: "networkidle" });
      const screenshotPath = join(outputDir, `${sanitizeFilePart(viewport.name)}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const domCss = await extractDomCssSnapshot(page);

      captured.push({
        name: viewport.name,
        width: viewport.width,
        height: viewport.height,
        screenshot_path: screenshotPath,
        dom_css: domCss
      });
    } finally {
      await page.close();
    }
  }

  return captured;
}

async function extractDomCssSnapshot(page: Page): Promise<PdosDomCssSnapshot> {
  return page.evaluate(() => {
    const global = globalThis as unknown as {
      document: any;
      window: any;
      getComputedStyle: (element: any) => any;
      matchMedia: (query: string) => { matches: boolean };
    };
    const documentRef = global.document;
    const windowRef = global.window;
    const body = documentRef.body;
    const root = documentRef.documentElement;
    const allElements = Array.from(documentRef.querySelectorAll("*")) as any[];
    const visibleElements = allElements.filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = global.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    });
    const headings = collectText(documentRef.querySelectorAll("h1,h2,h3"), 24);
    const ctas = collectText(
      documentRef.querySelectorAll("a[href],button,[role='button'],input[type='button'],input[type='submit']"),
      24
    );
    const repeatedCardCount = visibleElements.filter((element) => {
      const className = String(element.className ?? "").toLowerCase();
      const dataRole = String(element.getAttribute?.("data-card") ?? "").toLowerCase();
      return element.tagName?.toLowerCase() === "article" || className.includes("card") || dataRole.length > 0;
    }).length;
    const bodyText = String(body?.innerText ?? "").replace(/\s+/g, " ").trim();
    const templateSignals = detectTemplateSignals(documentRef, bodyText, repeatedCardCount);
    const motionLevel = inferMotionLevel(documentRef, visibleElements, global);

    return {
      title: String(documentRef.title ?? ""),
      headings,
      ctas,
      visible_text_characters: bodyText.length,
      repeated_card_count: repeatedCardCount,
      horizontal_overflow: root.scrollWidth > windowRef.innerWidth + 1,
      text_overlap: detectTextOverlap(visibleElements),
      low_contrast: detectLowContrast(visibleElements, global),
      primary_content_in_canvas: bodyText.length < 120 && documentRef.querySelectorAll("canvas,svg,video").length > 0,
      motion_level: motionLevel,
      reduced_motion_supported: detectReducedMotionSupport(documentRef),
      template_signals: templateSignals
    };

    function collectText(nodes: any, limit: number): string[] {
      return Array.from(nodes)
        .map((node: any) => String(node.innerText || node.value || node.textContent || "").replace(/\s+/g, " ").trim())
        .filter((text) => text.length > 0)
        .slice(0, limit);
    }

    function detectTextOverlap(elements: any[]): boolean {
      const candidates = elements
        .filter((element) => {
          const tag = String(element.tagName ?? "").toLowerCase();
          return ["h1", "h2", "h3", "p", "a", "button", "label"].includes(tag);
        })
        .slice(0, 80)
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);

      for (let outer = 0; outer < candidates.length; outer += 1) {
        for (let inner = outer + 1; inner < candidates.length; inner += 1) {
          const first = candidates[outer];
          const second = candidates[inner];
          if (!first || !second || first.element.contains(second.element) || second.element.contains(first.element)) {
            continue;
          }
          const overlapX = Math.max(0, Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left));
          const overlapY = Math.max(0, Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top));
          const overlapArea = overlapX * overlapY;
          const smallestArea = Math.min(first.rect.width * first.rect.height, second.rect.width * second.rect.height);
          if (smallestArea > 0 && overlapArea / smallestArea > 0.35) {
            return true;
          }
        }
      }
      return false;
    }

    function detectLowContrast(elements: any[], globalRef: { getComputedStyle: (element: any) => any }): boolean {
      const textElements = elements
        .filter((element) => String(element.innerText || element.value || "").trim().length > 0)
        .slice(0, 80);
      for (const element of textElements) {
        const style = globalRef.getComputedStyle(element);
        const foreground = parseRgb(style.color);
        const background = findBackgroundRgb(element, globalRef);
        const fontSize = Number.parseFloat(style.fontSize || "16");
        if (!foreground || !background) {
          continue;
        }
        const ratio = contrastRatio(foreground, background);
        if (fontSize >= 24 ? ratio < 3 : ratio < 4.5) {
          return true;
        }
      }
      return false;
    }

    function findBackgroundRgb(element: any, globalRef: { getComputedStyle: (element: any) => any }): readonly [number, number, number] | undefined {
      let current = element;
      while (current) {
        const color = globalRef.getComputedStyle(current).backgroundColor;
        const parsed = parseRgb(color);
        if (parsed) {
          return parsed;
        }
        current = current.parentElement;
      }
      return [255, 255, 255];
    }

    function parseRgb(value: string): readonly [number, number, number] | undefined {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
      if (!match) {
        return undefined;
      }
      const alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
      if (alpha === 0) {
        return undefined;
      }
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    }

    function luminance(rgb: readonly [number, number, number]): number {
      const [red, green, blue] = rgb.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
    }

    function contrastRatio(first: readonly [number, number, number], second: readonly [number, number, number]): number {
      const firstLuminance = luminance(first);
      const secondLuminance = luminance(second);
      const lighter = Math.max(firstLuminance, secondLuminance);
      const darker = Math.min(firstLuminance, secondLuminance);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function inferMotionLevel(documentValue: any, elements: any[], globalRef: { getComputedStyle: (element: any) => any }): number {
      const animatedElements = elements.filter((element) => {
        const style = globalRef.getComputedStyle(element);
        return parseCssDuration(style.animationDuration) > 0 || parseCssDuration(style.transitionDuration) > 0;
      }).length;
      const mediaElements = documentValue.querySelectorAll("video,canvas").length;
      return Math.min(10, animatedElements + mediaElements * 2);
    }

    function parseCssDuration(value: string): number {
      return String(value)
        .split(",")
        .map((part) => part.trim())
        .reduce((max, part) => {
          if (part.endsWith("ms")) {
            return Math.max(max, Number.parseFloat(part) / 1000);
          }
          if (part.endsWith("s")) {
            return Math.max(max, Number.parseFloat(part));
          }
          return max;
        }, 0);
    }

    function detectReducedMotionSupport(documentValue: any): boolean {
      const inlineStyles = Array.from(documentValue.querySelectorAll("style"))
        .map((style: any) => String(style.textContent ?? ""))
        .join("\n");
      if (inlineStyles.includes("prefers-reduced-motion")) {
        return true;
      }
      for (const sheet of Array.from(documentValue.styleSheets) as any[]) {
        try {
          const rules = Array.from(sheet.cssRules ?? []) as any[];
          if (rules.some((rule) => String(rule.cssText ?? "").includes("prefers-reduced-motion"))) {
            return true;
          }
        } catch {
          continue;
        }
      }
      return false;
    }

    function detectTemplateSignals(documentValue: any, text: string, repeatedCardCountValue: number): string[] {
      const signals = new Set<string>();
      const markup = String(documentValue.documentElement.outerHTML ?? "").toLowerCase();
      if (repeatedCardCountValue >= 8) {
        signals.add("repeated-equal-card-grid");
      }
      if (markup.includes("bento")) {
        signals.add("bento-grid");
      }
      if (markup.includes("linear-gradient") || markup.includes("radial-gradient")) {
        signals.add("gradient-background");
      }
      if (markup.includes("fake-dashboard") || (markup.includes("dashboard") && text.length < 500)) {
        signals.add("fake-dashboard");
      }
      if (markup.includes("saas") && markup.includes("hero")) {
        signals.add("generic-saas-hero");
      }
      if (markup.includes("neon") || markup.includes("glow")) {
        signals.add("dark-neon-default");
      }
      return [...signals];
    }
  });
}

function sanitizeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "viewport";
}

function assignIfString<T extends Record<string, unknown>>(target: T, key: keyof T, value: unknown): void {
  if (typeof value === "string") {
    target[key] = value as T[keyof T];
  }
}

function parseViewport(value: string): PdosReaderViewport {
  const [name, size] = value.split("=");
  const [width, height] = (size ?? "").split("x").map((part) => Number.parseInt(part, 10));
  if (!name || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`Invalid viewport "${value}". Use name=WIDTHxHEIGHT.`);
  }
  return { name, width: width ?? 0, height: height ?? 0 };
}

function parseArgs(args: readonly string[]): PdosDesignReaderInput {
  const output: {
    url?: string;
    html_file?: string;
    output_dir?: string;
    project_type?: string;
    primary_goal?: string;
    target_users?: readonly string[];
    viewports?: readonly PdosReaderViewport[];
  } = {};
  const viewports: PdosReaderViewport[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (!value) {
      continue;
    }
    if (key === "--url") {
      output.url = value;
      index += 1;
    } else if (key === "--html-file") {
      output.html_file = value;
      index += 1;
    } else if (key === "--output-dir") {
      output.output_dir = value;
      index += 1;
    } else if (key === "--project-type") {
      output.project_type = value;
      index += 1;
    } else if (key === "--primary-goal") {
      output.primary_goal = value;
      index += 1;
    } else if (key === "--target-users") {
      output.target_users = value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
      index += 1;
    } else if (key === "--viewport") {
      viewports.push(parseViewport(value));
      index += 1;
    }
  }
  if (viewports.length > 0) {
    output.viewports = viewports;
  }
  return output;
}

function printUsage(): void {
  console.log(`Usage:
  npm run pdos:reader:capture -- --url https://example.com --output-dir output/playwright/product-design-os
  npm run pdos:reader:capture -- --html-file product-design-os/reader/capture-sample.html --viewport desktop=1440x900 --viewport mobile=390x844`);
}

async function runCli(): Promise<void> {
  const input = parseArgs(process.argv.slice(2));
  if (!input.url && !input.html_file) {
    printUsage();
    return;
  }
  const capture = await captureProductDesignReader(input);
  console.log(formatReaderCapture(capture));
}

function formatReaderCapture(capture: PdosDesignReaderCapture): string {
  return [
    "# Product & Design OS Design Reader Capture",
    "",
    `- URL: ${capture.url}`,
    `- Output directory: ${capture.output_dir}`,
    `- Snapshot: ${capture.snapshot_path ?? "not written"}`,
    `- Viewports: ${capture.viewports.map((viewport) => viewport.name).join(", ")}`,
    `- Visual QA OK: ${String(capture.visual_qa.ok)}`,
    `- Template-risk score: ${capture.visual_qa.template_risk_score}/10`
  ].join("\n");
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (basename(invokedFile) === basename(currentFile) && invokedFile === currentFile) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown Design Reader capture failure.";
    console.error(message);
    process.exit(1);
  });
}
