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

  if (hasInvariant(contract, "visible_h1")) {
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
  }

  if (hasInvariant(contract, "dom_text_cta")) {
    const ctaPropNames = contractPropNames(contract, ["primary_cta", "cta_label"]);
    const ctaMinLength = minLengthForFirstProp(contract, ctaPropNames, 1);
    const ctaAnchors = root
      .querySelectorAll("a")
      .filter(isVisibleElement)
      .filter((element) => element.classList.contains("cta") || ctaPropNames.includes(element.getAttribute("data-contract-prop") ?? ""))
      .filter((element) => normalizeText(element.text).length >= ctaMinLength)
      .filter((element) => {
        const href = element.getAttribute("href");
        return href !== undefined && isSafeHref(href);
      });

    if (ctaAnchors.length === 0) {
      pushIssue("dom_text_cta", "error", `Expected a visible DOM-text CTA anchor with safe href and at least ${ctaMinLength} characters.`);
    }
  }

  if (hasInvariant(contract, "proof_adjacency")) {
    const patternRoots = root
      .querySelectorAll("[data-pattern-id]")
      .filter((element) => element.getAttribute("data-pattern-id") === contract.target_id);
    const requiresOutcomeStatement = contract.props.some((prop) => prop.name === "outcome_statement");
    const outcomeMinLength = minLengthForProp(contract, "outcome_statement", 1);
    const outcomeNodes = root
      .querySelectorAll("[data-contract-prop]")
      .filter((element) => element.getAttribute("data-contract-prop") === "outcome_statement")
      .filter(isVisibleElement)
      .filter((element) => patternRoots.length === 0 || isDescendantOfAny(element, patternRoots))
      .filter((element) => normalizeText(element.text).length >= outcomeMinLength);
    const proofNodes = proofAdjacencyNodes(root, contract, patternRoots);

    if (requiresOutcomeStatement && outcomeNodes.length === 0) {
      pushIssue(
        "proof_adjacency",
        "warning",
        `Expected a visible outcome_statement node with at least ${outcomeMinLength} characters.`
      );
    }

    if (proofNodes.length === 0) {
      pushIssue("proof_adjacency", "warning", "Expected a visible proof/source node adjacent to the outcome.");
    } else if (outcomeNodes.length > 0 && !proofNodes.some((proofNode) => outcomeNodes.some((outcomeNode) => areAdjacentElements(proofNode, outcomeNode)))) {
      pushIssue("proof_adjacency", "warning", "Expected the proof/source node to be adjacent to the outcome statement.");
    }
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

function hasInvariant(contract: ComponentContract, code: string): boolean {
  return contract.output_invariants.some((invariant) => invariant.code === code);
}

function contractPropNames(contract: ComponentContract, candidates: readonly string[]): readonly string[] {
  const names = candidates.filter((candidate) => contract.props.some((prop) => prop.name === candidate));
  return names.length > 0 ? names : candidates;
}

function minLengthForFirstProp(contract: ComponentContract, propNames: readonly string[], fallback: number): number {
  const propName = propNames.find((candidate) => contract.props.some((prop) => prop.name === candidate));
  return propName === undefined ? fallback : minLengthForProp(contract, propName, fallback);
}

function proofAdjacencyNodes(root: HTMLElement, contract: ComponentContract, patternRoots: readonly HTMLElement[]): readonly HTMLElement[] {
  const proofPropNames = contractPropNames(contract, ["trust_cue", "proof_item", "source_reference"]);
  const proofSlotNames: readonly string[] = contract.slots
    .map((slot) => slot.name)
    .filter((slotName) => slotName === "proof_context" || slotName === "proof_asset");

  const propNodes = root
    .querySelectorAll("[data-contract-prop]")
    .filter((element) => proofPropNames.includes(element.getAttribute("data-contract-prop") ?? ""))
    .filter(isVisibleElement)
    .filter((element) => {
      const propName = element.getAttribute("data-contract-prop");
      return propName !== undefined && normalizeText(element.text).length >= minLengthForProp(contract, propName, 1);
    });

  const slotNodes = root
    .querySelectorAll("[data-contract-slot]")
    .filter((element) => proofSlotNames.includes(element.getAttribute("data-contract-slot") ?? ""))
    .filter(isVisibleElement)
    .filter((element) => hasVisibleProofSlotContent(element, contract));

  return [...propNodes, ...slotNodes].filter((element) => patternRoots.length === 0 || isDescendantOfAny(element, patternRoots));
}

function hasVisibleProofSlotContent(element: HTMLElement, contract: ComponentContract): boolean {
  const slotName = element.getAttribute("data-contract-slot");
  const nestedProofProps = element
    .querySelectorAll("[data-contract-prop]")
    .filter(isVisibleElement)
    .filter((candidate) => {
      const propName = candidate.getAttribute("data-contract-prop");
      if (propName === undefined || !["proof_item", "source_reference"].includes(propName)) {
        return false;
      }

      return normalizeText(candidate.text).length >= minLengthForProp(contract, propName, 1);
    });

  if (nestedProofProps.length > 0) {
    return true;
  }

  return slotName === "proof_asset" && hasResolvedProofAsset(element);
}

function hasResolvedProofAsset(element: HTMLElement): boolean {
  const assetId = element.getAttribute("data-asset-id")?.trim() ?? "";
  const assetSource = element.getAttribute("data-asset-source")?.trim() ?? "";
  if (assetId.length === 0 || assetSource.length === 0) {
    return false;
  }

  return element.querySelector("img,svg") !== null;
}

function areAdjacentElements(left: HTMLElement, right: HTMLElement): boolean {
  if (left === right) {
    return true;
  }

  const leftParent = left.parentNode as HTMLElement | null | undefined;
  const rightParent = right.parentNode as HTMLElement | null | undefined;
  if (leftParent == null || rightParent == null || leftParent !== rightParent) {
    return false;
  }

  const siblings = childElements(leftParent);
  const leftIndex = siblings.indexOf(left);
  const rightIndex = siblings.indexOf(right);

  return leftIndex !== -1 && rightIndex !== -1 && Math.abs(leftIndex - rightIndex) === 1;
}

function childElements(element: HTMLElement): readonly HTMLElement[] {
  return element.childNodes.filter(isHtmlElementNode);
}

function isHtmlElementNode(value: unknown): value is HTMLElement {
  return typeof value === "object" && value !== null && "tagName" in value && "getAttribute" in value;
}
