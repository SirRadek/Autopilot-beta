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
