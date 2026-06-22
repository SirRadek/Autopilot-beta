import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyProjectIntake,
  type PdosIntakeInput,
  type PdosIntakeRoute,
  type PdosProjectType
} from "./route-product-design-os";

export interface PdosRecipeCandidate {
  readonly id: string;
  readonly project_types: readonly string[];
  readonly priorities: readonly string[];
  readonly logic_priority: number;
  readonly design_priority: number;
  readonly motion_level: number;
  readonly visual_energy?: number;
  readonly allowed_patterns: readonly string[];
  readonly blocked_assets: readonly string[];
  readonly tests_required: readonly string[];
  readonly stop_conditions?: readonly string[];
}

export interface PdosPatternCandidate {
  readonly id: string;
  readonly type: string;
  readonly use_case: readonly string[];
  readonly good_for: readonly string[];
  readonly bad_for: readonly string[];
  readonly complexity: number;
  readonly usability: number;
  readonly mobile_quality: number;
  readonly requires: readonly string[];
  readonly risks: readonly string[];
}

export interface PdosAssetCandidate {
  readonly id: string;
  readonly type: string;
  readonly style: readonly string[];
  readonly use_case: readonly string[];
  readonly target: readonly string[];
  readonly creativity: number;
  readonly trust: number;
  readonly motion_level: number;
  readonly performance_cost: number;
  readonly mobile_safe: boolean;
  readonly dependencies?: readonly string[];
  readonly works_with?: readonly string[];
  readonly avoid_with?: readonly string[];
  readonly template_risk: number;
}

export interface PdosScoreInput extends PdosIntakeInput {
  readonly route?: PdosIntakeRoute;
  readonly recipes?: readonly PdosRecipeCandidate[];
  readonly patterns?: readonly PdosPatternCandidate[];
  readonly assets?: readonly PdosAssetCandidate[];
  readonly limit?: number;
}

export interface PdosScoredItem {
  readonly id: string;
  readonly score: number;
  readonly selected: boolean;
  readonly reasons: readonly string[];
  readonly penalties: readonly string[];
}

export interface PdosScoreReport {
  readonly route: PdosIntakeRoute;
  readonly selected: {
    readonly recipes: readonly PdosScoredItem[];
    readonly patterns: readonly PdosScoredItem[];
    readonly assets: readonly PdosScoredItem[];
  };
  readonly rejected: {
    readonly recipes: readonly PdosScoredItem[];
    readonly patterns: readonly PdosScoredItem[];
    readonly assets: readonly PdosScoredItem[];
  };
  readonly warnings: readonly string[];
  readonly formula: string;
  readonly report_markdown: string;
}

const SCORE_FORMULA =
  "score = purpose_fit*3 + target_fit*3 + logic_fit*3 + usability*3 + taste_match*2 + accessibility*2 + mobile_fit*2 - performance_cost*2 - implementation_complexity - template_risk*4 - style_conflict*3";

export function scoreProductDesignOs(input: PdosScoreInput | string, repoRoot = process.cwd()): PdosScoreReport {
  const normalizedInput = typeof input === "string" ? { text: input } : input;
  const route = normalizedInput.route ?? classifyProjectIntake(normalizedInput);
  const recipes = normalizedInput.recipes ?? loadRecipes(repoRoot);
  const patterns = normalizedInput.patterns ?? loadPatternManifest(repoRoot);
  const assets = normalizedInput.assets ?? loadAssetManifest(repoRoot);
  const limit = clampLimit(normalizedInput.limit);

  const scoredRecipes = rankItems(recipes.map((recipe) => scoreRecipe(recipe, route)));
  const scoredPatterns = rankItems(patterns.map((pattern) => scorePattern(pattern, route, scoredRecipes)));
  const scoredAssets = rankItems(assets.map((asset) => scoreAsset(asset, route, scoredRecipes)));
  const warnings = [
    ...(patterns.length === 0 ? ["pattern_manifest_empty"] : []),
    ...(assets.length === 0 ? ["asset_manifest_empty"] : [])
  ];
  const reportWithoutMarkdown = {
    route,
    selected: {
      recipes: scoredRecipes.slice(0, limit),
      patterns: scoredPatterns.slice(0, limit),
      assets: scoredAssets.slice(0, limit)
    },
    rejected: {
      recipes: scoredRecipes.slice(limit),
      patterns: scoredPatterns.slice(limit),
      assets: scoredAssets.slice(limit)
    },
    warnings,
    formula: SCORE_FORMULA
  };

  return {
    ...reportWithoutMarkdown,
    report_markdown: buildScoreMarkdown(reportWithoutMarkdown)
  };
}

export function formatPdosScoreReport(report: PdosScoreReport, format: "json" | "markdown" = "json"): string {
  if (format === "markdown") {
    return `${report.report_markdown.trimEnd()}\n`;
  }
  const { report_markdown: _reportMarkdown, ...jsonReport } = report;
  return `${JSON.stringify(jsonReport, null, 2)}\n`;
}

function scoreRecipe(recipe: PdosRecipeCandidate, route: PdosIntakeRoute): PdosScoredItem {
  const projectFit = recipe.project_types.includes(route.project_type) ? 10 : 2;
  const logicFit = distanceFit(recipe.logic_priority, route.logic_priority);
  const designFit = distanceFit(recipe.design_priority, route.design_priority);
  const motionFit = distanceFit(recipe.motion_level, route.motion_level);
  const stopPenalty = sharedCount(recipe.stop_conditions ?? [], route.stop_conditions) * 8;
  const score = projectFit * 4 + logicFit * 2 + designFit * 2 + motionFit * 2 - stopPenalty;
  const reasons = [
    recipe.project_types.includes(route.project_type)
      ? `Project type ${route.project_type} is supported.`
      : `Project type ${route.project_type} is not a primary fit.`,
    `Logic/design/motion fit: ${logicFit}/${designFit}/${motionFit}.`
  ];
  const penalties = stopPenalty > 0 ? ["Recipe stop conditions overlap with unresolved route stop conditions."] : [];

  return {
    id: recipe.id,
    score,
    selected: false,
    reasons,
    penalties
  };
}

function scorePattern(
  pattern: PdosPatternCandidate,
  route: PdosIntakeRoute,
  scoredRecipes: readonly PdosScoredItem[]
): PdosScoredItem {
  const topRecipeId = scoredRecipes[0]?.id ?? route.selected_recipe;
  const purposeFit = pattern.use_case.includes(route.project_type) ? 10 : 3;
  const blockedByUseCase = pattern.bad_for.includes(route.project_type);
  const logicFit = route.logic_priority >= 7 && pattern.type !== "motion_pattern" ? 8 : 5;
  const score =
    purposeFit * 3 +
    logicFit * 3 +
    pattern.usability * 3 +
    pattern.mobile_quality * 2 -
    pattern.complexity -
    (blockedByUseCase ? 30 : 0);
  const reasons = [
    `Compared against route ${route.project_type} and recipe ${topRecipeId}.`,
    pattern.use_case.includes(route.project_type) ? "Pattern use_case matches project type." : "Pattern use_case is not an exact match.",
    `Usability/mobile quality: ${pattern.usability}/${pattern.mobile_quality}.`
  ];
  const penalties = [
    ...(blockedByUseCase ? ["Pattern bad_for includes the route project type."] : []),
    ...(pattern.complexity >= 8 ? ["High implementation complexity."] : [])
  ];

  return {
    id: pattern.id,
    score,
    selected: false,
    reasons,
    penalties
  };
}

function scoreAsset(
  asset: PdosAssetCandidate,
  route: PdosIntakeRoute,
  scoredRecipes: readonly PdosScoredItem[]
): PdosScoredItem {
  const topRecipeId = scoredRecipes[0]?.id ?? route.selected_recipe;
  const purposeFit = asset.use_case.includes(route.project_type) ? 10 : 3;
  const targetFit = route.design_priority >= 7 ? asset.creativity : asset.trust;
  const logicFit = route.logic_priority >= 7 && asset.type === "layout" ? 8 : 5;
  const usability = route.design_priority >= 7 ? Math.max(asset.creativity, asset.trust) : asset.trust;
  const tasteMatch = inferTasteMatch(asset, route);
  const accessibility = asset.mobile_safe ? 8 : 3;
  const mobileFit = asset.mobile_safe ? 10 : 2;
  const styleConflict = inferStyleConflict(asset, route);
  const score =
    purposeFit * 3 +
    targetFit * 3 +
    logicFit * 3 +
    usability * 3 +
    tasteMatch * 2 +
    accessibility * 2 +
    mobileFit * 2 -
    asset.performance_cost * 2 -
    inferImplementationComplexity(asset) -
    asset.template_risk * 4 -
    styleConflict * 3;
  const reasons = [
    `Compared against route ${route.project_type} and recipe ${topRecipeId}.`,
    asset.use_case.includes(route.project_type) ? "Asset use_case matches project type." : "Asset use_case is not an exact match.",
    `Creativity/trust/motion: ${asset.creativity}/${asset.trust}/${asset.motion_level}.`
  ];
  const penalties = [
    ...(asset.mobile_safe ? [] : ["Asset is not mobile safe."]),
    ...(asset.performance_cost >= 7 ? ["High performance cost."] : []),
    ...(asset.template_risk >= 6 ? ["High template-risk score."] : []),
    ...(styleConflict > 0 ? ["Asset style conflicts with route priorities."] : [])
  ];

  return {
    id: asset.id,
    score,
    selected: false,
    reasons,
    penalties
  };
}

function rankItems(items: readonly PdosScoredItem[]): readonly PdosScoredItem[] {
  return items
    .slice()
    .sort((first, second) => second.score - first.score || first.id.localeCompare(second.id))
    .map((item, index) => ({ ...item, selected: index === 0 }));
}

function distanceFit(candidate: number, target: number): number {
  return Math.max(0, 10 - Math.abs(candidate - target));
}

function inferTasteMatch(asset: PdosAssetCandidate, route: PdosIntakeRoute): number {
  const creative = asset.style.some((style) => ["editorial", "playful", "motion", "creative"].includes(style));
  const generic = asset.style.some((style) => ["generic", "saas-gradient", "dark-neon"].includes(style));
  if (generic) {
    return 1;
  }
  if (route.design_priority >= 7 && creative) {
    return 9;
  }
  return 6;
}

function inferStyleConflict(asset: PdosAssetCandidate, route: PdosIntakeRoute): number {
  if (route.logic_priority >= 8 && asset.motion_level >= 7) {
    return 5;
  }
  if (route.motion_level <= 2 && asset.type === "3d") {
    return 7;
  }
  return 0;
}

function inferImplementationComplexity(asset: PdosAssetCandidate): number {
  return (asset.dependencies?.length ?? 0) + (asset.type === "3d" ? 5 : 0) + (asset.motion_level >= 7 ? 2 : 0);
}

function sharedCount(first: readonly string[], second: readonly string[]): number {
  const secondSet = new Set(second);
  return first.filter((item) => secondSet.has(item)).length;
}

function buildScoreMarkdown(report: Omit<PdosScoreReport, "report_markdown">): string {
  return [
    "# Product & Design OS Score Report",
    "",
    "## Route",
    `- Project type: ${report.route.project_type}`,
    `- Selected route recipe: ${report.route.selected_recipe}`,
    `- Logic/design/motion: ${report.route.logic_priority}/${report.route.design_priority}/${report.route.motion_level}`,
    `- Risk level: ${report.route.risk_level}`,
    "",
    "## Formula",
    `- ${report.formula}`,
    "",
    "## Selected Recipes",
    ...formatItems(report.selected.recipes),
    "## Rejected Recipes",
    ...formatItems(report.rejected.recipes, "No rejected recipe candidates."),
    "## Selected Patterns",
    ...formatItems(report.selected.patterns, "No pattern candidates are registered yet."),
    "## Rejected Patterns",
    ...formatItems(report.rejected.patterns, "No rejected pattern candidates."),
    "## Selected Assets",
    ...formatItems(report.selected.assets, "No asset candidates are registered yet."),
    "## Rejected Assets",
    ...formatItems(report.rejected.assets, "No rejected asset candidates."),
    "## Warnings",
    ...formatWarnings(report.warnings)
  ].join("\n");
}

function formatItems(items: readonly PdosScoredItem[], fallback = "None."): readonly string[] {
  if (items.length === 0) {
    return [`- ${fallback}`];
  }
  return items.flatMap((item) => [
    `- ${item.id}: ${item.score}`,
    ...item.reasons.map((reason) => `  - ${reason}`),
    ...item.penalties.map((penalty) => `  - Penalty: ${penalty}`)
  ]);
}

function formatWarnings(warnings: readonly string[]): readonly string[] {
  if (warnings.length === 0) {
    return ["- None."];
  }
  return warnings.map((warning) => `- ${warning}`);
}

function loadRecipes(repoRoot: string): readonly PdosRecipeCandidate[] {
  const recipesRoot = join(repoRoot, "product-design-os", "recipes");
  if (!existsSync(recipesRoot)) {
    return [];
  }
  return readdirSync(recipesRoot)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readJson(join(recipesRoot, file)))
    .filter(isRecipeCandidate);
}

function loadPatternManifest(repoRoot: string): readonly PdosPatternCandidate[] {
  const manifest = readJson(join(repoRoot, "product-design-os", "patterns", "pattern-manifest.json"));
  if (!isRecord(manifest) || !Array.isArray(manifest.patterns)) {
    return [];
  }
  return manifest.patterns.filter(isPatternCandidate);
}

function loadAssetManifest(repoRoot: string): readonly PdosAssetCandidate[] {
  const manifest = readJson(join(repoRoot, "product-design-os", "assets", "asset-manifest.json"));
  if (!isRecord(manifest) || !Array.isArray(manifest.assets)) {
    return [];
  }
  return manifest.assets.filter(isAssetCandidate);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function isRecipeCandidate(value: unknown): value is PdosRecipeCandidate {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.project_types) &&
    Array.isArray(value.priorities) &&
    Number.isInteger(value.logic_priority) &&
    Number.isInteger(value.design_priority) &&
    Number.isInteger(value.motion_level) &&
    Array.isArray(value.allowed_patterns) &&
    Array.isArray(value.blocked_assets) &&
    Array.isArray(value.tests_required)
  );
}

function isPatternCandidate(value: unknown): value is PdosPatternCandidate {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    Array.isArray(value.use_case) &&
    Array.isArray(value.good_for) &&
    Array.isArray(value.bad_for) &&
    Number.isInteger(value.complexity) &&
    Number.isInteger(value.usability) &&
    Number.isInteger(value.mobile_quality) &&
    Array.isArray(value.requires) &&
    Array.isArray(value.risks)
  );
}

function isAssetCandidate(value: unknown): value is PdosAssetCandidate {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    Array.isArray(value.style) &&
    Array.isArray(value.use_case) &&
    Array.isArray(value.target) &&
    Number.isInteger(value.creativity) &&
    Number.isInteger(value.trust) &&
    Number.isInteger(value.motion_level) &&
    Number.isInteger(value.performance_cost) &&
    typeof value.mobile_safe === "boolean" &&
    Number.isInteger(value.template_risk)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return 3;
  }
  return Math.max(1, Math.min(10, value));
}

function parseArgs(args: readonly string[]): {
  text?: string;
  format?: "json" | "markdown";
  limit?: number;
} {
  const result: { text?: string; format?: "json" | "markdown"; limit?: number } = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (!value) {
      continue;
    }
    if (key === "--text") {
      result.text = value;
      index += 1;
    } else if (key === "--format" && (value === "json" || value === "markdown")) {
      result.format = value;
      index += 1;
    } else if (key === "--limit") {
      result.limit = Number.parseInt(value, 10);
      index += 1;
    }
  }
  return result;
}

function runCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const input: { text: string; limit?: number } = { text: args.text ?? "" };
  if (args.limit !== undefined) {
    input.limit = args.limit;
  }
  const report = scoreProductDesignOs(input);
  console.log(formatPdosScoreReport(report, args.format));
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (basename(invokedFile) === basename(currentFile) && invokedFile === currentFile) {
  runCli();
}
