import { isSafeHref } from "../safe-url";
import type { ComponentContract, PatternRenderInput } from "../types";

interface TactileShadowHeroInput extends PatternRenderInput {
  readonly props: {
    readonly eyebrow?: string;
    readonly headline?: string;
    readonly primary_cta?: string;
    readonly trust_cue?: string;
    readonly cta_href?: string;
    readonly heritage_badge?: string;
    readonly photo_caption?: string;
    readonly static_fallback_label?: string;
  } & PatternRenderInput["props"];
  readonly contract: ComponentContract;
}

interface TactileShadowHeroContractIssue {
  readonly code: string;
  readonly prop?: string;
  readonly message: string;
}

interface ValidTactileShadowHeroProps {
  readonly eyebrow: string;
  readonly headline: string;
  readonly primary_cta: string;
  readonly trust_cue: string;
  readonly cta_href: string;
  readonly heritage_badge: string;
  readonly photo_caption: string;
  readonly static_fallback_label: string;
}

export class TactileShadowHeroContractError extends Error {
  readonly issues: readonly TactileShadowHeroContractIssue[];

  constructor(issues: readonly TactileShadowHeroContractIssue[]) {
    super(`tactile-shadow-hero contract failed: ${issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
    this.name = "TactileShadowHeroContractError";
    this.issues = issues;
  }
}

export const tactileShadowHeroCss = `
.tactile-shadow-hero {
  container-type: inline-size;
  position: relative;
  min-height: min(780px, 100svh);
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-background);
  isolation: isolate;
}

.tactile-shadow-hero,
.tactile-shadow-hero * {
  box-sizing: border-box;
}

.tactile-shadow-hero__stone {
  position: absolute;
  inset: 0;
  z-index: 0;
  margin: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 12% 16%, color-mix(in srgb, var(--color-background) 70%, transparent) 0 0.18rem, transparent 0.2rem),
    radial-gradient(circle at 68% 36%, color-mix(in srgb, var(--color-text) 14%, transparent) 0 0.14rem, transparent 0.16rem),
    radial-gradient(circle at 86% 74%, color-mix(in srgb, var(--color-border) 54%, transparent) 0 0.2rem, transparent 0.23rem),
    linear-gradient(135deg, color-mix(in srgb, var(--color-surface) 86%, var(--color-background)) 0 32%, color-mix(in srgb, var(--color-background) 72%, var(--color-surface)) 32% 64%, color-mix(in srgb, var(--color-surface) 68%, var(--color-accent-soft)) 64% 100%);
}

.tactile-shadow-hero__stone::before {
  content: "";
  position: absolute;
  inset: -22%;
  z-index: 2;
  opacity: 0.58;
  background:
    radial-gradient(ellipse at 36% 42%, color-mix(in srgb, var(--color-surface) 72%, transparent) 0 18%, color-mix(in srgb, var(--color-background) 42%, transparent) 18% 34%, transparent 60%);
  transform: translate3d(-7%, 0, 0);
  animation: tactileShadowSunSweep 20s ease-in-out infinite alternate;
  will-change: transform, opacity;
  pointer-events: none;
}

.tactile-shadow-hero__stone::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 3;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--color-text) 34%, transparent) 0, transparent 22%, transparent 78%, color-mix(in srgb, var(--color-text) 38%, transparent) 100%),
    linear-gradient(180deg, color-mix(in srgb, var(--color-text) 32%, transparent) 0, transparent 28%, transparent 66%, color-mix(in srgb, var(--color-text) 44%, transparent) 100%);
  pointer-events: none;
}

.tactile-shadow-hero__stone-surface {
  position: absolute;
  inset: 0;
  z-index: 1;
  opacity: 0.82;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--color-text) 17%, transparent) 1px, transparent 1px),
    linear-gradient(180deg, transparent 0 calc(100% - max(1px, var(--style-decoration-border-width))), color-mix(in srgb, var(--color-text) 20%, transparent) calc(100% - max(1px, var(--style-decoration-border-width))) 100%),
    radial-gradient(circle at 18% 28%, color-mix(in srgb, var(--color-background) 58%, transparent) 0 0.16rem, transparent 0.18rem),
    radial-gradient(circle at 43% 66%, color-mix(in srgb, var(--color-text) 14%, transparent) 0 0.12rem, transparent 0.15rem),
    radial-gradient(circle at 79% 41%, color-mix(in srgb, var(--color-border) 46%, transparent) 0 0.13rem, transparent 0.16rem);
  background-size:
    clamp(4.8rem, 12cqi, 8.4rem) 100%,
    100% clamp(3.2rem, 8cqi, 5.6rem),
    auto,
    auto,
    auto;
  mix-blend-mode: multiply;
  pointer-events: none;
}

.tactile-shadow-hero__photo-caption {
  position: absolute;
  left: clamp(var(--space-4), 4cqi, var(--space-8));
  top: clamp(var(--space-4), 4cqi, var(--space-8));
  z-index: 4;
  max-width: min(22rem, calc(100% - var(--space-8)));
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: var(--style-decoration-border-width) solid color-mix(in srgb, var(--color-accent) 44%, var(--color-border));
  border-radius: min(var(--style-corner-radius), 8px);
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-background) 74%, var(--color-surface));
  font-family: var(--type-font-body);
  font-size: clamp(0.78rem, 1.3cqi, 0.92rem);
  font-weight: var(--type-weight-bold);
  line-height: 1.2;
}

.tactile-shadow-hero__layout {
  position: relative;
  z-index: 1;
  width: min(100%, var(--pdos-page-container-max));
  min-height: inherit;
  margin-inline: auto;
  padding: var(--pdos-page-section-padding-block) var(--pdos-page-gutter);
  display: grid;
  grid-template-rows: 1fr auto;
  justify-items: center;
  gap: clamp(var(--space-7), 7cqi, calc(var(--space-8) * 1.8));
}

.tactile-shadow-hero__copy {
  align-self: center;
  display: grid;
  justify-items: center;
  gap: var(--space-5);
  max-width: 70rem;
  text-align: center;
}

.tactile-shadow-hero__eyebrow {
  width: fit-content;
  margin: 0;
  padding-block-end: calc(var(--style-decoration-border-width) + 0.125rem);
  border-block-end: var(--style-decoration-border-width) solid var(--color-accent-soft);
  color: color-mix(in srgb, var(--color-accent) 76%, var(--color-text));
  font-family: var(--type-font-body);
  font-size: var(--pdos-type-kicker);
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
  text-shadow: 0 0.35rem 1.4rem color-mix(in srgb, var(--color-text) 54%, transparent);
}

.tactile-shadow-hero h1 {
  max-width: 13ch;
  margin: 0;
  color: var(--color-accent);
  font-family: var(--type-font-heading);
  font-size: clamp(2.8rem, 10cqi, 7.4rem);
  line-height: 0.92;
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
  text-align: center;
  text-shadow:
    0 0.16rem 0 color-mix(in srgb, var(--color-background) 44%, transparent),
    0 0.6rem 2rem color-mix(in srgb, var(--color-text) 72%, transparent),
    0 0 3rem color-mix(in srgb, var(--color-text) 54%, transparent);
  text-transform: var(--style-heading-transform);
  overflow-wrap: anywhere;
}

.tactile-shadow-hero__bottom {
  display: grid;
  justify-items: center;
  gap: var(--space-3);
  text-align: center;
}

.tactile-shadow-hero .cta {
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4) var(--space-6);
  border: var(--style-decoration-border-width) solid color-mix(in srgb, var(--color-accent) 74%, var(--color-text));
  border-radius: min(var(--style-corner-radius), 8px);
  color: var(--color-text);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--color-surface) 82%, var(--color-accent)) 0 48%, color-mix(in srgb, var(--color-background) 68%, var(--color-surface)) 48% 100%);
  font-family: var(--type-font-body);
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-bold);
  line-height: 1;
  text-decoration: none;
  box-shadow:
    0 0.4rem 1.4rem color-mix(in srgb, var(--color-text) 38%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--color-background) 72%, transparent);
}

.tactile-shadow-hero .cta:hover {
  transform: none;
}

.tactile-shadow-hero .cta:focus-visible {
  outline: max(2px, var(--style-decoration-border-width)) solid var(--color-accent-soft);
  outline-offset: var(--space-2);
}

.tactile-shadow-hero__badge {
  max-width: min(42rem, 100%);
  margin: 0;
  padding: var(--space-2) var(--space-4);
  border: var(--style-decoration-border-width) solid color-mix(in srgb, var(--color-accent-soft) 72%, var(--color-border));
  border-radius: min(var(--style-corner-radius), 8px);
  color: color-mix(in srgb, var(--color-background) 88%, var(--color-surface));
  background: color-mix(in srgb, var(--color-text) 58%, transparent);
  font-family: var(--type-font-body);
  font-size: clamp(0.86rem, 1.5cqi, 1rem);
  font-weight: var(--type-weight-bold);
  line-height: 1.35;
  text-shadow: 0 0.35rem 1.1rem color-mix(in srgb, var(--color-text) 58%, transparent);
}

.tactile-shadow-hero__badge-separator {
  color: color-mix(in srgb, var(--color-accent-soft) 82%, var(--color-background));
}

.tactile-shadow-hero__focus {
  opacity: 0;
  filter: blur(4px);
  animation: tactileShadowFocus 2.5s ease-out both;
  will-change: filter, opacity;
}

.tactile-shadow-hero__focus--late {
  animation-delay: 280ms;
}

@keyframes tactileShadowSunSweep {
  0% {
    opacity: 0.42;
    transform: translate3d(-7%, 0, 0);
  }
  48% {
    opacity: 0.64;
  }
  100% {
    opacity: 0.5;
    transform: translate3d(7%, 0, 0);
  }
}

@keyframes tactileShadowFocus {
  0% {
    opacity: 0;
    filter: blur(4px);
  }
  100% {
    opacity: 1;
    filter: blur(0);
  }
}

@media (max-width: 820px) {
  .tactile-shadow-hero {
    min-height: min(720px, 100svh);
  }

  .tactile-shadow-hero__layout {
    padding: var(--space-8) var(--space-4);
    gap: var(--space-7);
  }

  .tactile-shadow-hero h1 {
    max-width: 11ch;
    font-size: clamp(2.45rem, 15cqi, 5rem);
  }

  .tactile-shadow-hero__photo-caption {
    left: var(--space-4);
    top: var(--space-4);
  }
}

@media (max-width: 540px) {
  .tactile-shadow-hero {
    min-height: min(680px, 100svh);
  }

  .tactile-shadow-hero__layout {
    padding-block: var(--space-8);
  }

  .tactile-shadow-hero__copy {
    gap: var(--space-4);
  }

  .tactile-shadow-hero h1 {
    max-width: 10ch;
    font-size: clamp(2.25rem, 18cqi, 4.2rem);
  }

  .tactile-shadow-hero__bottom {
    width: 100%;
  }

  .tactile-shadow-hero .cta {
    width: min(100%, 24rem);
  }

  .tactile-shadow-hero__badge {
    width: min(100%, 24rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tactile-shadow-hero__stone::before,
  .tactile-shadow-hero__focus,
  .tactile-shadow-hero__focus--late {
    animation: none;
    opacity: 1;
    filter: none;
    transform: none;
    will-change: auto;
  }

  .tactile-shadow-hero__stone::before {
    opacity: 0.5;
  }
}
`.trim();

export function renderTactileShadowHero(input: PatternRenderInput): string {
  const props = normalizeProps(input.props);
  const issues = validateTactileShadowHeroInput(input, props);
  if (issues.length > 0) {
    throw new TactileShadowHeroContractError(issues);
  }

  return `
<section class="tactile-shadow-hero" data-pattern-id="tactile-shadow-hero" data-contract-id="${escapeAttribute(input.contract.id)}" data-motion-strategy="css-only" data-reduced-motion-fallback="${escapeAttribute(props.static_fallback_label)}" aria-labelledby="tactile-shadow-hero-title">
  <figure class="tactile-shadow-hero__stone" aria-label="${escapeAttribute(props.photo_caption)}">
    <div class="tactile-shadow-hero__stone-surface" aria-hidden="true"></div>
    <figcaption class="tactile-shadow-hero__photo-caption" data-contract-prop="photo_caption">${escapeHtml(props.photo_caption)}</figcaption>
  </figure>
  <div class="tactile-shadow-hero__layout">
    <div class="tactile-shadow-hero__copy tactile-shadow-hero__focus">
      <p class="tactile-shadow-hero__eyebrow" data-contract-prop="eyebrow">${escapeHtml(props.eyebrow)}</p>
      <h1 id="tactile-shadow-hero-title" data-contract-prop="headline">${escapeHtml(props.headline)}</h1>
    </div>
    <div class="tactile-shadow-hero__bottom tactile-shadow-hero__focus tactile-shadow-hero__focus--late">
      <a class="cta" data-contract-prop="primary_cta" href="${escapeAttribute(props.cta_href)}">${escapeHtml(props.primary_cta)}</a>
      <p class="tactile-shadow-hero__badge">
        <span data-contract-prop="trust_cue">${escapeHtml(props.trust_cue)}</span>
        <span class="tactile-shadow-hero__badge-separator" aria-hidden="true"> / </span>
        <span data-contract-prop="heritage_badge">${escapeHtml(props.heritage_badge)}</span>
      </p>
    </div>
  </div>
</section>`.trim();
}

function validateTactileShadowHeroInput(
  input: PatternRenderInput,
  props: ValidTactileShadowHeroProps
): TactileShadowHeroContractIssue[] {
  const issues: TactileShadowHeroContractIssue[] = [];

  if (input.contract.target_kind !== "pattern" || input.contract.target_id !== "tactile-shadow-hero") {
    issues.push({
      code: "contract_mismatch",
      message: `Expected pattern contract for tactile-shadow-hero, received ${input.contract.target_kind}:${input.contract.target_id}.`
    });
  }

  validateRequiredTextProp(input, props, "headline", "visible_h1", issues);
  validateRequiredTextProp(input, props, "primary_cta", "dom_text_cta", issues);
  validateRequiredTextProp(input, props, "trust_cue", "proof_adjacency", issues);
  validateRequiredTextProp(input, props, "heritage_badge", "proof_adjacency", issues);
  validateRequiredTextProp(input, props, "photo_caption", "no_primary_content_in_canvas", issues);
  validateRequiredTextProp(input, props, "static_fallback_label", "reduced_motion_fallback", issues);
  validateCtaHref(props, issues);

  return issues;
}

function validateCtaHref(props: ValidTactileShadowHeroProps, issues: TactileShadowHeroContractIssue[]): void {
  if (!isSafeHref(props.cta_href)) {
    issues.push({
      code: "unsafe_href",
      prop: "cta_href",
      message: "cta_href must use #, /, ./, ../, http(s), mailto, or tel."
    });
  }
}

function validateRequiredTextProp(
  input: PatternRenderInput,
  props: ValidTactileShadowHeroProps,
  propName: keyof ValidTactileShadowHeroProps,
  invariantCode: string,
  issues: TactileShadowHeroContractIssue[]
): void {
  const contractProp = input.contract.props.find((prop) => prop.name === propName);
  const minLength = contractProp?.min_length ?? 1;
  const value = props[propName].trim();

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

function normalizeProps(props: TactileShadowHeroInput["props"]): ValidTactileShadowHeroProps {
  return {
    eyebrow: props.eyebrow?.trim() || "Patinovaný stín",
    headline: props.headline?.trim() || "Poctivé zednické řemeslo z Polabí",
    primary_cta: props.primary_cta?.trim() || "Získat kalkulaci zdarma",
    trust_cue: props.trust_cue?.trim() || "18 let praxe, 124 staveb",
    cta_href: props.cta_href?.trim() || "#kontakt",
    heritage_badge: props.heritage_badge?.trim() || "Založeno na poctivé práci od r. 2004",
    photo_caption: props.photo_caption?.trim() || "Foto: hrubě opracovaná pískovcová zeď",
    static_fallback_label: props.static_fallback_label?.trim() || "Statický patinovaný stín bez pohybu"
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
