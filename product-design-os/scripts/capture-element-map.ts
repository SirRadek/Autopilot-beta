import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "@playwright/test";

export interface ElementMapViewportInput {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

export interface ElementMapPoint {
  readonly viewport: string;
  readonly x: number;
  readonly y: number;
}

export interface ElementMapInput {
  readonly url?: string;
  readonly html_file?: string;
  readonly output_dir?: string;
  readonly viewports?: readonly ElementMapViewportInput[];
  readonly xy?: ElementMapPoint;
}

export interface ElementRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ElementSourceRef {
  readonly file: string;
  readonly line?: number;
  readonly col?: number;
  readonly component?: string;
}

export interface ElementStyleDigest {
  readonly display: string;
  readonly position: string;
  readonly visibility: string;
  readonly pointerEvents: string;
  readonly opacity: number;
  readonly zIndex: string;
  readonly color: string;
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly borderWidth: string;
  readonly boxShadow: string;
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly padding: string;
  readonly margin: string;
  readonly gap: string;
  readonly hasPaint: boolean;
}

export type ElementSourceRefValue = ElementSourceRef | "unknown";
export type ElementIdentityConfidence = "high" | "medium" | "low";

export interface ElementPassport {
  readonly id: string;
  readonly siteId: string;
  readonly instanceKey: string;
  readonly parentId: string | null;
  readonly domPath: string;
  readonly role: string;
  readonly accessibleName: string;
  readonly textSnippet: string;
  readonly rect: ElementRect;
  readonly zPath: readonly number[];
  readonly depth: number;
  readonly visible: boolean;
  readonly hitTestable: boolean;
  readonly sourceRef: ElementSourceRefValue;
  readonly styleDigest: ElementStyleDigest;
  readonly stateFlags: readonly string[];
  readonly identityConfidence: ElementIdentityConfidence;
}

export interface ElementMapViewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly screenshot_path: string;
  readonly nodes: readonly ElementPassport[];
}

export interface ElementMap {
  readonly vemVersion: string;
  readonly url: string;
  readonly captured_at: string;
  readonly viewports: readonly ElementMapViewport[];
}

interface RawElementPassport {
  readonly parentDomPath: string | null;
  readonly domPath: string;
  readonly stableHint: string;
  readonly role: string;
  readonly accessibleName: string;
  readonly textSnippet: string;
  readonly rect: ElementRect;
  readonly zPath: readonly number[];
  readonly depth: number;
  readonly visible: boolean;
  readonly hitTestable: boolean;
  readonly sourceRef: ElementSourceRefValue;
  readonly styleDigest: ElementStyleDigest;
  readonly stateFlags: readonly string[];
  readonly identityConfidence: ElementIdentityConfidence;
}

const VEM_VERSION = "vem-mvp-1";
const DEFAULT_OUTPUT_DIR = "output/playwright/product-design-os";

const DEFAULT_VIEWPORTS: readonly ElementMapViewportInput[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 }
];

export async function captureElementMap(input: ElementMapInput): Promise<ElementMap> {
  const targetUrl = resolveTargetUrl(input);
  const outputDir = resolve(input.output_dir ?? DEFAULT_OUTPUT_DIR);
  mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const capturedViewports = await captureViewports(browser, targetUrl, outputDir, input.viewports ?? DEFAULT_VIEWPORTS, input.xy);
    const map: ElementMap = {
      vemVersion: VEM_VERSION,
      url: targetUrl,
      captured_at: new Date().toISOString(),
      viewports: capturedViewports
    };

    writeFileSync(join(outputDir, "element-map.json"), `${JSON.stringify(map, null, 2)}\n`, "utf8");

    return map;
  } finally {
    await browser.close();
  }
}

export function resolvePointToPassport(map: ElementMap, viewport: string, x: number, y: number): ElementPassport | null {
  const targetViewport = map.viewports.find((candidate) => candidate.name === viewport);
  if (!targetViewport) {
    return null;
  }

  const candidates = targetViewport.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.visible && containsPoint(node.rect, x, y))
    .sort((first, second) => compareHitCandidate(first, second));

  const resolved = candidates.find(({ node }) => isResolvableHitNode(node));
  return resolved?.node ?? null;
}

function resolveTargetUrl(input: ElementMapInput): string {
  if (input.url) {
    return input.url;
  }
  if (input.html_file) {
    return pathToFileURL(resolve(input.html_file)).toString();
  }
  throw new Error("Element Map capture requires --url or --html-file.");
}

async function captureViewports(
  browser: Browser,
  url: string,
  outputDir: string,
  viewports: readonly ElementMapViewportInput[],
  point?: ElementMapPoint
): Promise<readonly ElementMapViewport[]> {
  const captured: ElementMapViewport[] = [];

  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: {
        width: viewport.width,
        height: viewport.height
      }
    });

    try {
      await page.goto(url, { waitUntil: "networkidle" });
      await settlePage(page);

      const screenshotPath = join(outputDir, `${sanitizeFilePart(viewport.name)}-element-map.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      if (point?.viewport === viewport.name) {
        await capturePointThumbnail(page, outputDir, viewport, point);
      }

      const rawNodes = await extractRawElementPassports(page);
      captured.push({
        name: viewport.name,
        width: viewport.width,
        height: viewport.height,
        screenshot_path: screenshotPath,
        nodes: materializePassports(rawNodes)
      });
    } finally {
      await page.close();
    }
  }

  return captured;
}

async function settlePage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const documentRef = globalThis.document as Document & { fonts?: { ready?: Promise<unknown> } };
    await documentRef.fonts?.ready;
    await new Promise<void>((resolveFrame) => {
      globalThis.requestAnimationFrame(() => {
        globalThis.requestAnimationFrame(() => resolveFrame());
      });
    });
  });
}

async function capturePointThumbnail(
  page: Page,
  outputDir: string,
  viewport: ElementMapViewportInput,
  point: ElementMapPoint
): Promise<void> {
  const clipX = clamp(point.x - 64, 0, Math.max(0, viewport.width - 1));
  const clipY = clamp(point.y - 64, 0, Math.max(0, viewport.height - 1));
  const width = Math.min(128, viewport.width - clipX);
  const height = Math.min(128, viewport.height - clipY);

  if (width <= 0 || height <= 0) {
    return;
  }

  await page.screenshot({
    path: thumbnailPath(outputDir, point),
    clip: {
      x: clipX,
      y: clipY,
      width,
      height
    }
  });
}

async function extractRawElementPassports(page: Page): Promise<readonly RawElementPassport[]> {
  return page.evaluate(() => {
    const documentRef = globalThis.document;
    const windowRef = globalThis.window;
    const allElements = Array.from(documentRef.querySelectorAll("*")) as HTMLElement[];
    const nodes: RawElementPassport[] = [];
    const viewportWidth = windowRef.innerWidth;
    const viewportHeight = windowRef.innerHeight;
    const scrollX = Math.round(windowRef.scrollX);
    const scrollY = Math.round(windowRef.scrollY);

    for (const element of allElements) {
      const rect = element.getBoundingClientRect();
      const style = globalThis.getComputedStyle(element);
      const visible = isVisibleElement(rect, style, viewportWidth, viewportHeight);
      if (!visible) {
        continue;
      }

      const domPath = buildDomPath(element);
      const parentDomPath = element.parentElement ? buildDomPath(element.parentElement) : null;
      const textSnippet = normalizeText(element.innerText || element.textContent || "", 140);
      const accessibleName = inferAccessibleName(element, textSnippet);
      const role = inferRole(element, accessibleName);
      const sourceRef = inferSourceRef(element);
      const styleDigest = buildStyleDigest(style, element, textSnippet, accessibleName);
      const stateFlags = collectStateFlags(element, style, styleDigest, scrollX, scrollY);
      const stableHint = inferStableHint(element, textSnippet, accessibleName);
      const hitTestable = visible && style.pointerEvents !== "none";

      nodes.push({
        parentDomPath,
        domPath,
        stableHint,
        role,
        accessibleName,
        textSnippet,
        rect: {
          x: roundRectNumber(rect.x),
          y: roundRectNumber(rect.y),
          w: roundRectNumber(rect.width),
          h: roundRectNumber(rect.height)
        },
        zPath: collectZPath(element),
        depth: getDepth(element),
        visible,
        hitTestable,
        sourceRef,
        styleDigest,
        stateFlags,
        identityConfidence: inferIdentityConfidence(sourceRef, stableHint)
      });
    }

    return nodes;

    function isVisibleElement(rect: DOMRect, style: CSSStyleDeclaration, width: number, height: number): boolean {
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < width &&
        rect.top < height &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number.parseFloat(style.opacity || "1") > 0
      );
    }

    function buildDomPath(elementValue: Element): string {
      const parts: string[] = [];
      let current: Element | null = elementValue;
      while (current && current.nodeType === Node.ELEMENT_NODE) {
        const tagName = current.tagName.toLowerCase();
        const idPart = current.id ? `#${escapePathPart(current.id)}` : "";
        if (idPart.length > 0) {
          parts.unshift(`${tagName}${idPart}`);
          current = current.parentElement;
          continue;
        }

        const parent = current.parentElement;
        const siblings = parent
          ? Array.from(parent.children).filter((sibling) => sibling.tagName.toLowerCase() === tagName)
          : [current];
        const position = Math.max(1, siblings.indexOf(current) + 1);
        parts.unshift(`${tagName}:nth-of-type(${position})`);
        current = parent;
      }
      return parts.join(" > ");
    }

    function escapePathPart(value: string): string {
      return value.replace(/[^a-zA-Z0-9_-]/g, "_");
    }

    function normalizeText(value: string, maxLength: number): string {
      const normalized = String(value).replace(/\s+/g, " ").trim();
      return normalized.length > maxLength ? normalized.slice(0, maxLength - 1).trimEnd() : normalized;
    }

    function inferAccessibleName(elementValue: HTMLElement, fallbackText: string): string {
      const ariaLabel = elementValue.getAttribute("aria-label");
      if (ariaLabel && ariaLabel.trim().length > 0) {
        return normalizeText(ariaLabel, 140);
      }

      const labelledBy = elementValue.getAttribute("aria-labelledby");
      if (labelledBy) {
        const labelText = labelledBy
          .split(/\s+/)
          .map((id) => documentRef.getElementById(id)?.textContent ?? "")
          .join(" ");
        const normalized = normalizeText(labelText, 140);
        if (normalized.length > 0) {
          return normalized;
        }
      }

      const alt = elementValue.getAttribute("alt");
      if (alt && alt.trim().length > 0) {
        return normalizeText(alt, 140);
      }

      const title = elementValue.getAttribute("title");
      if (title && title.trim().length > 0) {
        return normalizeText(title, 140);
      }

      const tagName = elementValue.tagName.toLowerCase();
      if (["button", "a", "summary", "label"].includes(tagName)) {
        return fallbackText;
      }

      if (tagName === "input") {
        const input = elementValue as HTMLInputElement;
        const inputLabel = findLabelText(input);
        if (inputLabel.length > 0) {
          return inputLabel;
        }
        return normalizeText(input.value || input.placeholder || input.name || "", 140);
      }

      return "";
    }

    function findLabelText(input: HTMLInputElement): string {
      if (input.labels && input.labels.length > 0) {
        return normalizeText(
          Array.from(input.labels)
            .map((label) => label.textContent ?? "")
            .join(" "),
          140
        );
      }
      return "";
    }

    function inferRole(elementValue: HTMLElement, accessibleNameValue: string): string {
      const explicitRole = elementValue.getAttribute("role");
      if (explicitRole && explicitRole.trim().length > 0) {
        return explicitRole.trim();
      }

      const tagName = elementValue.tagName.toLowerCase();
      if (tagName === "a" && elementValue.hasAttribute("href")) {
        return "link";
      }
      if (tagName === "button") {
        return "button";
      }
      if (tagName === "textarea") {
        return "textbox";
      }
      if (tagName === "select") {
        return "combobox";
      }
      if (tagName === "input") {
        return inferInputRole(elementValue as HTMLInputElement);
      }
      if (tagName === "img") {
        return "img";
      }
      if (/^h[1-6]$/.test(tagName)) {
        return "heading";
      }
      if (tagName === "main") {
        return "main";
      }
      if (tagName === "nav") {
        return "navigation";
      }
      if (tagName === "header") {
        return "banner";
      }
      if (tagName === "footer") {
        return "contentinfo";
      }
      if (tagName === "article") {
        return "article";
      }
      if (tagName === "section" && accessibleNameValue.length > 0) {
        return "region";
      }
      if (["canvas", "svg", "video"].includes(tagName)) {
        return tagName;
      }
      return "generic";
    }

    function inferInputRole(input: HTMLInputElement): string {
      const type = String(input.type || "text").toLowerCase();
      if (type === "checkbox") {
        return "checkbox";
      }
      if (type === "radio") {
        return "radio";
      }
      if (type === "range") {
        return "slider";
      }
      if (["button", "submit", "reset"].includes(type)) {
        return "button";
      }
      if (type === "search") {
        return "searchbox";
      }
      return "textbox";
    }

    function inferSourceRef(elementValue: HTMLElement): ElementSourceRefValue {
      const directFile =
        getFirstAttribute(elementValue, ["data-source-file", "data-src-file", "data-file", "data-source"]) ?? "";
      const location = getFirstAttribute(elementValue, ["data-source-loc", "data-loc", "data-src"]) ?? directFile;
      const parsed = parseSourceLocation(location);
      const file = parsed.file || directFile;
      if (!file) {
        return "unknown";
      }

      const source: { file: string; line?: number; col?: number; component?: string } = {
        file
      };
      const line = parsed.line ?? parseOptionalInteger(getFirstAttribute(elementValue, ["data-source-line", "data-line"]));
      const col =
        parsed.col ?? parseOptionalInteger(getFirstAttribute(elementValue, ["data-source-col", "data-source-column", "data-col"]));
      const component = getFirstAttribute(elementValue, ["data-source-component", "data-component", "data-react-component"]);
      if (line !== undefined) {
        source.line = line;
      }
      if (col !== undefined) {
        source.col = col;
      }
      if (component && component.trim().length > 0) {
        source.component = component.trim();
      }
      return source;
    }

    function getFirstAttribute(elementValue: HTMLElement, names: readonly string[]): string | undefined {
      for (const name of names) {
        const value = elementValue.getAttribute(name);
        if (value && value.trim().length > 0) {
          return value.trim();
        }
      }
      return undefined;
    }

    function parseSourceLocation(value: string): { file: string; line?: number; col?: number } {
      const trimmed = value.trim();
      if (!trimmed) {
        return { file: "" };
      }

      const match = trimmed.match(/^(.+?)(?::(\d+))?(?::(\d+))?$/);
      if (!match) {
        return { file: trimmed };
      }

      const parsed: { file: string; line?: number; col?: number } = {
        file: match[1] ?? trimmed
      };
      const line = parseOptionalInteger(match[2]);
      const col = parseOptionalInteger(match[3]);
      if (line !== undefined) {
        parsed.line = line;
      }
      if (col !== undefined) {
        parsed.col = col;
      }
      return parsed;
    }

    function parseOptionalInteger(value: string | undefined): number | undefined {
      if (!value) {
        return undefined;
      }
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    }

    function buildStyleDigest(
      style: CSSStyleDeclaration,
      elementValue: HTMLElement,
      textSnippetValue: string,
      accessibleNameValue: string
    ): ElementStyleDigest {
      const borderWidth = [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth
      ].join(" ");
      const digest = {
        display: style.display,
        position: style.position,
        visibility: style.visibility,
        pointerEvents: style.pointerEvents,
        opacity: Number.parseFloat(style.opacity || "1"),
        zIndex: style.zIndex,
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderWidth,
        boxShadow: style.boxShadow,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
        margin: `${style.marginTop} ${style.marginRight} ${style.marginBottom} ${style.marginLeft}`,
        gap: style.gap,
        hasPaint: false
      };

      digest.hasPaint = hasPaint(style, elementValue, borderWidth, textSnippetValue, accessibleNameValue);
      return digest;
    }

    function hasPaint(
      style: CSSStyleDeclaration,
      elementValue: HTMLElement,
      borderWidth: string,
      textSnippetValue: string,
      accessibleNameValue: string
    ): boolean {
      if (textSnippetValue.length > 0 || accessibleNameValue.length > 0) {
        return true;
      }
      if (colorHasVisibleAlpha(style.backgroundColor)) {
        return true;
      }
      if (borderWidth.split(/\s+/).some((part) => Number.parseFloat(part) > 0) && colorHasVisibleAlpha(style.borderColor)) {
        return true;
      }
      if (style.boxShadow && style.boxShadow !== "none") {
        return true;
      }
      if (["img", "svg", "canvas", "video", "picture"].includes(elementValue.tagName.toLowerCase())) {
        return true;
      }
      return false;
    }

    function colorHasVisibleAlpha(value: string): boolean {
      const normalized = value.trim().toLowerCase();
      if (!normalized || normalized === "transparent") {
        return false;
      }
      const rgba = normalized.match(/rgba?\(([^)]+)\)/);
      if (!rgba) {
        return true;
      }
      const channels = (rgba[1] ?? "").split(",").map((part) => part.trim());
      if (channels.length < 4) {
        return true;
      }
      return Number.parseFloat(channels[3] ?? "1") > 0;
    }

    function collectStateFlags(
      elementValue: HTMLElement,
      style: CSSStyleDeclaration,
      digest: ElementStyleDigest,
      scrollXValue: number,
      scrollYValue: number
    ): string[] {
      const flags = new Set<string>(["windowed", `scroll=${scrollXValue},${scrollYValue}`]);
      const ariaFlags = ["disabled", "checked", "expanded", "selected", "pressed", "current", "modal"];
      for (const flag of ariaFlags) {
        if (elementValue.getAttribute(`aria-${flag}`) === "true") {
          flags.add(flag);
        }
      }
      if ((elementValue as HTMLButtonElement).disabled) {
        flags.add("disabled");
      }
      if (style.position === "fixed" || style.position === "sticky") {
        flags.add(style.position);
      }
      if (style.pointerEvents === "none") {
        flags.add("pointer-events-none");
      }
      if (!digest.hasPaint && style.pointerEvents !== "none") {
        flags.add("zero-paint-overlay");
      }
      return [...flags];
    }

    function inferStableHint(elementValue: HTMLElement, textSnippetValue: string, accessibleNameValue: string): string {
      return getFirstAttribute(elementValue, ["data-key", "data-testid", "data-test-id", "data-cy", "id"]) ?? (accessibleNameValue || textSnippetValue);
    }

    function inferIdentityConfidence(sourceRefValue: ElementSourceRefValue, stableHintValue: string): ElementIdentityConfidence {
      if (sourceRefValue !== "unknown") {
        return "high";
      }
      if (stableHintValue.length > 0) {
        return "medium";
      }
      return "low";
    }

    function collectZPath(elementValue: HTMLElement): number[] {
      const chain: HTMLElement[] = [];
      let current: HTMLElement | null = elementValue;
      while (current) {
        chain.unshift(current);
        current = current.parentElement;
      }
      return chain.map((item) => parseZIndex(globalThis.getComputedStyle(item).zIndex));
    }

    function parseZIndex(value: string): number {
      if (!value || value === "auto") {
        return 0;
      }
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) ? parsed : 0;
    }

    function getDepth(elementValue: HTMLElement): number {
      let depth = 0;
      let current = elementValue.parentElement;
      while (current) {
        depth += 1;
        current = current.parentElement;
      }
      return depth;
    }

    function roundRectNumber(value: number): number {
      return Math.round(value * 100) / 100;
    }
  });
}

function materializePassports(rawNodes: readonly RawElementPassport[]): readonly ElementPassport[] {
  const idByDomPath = new Map<string, string>();
  for (const node of rawNodes) {
    idByDomPath.set(node.domPath, passportId(node.domPath));
  }

  return rawNodes.map((node) => {
    const siteId = sha1(node.domPath);
    const stableSeed = node.stableHint || node.textSnippet || node.role || node.domPath;
    return {
      id: passportId(node.domPath),
      siteId,
      instanceKey: `${siteId}:${sha1(stableSeed).slice(0, 12)}`,
      parentId: node.parentDomPath ? idByDomPath.get(node.parentDomPath) ?? null : null,
      domPath: node.domPath,
      role: node.role,
      accessibleName: node.accessibleName,
      textSnippet: node.textSnippet,
      rect: node.rect,
      zPath: node.zPath,
      depth: node.depth,
      visible: node.visible,
      hitTestable: node.hitTestable,
      sourceRef: node.sourceRef,
      styleDigest: node.styleDigest,
      stateFlags: node.stateFlags,
      identityConfidence: node.identityConfidence
    };
  });
}

function passportId(domPath: string): string {
  return `vem-${sha1(domPath).slice(0, 12)}`;
}

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function containsPoint(rect: ElementRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function compareHitCandidate(
  first: { readonly node: ElementPassport; readonly index: number },
  second: { readonly node: ElementPassport; readonly index: number }
): number {
  const zComparison = compareZPath(second.node.zPath, first.node.zPath);
  if (zComparison !== 0) {
    return zComparison;
  }
  if (first.node.depth !== second.node.depth) {
    return second.node.depth - first.node.depth;
  }
  return second.index - first.index;
}

function compareZPath(first: readonly number[], second: readonly number[]): number {
  const maxLength = Math.max(first.length, second.length);
  for (let index = 0; index < maxLength; index += 1) {
    const firstValue = first[index] ?? 0;
    const secondValue = second[index] ?? 0;
    if (firstValue !== secondValue) {
      return firstValue - secondValue;
    }
  }
  return 0;
}

function isResolvableHitNode(node: ElementPassport): boolean {
  if (!node.visible) {
    return false;
  }
  if (isZeroPaintPointerOverlay(node)) {
    return false;
  }
  return hasPaintVisible(node) || hasMeaningfulSemantics(node);
}

function isZeroPaintPointerOverlay(node: ElementPassport): boolean {
  return node.hitTestable && !hasPaintVisible(node) && !hasMeaningfulSemantics(node);
}

function hasPaintVisible(node: ElementPassport): boolean {
  return node.styleDigest.opacity > 0 && node.styleDigest.visibility !== "hidden" && node.styleDigest.hasPaint;
}

function hasMeaningfulSemantics(node: ElementPassport): boolean {
  if (node.sourceRef !== "unknown") {
    return true;
  }
  if (node.accessibleName.trim().length > 0 || node.textSnippet.trim().length > 0) {
    return true;
  }
  return !["generic", "presentation", "none"].includes(node.role);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "viewport";
}

function thumbnailPath(outputDir: string, point: ElementMapPoint): string {
  return join(outputDir, `${sanitizeFilePart(point.viewport)}-${Math.round(point.x)}-${Math.round(point.y)}-thumb.png`);
}

function formatSourceRef(sourceRef: ElementSourceRefValue): string {
  if (sourceRef === "unknown") {
    return "unknown";
  }
  const position = sourceRef.line ? `:${sourceRef.line}${sourceRef.col ? `:${sourceRef.col}` : ""}` : "";
  const component = sourceRef.component ? `#${sourceRef.component}` : "";
  return `${sourceRef.file}${position}${component}`;
}

function parseArgs(args: readonly string[]): ElementMapInput {
  const output: {
    url?: string;
    html_file?: string;
    output_dir?: string;
    xy?: ElementMapPoint;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--url") {
      const value = args[index + 1];
      if (value) {
        output.url = value;
        index += 1;
      }
    } else if (key === "--html-file") {
      const value = args[index + 1];
      if (value) {
        output.html_file = value;
        index += 1;
      }
    } else if (key === "--output-dir") {
      const value = args[index + 1];
      if (value) {
        output.output_dir = value;
        index += 1;
      }
    } else if (key === "--xy") {
      const viewport = args[index + 1];
      const x = Number.parseFloat(args[index + 2] ?? "");
      const y = Number.parseFloat(args[index + 3] ?? "");
      if (!viewport || !Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("Invalid --xy. Use --xy <viewport> <x> <y>.");
      }
      output.xy = { viewport, x, y };
      index += 3;
    }
  }

  return output;
}

function printUsage(): void {
  console.log(`Usage:
  npm run pdos:reader:element-map -- --url https://example.com --output-dir output/playwright/product-design-os
  npm run pdos:reader:element-map -- --html-file product-design-os/reader/capture-sample.html --xy desktop 120 240`);
}

function formatCaptureSummary(map: ElementMap): string {
  const nodeCount = map.viewports.reduce((total, viewport) => total + viewport.nodes.length, 0);
  const realSourceCount = map.viewports.reduce(
    (total, viewport) => total + viewport.nodes.filter((node) => node.sourceRef !== "unknown").length,
    0
  );
  return [
    "# Product & Design OS Element Map Capture",
    "",
    `- URL: ${map.url}`,
    `- VEM version: ${map.vemVersion}`,
    `- Viewports: ${map.viewports.map((viewport) => viewport.name).join(", ")}`,
    `- Nodes: ${nodeCount}`,
    `- SourceRef coverage: ${realSourceCount} real / ${nodeCount - realSourceCount} unknown`
  ].join("\n");
}

function buildPointEchoPayload(map: ElementMap, outputDir: string, point: ElementMapPoint): Record<string, unknown> {
  const passport = resolvePointToPassport(map, point.viewport, point.x, point.y);
  if (!passport) {
    return {
      viewport: point.viewport,
      x: point.x,
      y: point.y,
      thumbnail_crop_path: thumbnailPath(outputDir, point),
      resolved: null
    };
  }

  const name = passport.accessibleName || passport.textSnippet || "";
  return {
    viewport: point.viewport,
    x: point.x,
    y: point.y,
    thumbnail_crop_path: thumbnailPath(outputDir, point),
    role_name: `${passport.role}:${name}`,
    id: passport.id,
    source_ref: formatSourceRef(passport.sourceRef),
    passport
  };
}

async function runCli(): Promise<void> {
  const input = parseArgs(process.argv.slice(2));
  if (!input.url && !input.html_file) {
    printUsage();
    return;
  }

  const map = await captureElementMap(input);
  if (input.xy) {
    const outputDir = resolve(input.output_dir ?? DEFAULT_OUTPUT_DIR);
    console.log(JSON.stringify(buildPointEchoPayload(map, outputDir, input.xy), null, 2));
    return;
  }

  console.log(formatCaptureSummary(map));
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (basename(invokedFile) === basename(currentFile) && invokedFile === currentFile) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown Element Map capture failure.";
    console.error(message);
    process.exit(1);
  });
}
