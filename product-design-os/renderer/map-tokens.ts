import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { TokenOverrideMap, TokenPrimitive } from "./types";

export interface TokenOverrideValidationIssue {
  readonly code: string;
  readonly tokenFile?: string;
  readonly tokenKey?: string;
  readonly message: string;
}

export class TokenOverrideValidationError extends Error {
  readonly issues: readonly TokenOverrideValidationIssue[];

  constructor(issues: readonly TokenOverrideValidationIssue[]) {
    super(`Token override validation failed: ${issues.map((issue) => issue.message).join("; ")}`);
    this.name = "TokenOverrideValidationError";
    this.issues = issues;
  }
}

const tokenPrefixByFile: Readonly<Record<string, string>> = {
  color: "color",
  typography: "type",
  spacing: "space",
  radius: "radius",
  shadow: "shadow",
  motion: "motion",
  style: "style"
};

const tokenFileOrder = Object.keys(tokenPrefixByFile);
const allowedCssValueFunctions = new Set(["rgb", "rgba", "hsl", "hsla", "cubic-bezier"]);
const styleTokenValues = {
  decoration_intensity: new Set(["none", "subtle", "bold"]),
  corner_style: new Set(["sharp", "rounded", "pill"]),
  heading_case: new Set(["none", "upper"]),
  surface_treatment: new Set(["flat", "gradient"])
} as const;

interface TokenFile {
  readonly tokens?: Record<string, unknown>;
}

export function mapTokensToCss(pdosRoot: string, overrides: TokenOverrideMap = {}): string {
  const tokensDir = path.join(pdosRoot, "tokens");
  const tokenFiles = readdirSync(tokensDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort(compareTokenFiles);
  const knownTokenFiles = new Set(tokenFiles.map((fileName) => fileName.slice(0, -".json".length)));
  const normalizedOverrides = normalizeOverrideMap(overrides);
  const issues: TokenOverrideValidationIssue[] = [];

  for (const tokenFile of Object.keys(normalizedOverrides)) {
    if (!knownTokenFiles.has(tokenFile)) {
      issues.push({
        code: "unknown_token_file",
        tokenFile,
        message: `Unknown token override file "${tokenFile}".`
      });
    }
  }

  const declarations: string[] = [];

  for (const fileName of tokenFiles) {
    const tokenFile = fileName.slice(0, -".json".length);
    const prefix = tokenPrefixByFile[tokenFile] ?? toKebabCase(tokenFile);
    const parsed = readTokenFile(path.join(tokensDir, fileName));
    const baseTokens = parsed.tokens ?? {};
    const flattened = normalizeFlattenedTokens(tokenFile, stringifyFlattenedTokens(flattenTokens(baseTokens)), issues);
    const overridesForFile = normalizedOverrides[tokenFile] ?? {};
    const canonicalTokenKeyByCandidate = tokenKeyCandidates(flattened);

    for (const [overrideKey, overrideValue] of Object.entries(overridesForFile)) {
      const canonicalTokenKey = canonicalTokenKeyByCandidate.get(overrideKey) ?? canonicalTokenKeyByCandidate.get(toKebabCase(overrideKey));
      if (canonicalTokenKey === undefined) {
        issues.push({
          code: "unknown_token_key",
          tokenFile,
          tokenKey: overrideKey,
          message: `Unknown token override key "${overrideKey}" in "${tokenFile}".`
        });
        continue;
      }

      const safeValue = normalizeTokenValueForCss(tokenFile, canonicalTokenKey, overrideValue);
      if (safeValue === undefined) {
        issues.push({
          code: "unsafe_token_value",
          tokenFile,
          tokenKey: overrideKey,
          message: `Unsafe CSS token override value for "${tokenFile}.${overrideKey}".`
        });
        continue;
      }

      flattened[canonicalTokenKey] = safeValue;
    }

    for (const [tokenKey, value] of Object.entries(flattened).sort(([left], [right]) => left.localeCompare(right))) {
      declarations.push(`  ${cssCustomPropertyName(prefix, tokenKey)}: ${value};`);
    }

    if (tokenFile === "style") {
      declarations.push(...styleDerivedDeclarations(flattened));
    }
  }

  if (issues.length > 0) {
    throw new TokenOverrideValidationError(issues);
  }

  return [":root{", ...declarations, "}"].join("\n");
}

function compareTokenFiles(left: string, right: string): number {
  const leftName = left.slice(0, -".json".length);
  const rightName = right.slice(0, -".json".length);
  const leftIndex = tokenFileOrder.indexOf(leftName);
  const rightIndex = tokenFileOrder.indexOf(rightName);

  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) {
      return 1;
    }
    if (rightIndex === -1) {
      return -1;
    }
    return leftIndex - rightIndex;
  }

  return leftName.localeCompare(rightName);
}

function readTokenFile(filePath: string): TokenFile {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Token file must contain an object: ${filePath}`);
  }
  return parsed as TokenFile;
}

function flattenTokens(tokens: Record<string, unknown>, parentKeys: readonly string[] = []): Record<string, TokenPrimitive> {
  const flattened: Record<string, TokenPrimitive> = {};

  for (const [key, value] of Object.entries(tokens)) {
    const nextKeys = [...parentKeys, key];

    if (isTokenPrimitive(value)) {
      flattened[nextKeys.join("-")] = value;
    } else if (isRecord(value)) {
      Object.assign(flattened, flattenTokens(value, nextKeys));
    }
  }

  return flattened;
}

function normalizeOverrideMap(overrides: TokenOverrideMap): Record<string, Record<string, TokenPrimitive>> {
  const normalized: Record<string, Record<string, TokenPrimitive>> = Object.create(null) as Record<
    string,
    Record<string, TokenPrimitive>
  >;

  for (const [rawTokenFile, tokenOverrides] of Object.entries(overrides)) {
    if (tokenOverrides === undefined) {
      continue;
    }

    const tokenFile = rawTokenFile.replace(/\.json$/i, "");
    normalized[tokenFile] = {
      ...(normalized[tokenFile] ?? {}),
      ...tokenOverrides
    };
  }

  return normalized;
}

function stringifyFlattenedTokens(tokens: Record<string, TokenPrimitive>): Record<string, string> {
  const stringified: Record<string, string> = {};
  for (const [tokenKey, tokenValue] of Object.entries(tokens)) {
    stringified[tokenKey] = String(tokenValue);
  }
  return stringified;
}

function normalizeFlattenedTokens(
  tokenFile: string,
  tokens: Record<string, string>,
  issues: TokenOverrideValidationIssue[]
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [tokenKey, tokenValue] of Object.entries(tokens)) {
    const safeValue = normalizeTokenValueForCss(tokenFile, tokenKey, tokenValue);
    if (safeValue === undefined) {
      issues.push({
        code: "unsafe_base_token_value",
        tokenFile,
        tokenKey,
        message: `Unsafe CSS base token value for "${tokenFile}.${tokenKey}".`
      });
      continue;
    }

    normalized[tokenKey] = safeValue;
  }

  return normalized;
}

function normalizeTokenValueForCss(tokenFile: string, tokenKey: string, value: TokenPrimitive): string | undefined {
  if (tokenFile === "style") {
    return normalizeStyleTokenOverrideValue(tokenKey, value);
  }

  const safeValue = normalizeCssTokenOverrideValue(value);
  if (safeValue === undefined) {
    return undefined;
  }

  if (tokenFile === "color" && !isHexColor(safeValue)) {
    return undefined;
  }

  return safeValue;
}

function normalizeStyleTokenOverrideValue(tokenKey: string, value: TokenPrimitive): string | undefined {
  if (tokenKey === "accent_angle_deg") {
    const angle = normalizeDegreeAngle(value);
    if (angle === undefined) {
      return undefined;
    }
    return normalizeCssTokenOverrideValue(angle);
  }

  if (!isKnownStyleEnumKey(tokenKey)) {
    return undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  const allowedValues: ReadonlySet<string> = styleTokenValues[tokenKey];
  return allowedValues.has(trimmed) ? trimmed : undefined;
}

function tokenKeyCandidates(flattenedTokens: Record<string, string>): Map<string, string> {
  const candidates = new Map<string, string>();
  for (const tokenKey of Object.keys(flattenedTokens)) {
    candidates.set(tokenKey, tokenKey);
    candidates.set(toKebabCase(tokenKey), tokenKey);
  }
  return candidates;
}

function styleDerivedDeclarations(styleTokens: Record<string, string>): readonly string[] {
  const decoration = styleTokens.decoration_intensity ?? "bold";
  const accentAngle = styleTokens.accent_angle_deg ?? "-8deg";
  const corner = styleTokens.corner_style ?? "sharp";
  const headingCase = styleTokens.heading_case ?? "none";
  const surface = styleTokens.surface_treatment ?? "gradient";

  return [
    `  --style-accent-angle-inverse-deg: ${invertDegreeAngle(accentAngle)};`,
    `  --style-corner-radius: ${cornerRadiusForStyle(corner)};`,
    `  --style-decoration-border-width: ${decorationBorderWidth(decoration)};`,
    `  --style-decoration-opacity: ${decorationOpacity(decoration)};`,
    `  --style-heading-transform: ${headingCase === "upper" ? "uppercase" : "none"};`,
    `  --style-surface-background: ${surfaceBackground(surface)};`
  ];
}

function invertDegreeAngle(value: string): string {
  const match = /^(-?(?:\d+|\d*\.\d+))deg$/.exec(value.trim());
  if (match === null) {
    return "8deg";
  }

  return `${formatCssNumber(Number(match[1]) * -1)}deg`;
}

function cornerRadiusForStyle(value: string): string {
  if (value === "pill") {
    return "999px";
  }
  if (value === "rounded") {
    return "var(--radius-lg)";
  }
  return "var(--radius-none)";
}

function decorationBorderWidth(value: string): string {
  if (value === "none") {
    return "0px";
  }
  if (value === "subtle") {
    return "2px";
  }
  return "3px";
}

function decorationOpacity(value: string): string {
  if (value === "none") {
    return "0";
  }
  if (value === "subtle") {
    return "0.52";
  }
  return "1";
}

function surfaceBackground(value: string): string {
  if (value === "flat") {
    return "var(--color-background)";
  }

  return [
    "linear-gradient(105deg,",
    "var(--color-background) 0%,",
    "color-mix(in srgb, var(--color-background) 86%, var(--color-surface)) 47%,",
    "color-mix(in srgb, var(--color-surface) 72%, var(--color-background)) 100%)"
  ].join(" ");
}

function normalizeCssTokenOverrideValue(value: TokenPrimitive): string | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 240) {
    return undefined;
  }

  if (/[<>{};\\]/.test(trimmed) || /\/\*|\*\//.test(trimmed)) {
    return undefined;
  }

  if (/(?:javascript|vbscript|data)\s*:|@import\b|expression\s*\(|url\s*\(/i.test(trimmed)) {
    return undefined;
  }

  if (!/^[a-zA-Z0-9\s#%.,()/"'-]+$/.test(trimmed)) {
    return undefined;
  }

  const functionPattern = /\b([a-z][a-z0-9-]*)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = functionPattern.exec(trimmed)) !== null) {
    const functionName = match[1];
    if (functionName === undefined || !allowedCssValueFunctions.has(functionName.toLowerCase())) {
      return undefined;
    }
  }

  return trimmed;
}

function normalizeDegreeAngle(value: TokenPrimitive): string | undefined {
  const raw = typeof value === "number" ? `${value}deg` : typeof value === "string" ? value.trim() : "";
  const match = /^(-?(?:\d+|\d*\.\d+))deg$/.exec(raw);
  if (match === null) {
    return undefined;
  }

  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric) || numeric < -24 || numeric > 24) {
    return undefined;
  }

  return `${formatCssNumber(numeric)}deg`;
}

function formatCssNumber(value: number): string {
  if (Object.is(value, -0)) {
    return "0";
  }
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function isHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function isKnownStyleEnumKey(value: string): value is keyof typeof styleTokenValues {
  return Object.prototype.hasOwnProperty.call(styleTokenValues, value);
}

function cssCustomPropertyName(prefix: string, rawTokenKey: string): string {
  const kebabTokenKey = toKebabCase(rawTokenKey);
  const dedupedKey = kebabTokenKey.startsWith(`${prefix}-`) ? kebabTokenKey.slice(prefix.length + 1) : kebabTokenKey;
  return `--${prefix}-${dedupedKey}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenPrimitive(value: unknown): value is TokenPrimitive {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}
