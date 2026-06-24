import type { ComponentContract, ResolvedAsset } from "../types";
import { isSafeHref } from "../safe-url";

export interface SharpPositioningHeroInput {
  readonly props: {
    readonly headline?: string;
    readonly primary_cta?: string;
    readonly trust_cue?: string;
    readonly cta_href?: string;
  };
  readonly slots: {
    readonly hero_asset?: readonly ResolvedAsset[];
    readonly theme_background?: readonly ResolvedAsset[];
  };
  readonly contract: ComponentContract;
}

export interface SharpPositioningHeroContractIssue {
  readonly code: string;
  readonly prop?: string;
  readonly message: string;
}

interface ValidSharpPositioningHeroProps {
  readonly headline: string;
  readonly primary_cta: string;
  readonly trust_cue: string;
  readonly cta_href: string;
}

export class SharpPositioningHeroContractError extends Error {
  readonly issues: readonly SharpPositioningHeroContractIssue[];

  constructor(issues: readonly SharpPositioningHeroContractIssue[]) {
    super(`sharp-positioning-hero contract failed: ${issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
    this.name = "SharpPositioningHeroContractError";
    this.issues = issues;
  }
}

export const sharpPositioningHeroCss = `
.sharp-positioning-hero {
  container-type: inline-size;
  position: relative;
  min-height: min(760px, 100svh);
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-background);
  isolation: isolate;
}

.sharp-positioning-hero,
.sharp-positioning-hero * {
  box-sizing: border-box;
}

.sharp-positioning-hero__theme {
  position: absolute;
  inset: 0;
  z-index: -3;
}

.sharp-positioning-hero__theme svg,
.sharp-positioning-hero__theme img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.sharp-positioning-hero::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -2;
  background:
    linear-gradient(105deg,
      var(--color-background) 0%,
      color-mix(in srgb, var(--color-background) 86%, var(--color-surface)) 47%,
      color-mix(in srgb, var(--color-surface) 72%, var(--color-background)) 100%);
}

.sharp-positioning-hero__layout {
  width: min(100%, 1180px);
  min-height: inherit;
  margin-inline: auto;
  padding: clamp(var(--space-6), 6cqi, calc(var(--space-8) * 2)) var(--space-6);
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(18rem, 0.95fr);
  gap: clamp(var(--space-6), 5cqi, calc(var(--space-8) * 2));
  align-items: center;
}

.sharp-positioning-hero__copy {
  position: relative;
  display: grid;
  gap: var(--space-6);
  align-content: end;
  max-width: 52rem;
}

.sharp-positioning-hero__eyebrow {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  min-height: 2rem;
  color: var(--color-muted-text);
  font-family: var(--type-font-body);
  font-size: 0.84rem;
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
}

.sharp-positioning-hero h1 {
  max-width: 11ch;
  margin: 0;
  font-family: var(--type-font-heading);
  font-size: clamp(3rem, 11cqi, 7.4rem);
  line-height: 0.9;
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
}

.sharp-positioning-hero__action-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}

.sharp-positioning-hero .cta {
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4) var(--space-6);
  border: 1px solid var(--color-accent);
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

.sharp-positioning-hero .cta:hover {
  transform: translateY(-1px);
}

.sharp-positioning-hero .cta:focus-visible {
  outline: 3px solid var(--color-focus-ring);
  outline-offset: 3px;
}

.sharp-positioning-hero__trust {
  max-width: 26rem;
  margin: 0;
  padding-inline-start: var(--space-4);
  border-inline-start: 3px solid var(--color-accent);
  color: var(--color-muted-text);
  font-family: var(--type-font-body);
  font-size: var(--type-size-body);
  line-height: var(--type-line-height-body);
}

.sharp-positioning-hero__asset-wrap {
  position: relative;
  min-height: clamp(22rem, 56cqi, 38rem);
}

.sharp-positioning-hero__asset {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.sharp-positioning-hero__asset-panel {
  fill: color-mix(in srgb, var(--color-background) 82%, var(--color-surface));
  stroke: var(--color-border);
  stroke-width: 2;
}

.sharp-positioning-hero__asset-line {
  stroke: var(--color-text);
  stroke-width: 2;
  opacity: 0.56;
}

.sharp-positioning-hero__asset-accent {
  fill: var(--color-accent);
}

.sharp-positioning-hero__asset-muted {
  fill: color-mix(in srgb, var(--color-accent) 18%, var(--color-surface));
}

.sharp-positioning-hero__asset-surface {
  fill: var(--color-surface);
}

@media (max-width: 760px) {
  .sharp-positioning-hero {
    min-height: auto;
  }

  .sharp-positioning-hero__layout {
    grid-template-columns: 1fr;
    padding: var(--space-8) var(--space-4);
  }

  .sharp-positioning-hero h1 {
    max-width: 10ch;
    font-size: clamp(2.6rem, 18cqi, 4.5rem);
  }

  .sharp-positioning-hero__asset-wrap {
    min-height: 17rem;
  }

  .sharp-positioning-hero__action-row {
    align-items: stretch;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sharp-positioning-hero .cta {
    transition: none;
  }

  .sharp-positioning-hero .cta:hover {
    transform: none;
  }
}
`.trim();

export function renderSharpPositioningHero(input: SharpPositioningHeroInput): string {
  const issues = validateSharpPositioningHeroInput(input);
  if (issues.length > 0) {
    throw new SharpPositioningHeroContractError(issues);
  }

  const props = normalizeProps(input.props);
  const heroAsset = input.slots.hero_asset?.[0];
  const themeBackground = input.slots.theme_background?.[0];

  return `
<section class="sharp-positioning-hero" data-pattern-id="sharp-positioning-hero" data-contract-id="${escapeAttribute(input.contract.id)}" data-hero-asset-id="${escapeAttribute(heroAsset?.id ?? "")}" data-theme-background-id="${escapeAttribute(themeBackground?.id ?? "")}" aria-labelledby="sharp-positioning-hero-title">
  ${renderThemeBackground(themeBackground)}
  <div class="sharp-positioning-hero__layout">
    <div class="sharp-positioning-hero__copy">
      <div class="sharp-positioning-hero__eyebrow" aria-hidden="true">Offer / proof / request</div>
      <h1 id="sharp-positioning-hero-title" data-contract-prop="headline">${escapeHtml(props.headline)}</h1>
      <div class="sharp-positioning-hero__action-row">
        <a class="cta" data-contract-prop="primary_cta" href="${escapeAttribute(props.cta_href)}">${escapeHtml(props.primary_cta)}</a>
        <p class="sharp-positioning-hero__trust" data-contract-prop="trust_cue">${escapeHtml(props.trust_cue)}</p>
      </div>
    </div>
    <div class="sharp-positioning-hero__asset-wrap" data-asset-id="${escapeAttribute(heroAsset?.id ?? "")}" data-asset-source="${escapeAttribute(heroAsset?.source ?? "")}">
      ${renderEditorialMotionHeroSvg(heroAsset)}
    </div>
  </div>
</section>`.trim();
}

function validateSharpPositioningHeroInput(input: SharpPositioningHeroInput): SharpPositioningHeroContractIssue[] {
  const issues: SharpPositioningHeroContractIssue[] = [];

  if (input.contract.target_kind !== "pattern" || input.contract.target_id !== "sharp-positioning-hero") {
    issues.push({
      code: "contract_mismatch",
      message: `Expected pattern contract for sharp-positioning-hero, received ${input.contract.target_kind}:${input.contract.target_id}.`
    });
  }

  validateRequiredTextProp(input, "headline", "visible_h1", issues);
  validateRequiredTextProp(input, "primary_cta", "dom_text_cta", issues);
  validateRequiredTextProp(input, "trust_cue", "proof_adjacency", issues);
  validateCtaHref(input, issues);
  validateRequiredAssetSlot(input, "hero_asset", issues);
  validateRequiredAssetSlot(input, "theme_background", issues);

  return issues;
}

function validateCtaHref(
  input: SharpPositioningHeroInput,
  issues: SharpPositioningHeroContractIssue[]
): void {
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
  input: SharpPositioningHeroInput,
  propName: keyof SharpPositioningHeroInput["props"],
  invariantCode: string,
  issues: SharpPositioningHeroContractIssue[]
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

function validateRequiredAssetSlot(
  input: SharpPositioningHeroInput,
  slotName: keyof SharpPositioningHeroInput["slots"],
  issues: SharpPositioningHeroContractIssue[]
): void {
  const contractSlot = input.contract.slots.find((slot) => slot.name === slotName);
  const assets = input.slots[slotName] ?? [];

  if (contractSlot?.required === true && assets.length === 0) {
    issues.push({
      code: "slot_missing",
      message: `${slotName} must be filled by ${input.contract.id}.`
    });
    return;
  }

  const minItems = contractSlot?.min_items;
  if (minItems !== undefined && assets.length < minItems) {
    issues.push({
      code: "slot_missing",
      message: `${slotName} must include at least ${minItems} asset(s).`
    });
  }

  const maxItems = contractSlot?.max_items;
  if (maxItems !== undefined && assets.length > maxItems) {
    issues.push({
      code: "slot_overfilled",
      message: `${slotName} must include no more than ${maxItems} asset(s).`
    });
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

function normalizeProps(props: SharpPositioningHeroInput["props"]): ValidSharpPositioningHeroProps {
  const href = props.cta_href?.trim() || "#request";
  return {
    headline: props.headline?.trim() ?? "",
    primary_cta: props.primary_cta?.trim() ?? "",
    trust_cue: props.trust_cue?.trim() ?? "",
    cta_href: href
  };
}

function renderThemeBackground(asset: ResolvedAsset | undefined): string {
  if (asset === undefined) {
    return "";
  }

  if (asset.href !== undefined) {
    return `<div class="sharp-positioning-hero__theme" aria-hidden="true" data-asset-id="${escapeAttribute(asset.id)}" data-asset-source="${escapeAttribute(asset.source)}"><img src="${escapeAttribute(asset.href)}" alt="" loading="eager" decoding="async"></div>`;
  }

  return `<div class="sharp-positioning-hero__theme" aria-hidden="true" data-asset-id="${escapeAttribute(asset.id)}" data-asset-source="${escapeAttribute(asset.source)}"></div>`;
}

function isFileBackedAsset(asset: ResolvedAsset): boolean {
  return /\.(?:svg|png|jpe?g|webp|gif)$/i.test(asset.source);
}

function renderEditorialMotionHeroSvg(asset: ResolvedAsset | undefined): string {
  const label = asset === undefined ? "Editorial motion hero asset" : `Editorial motion hero asset ${asset.id}`;

  return `
<svg class="sharp-positioning-hero__asset" viewBox="0 0 640 520" role="img" aria-label="${escapeAttribute(label)}" focusable="false">
  <path class="sharp-positioning-hero__asset-panel" d="M112 86h346l78 88-92 260H96L42 276 112 86Z"/>
  <path class="sharp-positioning-hero__asset-muted" d="M156 132h234l54 60-66 186H142L104 266l52-134Z"/>
  <path class="sharp-positioning-hero__asset-accent" d="M438 116h80l44 52-60 74h-78l-42-54 56-72Z"/>
  <path class="sharp-positioning-hero__asset-surface" d="M172 176h172v34H172zM172 246h232v20H172zM172 292h184v20H172z"/>
  <path class="sharp-positioning-hero__asset-line" d="M74 426h418M118 74l330 388M548 250 82 250M448 116 520 242"/>
  <circle class="sharp-positioning-hero__asset-accent" cx="492" cy="308" r="34"/>
  <circle class="sharp-positioning-hero__asset-surface" cx="492" cy="308" r="13"/>
</svg>`.trim();
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
