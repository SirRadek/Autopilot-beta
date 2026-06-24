export interface WcagContrastResult {
  readonly pair: string;
  readonly ratio: number;
}

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
  ["accent", "accent_text"],
  ["accent_secondary", "accent_text"]
] as const;

const minAaContrastRatio = 4.5;

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

function extractRootCssVars(cssOrHtml: string): ReadonlyMap<string, string> {
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
