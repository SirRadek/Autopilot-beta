import { isSafeHref } from "../safe-url";
import type { ComponentContract, PatternRenderInput, ResolvedAsset, ResolvedSlotTarget } from "../types";
import { escapeAttribute, escapeHtml, isFileBackedAsset } from "./sharp-positioning-hero";

export interface ProofLedSectionContractIssue {
  readonly code: string;
  readonly prop?: string;
  readonly message: string;
}

interface ValidProofLedSectionProps {
  readonly proof_item: string;
  readonly outcome_statement: string;
  readonly source_reference: string;
  readonly cta_label: string;
  readonly cta_href: string;
}

export class ProofLedSectionContractError extends Error {
  readonly issues: readonly ProofLedSectionContractIssue[];

  constructor(issues: readonly ProofLedSectionContractIssue[]) {
    super(`proof-led-section contract failed: ${issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
    this.name = "ProofLedSectionContractError";
    this.issues = issues;
  }
}

export const proofLedSectionCss = `
.proof-led-section {
  container-type: inline-size;
  position: relative;
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-background);
}

.proof-led-section,
.proof-led-section * {
  box-sizing: border-box;
}

.proof-led-section::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  background: var(--style-surface-background);
}

.proof-led-section__inner {
  position: relative;
  z-index: 1;
  width: min(100%, 1180px);
  margin-inline: auto;
  padding: clamp(var(--space-7), 7cqi, calc(var(--space-8) * 2)) var(--space-6);
  display: grid;
  grid-template-columns: minmax(16rem, 0.72fr) minmax(0, 1fr);
  gap: clamp(var(--space-6), 6cqi, calc(var(--space-8) * 2));
  align-items: center;
}

.proof-led-section__asset-wrap {
  position: relative;
  min-height: clamp(18rem, 40cqi, 29rem);
  overflow: hidden;
  border: var(--style-decoration-border-width) solid var(--color-border);
  border-radius: var(--style-corner-radius);
  background: color-mix(in srgb, var(--color-surface) 84%, var(--color-background));
  box-shadow: var(--shadow-md);
  transform: rotate(var(--style-accent-angle-deg));
  transform-origin: center;
}

.proof-led-section__asset-wrap img,
.proof-led-section__asset {
  display: block;
  width: 100%;
  height: 100%;
}

.proof-led-section__asset-wrap img {
  object-fit: cover;
}

.proof-led-section__asset {
  position: absolute;
  inset: 0;
  transform: rotate(var(--style-accent-angle-inverse-deg));
  transform-origin: center;
}

.proof-led-section__asset-bg {
  fill: var(--color-surface);
}

.proof-led-section__asset-panel {
  fill: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
  stroke: var(--color-border);
  stroke-width: 2;
}

.proof-led-section__asset-accent {
  fill: var(--color-accent-secondary);
  opacity: var(--style-decoration-opacity);
}

.proof-led-section__asset-line {
  stroke: var(--color-text);
  stroke-width: 2;
  opacity: 0.6;
}

.proof-led-section__asset-soft {
  fill: var(--color-accent-soft);
}

.proof-led-section__content {
  display: grid;
  gap: var(--space-6);
  align-content: center;
  max-width: 48rem;
}

.proof-led-section__statement {
  display: grid;
  gap: var(--space-4);
  padding-inline-start: var(--space-5);
  border-inline-start: var(--style-decoration-border-width) solid var(--color-accent);
}

.proof-led-section h2 {
  margin: 0;
  max-width: 14ch;
  color: var(--color-text);
  font-family: var(--type-font-heading);
  font-size: clamp(2.25rem, 7cqi, 5rem);
  line-height: 0.95;
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
  text-transform: var(--style-heading-transform);
}

.proof-led-section__proof {
  margin: 0;
  max-width: 36rem;
  color: var(--color-text);
  font-family: var(--type-font-body);
  font-size: clamp(var(--type-size-body), 2.5cqi, var(--type-size-lg));
  line-height: var(--type-line-height-body);
}

.proof-led-section__source {
  width: fit-content;
  min-height: 2rem;
  margin: 0;
  padding-block-end: calc(var(--style-decoration-border-width) + 0.125rem);
  border-block-end: var(--style-decoration-border-width) solid var(--color-accent-soft);
  color: var(--color-muted-text);
  font-family: var(--type-font-body);
  font-size: 0.84rem;
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
}

.proof-led-section .cta {
  min-width: 44px;
  min-height: 44px;
  width: fit-content;
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

.proof-led-section .cta:hover {
  transform: translateY(-1px);
  border-color: var(--color-accent-secondary);
  background: var(--color-accent-secondary);
}

.proof-led-section .cta:focus-visible {
  outline: 3px solid var(--color-focus-ring);
  outline-offset: 3px;
}

@media (max-width: 760px) {
  .proof-led-section__inner {
    grid-template-columns: 1fr;
    padding: var(--space-8) var(--space-4);
  }

  .proof-led-section__asset-wrap {
    min-height: 15rem;
  }

  .proof-led-section h2 {
    max-width: 12ch;
    font-size: clamp(2rem, 14cqi, 3.35rem);
  }

  .proof-led-section .cta {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .proof-led-section .cta {
    transition: none;
  }

  .proof-led-section .cta:hover {
    transform: none;
  }
}
`.trim();

export function renderProofLedSection(input: PatternRenderInput): string {
  const issues = validateProofLedSectionInput(input);
  if (issues.length > 0) {
    throw new ProofLedSectionContractError(issues);
  }

  const props = normalizeProps(input.props);
  const proofAsset = firstAsset(input.slots.proof_asset);

  return `
<section class="proof-led-section" data-pattern-id="proof-led-section" data-contract-id="${escapeAttribute(input.contract.id)}" data-proof-asset-id="${escapeAttribute(proofAsset?.id ?? "")}" aria-labelledby="proof-led-section-title">
  <div class="proof-led-section__inner">
    <div class="proof-led-section__asset-wrap" data-contract-slot="proof_asset" data-asset-id="${escapeAttribute(proofAsset?.id ?? "")}" data-asset-source="${escapeAttribute(proofAsset?.source ?? "")}">
      ${renderProofAsset(proofAsset)}
    </div>
    <div class="proof-led-section__content">
      <div class="proof-led-section__statement">
        <h2 id="proof-led-section-title" data-contract-prop="outcome_statement">${escapeHtml(props.outcome_statement)}</h2>
        <p class="proof-led-section__proof" data-contract-prop="proof_item">${escapeHtml(props.proof_item)}</p>
        <p class="proof-led-section__source" data-contract-prop="source_reference">${escapeHtml(props.source_reference)}</p>
      </div>
      <a class="cta" data-contract-prop="cta_label" href="${escapeAttribute(props.cta_href)}">${escapeHtml(props.cta_label)}</a>
    </div>
  </div>
</section>`.trim();
}

function validateProofLedSectionInput(input: PatternRenderInput): ProofLedSectionContractIssue[] {
  const issues: ProofLedSectionContractIssue[] = [];

  if (input.contract.target_kind !== "pattern" || input.contract.target_id !== "proof-led-section") {
    issues.push({
      code: "contract_mismatch",
      message: `Expected pattern contract for proof-led-section, received ${input.contract.target_kind}:${input.contract.target_id}.`
    });
  }

  validateRequiredTextProp(input, "proof_item", "proof_adjacency", issues);
  validateRequiredTextProp(input, "outcome_statement", "proof_adjacency", issues);
  validateRequiredTextProp(input, "source_reference", "proof_adjacency", issues);
  validateRequiredTextProp(input, "cta_label", "dom_text_cta", issues);
  validateCtaHref(input, issues);
  validateRequiredAssetSlot(input, "proof_asset", issues);

  return issues;
}

function validateRequiredTextProp(
  input: PatternRenderInput,
  propName: string,
  invariantCode: string,
  issues: ProofLedSectionContractIssue[]
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

function validateCtaHref(input: PatternRenderInput, issues: ProofLedSectionContractIssue[]): void {
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

function validateRequiredAssetSlot(
  input: PatternRenderInput,
  slotName: string,
  issues: ProofLedSectionContractIssue[]
): void {
  const contractSlot = input.contract.slots.find((slot) => slot.name === slotName);
  const slotTargets = input.slots[slotName] ?? [];
  const assets = slotTargets.filter((slotTarget): slotTarget is ResolvedAsset => slotTarget.targetKind === "asset");

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
      message: `${slotName} must include at least ${minItems} asset(s).`
    });
  }

  const maxItems = contractSlot?.max_items;
  if (maxItems !== undefined && slotTargets.length > maxItems) {
    issues.push({
      code: "slot_overfilled",
      message: `${slotName} must include no more than ${maxItems} asset(s).`
    });
  }

  for (const slotTarget of slotTargets) {
    if (slotTarget.targetKind !== "asset") {
      issues.push({
        code: "slot_target_kind_mismatch",
        message: `${slotName} accepts assets, received ${slotTarget.targetKind} ${slotTarget.id}.`
      });
    }
  }

  const allowedIds = new Set(contractSlot?.allowed_asset_ids ?? []);
  if (allowedIds.size > 0) {
    for (const asset of assets) {
      if (!allowedIds.has(asset.id)) {
        issues.push({
          code: "slot_asset_not_allowed",
          message: `${slotName} does not accept asset ${asset.id}.`
        });
      }
    }
  }

  for (const asset of assets) {
    if (asset.source.trim().length === 0) {
      issues.push({
        code: "slot_asset_source_missing",
        message: `${slotName} asset ${asset.id} has no resolved source.`
      });
    }

    if (asset.href !== undefined && !isSafeHref(asset.href)) {
      issues.push({
        code: "slot_asset_unsafe_href",
        message: `${slotName} asset ${asset.id} has an unsafe href.`
      });
    }

    if (isFileBackedAsset(asset) && asset.href === undefined) {
      issues.push({
        code: "slot_asset_source_missing",
        message: `${slotName} asset ${asset.id} is file-backed but has no resolved href.`
      });
    }
  }
}

function normalizeProps(props: PatternRenderInput["props"]): ValidProofLedSectionProps {
  const href = props.cta_href?.trim() || "#proof";
  return {
    proof_item: props.proof_item?.trim() ?? "",
    outcome_statement: props.outcome_statement?.trim() ?? "",
    source_reference: props.source_reference?.trim() ?? "",
    cta_label: props.cta_label?.trim() ?? "",
    cta_href: href
  };
}

function firstAsset(slotTargets: readonly ResolvedSlotTarget[] | undefined): ResolvedAsset | undefined {
  return slotTargets?.find((slotTarget): slotTarget is ResolvedAsset => slotTarget.targetKind === "asset");
}

function renderProofAsset(asset: ResolvedAsset | undefined): string {
  if (asset?.href !== undefined) {
    return `<img src="${escapeAttribute(asset.href)}" alt="" loading="lazy" decoding="async">`;
  }

  const label = asset?.id ?? "";
  return `
<svg class="proof-led-section__asset" viewBox="0 0 560 420" role="img" aria-label="${escapeAttribute(label)}" focusable="false">
  <rect class="proof-led-section__asset-bg" x="0" y="0" width="560" height="420"/>
  <path class="proof-led-section__asset-panel" d="M84 82h308l84 74v182H84z"/>
  <path class="proof-led-section__asset-soft" d="M126 124h214v54H126zM126 216h278v24H126zM126 266h226v24H126z"/>
  <path class="proof-led-section__asset-accent" d="M388 106h58l44 44-44 44h-58l-44-44z"/>
  <path class="proof-led-section__asset-line" d="M82 338h394M126 188h266M126 304h176M360 106l86 88"/>
  <circle class="proof-led-section__asset-accent" cx="412" cy="294" r="30"/>
  <path class="proof-led-section__asset-line" d="m396 294 12 12 24-28"/>
</svg>`.trim();
}
