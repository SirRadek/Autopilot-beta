import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkRenderedContract } from "./check-render-contract";
import { renderComposition } from "./render-composition";
import { assertRootColorContrastWcagAA, type WcagContrastResult } from "./wcag-contrast";
import type { ComponentContract, TokenPrimitive } from "./types";

export type { WcagContrastResult } from "./wcag-contrast";

export interface BrandTokenOverride {
  readonly token_file: string;
  readonly token_key: string;
  readonly value: TokenPrimitive;
  readonly reason: string;
}

export interface BrandRenderExample {
  readonly id: string;
  readonly outputFileName: string;
  readonly tokenOverrides: readonly BrandTokenOverride[];
}

export interface BrandRenderResult {
  readonly id: string;
  readonly outputPath: string;
  readonly contractErrors: number;
  readonly contrastPairs: readonly WcagContrastResult[];
}

export const brandRenderExamples: readonly BrandRenderExample[] = [
  {
    id: "calm-corporate",
    outputFileName: "brand-calm.html",
    tokenOverrides: [
      colorOverride("background", "#F8FAFC", "Cool neutral page background for a calm corporate brief."),
      colorOverride("surface", "#FFFFFF", "Clean white surfaces keep the direction restrained."),
      colorOverride("text", "#0F172A", "High-contrast slate text on the calm background."),
      colorOverride("muted_text", "#475569", "Readable muted copy without losing contrast."),
      colorOverride("border", "#CBD5E1", "Soft neutral separators for the corporate treatment."),
      colorOverride("accent", "#2563EB", "Trustworthy blue CTA accent with AA contrast on white text."),
      colorOverride("accent_secondary", "#0F766E", "Cool secondary accent for hover and supporting marks."),
      colorOverride("accent_soft", "#DBEAFE", "Soft blue fill for quiet decorative surfaces."),
      colorOverride("accent_text", "#FFFFFF", "Readable CTA text on the blue accent."),
      colorOverride("focus_ring", "#0F766E", "Visible teal keyboard focus ring."),
      styleOverride("decoration_intensity", "subtle", "Reduce decorative weight for the calm corporate brand."),
      styleOverride("accent_angle_deg", "0deg", "Remove skewed angle for a cleaner corporate shape language."),
      styleOverride("corner_style", "rounded", "Use modest rounding without changing the component contract."),
      styleOverride("heading_case", "none", "Keep sentence-case headings for a quieter voice."),
      styleOverride("surface_treatment", "flat", "Use flat surfaces instead of the default editorial gradient.")
    ]
  },
  {
    id: "bold-editorial",
    outputFileName: "brand-bold.html",
    tokenOverrides: [
      colorOverride("background", "#0B0F19", "Dark editorial canvas with AA contrast for light text."),
      colorOverride("surface", "#111827", "Deep surface color for high-contrast editorial framing."),
      colorOverride("text", "#F9FAFB", "Light foreground text for the dark brief."),
      colorOverride("muted_text", "#CBD5E1", "Readable secondary copy on the dark canvas."),
      colorOverride("border", "#374151", "Subtle dark-mode borders."),
      colorOverride("accent", "#FACC15", "High-energy yellow accent with AA contrast on dark text."),
      colorOverride("accent_secondary", "#38BDF8", "Bright cyan secondary accent for hover and marks."),
      colorOverride("accent_soft", "#312E81", "Saturated soft fill for decorative asset regions."),
      colorOverride("accent_text", "#111827", "Dark CTA text for the yellow and cyan accent fills."),
      colorOverride("focus_ring", "#FACC15", "Visible focus treatment for the dark editorial brand."),
      styleOverride("decoration_intensity", "bold", "Keep high decoration weight for editorial emphasis."),
      styleOverride("accent_angle_deg", "-12deg", "Push the angular accent language for the editorial brief."),
      styleOverride("corner_style", "sharp", "Keep sharp geometry for the high-contrast direction."),
      styleOverride("heading_case", "upper", "Use uppercase heading treatment from tokens, not component markup."),
      styleOverride("surface_treatment", "gradient", "Use the gradient surface treatment for editorial depth.")
    ]
  }
];

export function buildBrandCompositionSpec(baseSpec: unknown, example: BrandRenderExample): unknown {
  if (!isRecord(baseSpec)) {
    throw new Error("Base composition spec must be an object.");
  }

  return {
    ...cloneJsonRecord(baseSpec),
    id: `${typeof baseSpec.id === "string" ? baseSpec.id : "composition"}-${example.id}`,
    token_overrides: {
      enabled: true,
      values: example.tokenOverrides
    }
  };
}

export function renderBrandExamples(repoRoot = process.cwd()): readonly BrandRenderResult[] {
  const pdosRoot = path.join(repoRoot, "product-design-os");
  const outputDir = path.join(repoRoot, "output", "render");
  const baseSpec = readJson(path.join(pdosRoot, "specs", "examples", "buildable-marketing.composition.json"));
  const contract = readSharpPositioningHeroContract(pdosRoot);
  const results: BrandRenderResult[] = [];

  mkdirSync(outputDir, { recursive: true });

  for (const example of brandRenderExamples) {
    const spec = buildBrandCompositionSpec(baseSpec, example);
    const renderResult = renderComposition(spec, pdosRoot);
    const contractReport = checkRenderedContract(renderResult.html, contract);
    if (contractReport.errors.length > 0) {
      throw new Error(`Brand render ${example.id} failed contract: ${contractReport.errors.map((issue) => issue.code).join(", ")}`);
    }

    const contrastPairs = assertRenderedWcagAA(renderResult.html);
    const outputPath = path.join(outputDir, example.outputFileName);
    writeFileSync(outputPath, renderResult.html, "utf8");

    results.push({
      id: example.id,
      outputPath,
      contractErrors: contractReport.errors.length,
      contrastPairs
    });
  }

  return results;
}

export function assertRenderedWcagAA(html: string): readonly WcagContrastResult[] {
  return assertRootColorContrastWcagAA(html);
}

function colorOverride(tokenKey: string, value: string, reason: string): BrandTokenOverride {
  return {
    token_file: "color",
    token_key: tokenKey,
    value,
    reason
  };
}

function styleOverride(tokenKey: string, value: string, reason: string): BrandTokenOverride {
  return {
    token_file: "style",
    token_key: tokenKey,
    value,
    reason
  };
}

function readSharpPositioningHeroContract(pdosRoot: string): ComponentContract {
  const manifest = readJson<{ readonly contracts?: readonly ComponentContract[] }>(
    path.join(pdosRoot, "contracts", "component-contract-manifest.json")
  );
  const contract = manifest.contracts?.find(
    (candidate) => candidate.target_kind === "pattern" && candidate.target_id === "sharp-positioning-hero"
  );
  if (contract === undefined) {
    throw new Error("Missing sharp-positioning-hero contract.");
  }
  return contract;
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCliEntryPoint(): boolean {
  const entryPoint = process.argv[1];
  if (entryPoint === undefined) {
    return false;
  }

  return path.resolve(entryPoint) === fileURLToPath(import.meta.url);
}

if (isCliEntryPoint()) {
  const repoRoot = process.cwd();
  for (const result of renderBrandExamples(repoRoot)) {
    const relativePath = path.relative(repoRoot, result.outputPath).replace(/\\/g, "/");
    const contrast = result.contrastPairs.map((pair) => `${pair.pair} ${pair.ratio.toFixed(2)}:1`).join(", ");
    console.log(`Rendered ${relativePath} (${result.id}; contract errors ${result.contractErrors}; WCAG-AA ${contrast})`);
  }
}
