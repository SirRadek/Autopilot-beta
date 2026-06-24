import { isSafeHref } from "../safe-url";
import type { PatternRenderInput, ResolvedPatternReference, ResolvedSlotTarget } from "../types";
import { escapeAttribute, escapeHtml } from "./sharp-positioning-hero";

export interface OutcomeCtaContractIssue {
  readonly code: string;
  readonly prop?: string;
  readonly message: string;
}

interface ValidOutcomeCtaProps {
  readonly outcome_statement: string;
  readonly cta_label: string;
  readonly cta_href: string;
}

export class OutcomeCtaContractError extends Error {
  readonly issues: readonly OutcomeCtaContractIssue[];

  constructor(issues: readonly OutcomeCtaContractIssue[]) {
    super(`outcome-cta contract failed: ${issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
    this.name = "OutcomeCtaContractError";
    this.issues = issues;
  }
}

export const outcomeCtaCss = `
.outcome-cta {
  container-type: inline-size;
  position: relative;
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-background);
}

.outcome-cta,
.outcome-cta * {
  box-sizing: border-box;
}

.outcome-cta::before {
  content: "";
  position: absolute;
  inset: var(--space-4);
  border: var(--style-decoration-border-width) solid var(--color-border);
  border-radius: var(--style-corner-radius);
  background: var(--style-surface-background);
}

.outcome-cta__inner {
  position: relative;
  z-index: 1;
  width: min(100%, 1180px);
  margin-inline: auto;
  padding: clamp(var(--space-8), 8cqi, calc(var(--space-8) * 2)) var(--space-6);
}

.outcome-cta__copy {
  display: grid;
  grid-template-columns: minmax(2.75rem, 0.12fr) minmax(0, 1fr) auto;
  gap: clamp(var(--space-4), 4cqi, var(--space-8));
  align-items: center;
}

.outcome-cta__proof-context {
  min-width: 44px;
  min-height: 44px;
  height: 100%;
  align-self: stretch;
  border-radius: var(--style-corner-radius);
  background:
    linear-gradient(
      180deg,
      var(--color-accent-secondary) 0%,
      color-mix(in srgb, var(--color-accent-secondary) 42%, var(--color-accent-soft)) 100%
    );
  opacity: var(--style-decoration-opacity);
  transform: skewY(var(--style-accent-angle-deg));
  transform-origin: center;
}

.outcome-cta h2 {
  margin: 0;
  max-width: 16ch;
  color: var(--color-text);
  font-family: var(--type-font-heading);
  font-size: clamp(2.35rem, 7cqi, 5.5rem);
  line-height: 0.94;
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
  text-transform: var(--style-heading-transform);
}

.outcome-cta .cta {
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4) var(--space-6);
  border: 1px solid var(--color-accent);
  border-radius: var(--style-corner-radius);
  color: var(--color-accent-text);
  background: var(--color-accent);
  font-family: var(--type-font-body);
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-bold);
  line-height: 1;
  text-decoration: none;
  box-shadow: var(--shadow-md);
  transition:
    transform var(--motion-duration-fast) var(--motion-easing-standard),
    box-shadow var(--motion-duration-fast) var(--motion-easing-standard);
}

.outcome-cta .cta:hover {
  transform: translateY(-1px);
  border-color: var(--color-accent-secondary);
  background: var(--color-accent-secondary);
}

.outcome-cta .cta:focus-visible {
  outline: 3px solid var(--color-focus-ring);
  outline-offset: 3px;
}

@media (max-width: 760px) {
  .outcome-cta::before {
    inset: var(--space-3);
  }

  .outcome-cta__inner {
    padding: var(--space-8) var(--space-4);
  }

  .outcome-cta__copy {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .outcome-cta__proof-context {
    height: 0.5rem;
    min-height: 0.5rem;
  }

  .outcome-cta h2 {
    max-width: 12ch;
    font-size: clamp(2rem, 14cqi, 3.35rem);
  }

  .outcome-cta .cta {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .outcome-cta .cta {
    transition: none;
  }

  .outcome-cta .cta:hover {
    transform: none;
  }
}
`.trim();

export function renderOutcomeCta(input: PatternRenderInput): string {
  const issues = validateOutcomeCtaInput(input);
  if (issues.length > 0) {
    throw new OutcomeCtaContractError(issues);
  }

  const props = normalizeProps(input.props);
  const proofContext = firstPattern(input.slots.proof_context);

  return `
<section class="outcome-cta" data-pattern-id="outcome-cta" data-contract-id="${escapeAttribute(input.contract.id)}" data-proof-context-id="${escapeAttribute(proofContext?.id ?? "")}" aria-labelledby="outcome-cta-title">
  <div class="outcome-cta__inner">
    <div class="outcome-cta__copy">
      <div class="outcome-cta__proof-context" data-contract-slot="proof_context" data-slot-target-kind="pattern" data-slot-target-id="${escapeAttribute(proofContext?.id ?? "")}" aria-label="${escapeAttribute(props.outcome_statement)}"></div>
      <h2 id="outcome-cta-title" data-contract-prop="outcome_statement">${escapeHtml(props.outcome_statement)}</h2>
      <a class="cta" data-contract-prop="cta_label" href="${escapeAttribute(props.cta_href)}">${escapeHtml(props.cta_label)}</a>
    </div>
  </div>
</section>`.trim();
}

function validateOutcomeCtaInput(input: PatternRenderInput): OutcomeCtaContractIssue[] {
  const issues: OutcomeCtaContractIssue[] = [];

  if (input.contract.target_kind !== "pattern" || input.contract.target_id !== "outcome-cta") {
    issues.push({
      code: "contract_mismatch",
      message: `Expected pattern contract for outcome-cta, received ${input.contract.target_kind}:${input.contract.target_id}.`
    });
  }

  validateRequiredTextProp(input, "outcome_statement", "proof_adjacency", issues);
  validateRequiredTextProp(input, "cta_label", "dom_text_cta", issues);
  validateCtaHref(input, issues);
  validateRequiredPatternSlot(input, "proof_context", issues);

  return issues;
}

function validateRequiredTextProp(
  input: PatternRenderInput,
  propName: string,
  invariantCode: string,
  issues: OutcomeCtaContractIssue[]
): void {
  const contractProp = input.contract.props.find((prop) => prop.name === propName);
  const minLength = contractProp?.min_length ?? 1;
  const rawValue = input.props[propName];
  const value = typeof rawValue === "string" ? rawValue.trim() : "";

  if (contractProp?.required === true && value.length === 0) {
    issues.push({
      code: invariantCode,
      prop: propName,
      message: `${propName} is required by ${input.contract.id}.`
    });
    return;
  }

  if (value.length < minLength) {
    issues.push({
      code: invariantCode,
      prop: propName,
      message: `${propName} must be at least ${minLength} characters.`
    });
  }
}

function validateCtaHref(input: PatternRenderInput, issues: OutcomeCtaContractIssue[]): void {
  const rawHref = input.props.cta_href;
  if (rawHref === undefined || rawHref.trim().length === 0) {
    return;
  }

  if (!isSafeHref(rawHref)) {
    issues.push({
      code: "unsafe_href",
      prop: "cta_href",
      message: "cta_href must use #, /, ./, ../, http(s), mailto, or tel."
    });
  }
}

function validateRequiredPatternSlot(
  input: PatternRenderInput,
  slotName: string,
  issues: OutcomeCtaContractIssue[]
): void {
  const contractSlot = input.contract.slots.find((slot) => slot.name === slotName);
  const slotTargets = input.slots[slotName] ?? [];
  const patternTargets = slotTargets.filter(
    (slotTarget): slotTarget is ResolvedPatternReference => slotTarget.targetKind === "pattern"
  );

  if (contractSlot?.required === true && slotTargets.length === 0) {
    issues.push({
      code: "slot_missing",
      message: `${slotName} must be filled by ${input.contract.id}.`
    });
    return;
  }

  const minItems = contractSlot?.min_items;
  if (minItems !== undefined && slotTargets.length < minItems) {
    issues.push({
      code: "slot_missing",
      message: `${slotName} must include at least ${minItems} pattern(s).`
    });
  }

  const maxItems = contractSlot?.max_items;
  if (maxItems !== undefined && slotTargets.length > maxItems) {
    issues.push({
      code: "slot_overfilled",
      message: `${slotName} must include no more than ${maxItems} pattern(s).`
    });
  }

  for (const slotTarget of slotTargets) {
    if (slotTarget.targetKind !== "pattern") {
      issues.push({
        code: "slot_target_kind_mismatch",
        message: `${slotName} accepts patterns, received ${slotTarget.targetKind} ${slotTarget.id}.`
      });
    }
  }

  const allowedIds = new Set(contractSlot?.allowed_pattern_ids ?? []);
  if (allowedIds.size > 0) {
    for (const patternTarget of patternTargets) {
      if (!allowedIds.has(patternTarget.id)) {
        issues.push({
          code: "slot_pattern_not_allowed",
          message: `${slotName} does not accept pattern ${patternTarget.id}.`
        });
      }
    }
  }
}

function normalizeProps(props: PatternRenderInput["props"]): ValidOutcomeCtaProps {
  const href = props.cta_href?.trim() || "#request";
  return {
    outcome_statement: props.outcome_statement?.trim() ?? "",
    cta_label: props.cta_label?.trim() ?? "",
    cta_href: href
  };
}

function firstPattern(slotTargets: readonly ResolvedSlotTarget[] | undefined): ResolvedPatternReference | undefined {
  return slotTargets?.find((slotTarget): slotTarget is ResolvedPatternReference => slotTarget.targetKind === "pattern");
}
