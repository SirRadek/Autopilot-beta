export interface WcagContrastResult {
  readonly pair: string;
  readonly ratio: number;
}

export interface WcagContrastWarning {
  readonly pair: string;
  readonly reason: string;
}

export interface ComponentContrastReport {
  readonly results: readonly WcagContrastResult[];
  readonly warnings: readonly WcagContrastWarning[];
}

type Rgb = readonly [number, number, number];
type Rgba = readonly [number, number, number, number];

export class WcagContrastError extends Error {
  readonly pair: string;
  readonly ratio: number;
  readonly minRatio: number;

  constructor(pair: string, ratio: number, minRatio: number) {
    super(`Rendered color pair ${pair} contrast ${ratio.toFixed(2)} is below ${minRatio}.`);
    this.name = "WcagContrastError";
    this.pair = pair;
    this.ratio = ratio;
    this.minRatio = minRatio;
  }
}

const wcagContrastPairs = [
  ["background", "text"],
  ["background", "muted_text"],
  ["surface", "text"],
  ["surface", "muted_text"],
  ["accent", "accent_text"],
  ["accent_secondary", "accent_text"]
] as const;

const minAaContrastRatio = 4.5;

interface ComponentContrastPair {
  readonly pair: string;
  readonly background: string;
  readonly foreground: string;
}

// Foreground/background pairs that ship as real component CSS but never reach the
// 6 :root pairs above because their fills are color-mix() expressions. These mirror the
// literal CSS each component renders, so the gate measures the same composited color the
// browser paints. Resolved against the :root tokens (color-mix is token-driven, not DOM-driven).
const componentContrastPairs: readonly ComponentContrastPair[] = [
  {
    // .tactile-shadow-hero__badge — trust badge text on its color-mix fill (deep-critique A11Y-1).
    pair: "hero_badge_fill/hero_badge_text",
    background: "color-mix(in srgb, var(--color-text) 92%, var(--color-accent))",
    foreground: "color-mix(in srgb, var(--color-background) 92%, var(--color-surface))"
  },
  {
    // .outcome-cta__proof-context / .proof-led-section surface panel — muted text on the
    // surface-mixed panel that proof-led-section and outcome-cta render (deep-critique A11Y-4).
    pair: "surface_panel/muted_text",
    background: "color-mix(in srgb, var(--color-surface) 78%, var(--color-background))",
    foreground: "var(--color-muted-text)"
  }
];

// Text layered directly over the hero <img> with only a text-shadow (no opaque scrim). The
// backdrop is an uncontrolled photo, so AA cannot be guaranteed — warn instead of throw
// (deep-critique A11Y-2). Detected by the image-variant marker the hero emits.
const heroImageVariantMarker = "tactile-shadow-hero__stone--image";
const overPhotoTextPairs: readonly WcagContrastWarning[] = [
  {
    pair: "hero_headline/hero_photo",
    reason:
      "Hero H1 sits over the uncontrolled hero photo with only a text-shadow (no opaque scrim); AA contrast is not guaranteed over mid/dark photo regions."
  },
  {
    pair: "hero_eyebrow/hero_photo",
    reason:
      "Hero eyebrow sits over the uncontrolled hero photo with only a text-shadow (no opaque scrim); AA contrast is not guaranteed over mid/dark photo regions."
  }
];

export function assertRootColorContrastWcagAA(cssOrHtml: string): readonly WcagContrastResult[] {
  const rootVars = extractRootCssVars(cssOrHtml);
  const results: WcagContrastResult[] = [];

  for (const [backgroundKey, foregroundKey] of wcagContrastPairs) {
    const background = requiredRootVar(rootVars, `color-${backgroundKey.replace(/_/g, "-")}`);
    const foreground = requiredRootVar(rootVars, `color-${foregroundKey.replace(/_/g, "-")}`);
    const pair = `${backgroundKey}/${foregroundKey}`;
    const ratio = contrastRatio(parseHexColor(background), parseHexColor(foreground));
    if (ratio < minAaContrastRatio) {
      throw new WcagContrastError(pair, ratio, minAaContrastRatio);
    }

    results.push({
      pair,
      ratio
    });
  }

  return results;
}

export function extractRootCssVars(cssOrHtml: string): ReadonlyMap<string, string> {
  const rootBlock = /:root\{([\s\S]*?)\n\}/.exec(cssOrHtml)?.[1];
  if (rootBlock === undefined) {
    throw new Error("Rendered CSS does not contain a :root CSS block.");
  }

  const vars = new Map<string, string>();
  const declarationPattern = /--([a-z0-9-]+):\s*([^;]+);/gi;
  let match: RegExpExecArray | null;
  while ((match = declarationPattern.exec(rootBlock)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      vars.set(key, value.trim());
    }
  }

  return vars;
}

function requiredRootVar(vars: ReadonlyMap<string, string>, key: string): string {
  const value = vars.get(key);
  if (value === undefined) {
    throw new Error(`Rendered :root CSS is missing --${key}.`);
  }
  return value;
}

function contrastRatio(first: readonly [number, number, number], second: readonly [number, number, number]): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: readonly [number, number, number]): number {
  const [red, green, blue] = color.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

function parseHexColor(value: string): readonly [number, number, number] {
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
    throw new Error(`Expected hex color, received ${value}.`);
  }

  const normalized = value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : value;
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16)
  ];
}

/**
 * Resolve a CSS color expression to a concrete opaque sRGB triple.
 *
 * Handles plain hex, `var(--color-*)` (recursively resolved against the supplied :root
 * vars, with `var(--name, fallback)` support), and `color-mix(in srgb, A N%, B)` —
 * including `B = transparent`, which composites the translucent result over `backdrop`.
 * Throws when the result is still translucent and no opaque backdrop was supplied.
 */
export function resolveColor(value: string, rootVars: ReadonlyMap<string, string>, backdrop?: Rgb): Rgb {
  const [red, green, blue, alpha] = resolveRgba(value, rootVars, new Set());
  if (alpha >= 1) {
    return [red, green, blue];
  }
  if (backdrop === undefined) {
    throw new Error(
      `resolveColor: ${value} resolves to a translucent color (alpha ${alpha.toFixed(2)}); supply an opaque backdrop to flatten it.`
    );
  }
  return compositeOver([red, green, blue, alpha], backdrop);
}

/**
 * WCAG-AA contrast ratio between a foreground and background color expression, both resolved
 * against the supplied :root vars. The background is flattened over the page background when
 * translucent; the foreground is flattened over the resolved background.
 */
export function colorContrastRatio(
  foreground: string,
  background: string,
  rootVars: ReadonlyMap<string, string>
): number {
  const pageBackground: Rgb = rootVars.has("color-background")
    ? resolveColor("var(--color-background)", rootVars)
    : [255, 255, 255];
  const backgroundRgb = resolveColor(background, rootVars, pageBackground);
  const foregroundRgb = resolveColor(foreground, rootVars, backgroundRgb);
  return contrastRatio(backgroundRgb, foregroundRgb);
}

/**
 * Extends the :root contrast gate to the composited component pairs (color-mix fills) that the
 * 6-pair hex check is structurally blind to, plus non-throwing warnings for text over the
 * uncontrolled hero photo. The existing `assertRootColorContrastWcagAA` throw behavior is
 * unchanged — this is the additional layer (deep-critique A11Y-3).
 */
export function assertComponentColorContrastWcagAA(cssOrHtml: string): ComponentContrastReport {
  const rootVars = extractRootCssVars(cssOrHtml);
  const results: WcagContrastResult[] = [];

  for (const { pair, background, foreground } of componentContrastPairs) {
    const ratio = colorContrastRatio(foreground, background, rootVars);
    if (ratio < minAaContrastRatio) {
      throw new WcagContrastError(pair, ratio, minAaContrastRatio);
    }
    results.push({ pair, ratio });
  }

  const warnings: WcagContrastWarning[] = cssOrHtml.includes(heroImageVariantMarker)
    ? overPhotoTextPairs.map((warning) => ({ pair: warning.pair, reason: warning.reason }))
    : [];

  return { results, warnings };
}

function resolveRgba(value: string, rootVars: ReadonlyMap<string, string>, seen: ReadonlySet<string>): Rgba {
  const trimmed = value.trim();
  if (/^transparent$/i.test(trimmed)) {
    return [0, 0, 0, 0];
  }
  if (trimmed.startsWith("#")) {
    const [red, green, blue] = parseHexColor(trimmed);
    return [red, green, blue, 1];
  }
  if (/^var\(/i.test(trimmed)) {
    return resolveVar(trimmed, rootVars, seen);
  }
  if (/^color-mix\(/i.test(trimmed)) {
    return resolveColorMix(trimmed, rootVars, seen);
  }
  throw new Error(`Unsupported color value: ${trimmed}.`);
}

function resolveVar(value: string, rootVars: ReadonlyMap<string, string>, seen: ReadonlySet<string>): Rgba {
  const inner = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")"));
  const parts = splitTopLevel(inner, ",");
  const rawName = parts[0];
  if (rawName === undefined || rawName.trim().length === 0) {
    throw new Error(`Malformed var() expression: ${value}.`);
  }
  const name = rawName.trim().replace(/^--/, "");
  if (seen.has(name)) {
    throw new Error(`Cyclic var() reference while resolving --${name}.`);
  }
  const fallback = parts.length > 1 ? parts.slice(1).join(",").trim() : undefined;
  const resolved = rootVars.get(name);
  if (resolved === undefined) {
    if (fallback !== undefined && fallback.length > 0) {
      return resolveRgba(fallback, rootVars, seen);
    }
    throw new Error(`Rendered :root CSS is missing --${name}.`);
  }
  const nextSeen = new Set(seen);
  nextSeen.add(name);
  return resolveRgba(resolved, rootVars, nextSeen);
}

function resolveColorMix(value: string, rootVars: ReadonlyMap<string, string>, seen: ReadonlySet<string>): Rgba {
  const inner = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")"));
  const parts = splitTopLevel(inner, ",");
  if (parts.length !== 3) {
    throw new Error(`Unsupported color-mix() form (expected "in srgb, A, B"): ${value}.`);
  }
  const [space, componentA, componentB] = parts;
  if (space === undefined || componentA === undefined || componentB === undefined) {
    throw new Error(`Malformed color-mix() expression: ${value}.`);
  }
  if (!/^in\s+srgb$/i.test(space.trim())) {
    throw new Error(`Unsupported color-mix() interpolation space (only "in srgb" is supported): ${space.trim()}.`);
  }
  const [colorA, percentA] = splitColorAndPercentage(componentA);
  const [colorB, percentB] = splitColorAndPercentage(componentB);
  return mixSrgb(resolveRgba(colorA, rootVars, seen), percentA, resolveRgba(colorB, rootVars, seen), percentB);
}

/**
 * Premultiplied-alpha mix of two sRGB colors. Weights are the color-mix percentages; an
 * omitted percentage is `100 - other`, both omitted is 50/50. When the percentages sum to
 * less than 100 the result alpha is scaled down (per the CSS color-mix spec).
 */
function mixSrgb(a: Rgba, percentA: number | undefined, b: Rgba, percentB: number | undefined): Rgba {
  const p1 = percentA ?? (percentB === undefined ? 50 : Math.max(0, 100 - percentB));
  const p2 = percentB ?? (percentA === undefined ? 50 : Math.max(0, 100 - percentA));
  const total = p1 + p2;
  if (total === 0) {
    return [0, 0, 0, 0];
  }
  const weightA = p1 / total;
  const weightB = p2 / total;
  const alphaScale = Math.min(1, total / 100);
  const mixedAlpha = weightA * a[3] + weightB * b[3];
  const channel = (channelA: number, channelB: number): number =>
    mixedAlpha > 0 ? (weightA * a[3] * channelA + weightB * b[3] * channelB) / mixedAlpha : 0;
  return [
    channel(a[0], b[0]),
    channel(a[1], b[1]),
    channel(a[2], b[2]),
    mixedAlpha * alphaScale
  ];
}

function compositeOver(foreground: Rgba, backdrop: Rgb): Rgb {
  const alpha = foreground[3];
  return [
    foreground[0] * alpha + backdrop[0] * (1 - alpha),
    foreground[1] * alpha + backdrop[1] * (1 - alpha),
    foreground[2] * alpha + backdrop[2] * (1 - alpha)
  ];
}

function splitColorAndPercentage(component: string): readonly [string, number | undefined] {
  const trimmed = component.trim();
  const percentMatch = /\s+([0-9]+(?:\.[0-9]+)?)%$/.exec(trimmed);
  if (percentMatch?.index === undefined || percentMatch[1] === undefined) {
    return [trimmed, undefined];
  }
  return [trimmed.slice(0, percentMatch.index).trim(), Number.parseFloat(percentMatch[1])];
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    }
    if (char === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}
