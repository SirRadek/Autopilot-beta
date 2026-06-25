import { isSafeHref } from "../safe-url";
import type { ComponentContract, PatternRenderInput } from "../types";

export interface StructuralGravityGridInput extends PatternRenderInput {
  readonly props: {
    readonly eyebrow?: string;
    readonly headline?: string;
    readonly primary_cta?: string;
    readonly trust_cue?: string;
    readonly cta_href?: string;
    readonly gallery_item_one?: string;
    readonly gallery_item_two?: string;
    readonly gallery_item_three?: string;
    readonly static_fallback_label?: string;
  } & PatternRenderInput["props"];
  readonly contract: ComponentContract;
}

export interface StructuralGravityGridContractIssue {
  readonly code: string;
  readonly prop?: string;
  readonly message: string;
}

interface ValidStructuralGravityGridProps {
  readonly eyebrow: string;
  readonly headline: string;
  readonly primary_cta: string;
  readonly trust_cue: string;
  readonly cta_href: string;
  readonly gallery_item_one: string;
  readonly gallery_item_two: string;
  readonly gallery_item_three: string;
  readonly static_fallback_label: string;
}

export class StructuralGravityGridContractError extends Error {
  readonly issues: readonly StructuralGravityGridContractIssue[];

  constructor(issues: readonly StructuralGravityGridContractIssue[]) {
    super(`structural-gravity-grid contract failed: ${issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
    this.name = "StructuralGravityGridContractError";
    this.issues = issues;
  }
}

export const structuralGravityGridCss = `
.structural-gravity-grid {
  container-type: inline-size;
  position: relative;
  min-height: min(760px, 100svh);
  overflow: hidden;
  color: var(--color-text);
  background: transparent;
  isolation: isolate;
}

.structural-gravity-grid,
.structural-gravity-grid * {
  box-sizing: border-box;
}

.structural-gravity-grid__layout {
  position: relative;
  z-index: 1;
  width: min(100%, var(--pdos-page-container-max));
  min-height: inherit;
  margin-inline: auto;
  padding: var(--pdos-page-section-padding-block) var(--pdos-page-gutter);
  display: grid;
  grid-template-columns: minmax(0, 1.02fr) minmax(18rem, 0.98fr);
  gap: clamp(var(--space-8), 7cqi, calc(var(--space-8) * 2.25));
  align-items: center;
}

.structural-gravity-grid__copy {
  display: grid;
  gap: var(--space-6);
  align-content: center;
  max-width: 55rem;
}

.structural-gravity-grid__eyebrow {
  width: fit-content;
  margin: 0;
  padding-block-end: calc(var(--style-decoration-border-width) + 0.125rem);
  border-block-end: var(--style-decoration-border-width) solid var(--color-accent-soft);
  color: var(--color-muted-text);
  font-family: var(--type-font-body);
  font-size: var(--pdos-type-kicker);
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
}

.structural-gravity-grid h1 {
  max-width: 17ch;
  margin: 0;
  color: var(--color-text);
  font-family: var(--type-font-heading);
  font-size: clamp(2.4rem, 7cqi, 5.9rem);
  line-height: 0.96;
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
  text-transform: var(--style-heading-transform);
}

.structural-gravity-grid__action-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}

.structural-gravity-grid__trust {
  max-width: 31rem;
  margin: 0;
  padding-inline-start: var(--space-4);
  border-inline-start: var(--style-decoration-border-width) solid var(--color-accent);
  color: var(--color-muted-text);
  font-family: var(--type-font-body);
  font-size: var(--type-size-body);
  line-height: var(--type-line-height-body);
}

.structural-gravity-grid .cta:hover {
  transform: none;
}

.structural-gravity-grid__gallery-wrap {
  position: relative;
  min-height: clamp(20rem, 52cqi, 36rem);
  display: grid;
  align-items: center;
}

.structural-gravity-grid__level-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  z-index: 2;
  height: max(1px, var(--style-decoration-border-width));
  background: var(--color-accent);
  transform: scaleX(0);
  transform-origin: center;
  animation: structuralLevelSweep 850ms cubic-bezier(0.16, 1, 0.3, 1) both;
  will-change: transform;
  pointer-events: none;
}

.structural-gravity-grid__gallery {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  grid-auto-rows: minmax(5.25rem, auto);
  gap: clamp(0.55rem, 1.2cqi, 1rem);
  width: min(100%, 37rem);
  margin: 0;
  padding: 0;
  list-style: none;
}

.structural-gravity-grid__block {
  position: relative;
  min-height: clamp(7.25rem, 13cqi, 10rem);
  display: grid;
  align-content: end;
  padding: clamp(var(--space-4), 2.5cqi, var(--space-6));
  overflow: hidden;
  border: var(--style-decoration-border-width) solid color-mix(in srgb, var(--color-border) 82%, var(--color-text));
  border-radius: min(var(--style-corner-radius), 8px);
  color: var(--color-text);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--color-surface) 88%, var(--color-background)) 0 38%, transparent 38% 100%),
    linear-gradient(90deg, color-mix(in srgb, var(--color-border) 24%, transparent) 1px, transparent 1px),
    color-mix(in srgb, var(--color-surface) 88%, var(--color-background));
  background-size: auto, clamp(1.6rem, 4cqi, 2.8rem) 100%, auto;
  box-shadow: var(--shadow-sm);
  transform: translate3d(0, -20px, 0) rotate(0.4deg);
  animation: structuralSettle 850ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transform-origin: center bottom;
  will-change: transform;
}

.structural-gravity-grid__block::after {
  content: "";
  position: absolute;
  inset: 0;
  opacity: 0.34;
  background:
    linear-gradient(180deg, transparent 0 46%, color-mix(in srgb, var(--color-border) 38%, transparent) 46% 48%, transparent 48% 100%),
    radial-gradient(circle at 12% 18%, color-mix(in srgb, var(--color-background) 36%, transparent) 0 0.18rem, transparent 0.2rem),
    radial-gradient(circle at 72% 64%, color-mix(in srgb, var(--color-text) 12%, transparent) 0 0.16rem, transparent 0.18rem);
  pointer-events: none;
}

.structural-gravity-grid__block-label {
  position: relative;
  z-index: 1;
  font-family: var(--type-font-body);
  font-size: clamp(1rem, 2.2cqi, 1.28rem);
  line-height: 1.2;
  font-weight: var(--type-weight-bold);
}

.structural-gravity-grid__block--one {
  grid-column: 1 / 5;
  grid-row: 1 / 3;
}

.structural-gravity-grid__block--two {
  grid-column: 5 / 7;
  grid-row: 1 / 2;
  animation-delay: 45ms;
}

.structural-gravity-grid__block--three {
  grid-column: 2 / 7;
  grid-row: 3 / 5;
  min-height: clamp(8rem, 14cqi, 11rem);
  border-color: color-mix(in srgb, var(--color-accent) 42%, var(--color-border));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--color-accent-soft) 48%, var(--color-surface)) 0 34%, transparent 34% 100%),
    linear-gradient(90deg, color-mix(in srgb, var(--color-border) 24%, transparent) 1px, transparent 1px),
    color-mix(in srgb, var(--color-surface) 86%, var(--color-background));
  animation-delay: 90ms;
}

.structural-gravity-grid__settle {
  transform: translate3d(0, -20px, 0) rotate(0.4deg);
  animation: structuralSettle 850ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transform-origin: center bottom;
  will-change: transform;
}

@keyframes structuralSettle {
  0% {
    transform: translate3d(0, -20px, 0) rotate(0.4deg);
  }
  100% {
    transform: translate3d(0, 0, 0) rotate(0deg);
  }
}

@keyframes structuralLevelSweep {
  0%,
  56% {
    transform: scaleX(0);
  }
  100% {
    transform: scaleX(1);
  }
}

@media (max-width: 860px) {
  .structural-gravity-grid {
    min-height: auto;
  }

  .structural-gravity-grid__layout {
    grid-template-columns: 1fr;
  }

  .structural-gravity-grid h1 {
    max-width: 13ch;
    font-size: clamp(2.15rem, 13cqi, 4rem);
  }

  .structural-gravity-grid__gallery-wrap {
    min-height: auto;
  }

  .structural-gravity-grid__gallery {
    width: 100%;
  }

  .structural-gravity-grid__action-row {
    align-items: stretch;
  }

  .structural-gravity-grid .cta {
    width: 100%;
  }
}

@media (max-width: 520px) {
  .structural-gravity-grid__gallery {
    grid-template-columns: 1fr;
    grid-auto-rows: auto;
  }

  .structural-gravity-grid__block,
  .structural-gravity-grid__block--one,
  .structural-gravity-grid__block--two,
  .structural-gravity-grid__block--three {
    grid-column: auto;
    grid-row: auto;
    min-height: 6.5rem;
  }

  .structural-gravity-grid__level-line {
    top: calc(50% + 0.35rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .structural-gravity-grid__settle,
  .structural-gravity-grid__block,
  .structural-gravity-grid__level-line {
    animation: none;
    transform: none;
    will-change: auto;
  }
}
`.trim();

export function renderStructuralGravityGrid(input: PatternRenderInput): string {
  const issues = validateStructuralGravityGridInput(input);
  if (issues.length > 0) {
    throw new StructuralGravityGridContractError(issues);
  }

  const props = normalizeProps(input.props);

  return `
<section class="structural-gravity-grid" data-pattern-id="structural-gravity-grid" data-contract-id="${escapeAttribute(input.contract.id)}" data-motion-strategy="css-only" data-reduced-motion-fallback="${escapeAttribute(props.static_fallback_label)}" aria-labelledby="structural-gravity-grid-title">
  <div class="structural-gravity-grid__layout">
    <div class="structural-gravity-grid__copy">
      <p class="structural-gravity-grid__eyebrow structural-gravity-grid__settle" data-contract-prop="eyebrow">${escapeHtml(props.eyebrow)}</p>
      <h1 id="structural-gravity-grid-title" class="structural-gravity-grid__settle" data-contract-prop="headline">${escapeHtml(props.headline)}</h1>
      <div class="structural-gravity-grid__action-row">
        <a class="cta" data-contract-prop="primary_cta" href="${escapeAttribute(props.cta_href)}">${escapeHtml(props.primary_cta)}</a>
        <p class="structural-gravity-grid__trust" data-contract-prop="trust_cue">${escapeHtml(props.trust_cue)}</p>
      </div>
    </div>
    <div class="structural-gravity-grid__gallery-wrap structural-gravity-grid__settle" aria-label="${escapeAttribute(props.static_fallback_label)}">
      <span class="structural-gravity-grid__level-line" aria-hidden="true"></span>
      <ul class="structural-gravity-grid__gallery" data-contract-prop="gallery_items">
        ${renderGalleryItem("one", props.gallery_item_one)}
        ${renderGalleryItem("two", props.gallery_item_two)}
        ${renderGalleryItem("three", props.gallery_item_three)}
      </ul>
    </div>
  </div>
</section>`.trim();
}

function renderGalleryItem(slot: "one" | "two" | "three", label: string): string {
  return `
<li class="structural-gravity-grid__block structural-gravity-grid__block--${slot}" data-structural-gallery-item="${slot}" data-contract-prop="gallery_item_${slot}">
  <span class="structural-gravity-grid__block-label">${escapeHtml(label)}</span>
</li>`.trim();
}

function validateStructuralGravityGridInput(input: PatternRenderInput): StructuralGravityGridContractIssue[] {
  const issues: StructuralGravityGridContractIssue[] = [];

  if (input.contract.target_kind !== "pattern" || input.contract.target_id !== "structural-gravity-grid") {
    issues.push({
      code: "contract_mismatch",
      message: `Expected pattern contract for structural-gravity-grid, received ${input.contract.target_kind}:${input.contract.target_id}.`
    });
  }

  validateRequiredTextProp(input, "headline", "visible_h1", issues);
  validateRequiredTextProp(input, "primary_cta", "dom_text_cta", issues);
  validateRequiredTextProp(input, "trust_cue", "proof_adjacency", issues);
  validateRequiredTextProp(input, "gallery_item_one", "no_primary_content_in_canvas", issues);
  validateRequiredTextProp(input, "gallery_item_two", "no_primary_content_in_canvas", issues);
  validateRequiredTextProp(input, "gallery_item_three", "no_primary_content_in_canvas", issues);
  validateRequiredTextProp(input, "static_fallback_label", "reduced_motion_fallback", issues);
  validateCtaHref(input, issues);

  return issues;
}

function validateCtaHref(input: PatternRenderInput, issues: StructuralGravityGridContractIssue[]): void {
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

function validateRequiredTextProp(
  input: PatternRenderInput,
  propName: string,
  invariantCode: string,
  issues: StructuralGravityGridContractIssue[]
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

function normalizeProps(props: PatternRenderInput["props"]): ValidStructuralGravityGridProps {
  return {
    eyebrow: props.eyebrow?.trim() || "Local masonry craft",
    headline: props.headline?.trim() ?? "",
    primary_cta: props.primary_cta?.trim() ?? "",
    trust_cue: props.trust_cue?.trim() ?? "",
    cta_href: props.cta_href?.trim() || "#kontakt",
    gallery_item_one: props.gallery_item_one?.trim() ?? "",
    gallery_item_two: props.gallery_item_two?.trim() ?? "",
    gallery_item_three: props.gallery_item_three?.trim() ?? "",
    static_fallback_label: props.static_fallback_label?.trim() ?? ""
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
