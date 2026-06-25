import { parse, type HTMLElement } from "node-html-parser";

import { isSafeHref } from "./safe-url";
import type { ComponentContract } from "./types";

export interface RenderContractIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface RenderContractReport {
  readonly errors: readonly RenderContractIssue[];
  readonly warnings: readonly RenderContractIssue[];
}

export function checkRenderedContract(html: string, contract: ComponentContract): RenderContractReport {
  const errors: RenderContractIssue[] = [];
  const warnings: RenderContractIssue[] = [];
  const root = parseContractDom(html);
  const pushIssue = (code: string, fallbackSeverity: "error" | "warning", message: string): void => {
    const severity = contract.output_invariants.find((invariant) => invariant.code === code)?.severity ?? fallbackSeverity;
    const issue = { code, severity, message };
    if (severity === "error") {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
  };

  const visibleH1s = root.querySelectorAll("h1").filter(isVisibleElement);
  const headlineMinLength = minLengthForProp(contract, "headline", 1);

  if (visibleH1s.length !== 1) {
    pushIssue("visible_h1", "error", `Expected exactly one visible h1, found ${visibleH1s.length}.`);
  } else {
    const visibleH1 = visibleH1s[0];
    if (visibleH1 === undefined) {
      pushIssue("visible_h1", "error", "Expected one visible h1 but none was readable.");
      return { errors, warnings };
    }

    const headlineText = normalizeText(visibleH1.text);
    if (headlineText.length < headlineMinLength) {
      pushIssue("visible_h1", "error", `Visible h1 text must be at least ${headlineMinLength} characters.`);
    }
  }

  const ctaMinLength = minLengthForProp(contract, "primary_cta", 1);
  const ctaAnchors = root
    .querySelectorAll("a")
    .filter(isVisibleElement)
    .filter((element) => element.classList.contains("cta") || element.getAttribute("data-contract-prop") === "primary_cta")
    .filter((element) => normalizeText(element.text).length >= ctaMinLength)
    .filter((element) => {
      const href = element.getAttribute("href");
      return href !== undefined && isSafeHref(href);
    });

  if (ctaAnchors.length === 0) {
    pushIssue("dom_text_cta", "error", `Expected a visible DOM-text CTA anchor with safe href and at least ${ctaMinLength} characters.`);
  }

  const trustCueMinLength = minLengthForProp(contract, "trust_cue", 1);
  const heroRoots = root
    .querySelectorAll("[data-pattern-id]")
    .filter((element) => element.getAttribute("data-pattern-id") === contract.target_id);
  const trustCueNodes = root
    .querySelectorAll("[data-contract-prop]")
    .filter((element) => element.getAttribute("data-contract-prop") === "trust_cue")
    .filter(isVisibleElement)
    .filter((element) => normalizeText(element.text).length >= trustCueMinLength)
    .filter((element) => heroRoots.length === 0 || isDescendantOfAny(element, heroRoots));

  if (trustCueNodes.length === 0) {
    pushIssue("proof_adjacency", "warning", `Expected nearby trust cue text with at least ${trustCueMinLength} characters.`);
  }

  checkCanvasTextDomTwin(root, pushIssue);
  checkNoStoredFrames(root, html, pushIssue);
  checkReducedMotionFallback(root, html, pushIssue);

  return { errors, warnings };
}

type PushIssue = (code: string, fallbackSeverity: "error" | "warning", message: string) => void;

/**
 * Self-scoping dot-stage guard. Display words drawn on canvas are marked with
 * [data-dot-word]; each must have a matching [data-dot-twin] DOM node carrying
 * identical text so crawlers and screen readers still read the word. Only fires
 * when [data-dot-word] markers are present, so non-dot patterns are unaffected.
 */
function checkCanvasTextDomTwin(root: HTMLElement, pushIssue: PushIssue): void {
  const dotWordNodes = root.querySelectorAll("[data-dot-word]");
  if (dotWordNodes.length === 0) {
    return;
  }

  const twinTextsByWord = new Map<string, string[]>();
  // Only visible twins count — a hidden/aria-hidden twin is not readable by assistive tech.
  for (const twin of root.querySelectorAll("[data-dot-twin]").filter(isVisibleElement)) {
    const key = normalizeText(twin.getAttribute("data-dot-twin") ?? "");
    const texts = twinTextsByWord.get(key) ?? [];
    texts.push(normalizeText(twin.text));
    twinTextsByWord.set(key, texts);
  }

  for (const wordNode of dotWordNodes) {
    const word = normalizeText(wordNode.getAttribute("data-dot-word") ?? "");
    const twinTexts = twinTextsByWord.get(word) ?? [];
    if (word.length === 0 || !twinTexts.includes(word)) {
      pushIssue(
        "canvas_text_dom_twin",
        "error",
        `Dot-built display word "${word}" must have a matching DOM twin: [data-dot-twin="${word}"] with identical text.`
      );
    }
  }
}

/**
 * Self-scoping procedural-only guard. A [data-dot-stage] canvas promises a
 * procedural engine, so the output must ship no stored frames (img/video/
 * picture/source elements or data: URIs). Scans the raw HTML so frames hidden
 * inside <script>/<style> (stripped before parsing) are still caught.
 */
function checkNoStoredFrames(root: HTMLElement, rawHtml: string, pushIssue: PushIssue): void {
  if (root.querySelectorAll("[data-dot-stage]").length === 0) {
    return;
  }

  const hasFrameElement =
    /<(?:img|video|picture|source|object|embed|image|use)\b/i.test(rawHtml) ||
    /<input\b[^>]*\btype\s*=\s*["']?\s*image/i.test(rawHtml);
  const hasDataUri =
    /(?:src|href|xlink:href|content|srcset|data)\s*=\s*["']?\s*data:/i.test(rawHtml) ||
    /(?:url|image-set)\(\s*['"]?\s*data:/i.test(rawHtml);

  if (hasFrameElement || hasDataUri) {
    pushIssue(
      "no_stored_frames",
      "error",
      "Procedural dot-stage must not embed stored frames (img/video/picture/source/object/embed/svg image/use/input[type=image] elements or data: URIs)."
    );
  }
}

/**
 * Self-scoping reduced-motion guard. A [data-dot-stage] canvas animates, so the
 * output must reference a prefers-reduced-motion guard (in the engine script and/or
 * CSS). Scans the raw HTML because the engine's matchMedia guard lives in a <script>
 * that is stripped before parsing. This proves the guard EXISTS, not its runtime
 * behaviour — behaviour is covered by the buildability-floor visual-qa probe.
 */
function checkReducedMotionFallback(root: HTMLElement, rawHtml: string, pushIssue: PushIssue): void {
  if (root.querySelectorAll("[data-dot-stage]").length === 0) {
    return;
  }

  if (!/prefers-reduced-motion/i.test(rawHtml)) {
    pushIssue(
      "reduced_motion_fallback",
      "error",
      "Procedural dot-stage must guard its animation with a prefers-reduced-motion check (none found in script or CSS)."
    );
  }
}

function parseContractDom(html: string): HTMLElement {
  return parse(stripNonContractHtml(html), {
    comment: false,
    lowerCaseTagName: true,
    blockTextElements: {
      script: true,
      style: true
    }
  });
}

function stripNonContractHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

function isVisibleElement(element: HTMLElement): boolean {
  let current: HTMLElement | null | undefined = element;
  while (current != null) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden")?.toLowerCase() === "true") {
      return false;
    }

    const style = current.getAttribute("style")?.toLowerCase() ?? "";
    if (/(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style)) {
      return false;
    }

    const parent = current.parentNode as HTMLElement | null | undefined;
    if (parent == null || parent === current) {
      break;
    }
    current = parent;
  }

  return true;
}

function isDescendantOfAny(element: HTMLElement, ancestors: readonly HTMLElement[]): boolean {
  let current: HTMLElement | undefined = element;
  while (current !== undefined) {
    if (ancestors.includes(current)) {
      return true;
    }

    const parent = current.parentNode as HTMLElement | undefined;
    if (parent === undefined || parent === current) {
      break;
    }
    current = parent;
  }

  return false;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function minLengthForProp(contract: ComponentContract, propName: string, fallback: number): number {
  return contract.props.find((prop) => prop.name === propName)?.min_length ?? fallback;
}
