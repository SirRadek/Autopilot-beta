import { isSafeHref } from "../safe-url";
import type { PatternRenderInput, ResolvedPatternReference, ResolvedSlotTarget } from "../types";
import { ctaClassName, escapeAttribute, escapeHtml, normalizeCtaVariant } from "./sharp-positioning-hero";

export interface OutcomeCtaContractIssue {
  readonly code: string;
  readonly prop?: string;
  readonly message: string;
}

interface ValidOutcomeCtaProps {
  readonly outcome_statement: string;
  readonly cta_label: string;
  readonly cta_href: string;
  readonly cta_variant: "primary" | "secondary";
  readonly contact_heading: string;
  readonly contact_phone: string;
  readonly contact_phone_href: string;
  readonly contact_email: string;
  readonly contact_note: string;
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
  background: transparent;
}

.outcome-cta__inner {
  position: relative;
  z-index: 1;
  width: min(100%, var(--pdos-page-container-max));
  margin-inline: auto;
  padding: var(--pdos-page-section-padding-block) var(--pdos-page-gutter);
  display: grid;
  gap: var(--space-6);
}

/* 2-column: proof testimonial spans the left, the heading sits directly above the CTA on
   the right so they read as one conversion unit. DOM stays flat (proof, h2, cta siblings)
   so the proof_adjacency render-contract holds; placement is via grid areas only. */
.outcome-cta__copy {
  display: grid;
  grid-template-columns: minmax(min(100%, 18rem), 0.4fr) minmax(0, 1fr);
  grid-template-areas:
    "proof heading"
    "proof cta";
  gap: var(--space-5) var(--pdos-page-section-gap);
  align-content: center;
}

.outcome-cta__copy > h2 {
  grid-area: heading;
  align-self: end;
}

.outcome-cta__copy > .cta {
  grid-area: cta;
  align-self: start;
  justify-self: start;
}

.outcome-cta__proof-context {
  grid-area: proof;
  min-width: 44px;
  min-height: 44px;
  align-self: center;
  display: grid;
  gap: var(--space-2);
  padding: var(--space-4);
  border-inline-start: var(--style-decoration-border-width) solid var(--color-accent-secondary);
  border-radius: var(--style-corner-radius);
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-surface) 78%, var(--color-background));
  box-shadow: var(--shadow-sm);
}

.outcome-cta__proof-source,
.outcome-cta__proof-text {
  margin: 0;
}

.outcome-cta__proof-source {
  width: fit-content;
  color: var(--color-muted-text);
  font-family: var(--type-font-body);
  font-size: var(--pdos-type-kicker);
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
}

.outcome-cta__proof-text {
  max-width: min(100%, 62ch);
  justify-self: start;
  color: var(--color-text);
  font-family: var(--type-font-body);
  font-size: var(--pdos-type-body);
  line-height: var(--type-line-height-body);
}

.outcome-cta h2 {
  margin: 0;
  max-width: min(100%, 24ch);
  color: var(--color-text);
  font-family: var(--type-font-heading);
  font-size: clamp(1.8rem, 3.4cqi, 3rem);
  line-height: 1.08;
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
  text-transform: var(--style-heading-transform);
}

.outcome-cta__contact {
  width: min(100%, 28rem);
  display: grid;
  gap: var(--space-4);
  color: var(--color-text);
}

.outcome-cta__contact-heading,
.outcome-cta__contact-note {
  margin: 0;
  font-family: var(--type-font-body);
  line-height: var(--type-line-height-body);
}

.outcome-cta__contact-heading {
  color: var(--color-text);
  font-size: clamp(1rem, 1.2cqi, 1.08rem);
  font-weight: var(--type-weight-bold);
}

.outcome-cta__phone {
  width: fit-content;
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  color: var(--color-accent);
  font-family: var(--type-font-heading);
  font-size: clamp(1.4rem, 3cqi, 2.4rem);
  font-weight: var(--type-weight-bold);
  line-height: 1.1;
  letter-spacing: 0;
  text-decoration-thickness: max(0.08em, 1px);
  text-underline-offset: 0.16em;
}

.outcome-cta__phone:hover {
  color: color-mix(in srgb, var(--color-accent) 82%, var(--color-text));
}

.outcome-cta__contact-note {
  max-width: min(100%, 58ch);
  color: var(--color-muted-text);
  font-size: var(--pdos-type-body);
}

.outcome-cta__form {
  width: min(100%, 28rem);
  display: grid;
  gap: var(--space-3);
}

.outcome-cta__form label {
  display: grid;
  gap: var(--space-2);
  color: var(--color-text);
  font-family: var(--type-font-body);
  font-size: clamp(1rem, 1.2cqi, 1.08rem);
  font-weight: var(--type-weight-bold);
  line-height: var(--type-line-height-body);
}

.outcome-cta__form input,
.outcome-cta__form textarea {
  width: 100%;
  min-height: 44px;
  border: var(--style-decoration-border-width) solid var(--color-border);
  border-radius: var(--style-corner-radius);
  padding: var(--space-3) var(--space-4);
  color: var(--color-text);
  background: var(--color-surface);
  font: inherit;
  font-size: clamp(1rem, 1.2cqi, 1.08rem);
  line-height: var(--type-line-height-body);
}

.outcome-cta__form textarea {
  min-height: 8rem;
  resize: vertical;
}

.outcome-cta__form input:focus-visible,
.outcome-cta__form textarea:focus-visible {
  outline: 3px solid var(--color-focus-ring);
  outline-offset: 3px;
  border-color: var(--color-accent);
}

.outcome-cta__form button.cta {
  width: fit-content;
  min-height: 44px;
  border: 0;
  cursor: pointer;
  font-size: clamp(1rem, 1.2cqi, 1.08rem);
}

@media (max-width: 960px) {
  .outcome-cta__copy {
    grid-template-columns: 1fr;
    grid-template-areas:
      "proof"
      "heading"
      "cta";
    align-items: stretch;
  }

  .outcome-cta__proof-context {
    min-height: 44px;
  }

  .outcome-cta__copy > .cta {
    justify-self: stretch;
  }

  .outcome-cta h2 {
    max-width: min(100%, 20ch);
    font-size: clamp(1.6rem, 6cqi, 2.3rem);
  }

  .outcome-cta .cta {
    width: 100%;
  }

  .outcome-cta__contact,
  .outcome-cta__form,
  .outcome-cta__form button.cta {
    width: 100%;
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
  const proofContextId = proofContext?.nodeId ?? proofContext?.id ?? "";

  return `
<section id="kontakt" class="outcome-cta" data-pattern-id="outcome-cta" data-contract-id="${escapeAttribute(input.contract.id)}" data-proof-context-id="${escapeAttribute(proofContextId)}" aria-labelledby="outcome-cta-title">
  <div class="outcome-cta__inner">
    <div class="outcome-cta__copy">
      <div class="outcome-cta__proof-context" data-contract-slot="proof_context" data-slot-target-kind="pattern" data-slot-target-id="${escapeAttribute(proofContextId)}">
        ${renderProofContext(proofContext)}
      </div>
      <h2 id="outcome-cta-title" data-contract-prop="outcome_statement">${escapeHtml(props.outcome_statement)}</h2>
      <a class="${ctaClassName(props.cta_variant)}" data-contract-prop="cta_label" href="${escapeAttribute(props.cta_href)}">${escapeHtml(props.cta_label)}</a>
    </div>
    ${renderContactBlock(props)}
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
    cta_href: href,
    cta_variant: normalizeCtaVariant(props.cta_variant),
    contact_heading: props.contact_heading?.trim() ?? "",
    contact_phone: props.contact_phone?.trim() ?? "",
    contact_phone_href: props.contact_phone_href?.trim() ?? "",
    contact_email: props.contact_email?.trim() ?? "",
    contact_note: props.contact_note?.trim() ?? ""
  };
}

function renderContactBlock(props: ValidOutcomeCtaProps): string {
  if (props.contact_phone.length === 0) {
    return "";
  }

  const headingMarkup =
    props.contact_heading.length === 0
      ? ""
      : `<p class="outcome-cta__contact-heading" data-contract-prop="contact_heading">${escapeHtml(props.contact_heading)}</p>`;
  const noteMarkup =
    props.contact_note.length === 0
      ? ""
      : `<p class="outcome-cta__contact-note" data-contract-prop="contact_note">${escapeHtml(props.contact_note)}</p>`;

  return `
<div class="outcome-cta__contact">
  ${headingMarkup}
  <a class="outcome-cta__phone" data-contract-prop="contact_phone" href="${escapeAttribute(props.contact_phone_href)}">${escapeHtml(props.contact_phone)}</a>
  ${noteMarkup}
  <form class="outcome-cta__form" action="mailto:${escapeAttribute(props.contact_email)}" method="post" enctype="text/plain">
    <label>
      Jméno
      <input type="text" name="name" autocomplete="name" required>
    </label>
    <label>
      Telefon
      <input type="tel" name="phone" autocomplete="tel" required>
    </label>
    <label>
      Zpráva
      <textarea name="message" rows="4"></textarea>
    </label>
    <button class="cta" type="submit">Odeslat poptávku</button>
  </form>
</div>`.trim();
}

function firstPattern(slotTargets: readonly ResolvedSlotTarget[] | undefined): ResolvedPatternReference | undefined {
  return slotTargets?.find((slotTarget): slotTarget is ResolvedPatternReference => slotTarget.targetKind === "pattern");
}

function renderProofContext(proofContext: ResolvedPatternReference | undefined): string {
  const proofText = firstNonEmpty(proofContext?.props?.proof_item, proofContext?.props?.outcome_statement);
  if (proofText === undefined) {
    return "";
  }

  const source = firstNonEmpty(proofContext?.props?.source_reference);
  const sourceMarkup =
    source === undefined
      ? ""
      : `<p class="outcome-cta__proof-source" data-contract-prop="source_reference">${escapeHtml(source)}</p>`;

  return `
${sourceMarkup}
<p class="outcome-cta__proof-text" data-contract-prop="proof_item">${escapeHtml(proofText)}</p>`.trim();
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}
