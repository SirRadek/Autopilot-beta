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
    const outcomeNodes = root
      .querySelectorAll("[data-contract-prop]")
      .filter((element) => element.getAttribute("data-contract-prop") === "outcome_statement")
      .filter(isVisibleElement)
      .filter((element) => patternRoots.length === 0 || isDescendantOfAny(element, patternRoots));
    const proofNodes = proofAdjacencyNodes(root, contract, patternRoots);

    if (proofNodes.length === 0) {
      pushIssue("proof_adjacency", "warning", "Expected a visible proof/source node adjacent to the outcome.");
    } else if (outcomeNodes.length > 0 && !proofNodes.some((proofNode) => outcomeNodes.some((outcomeNode) => areAdjacentElements(proofNode, outcomeNode)))) {
      pushIssue("proof_adjacency", "warning", "Expected the proof/source node to be adjacent to the outcome statement.");
    }
  }

  return { errors, warnings };
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
    .filter(isVisibleElement);

  return [...propNodes, ...slotNodes].filter((element) => patternRoots.length === 0 || isDescendantOfAny(element, patternRoots));
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
