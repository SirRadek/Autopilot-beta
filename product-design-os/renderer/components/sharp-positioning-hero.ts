import type { ComponentContract, PatternRenderInput, PatternSlotMap, ResolvedAsset, ResolvedSlotTarget } from "../types";
import { isSafeHref } from "../safe-url";

export interface SharpPositioningHeroInput extends PatternRenderInput {
  readonly props: {
    readonly eyebrow?: string;
    readonly kicker?: string;
    readonly headline?: string;
    readonly primary_cta?: string;
    readonly trust_cue?: string;
    readonly cta_href?: string;
    readonly cta_variant?: string;
    readonly hero_asset_alt?: string;
  } & PatternRenderInput["props"];
  readonly slots: {
    readonly hero_asset?: readonly ResolvedAsset[];
    readonly theme_background?: readonly ResolvedAsset[];
  } & PatternSlotMap;
  readonly contract: ComponentContract;
}

export interface SharpPositioningHeroContractIssue {
  readonly code: string;
  readonly prop?: string;
  readonly message: string;
}

interface ValidSharpPositioningHeroProps {
  readonly eyebrow: string;
  readonly headline: string;
  readonly primary_cta: string;
  readonly trust_cue: string;
  readonly cta_href: string;
  readonly cta_variant: CtaVariant;
  readonly hero_asset_alt: string;
}

type CtaVariant = "primary" | "secondary";

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
  background: transparent;
  isolation: isolate;
}

.sharp-positioning-hero__layout {
  width: min(100%, var(--pdos-page-container-max));
  min-height: inherit;
  margin-inline: auto;
  padding: var(--pdos-page-section-padding-block) var(--pdos-page-gutter);
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(min(100%, 18rem), 0.95fr);
  gap: var(--pdos-page-section-gap);
  align-items: center;
}

.sharp-positioning-hero__copy {
  position: relative;
  display: grid;
  gap: var(--space-6);
  align-content: end;
  max-width: min(100%, 72ch);
}

.sharp-positioning-hero__eyebrow {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  min-height: 2rem;
  padding-block-end: calc(var(--style-decoration-border-width) + 0.125rem);
  border-block-end: var(--style-decoration-border-width) solid var(--color-accent-soft);
  color: var(--color-muted-text);
  font-family: var(--type-font-body);
  font-size: var(--pdos-type-kicker);
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
}

.sharp-positioning-hero h1 {
  max-width: 11ch;
  margin: 0;
  font-family: var(--type-font-heading);
  font-size: var(--pdos-type-display);
  line-height: 0.9;
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
  text-transform: var(--style-heading-transform);
}

.sharp-positioning-hero__action-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}

.sharp-positioning-hero__trust {
  max-width: min(100%, 56ch);
  margin: 0;
  padding-inline-start: var(--space-4);
  border-inline-start: var(--style-decoration-border-width) solid var(--color-accent);
  border-radius: var(--style-corner-radius);
  color: var(--color-muted-text);
  font-family: var(--type-font-body);
  font-size: var(--pdos-type-body);
  line-height: var(--type-line-height-body);
}

.sharp-positioning-hero__asset-wrap {
  position: relative;
  min-height: clamp(22rem, 56cqi, 38rem);
  border-radius: var(--style-corner-radius);
}

.sharp-positioning-hero__asset {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
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
  fill: var(--color-accent-secondary);
}

.sharp-positioning-hero__asset-muted {
  fill: var(--color-accent-soft);
}

.sharp-positioning-hero__asset-surface {
  fill: var(--color-surface);
}

.sharp-positioning-hero__asset-placeholder {
  fill: color-mix(in srgb, var(--color-surface) 82%, var(--color-background));
  stroke: var(--color-border);
  stroke-width: 2;
}

.sharp-positioning-hero__asset-placeholder-mark {
  fill: var(--color-accent-soft);
  opacity: var(--style-decoration-opacity);
}

.sharp-positioning-hero__asset-placeholder-line {
  stroke: var(--color-accent-secondary);
  stroke-width: 3;
  stroke-linecap: round;
  opacity: 0.66;
}

@media (max-width: 760px) {
  .sharp-positioning-hero {
    min-height: auto;
  }

  .sharp-positioning-hero__layout {
    grid-template-columns: 1fr;
  }

  .sharp-positioning-hero h1 {
    max-width: 10ch;
  }

  .sharp-positioning-hero__asset-wrap {
    min-height: 17rem;
  }

  .sharp-positioning-hero__action-row {
    align-items: stretch;
  }
}
`.trim();

export function renderSharpPositioningHero(input: PatternRenderInput): string {
  const issues = validateSharpPositioningHeroInput(input);
  if (issues.length > 0) {
    throw new SharpPositioningHeroContractError(issues);
  }

  const props = normalizeProps(input.props);
  const heroAsset = firstAsset(input.slots.hero_asset);
  const themeBackground = firstAsset(input.slots.theme_background);

  return `
<section class="sharp-positioning-hero" data-pattern-id="sharp-positioning-hero" data-contract-id="${escapeAttribute(input.contract.id)}" data-hero-asset-id="${escapeAttribute(heroAsset?.id ?? "")}" data-theme-background-id="${escapeAttribute(themeBackground?.id ?? "")}" aria-labelledby="sharp-positioning-hero-title">
  <div class="sharp-positioning-hero__layout">
    <div class="sharp-positioning-hero__copy">
      <div class="sharp-positioning-hero__eyebrow" data-contract-prop="eyebrow">${escapeHtml(props.eyebrow)}</div>
      <h1 id="sharp-positioning-hero-title" data-contract-prop="headline">${escapeHtml(props.headline)}</h1>
      <div class="sharp-positioning-hero__action-row">
        <a class="${ctaClassName(props.cta_variant)}" data-contract-prop="primary_cta" href="${escapeAttribute(props.cta_href)}">${escapeHtml(props.primary_cta)}</a>
        <p class="sharp-positioning-hero__trust" data-contract-prop="trust_cue">${escapeHtml(props.trust_cue)}</p>
      </div>
    </div>
    <div class="sharp-positioning-hero__asset-wrap" data-asset-id="${escapeAttribute(heroAsset?.id ?? "")}" data-asset-source="${escapeAttribute(heroAsset?.source ?? "")}">
      ${renderResolvedSlotAssetMarkup(heroAsset, {
        className: "sharp-positioning-hero__asset",
        alt: props.hero_asset_alt,
        fallback: () => renderNeutralHeroAssetFallback(heroAsset)
      })}
    </div>
  </div>
</section>`.trim();
}

function firstAsset(slotTargets: readonly ResolvedSlotTarget[] | undefined): ResolvedAsset | undefined {
  return slotTargets?.find((slotTarget): slotTarget is ResolvedAsset => slotTarget.targetKind === "asset");
}

function validateSharpPositioningHeroInput(input: PatternRenderInput): SharpPositioningHeroContractIssue[] {
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
  input: PatternRenderInput,
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
  input: PatternRenderInput,
  propName: string,
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
  input: PatternRenderInput,
  slotName: string,
  issues: SharpPositioningHeroContractIssue[]
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
      if (asset.inlineContent !== true && !allowedIds.has(asset.id)) {
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

    if (isFileBackedAsset(asset) && asset.href === undefined && asset.inlineSvg === undefined) {
      issues.push({
        code: "slot_asset_source_missing",
        message: `${slotName} asset ${asset.id} is file-backed but has no resolved href.`
      });
    }
  }
}

function normalizeProps(props: PatternRenderInput["props"]): ValidSharpPositioningHeroProps {
  const href = props.cta_href?.trim() || "#request";
  const eyebrow = firstNonEmpty(props.eyebrow, props.kicker) ?? "Offer / proof / request";
  return {
    eyebrow,
    headline: props.headline?.trim() ?? "",
    primary_cta: props.primary_cta?.trim() ?? "",
    trust_cue: props.trust_cue?.trim() ?? "",
    cta_href: href,
    cta_variant: normalizeCtaVariant(props.cta_variant),
    hero_asset_alt: props.hero_asset_alt?.trim() || "Editorial hero asset"
  };
}

export function isFileBackedAsset(asset: ResolvedAsset): boolean {
  return /\.(?:svg|png|jpe?g|webp|gif|avif)$/i.test(asset.source);
}

function renderNeutralHeroAssetFallback(asset: ResolvedAsset | undefined): string {
  const label = asset === undefined ? "Neutral hero asset placeholder" : `Neutral hero asset placeholder for ${asset.id}`;

  return `
<svg class="sharp-positioning-hero__asset" viewBox="0 0 640 520" role="img" aria-label="${escapeAttribute(label)}" focusable="false">
  <rect class="sharp-positioning-hero__asset-placeholder" x="78" y="76" width="462" height="352" rx="0"/>
  <circle class="sharp-positioning-hero__asset-placeholder-mark" cx="214" cy="190" r="70"/>
  <path class="sharp-positioning-hero__asset-placeholder-mark" d="M392 116 512 236 392 356 272 236Z"/>
  <path class="sharp-positioning-hero__asset-placeholder-line" d="M120 398 514 98M126 118l388 282"/>
</svg>`.trim();
}

interface SlotAssetMarkupOptions {
  readonly className: string;
  readonly alt: string;
  readonly fallback: () => string;
}

export function renderResolvedSlotAssetMarkup(asset: ResolvedAsset | undefined, options: SlotAssetMarkupOptions): string {
  if (asset?.inlineSvg !== undefined) {
    const svg = sanitizeInlineSvgAsset(asset.inlineSvg, {
      className: options.className,
      label: firstNonEmpty(asset.alt, options.alt, asset.id) ?? "Resolved asset"
    });
    if (svg !== undefined) {
      return svg;
    }
  }

  if (asset?.href !== undefined && isSafeHref(asset.href) && isRasterImageHref(asset.href)) {
    const alt = firstNonEmpty(asset.alt, options.alt) ?? "";
    return `<img class="${escapeAttribute(options.className)}" src="${escapeAttribute(asset.href)}" alt="${escapeAttribute(alt)}" loading="lazy" decoding="async">`;
  }

  return options.fallback();
}

export function ctaClassName(variant: CtaVariant): string {
  return variant === "secondary" ? "cta cta--secondary" : "cta";
}

export function normalizeCtaVariant(value: string | undefined): CtaVariant {
  return value?.trim().toLowerCase() === "secondary" ? "secondary" : "primary";
}

function sanitizeInlineSvgAsset(
  rawSvg: string,
  options: { readonly className: string; readonly label: string }
): string | undefined {
  const match = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/i.exec(rawSvg);
  if (match === null) {
    return undefined;
  }

  const rootAttributes = match[1] ?? "";
  const viewBox = extractSafeSvgViewBox(rootAttributes) ?? "0 0 640 520";
  const innerSvg = sanitizeSvgInnerMarkup(match[2] ?? "");
  return `<svg class="${escapeAttribute(options.className)}" viewBox="${escapeAttribute(viewBox)}" role="img" aria-label="${escapeAttribute(options.label)}" focusable="false">${innerSvg}</svg>`;
}

const allowedSvgTags = new Set([
  "circle",
  "clippath",
  "defs",
  "desc",
  "ellipse",
  "g",
  "line",
  "lineargradient",
  "mask",
  "path",
  "polygon",
  "polyline",
  "radialgradient",
  "rect",
  "stop",
  "title"
]);

function sanitizeSvgInnerMarkup(value: string): string {
  return value
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!doctype[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|foreignobject|iframe|object|embed|image|use|animate|set|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?(script|foreignobject|iframe|object|embed|image|use|animate|set|style)\b[^>]*>/gi, "")
    .replace(/\s+on[a-z0-9:-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:href|xlink:href)\s*=\s*(?:"(?!#)[^"]*"|'(?!#)[^']*'|(?!#)[^\s>]+)/gi, "")
    .replace(/\s+[a-z0-9:-]+\s*=\s*(?:"[^"]*(?:javascript|vbscript|data)\s*:[^"]*"|'[^']*(?:javascript|vbscript|data)\s*:[^']*'|[^\s>]*(?:javascript|vbscript|data)\s*:[^\s>]*)/gi, "")
    .replace(/<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi, (tag: string, rawTagName: string) => {
      const tagName = rawTagName.toLowerCase();
      return allowedSvgTags.has(tagName) ? tag : "";
    })
    .trim();
}

function extractSafeSvgViewBox(rootAttributes: string): string | undefined {
  const match = /\sviewBox\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(rootAttributes);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return /^-?(?:\d+|\d*\.\d+)(?:\s+-?(?:\d+|\d*\.\d+)){3}$/.test(trimmed) ? trimmed : undefined;
}

function isRasterImageHref(href: string): boolean {
  return /\.(?:png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i.test(href);
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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
