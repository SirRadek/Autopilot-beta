import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkRenderedContract } from "./check-render-contract";
import { mapTokensToCss } from "./map-tokens";
import { getPatternComponent, patternComponentRegistry } from "./pattern-component-registry";
import { assertRootColorContrastWcagAA, WcagContrastError } from "./wcag-contrast";
import type {
  AssetManifestEntry,
  ComponentContract,
  QaTarget,
  ResolvedAsset,
  TokenOverrideMap,
  TokenPrimitive
} from "./types";

export interface RenderCompositionResult {
  readonly html: string;
  readonly qaTargets: readonly QaTarget[];
}

export class RenderCompositionSpecError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RenderCompositionSpecError";
    this.code = code;
  }
}

interface CompositionSpec {
  readonly id?: string;
  readonly nodes: readonly CompositionNode[];
  readonly token_overrides?: {
    readonly enabled?: boolean;
    readonly values?: readonly TokenOverrideSpec[];
  };
}

interface CompositionNode {
  readonly node_id?: string;
  readonly target_kind?: string;
  readonly target_id?: string;
  readonly props?: readonly CompositionProp[];
  readonly slot_fills?: readonly SlotFill[];
}

interface CompositionProp {
  readonly name?: string;
  readonly string_value?: string;
  readonly number_value?: number;
  readonly integer_value?: number;
  readonly boolean_value?: boolean;
  readonly ref_value?: string;
}

interface SlotFill {
  readonly slot?: string;
  readonly fills?: readonly SlotFillTarget[];
}

interface SlotFillTarget {
  readonly target_kind?: string;
  readonly target_id?: string;
}

interface TokenOverrideSpec {
  readonly token_file?: string;
  readonly token_key?: string;
  readonly value?: TokenPrimitive;
}

interface RenderPatternData {
  readonly patternId: string;
  readonly nodeId: string;
  readonly props: Record<string, string>;
  readonly slotFills: readonly SlotFill[];
  readonly tokenOverrides: TokenOverrideMap;
}

interface ContractManifest {
  readonly contracts?: readonly ComponentContract[];
}

interface AssetManifest {
  readonly assets?: readonly AssetManifestEntry[];
}

const defaultHeroData: RenderPatternData = {
  patternId: "sharp-positioning-hero",
  nodeId: "positioning-hero",
  props: {
    headline: "A premium launch page with clear proof before polish",
    primary_cta: "Request a plan",
    trust_cue: "Case-backed launch process"
  },
  slotFills: [
    { slot: "hero_asset", fills: [{ target_kind: "asset", target_id: "editorial-motion-hero" }] },
    { slot: "theme_background", fills: [{ target_kind: "asset", target_id: "theme-calm-prism-grid" }] }
  ],
  tokenOverrides: {}
};

export function renderComposition(specOrPattern: unknown, pdosRoot: string): RenderCompositionResult {
  const patternData = resolvePatternData(specOrPattern);
  const component = getPatternComponent(patternData.patternId);
  const contract = readPatternContract(pdosRoot, patternData.patternId);
  const assetManifest = readAssetManifest(pdosRoot);
  const slots = resolveSlots(patternData.slotFills, assetManifest, pdosRoot, contract);
  const tokenCss = mapTokensToCss(pdosRoot, patternData.tokenOverrides);
  assertTokenColorContrast(tokenCss);

  const fragment = component.render({
    props: patternData.props,
    slots,
    contract
  });

  const title = patternData.props.headline ?? "Sharp positioning hero";
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    tokenCss,
    documentBaseCss,
    component.css,
    "</style>",
    "</head>",
    "<body>",
    fragment,
    "</body>",
    "</html>"
  ].join("\n");

  return {
    html,
    qaTargets: [
      {
        patternId: patternData.patternId,
        contractId: contract.id,
        invariants: contract.output_invariants.map((invariant) => invariant.code),
        selectors: {
          h1: 'h1[data-contract-prop="headline"]',
          cta: 'a[data-contract-prop="primary_cta"]',
          trustCue: '[data-contract-prop="trust_cue"]'
        }
      }
    ]
  };
}

const documentBaseCss = `
html {
  min-width: 320px;
  color: var(--color-text);
  background: var(--color-background);
}

body {
  margin: 0;
  font-family: var(--type-font-body);
  font-size: var(--type-size-body);
  line-height: var(--type-line-height-body);
  color: var(--color-text);
  background: var(--color-background);
}
`.trim();

function assertTokenColorContrast(tokenCss: string): void {
  try {
    assertRootColorContrastWcagAA(tokenCss);
  } catch (error) {
    if (error instanceof WcagContrastError) {
      throw new RenderCompositionSpecError("token_color_contrast_below_aa", error.message);
    }
    throw error;
  }
}

function resolvePatternData(input: unknown): RenderPatternData {
  if (input === undefined || input === null) {
    return defaultHeroData;
  }

  if (isRecord(input) && "pattern_id" in input) {
    if (!isRegisteredPattern(input.pattern_id)) {
      throw new RenderCompositionSpecError(
        "unsupported_pattern_id",
        `Unsupported pattern id "${String(input.pattern_id)}" — no renderer is registered for it.`
      );
    }

    return {
      patternId: input.pattern_id,
      nodeId: typeof input.node_id === "string" ? input.node_id : "direct-pattern",
      props: readDirectProps(input.props),
      slotFills: readSlotFills(input.slot_fills),
      tokenOverrides: {}
    };
  }

  if (isRecord(input) && "nodes" in input) {
    const spec = readCompositionSpec(input);
    // Render the first pattern node that has a registered renderer.
    const node = spec.nodes.find(
      (candidate) => candidate.target_kind === "pattern" && isRegisteredPattern(candidate.target_id)
    );

    if (node === undefined || node.target_id === undefined) {
      const renderedPatternIds = spec.nodes
        .filter((candidate) => candidate.target_kind === "pattern")
        .map((candidate) => candidate.target_id ?? "<missing>");
      throw new RenderCompositionSpecError(
        "pattern_node_missing",
        `Composition spec does not contain a renderable pattern node (no registered renderer). Pattern nodes: ${renderedPatternIds.join(", ")}.`
      );
    }

    return {
      patternId: node.target_id,
      nodeId: node.node_id ?? "pattern-node",
      props: readCompositionProps(node.props),
      slotFills: readSlotFills(node.slot_fills),
      tokenOverrides: readTokenOverrides(spec)
    };
  }

  throw new RenderCompositionSpecError("malformed_spec", "Expected no spec, a direct pattern input, or a composition spec.");
}

function readDirectProps(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    throw new RenderCompositionSpecError("malformed_pattern_props", "Direct pattern input must include a props object.");
  }

  const props: Record<string, string> = {};
  for (const [key, propValue] of Object.entries(value)) {
    if (typeof propValue !== "string") {
      throw new RenderCompositionSpecError("malformed_pattern_props", `Direct pattern prop "${key}" must be a string.`);
    }
    props[key] = propValue;
  }

  return props;
}

function readCompositionProps(props: unknown): Record<string, string> {
  if (props === undefined) {
    return {};
  }

  if (!Array.isArray(props)) {
    throw new RenderCompositionSpecError("malformed_node_props", "Composition node props must be an array.");
  }

  const result: Record<string, string> = {};

  for (const prop of props) {
    if (!isRecord(prop)) {
      throw new RenderCompositionSpecError("malformed_node_props", "Composition node props must contain objects.");
    }

    if (typeof prop.name !== "string") {
      throw new RenderCompositionSpecError("malformed_node_props", "Composition node prop is missing a string name.");
    }

    const value = compositionPropValue(prop as unknown as CompositionProp);
    if (value !== undefined) {
      result[prop.name] = value;
    }
  }

  return result;
}

function compositionPropValue(prop: CompositionProp): string | undefined {
  if (prop.string_value !== undefined) {
    return prop.string_value;
  }
  if (prop.ref_value !== undefined) {
    return prop.ref_value;
  }
  if (prop.integer_value !== undefined) {
    return String(prop.integer_value);
  }
  if (prop.number_value !== undefined) {
    return String(prop.number_value);
  }
  if (prop.boolean_value !== undefined) {
    return String(prop.boolean_value);
  }
  return undefined;
}

function readTokenOverrides(spec: CompositionSpec): TokenOverrideMap {
  if (spec.token_overrides?.enabled !== true) {
    return {};
  }

  if (spec.token_overrides.values !== undefined && !Array.isArray(spec.token_overrides.values)) {
    throw new RenderCompositionSpecError("malformed_token_overrides", "Token override values must be an array.");
  }

  const overrides: Record<string, Record<string, TokenPrimitive>> = Object.create(null) as Record<
    string,
    Record<string, TokenPrimitive>
  >;

  for (const override of spec.token_overrides.values ?? []) {
    if (!isRecord(override)) {
      throw new RenderCompositionSpecError("malformed_token_overrides", "Token override entries must be objects.");
    }

    if (typeof override.token_file !== "string" || typeof override.token_key !== "string" || override.value === undefined) {
      throw new RenderCompositionSpecError("malformed_token_overrides", "Token override entries require token_file, token_key, and value.");
    }

    if (!isTokenPrimitive(override.value)) {
      throw new RenderCompositionSpecError("malformed_token_overrides", "Token override value must be a string, number, or boolean.");
    }

    const tokenFile = override.token_file.replace(/\.json$/i, "");
    overrides[tokenFile] = {
      ...(overrides[tokenFile] ?? {}),
      [override.token_key]: override.value
    };
  }

  return overrides;
}

function readCompositionSpec(input: Record<string, unknown>): CompositionSpec {
  if (!Array.isArray(input.nodes)) {
    throw new RenderCompositionSpecError("malformed_spec", "Composition spec must include a nodes array.");
  }

  const nodes: CompositionNode[] = [];
  for (const node of input.nodes) {
    if (!isRecord(node)) {
      throw new RenderCompositionSpecError("malformed_spec", "Composition spec nodes must contain objects.");
    }
    nodes.push(node as unknown as CompositionNode);
  }

  const spec: CompositionSpec = { nodes };
  if (typeof input.id === "string") {
    (spec as { id?: string }).id = input.id;
  }

  if ("token_overrides" in input) {
    if (!isRecord(input.token_overrides)) {
      throw new RenderCompositionSpecError("malformed_token_overrides", "token_overrides must be an object.");
    }

    const tokenOverrides: NonNullable<CompositionSpec["token_overrides"]> = {};
    if (input.token_overrides.enabled !== undefined) {
      if (typeof input.token_overrides.enabled !== "boolean") {
        throw new RenderCompositionSpecError("malformed_token_overrides", "token_overrides.enabled must be boolean.");
      }
      (tokenOverrides as { enabled?: boolean }).enabled = input.token_overrides.enabled;
    }

    if (input.token_overrides.values !== undefined) {
      if (!Array.isArray(input.token_overrides.values)) {
        throw new RenderCompositionSpecError("malformed_token_overrides", "token_overrides.values must be an array.");
      }
      (tokenOverrides as { values?: readonly TokenOverrideSpec[] }).values = input.token_overrides.values as readonly TokenOverrideSpec[];
    }

    (spec as { token_overrides?: NonNullable<CompositionSpec["token_overrides"]> }).token_overrides = tokenOverrides;
  }

  return spec;
}

function readSlotFills(value: unknown): readonly SlotFill[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new RenderCompositionSpecError("malformed_slot_fills", "slot_fills must be an array.");
  }

  const slotFills: SlotFill[] = [];
  for (const slotFill of value) {
    if (!isRecord(slotFill)) {
      throw new RenderCompositionSpecError("malformed_slot_fills", "slot_fills entries must be objects.");
    }

    if (typeof slotFill.slot !== "string") {
      throw new RenderCompositionSpecError("malformed_slot_fills", "slot_fills entries require a slot name.");
    }

    if (slotFill.fills !== undefined && !Array.isArray(slotFill.fills)) {
      throw new RenderCompositionSpecError("malformed_slot_fills", `slot_fills for "${slotFill.slot}" must contain a fills array.`);
    }

    for (const fill of slotFill.fills ?? []) {
      if (!isRecord(fill)) {
        throw new RenderCompositionSpecError("malformed_slot_fills", `slot_fills for "${slotFill.slot}" must contain fill objects.`);
      }
      if (typeof fill.target_kind !== "string" || typeof fill.target_id !== "string") {
        throw new RenderCompositionSpecError(
          "malformed_slot_fills",
          `slot_fills for "${slotFill.slot}" require target_kind and target_id.`
        );
      }
    }

    slotFills.push(slotFill as unknown as SlotFill);
  }

  return slotFills;
}

function readPatternContract(pdosRoot: string, patternId: string): ComponentContract {
  const manifest = readJson<ContractManifest>(path.join(pdosRoot, "contracts", "component-contract-manifest.json"));
  const contract = manifest.contracts?.find(
    (candidate) => candidate.target_kind === "pattern" && candidate.target_id === patternId
  );

  if (contract === undefined) {
    throw new Error(`Missing contract for pattern ${patternId}.`);
  }

  return contract;
}

function readAssetManifest(pdosRoot: string): AssetManifest {
  return readJson<AssetManifest>(path.join(pdosRoot, "assets", "asset-manifest.json"));
}

function isRegisteredPattern(patternId: unknown): patternId is string {
  return typeof patternId === "string" && Object.prototype.hasOwnProperty.call(patternComponentRegistry, patternId);
}

function resolveSlots(
  slotFills: readonly SlotFill[],
  assetManifest: AssetManifest,
  pdosRoot: string,
  contract: ComponentContract
): Record<string, readonly ResolvedAsset[]> {
  // Resolve every declared slot generically so any registered renderer gets its slots
  // (sharp-positioning-hero reads hero_asset/theme_background; dot-stage-hero reads motion_background).
  const slots: Record<string, ResolvedAsset[]> = {};

  for (const slotFill of slotFills) {
    if (slotFill.slot === undefined) {
      continue;
    }

    const contractSlot = contract.slots.find((slot) => slot.name === slotFill.slot);
    const resolvedAssets: ResolvedAsset[] = [];
    for (const fill of slotFill.fills ?? []) {
      if (fill.target_kind !== "asset" || fill.target_id === undefined) {
        continue;
      }

      resolvedAssets.push(
        resolveAsset(fill.target_id, assetManifest, pdosRoot, {
          required: contractSlot?.required === true,
          slotName: slotFill.slot
        })
      );
    }

    slots[slotFill.slot] = resolvedAssets;
  }

  return slots;
}

function resolveAsset(
  assetId: string,
  assetManifest: AssetManifest,
  pdosRoot: string,
  context: { readonly required: boolean; readonly slotName: string }
): ResolvedAsset {
  const asset = assetManifest.assets?.find((candidate) => candidate.id === assetId);
  if (asset === undefined) {
    if (context.required) {
      throw new RenderCompositionSpecError(
        "asset_manifest_entry_missing",
        `Required slot "${context.slotName}" references missing asset manifest entry ${assetId}.`
      );
    }
    return {
      id: assetId,
      targetKind: "asset",
      assetType: "unknown",
      source: ""
    };
  }

  const assetSource = typeof asset.source === "string" ? asset.source : "";
  const resolvedSource = resolveAssetSource({ ...asset, source: assetSource }, pdosRoot, context);
  const base = {
    id: asset.id,
    targetKind: "asset" as const,
    assetType: asset.type,
    source: assetSource
  };

  return {
    ...base,
    ...resolvedSource
  };
}

function resolveAssetSource(
  asset: AssetManifestEntry,
  pdosRoot: string,
  context: { readonly required: boolean; readonly slotName: string }
): { readonly href?: string; readonly inlineSvg?: string } {
  if (asset.source.trim().length === 0) {
    return handleUnresolvedAssetSource(
      "asset_source_missing",
      `Asset ${asset.id} must include a source before it can fill slot "${context.slotName}".`,
      context
    );
  }

  const normalizedSource = asset.source.replace(/\\/g, "/");
  if (!isLocalProductDesignOsSource(normalizedSource)) {
    return {};
  }

  const repoRoot = path.dirname(pdosRoot);
  const absolutePath = path.resolve(repoRoot, ...normalizedSource.split("/"));
  const pdosRootPath = path.resolve(repoRoot, "product-design-os");
  if (!isPathInside(absolutePath, pdosRootPath)) {
    return handleUnresolvedAssetSource(
      "asset_source_unsafe",
      `Asset source escapes product-design-os: ${normalizedSource}.`,
      context
    );
  }

  let sourceExists = false;
  try {
    sourceExists = existsSync(absolutePath);
  } catch (error) {
    return handleUnresolvedAssetSource(
      "asset_source_unreadable",
      `Asset source could not be checked: ${normalizedSource}. ${errorMessage(error)}`,
      context
    );
  }

  if (!sourceExists) {
    return handleUnresolvedAssetSource(
      "asset_source_missing",
      `Asset source file does not exist: ${normalizedSource}.`,
      context
    );
  }

  try {
    if (!statSync(absolutePath).isFile()) {
      return handleUnresolvedAssetSource(
        "asset_source_not_file",
        `Asset source must resolve to a file: ${normalizedSource}.`,
        sourceMustResolveToFile(asset) ? context : { ...context, required: false }
      );
    }
  } catch (error) {
    return handleUnresolvedAssetSource(
      "asset_source_unreadable",
      `Asset source could not be read: ${normalizedSource}. ${errorMessage(error)}`,
      context
    );
  }

  return { href: `../../${normalizedSource}` };
}

function isLocalProductDesignOsSource(source: string): boolean {
  return source === "product-design-os" || source.startsWith("product-design-os/");
}

function sourceMustResolveToFile(asset: AssetManifestEntry): boolean {
  const normalizedSource = asset.source.replace(/\\/g, "/");
  return normalizedSource !== "product-design-os" || asset.type === "background" || /\.(?:svg|png|jpe?g|webp|gif)$/i.test(asset.source);
}

function handleUnresolvedAssetSource(
  code: string,
  message: string,
  context: { readonly required: boolean }
): { readonly href?: string; readonly inlineSvg?: string } {
  if (context.required) {
    throw new RenderCompositionSpecError(code, message);
  }
  return {};
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenPrimitive(value: unknown): value is TokenPrimitive {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  const pdosRoot = path.join(repoRoot, "product-design-os");
  const specArg = process.argv[2];
  const specPath =
    specArg !== undefined
      ? path.resolve(repoRoot, specArg)
      : path.join(pdosRoot, "specs", "examples", "buildable-marketing.composition.json");
  const spec = readJson<CompositionSpec>(specPath);
  const result = renderComposition(spec, pdosRoot);

  const patternId = result.qaTargets[0]?.patternId ?? "composition";
  const outputDir = path.join(repoRoot, "output", "render");
  const outputPath = path.join(outputDir, `${patternId}.html`);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, result.html, "utf8");

  const contract = readPatternContract(pdosRoot, patternId);
  const report = checkRenderedContract(result.html, contract);
  if (report.errors.length > 0) {
    throw new Error(`Rendered contract failed: ${report.errors.map((issue) => issue.code).join(", ")}`);
  }

  console.log(`Rendered ${path.relative(repoRoot, outputPath).replace(/\\/g, "/")}`);
}
