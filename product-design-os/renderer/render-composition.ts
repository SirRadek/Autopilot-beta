import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkRenderedContract, type RenderContractIssue } from "./check-render-contract";
import { mapTokensToCss } from "./map-tokens";
import { getPatternComponent, hasPatternComponent, hasSectionPatternComponent } from "./pattern-component-registry";
import { isSafeHref } from "./safe-url";
import { assertRootColorContrastWcagAA, WcagContrastError } from "./wcag-contrast";
import type {
  AssetManifestEntry,
  ComponentContract,
  PatternPropMap,
  PatternSlotMap,
  QaTarget,
  ResolvedAsset,
  ResolvedPatternReference,
  ResolvedSlotTarget,
  TokenOverrideMap,
  TokenPrimitive
} from "./types";

export interface RenderCompositionResult {
  readonly html: string;
  readonly qaTargets: readonly QaTarget[];
}

export interface RenderCompositionPageResult {
  readonly html: string;
  readonly sections: readonly RenderedCompositionSection[];
  readonly skipped: readonly SkippedCompositionNode[];
}

export interface RenderedCompositionSection {
  readonly node_id: string;
  readonly pattern_id: string;
  readonly contractErrors: readonly RenderContractIssue[];
}

export interface SkippedCompositionNode {
  readonly node_id: string;
  readonly reason: string;
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
  readonly content?: InlineContentAsset;
}

interface InlineContentAsset {
  readonly href?: string;
  readonly alt?: string;
  readonly license?: string;
  readonly source_url?: string;
  readonly inline_svg?: string;
  readonly asset_type?: string;
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
  readonly compositionNodes?: readonly CompositionNode[];
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
  if (!hasPatternComponent(patternData.patternId)) {
    throw new RenderCompositionSpecError(
      "unsupported_pattern_id",
      `No renderer registered for pattern ${patternData.patternId}.`
    );
  }
  const component = getPatternComponent(patternData.patternId);
  const contract = readPatternContract(pdosRoot, patternData.patternId);
  const assetManifest = readAssetManifest(pdosRoot);
  const slots = resolveSlots(patternData.slotFills, assetManifest, pdosRoot, contract, patternData.compositionNodes);
  const tokenCss = mapTokensToCss(pdosRoot, patternData.tokenOverrides);
  const fontHeadLinks = renderWebFontHeadLinks(tokenCss);

  const fragment = component.render({
    props: patternData.props,
    slots,
    contract
  });

  const title = patternData.props.headline ?? patternData.props.outcome_statement ?? patternData.patternId;
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    ...fontHeadLinks,
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
  assertTokenColorContrast(html);

  return {
    html,
    qaTargets: [
      {
        patternId: patternData.patternId,
        contractId: contract.id,
        invariants: contract.output_invariants.map((invariant) => invariant.code),
        selectors: {
          h1: selectorForFirstContractProp(contract, ["headline", "outcome_statement"]),
          cta: selectorForFirstContractProp(contract, ["primary_cta", "cta_label"], "a.cta"),
          trustCue: selectorForFirstContractProp(contract, ["trust_cue", "proof_item", "source_reference"], "[data-contract-slot]")
        }
      }
    ]
  };
}

export function renderCompositionPage(specInput: unknown, pdosRoot: string): RenderCompositionPageResult {
  if (!isRecord(specInput) || !("nodes" in specInput)) {
    throw new RenderCompositionSpecError("malformed_spec", "Expected a composition spec with a nodes array.");
  }

  const spec = readCompositionSpec(specInput);
  const assetManifest = readAssetManifest(pdosRoot);
  const contractManifest = readContractManifest(pdosRoot);
  const tokenOverrides = readTokenOverrides(spec);
  const tokenCss = mapTokensToCss(pdosRoot, tokenOverrides);
  const fontHeadLinks = renderWebFontHeadLinks(tokenCss);

  const fragments: string[] = [];
  const sections: RenderedCompositionSection[] = [];
  const skipped: SkippedCompositionNode[] = [];
  const componentCss = new Set<string>();

  spec.nodes.forEach((node, index) => {
    const nodeId = node.node_id ?? `composition-node-${index + 1}`;

    if (node.target_kind === "asset") {
      skipped.push({
        node_id: nodeId,
        reason: `Asset ${node.target_id ?? "<missing>"} is slot-only and skipped during section rendering.`
      });
      return;
    }

    if (node.target_kind !== "pattern") {
      throw new RenderCompositionSpecError(
        "unsupported_target_kind",
        `Composition node ${nodeId} has unsupported target_kind ${node.target_kind ?? "<missing>"}.`
      );
    }

    const patternId = node.target_id;
    if (typeof patternId !== "string" || patternId.trim().length === 0) {
      throw new RenderCompositionSpecError("malformed_pattern_id", `Pattern node ${nodeId} is missing a string target_id.`);
    }

    const contract = findPatternContract(contractManifest, patternId);
    if (!hasPatternComponent(patternId)) {
      if (contract !== undefined) {
        skipped.push({
          node_id: nodeId,
          reason: `Pattern ${patternId} has a contract but no registered section renderer.`
        });
        return;
      }

      throw new RenderCompositionSpecError(
        "unsupported_pattern_id",
        `No renderer or contract registered for pattern ${patternId} on node ${nodeId}.`
      );
    }

    if (!hasSectionPatternComponent(patternId)) {
      skipped.push({
        node_id: nodeId,
        reason: `Pattern ${patternId} is registered, but not as a section renderer.`
      });
      return;
    }

    if (contract === undefined) {
      throw new RenderCompositionSpecError("contract_missing", `Missing contract for renderable pattern ${patternId}.`);
    }

    const component = getPatternComponent(patternId);
    const fragment = component.render({
      props: readCompositionProps(node.props),
      slots: resolveSlots(readSlotFills(node.slot_fills), assetManifest, pdosRoot, contract, spec.nodes),
      contract
    });
    const report = checkRenderedContract(fragment, contract);

    componentCss.add(component.css);
    fragments.push(fragment);
    sections.push({
      node_id: nodeId,
      pattern_id: patternId,
      contractErrors: report.errors
    });
  });

  if (sections.length === 0) {
    const skippedPatternIds = skipped.map((node) => `${node.node_id} (${node.reason})`).join("; ");
    throw new RenderCompositionSpecError(
      "pattern_node_missing",
      `Composition spec does not contain a renderable section pattern node. Skipped nodes: ${skippedPatternIds || "<none>"}.`
    );
  }

  const title = typeof spec.id === "string" ? spec.id : sections[0]?.pattern_id ?? "composition";
  const html = renderHtmlDocument({
    title,
    tokenCss,
    fontHeadLinks,
    componentCss: [...componentCss].join("\n\n"),
    body: `<main class="pdos-page" data-composition-id="${escapeAttribute(title)}">\n${fragments.join("\n")}\n</main>`
  });
  assertTokenColorContrast(html);

  return {
    html,
    sections,
    skipped
  };
}

const documentBaseCss = `
*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  min-width: 320px;
  color: var(--color-text);
  background: var(--color-background);
}

body {
  --pdos-page-container-max: 1180px;
  --pdos-page-gutter: var(--space-6);
  --pdos-page-section-padding-block: calc(var(--space-8) * 2);
  --pdos-page-section-gap: calc(var(--space-8) * 2);
  --pdos-type-kicker: 0.84rem;
  --pdos-type-body-lg: 1.15rem;
  --pdos-type-heading: 5rem;
  --pdos-type-display: 7.4rem;
  margin: 0;
  font-family: var(--type-font-body);
  font-size: var(--type-size-body);
  line-height: var(--type-line-height-body);
  color: var(--color-text);
  background: var(--color-background);
}

img,
svg {
  max-width: 100%;
}

.pdos-page {
  min-height: 100svh;
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: grid;
  row-gap: 0;
  color: var(--color-text);
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--color-border) 26%, transparent) 1px, transparent 1px),
    linear-gradient(0deg, color-mix(in srgb, var(--color-border) 22%, transparent) 1px, transparent 1px),
    var(--style-surface-background);
  background-size:
    clamp(7rem, 16vw, 14rem) clamp(7rem, 16vw, 14rem),
    clamp(7rem, 16vw, 14rem) clamp(7rem, 16vw, 14rem),
    auto;
}

.pdos-page > section {
  position: relative;
  z-index: 1;
  background: transparent;
}

.sharp-positioning-hero__copy::before,
.proof-led-section__content::before,
.outcome-cta__inner::before {
  content: "";
  display: block;
  width: clamp(5rem, 18cqi, 14rem);
  height: var(--style-decoration-border-width);
  border-radius: var(--style-corner-radius);
  background: var(--color-accent-secondary);
  opacity: var(--style-decoration-opacity);
  transform: rotate(var(--style-accent-angle-deg));
  transform-origin: left center;
}

.cta {
  min-width: 44px;
  min-height: 44px;
  width: fit-content;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4) var(--space-6);
  border: 1px solid var(--color-accent);
  border-radius: var(--style-corner-radius);
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

.cta:hover {
  transform: translateY(-1px);
  border-color: var(--color-accent-secondary);
  background: var(--color-accent-secondary);
}

.cta--secondary {
  color: var(--color-accent);
  background: transparent;
  border-color: var(--color-accent);
  box-shadow: none;
}

.cta--secondary:hover {
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  border-color: var(--color-accent-secondary);
  box-shadow: var(--shadow-sm);
}

.cta:focus-visible {
  outline: 3px solid var(--color-focus-ring);
  outline-offset: 3px;
}

@media (max-width: 760px) {
  body {
    --pdos-page-gutter: var(--space-4);
    --pdos-page-section-padding-block: var(--space-8);
    --pdos-page-section-gap: var(--space-8);
    --pdos-type-heading: 3.35rem;
    --pdos-type-display: 4.5rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cta {
    transition: none;
  }

  .cta:hover {
    transform: none;
  }
}
`.trim();

function renderHtmlDocument(input: {
  readonly title: string;
  readonly tokenCss: string;
  readonly fontHeadLinks: readonly string[];
  readonly componentCss: string;
  readonly body: string;
}): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    ...input.fontHeadLinks,
    `<title>${escapeHtml(input.title)}</title>`,
    "<style>",
    input.tokenCss,
    documentBaseCss,
    input.componentCss,
    "</style>",
    "</head>",
    "<body>",
    input.body,
    "</body>",
    "</html>"
  ].join("\n");
}

function renderWebFontHeadLinks(tokenCss: string): readonly string[] {
  const family = cssRootVarValue(tokenCss, "type-web-font-family");
  if (family === undefined || family.toLowerCase() === "none") {
    return [];
  }

  if (!/^[a-zA-Z0-9 ]{1,80}$/.test(family)) {
    return [];
  }

  const weights = normalizeGoogleFontWeights(cssRootVarValue(tokenCss, "type-web-font-weights") ?? "400,700");
  if (weights.length === 0) {
    return [];
  }

  const familyQuery = encodeURIComponent(family).replace(/%20/g, "+");
  const href = `https://fonts.googleapis.com/css2?family=${familyQuery}:wght@${weights.join(";")}&display=swap`;
  if (!isSafeHref(href)) {
    return [];
  }

  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${escapeAttribute(href)}">`
  ];
}

function cssRootVarValue(css: string, name: string): string | undefined {
  const rootBlock = /:root\{([\s\S]*?)\n\}/.exec(css)?.[1];
  if (rootBlock === undefined) {
    return undefined;
  }

  const match = new RegExp(`--${escapeRegExp(name)}:\\s*([^;]+);`).exec(rootBlock);
  return match?.[1]?.trim();
}

function normalizeGoogleFontWeights(value: string): readonly string[] {
  const weights = value.split(",").map((weight) => weight.trim()).filter((weight) => weight.length > 0);
  return weights.every((weight) => /^(?:[1-9]00)$/.test(weight)) ? weights : [];
}

function selectorForFirstContractProp(contract: ComponentContract, propNames: readonly string[], fallback = "[data-contract-prop]"): string {
  const propName = propNames.find((candidate) => contract.props.some((prop) => prop.name === candidate));
  if (propName === undefined) {
    return fallback;
  }
  return `[data-contract-prop="${propName}"]`;
}

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
    if (typeof input.pattern_id !== "string") {
      throw new RenderCompositionSpecError(
        "malformed_pattern_id",
        `Direct pattern input must include a string pattern_id.`
      );
    }

    if (!hasPatternComponent(input.pattern_id)) {
      throw new RenderCompositionSpecError(
        "unsupported_pattern_id",
        `No renderer registered for pattern ${input.pattern_id}.`
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
    const node = spec.nodes.find((candidate) => {
      return candidate.target_kind === "pattern" && typeof candidate.target_id === "string" && hasPatternComponent(candidate.target_id);
    });

    if (node === undefined) {
      const renderedPatternIds = spec.nodes
        .filter((candidate) => candidate.target_kind === "pattern")
        .map((candidate) => candidate.target_id ?? "<missing>");
      const code = renderedPatternIds.length === 0 ? "pattern_node_missing" : "unsupported_pattern_id";
      throw new RenderCompositionSpecError(
        code,
        `Composition spec does not contain a registered renderable pattern node. Pattern nodes: ${renderedPatternIds.join(", ")}.`
      );
    }

    return {
      patternId: node.target_id ?? "",
      nodeId: node.node_id ?? "rendered-pattern",
      props: readCompositionProps(node.props),
      slotFills: readSlotFills(node.slot_fills),
      tokenOverrides: readTokenOverrides(spec),
      compositionNodes: spec.nodes
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
      if (typeof fill.target_kind !== "string") {
        throw new RenderCompositionSpecError(
          "malformed_slot_fills",
          `slot_fills for "${slotFill.slot}" require target_kind.`
        );
      }

      if (fill.target_kind === "asset") {
        const hasRegistryId = typeof fill.target_id === "string";
        const hasInlineContent = fill.content !== undefined;
        if (!hasRegistryId && !hasInlineContent) {
          throw new RenderCompositionSpecError(
            "malformed_slot_fills",
            `slot_fills for "${slotFill.slot}" require target_id or content for asset fills.`
          );
        }

        if (hasInlineContent && !isRecord(fill.content)) {
          throw new RenderCompositionSpecError(
            "malformed_slot_fills",
            `slot_fills content for "${slotFill.slot}" must be an object.`
          );
        }
        continue;
      }

      if (typeof fill.target_id !== "string") {
        throw new RenderCompositionSpecError(
          "malformed_slot_fills",
          `slot_fills for "${slotFill.slot}" require target_id.`
        );
      }
    }

    slotFills.push(slotFill as unknown as SlotFill);
  }

  return slotFills;
}

function readPatternContract(pdosRoot: string, patternId: string): ComponentContract {
  const contract = findPatternContract(readContractManifest(pdosRoot), patternId);

  if (contract === undefined) {
    throw new Error(`Missing contract for pattern ${patternId}.`);
  }

  return contract;
}

function readContractManifest(pdosRoot: string): ContractManifest {
  return readJson<ContractManifest>(path.join(pdosRoot, "contracts", "component-contract-manifest.json"));
}

function findPatternContract(manifest: ContractManifest, patternId: string): ComponentContract | undefined {
  return manifest.contracts?.find(
    (candidate) => candidate.target_kind === "pattern" && candidate.target_id === patternId
  );
}

function readAssetManifest(pdosRoot: string): AssetManifest {
  return readJson<AssetManifest>(path.join(pdosRoot, "assets", "asset-manifest.json"));
}

function resolveSlots(
  slotFills: readonly SlotFill[],
  assetManifest: AssetManifest,
  pdosRoot: string,
  contract: ComponentContract,
  compositionNodes: readonly CompositionNode[] = []
): PatternSlotMap {
  const slots: Record<string, ResolvedSlotTarget[]> = {};

  for (const slotFill of slotFills) {
    if (slotFill.slot === undefined) {
      continue;
    }

    const contractSlot = contract.slots.find((slot) => slot.name === slotFill.slot);
    if (contractSlot === undefined) {
      throw new RenderCompositionSpecError(
        "unknown_slot_name",
        `Pattern ${contract.target_id} does not define slot "${slotFill.slot}".`
      );
    }

    const resolvedTargets: ResolvedSlotTarget[] = [];
    for (const fill of slotFill.fills ?? []) {
      if (fill.target_kind !== "asset" && fill.target_kind !== "pattern") {
        throw new RenderCompositionSpecError(
          "unsupported_slot_fill_target_kind",
          `Slot "${slotFill.slot}" on pattern ${contract.target_id} has unsupported fill target_kind ${fill.target_kind ?? "<missing>"}.`
        );
      }

      if (fill.target_kind === "asset") {
        if (fill.content !== undefined) {
          resolvedTargets.push(
            resolveInlineContentAsset(fill.content, {
              assetType: defaultInlineAssetType(contractSlot),
              required: contractSlot.required === true,
              slotName: slotFill.slot
            })
          );
          continue;
        }

        if (fill.target_id === undefined) {
          throw new RenderCompositionSpecError(
            "malformed_slot_fills",
            `slot_fills for "${slotFill.slot}" require target_id or content for asset fills.`
          );
        }

        resolvedTargets.push(
          resolveAsset(fill.target_id, assetManifest, pdosRoot, {
            required: contractSlot?.required === true,
            slotName: slotFill.slot
          })
        );
        continue;
      }

      if (fill.target_kind === "pattern") {
        if (fill.target_id === undefined) {
          throw new RenderCompositionSpecError(
            "malformed_slot_fills",
            `slot_fills for "${slotFill.slot}" require target_id for pattern fills.`
          );
        }

        resolvedTargets.push(resolvePatternReference(fill.target_id, compositionNodes));
      }
    }

    slots[slotFill.slot] = resolvedTargets;
  }

  return slots;
}

function resolvePatternReference(patternReferenceId: string, compositionNodes: readonly CompositionNode[]): ResolvedPatternReference {
  const nodeIdMatches = compositionNodes.filter((node) => node.target_kind === "pattern" && node.node_id === patternReferenceId);
  if (nodeIdMatches.length > 1) {
    throw new RenderCompositionSpecError(
      "ambiguous_pattern_node_id",
      `Pattern slot reference ${patternReferenceId} matched multiple composition node_id values.`
    );
  }

  if (nodeIdMatches.length === 1) {
    const sourceNode = nodeIdMatches[0];
    if (sourceNode === undefined) {
      throw new RenderCompositionSpecError("ambiguous_pattern_node_id", `Pattern slot reference ${patternReferenceId} was unreadable.`);
    }
    return resolvedPatternReferenceFromNode(patternReferenceId, sourceNode);
  }

  const targetIdMatches = compositionNodes.filter((node) => node.target_kind === "pattern" && node.target_id === patternReferenceId);
  if (targetIdMatches.length > 1) {
    throw new RenderCompositionSpecError(
      "ambiguous_pattern_target_id",
      `Pattern slot reference ${patternReferenceId} matched ${targetIdMatches.length} composition nodes by target_id; use a node_id target instead.`
    );
  }

  if (targetIdMatches.length === 1) {
    const sourceNode = targetIdMatches[0];
    if (sourceNode === undefined) {
      throw new RenderCompositionSpecError("ambiguous_pattern_target_id", `Pattern slot reference ${patternReferenceId} was unreadable.`);
    }
    return resolvedPatternReferenceFromNode(patternReferenceId, sourceNode);
  }

  return {
    id: patternReferenceId,
    targetKind: "pattern"
  };
}

function resolvedPatternReferenceFromNode(patternReferenceId: string, sourceNode: CompositionNode): ResolvedPatternReference {
  if (typeof sourceNode.target_id !== "string" || sourceNode.target_id.trim().length === 0) {
    throw new RenderCompositionSpecError(
      "malformed_pattern_id",
      `Pattern slot reference ${patternReferenceId} resolves to a node without a string target_id.`
    );
  }

  const reference: ResolvedPatternReference = {
    id: sourceNode.target_id,
    targetKind: "pattern"
  };

  if (sourceNode?.node_id !== undefined) {
    (reference as { nodeId?: string }).nodeId = sourceNode.node_id;
  }

  if (sourceNode?.props !== undefined) {
    (reference as { props?: PatternPropMap }).props = readCompositionProps(sourceNode.props);
  }

  return reference;
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

function resolveInlineContentAsset(
  content: InlineContentAsset,
  context: { readonly required: boolean; readonly slotName: string; readonly assetType: string }
): ResolvedAsset {
  if (!isRecord(content)) {
    throw new RenderCompositionSpecError("malformed_inline_asset", `Inline asset content for "${context.slotName}" must be an object.`);
  }

  const href = optionalTrimmedString(content.href);
  const inlineSvg = optionalTrimmedString(content.inline_svg);

  if (href === undefined && inlineSvg === undefined) {
    throw new RenderCompositionSpecError(
      "inline_asset_source_missing",
      `Inline asset content for "${context.slotName}" requires href or inline_svg.`
    );
  }

  if (href !== undefined) {
    if (!isSafeHref(href)) {
      throw new RenderCompositionSpecError(
        "unsafe_inline_asset_href",
        `Inline asset content for "${context.slotName}" has an unsafe href.`
      );
    }

    if (!isRasterImageHref(href)) {
      throw new RenderCompositionSpecError(
        "inline_asset_href_not_raster",
        `Inline asset content for "${context.slotName}" must use a raster image href.`
      );
    }
  }

  const sourceUrl = optionalTrimmedString(content.source_url);
  if (sourceUrl !== undefined && !isSafeHref(sourceUrl)) {
    throw new RenderCompositionSpecError(
      "unsafe_inline_asset_source_url",
      `Inline asset content for "${context.slotName}" has an unsafe source_url.`
    );
  }

  const resolved: ResolvedAsset = {
    id: `inline:${context.slotName}`,
    targetKind: "asset",
    assetType: optionalTrimmedString(content.asset_type) ?? context.assetType,
    source: href ?? "inline-svg",
    inlineContent: true
  };

  if (href !== undefined) {
    (resolved as { href?: string }).href = href;
  }

  if (inlineSvg !== undefined) {
    (resolved as { inlineSvg?: string }).inlineSvg = inlineSvg;
  }

  const alt = optionalTrimmedString(content.alt);
  if (alt !== undefined) {
    (resolved as { alt?: string }).alt = alt;
  }

  const license = optionalTrimmedString(content.license);
  if (license !== undefined) {
    (resolved as { license?: string }).license = license;
  }

  if (sourceUrl !== undefined) {
    (resolved as { sourceUrl?: string }).sourceUrl = sourceUrl;
  }

  return resolved;
}

function defaultInlineAssetType(slot: ComponentContract["slots"][number]): string {
  return slot.accepts_asset_types?.length === 1 ? slot.accepts_asset_types[0] ?? "inline-content" : "inline-content";
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

  if (isSvgAssetSource(normalizedSource)) {
    try {
      return { inlineSvg: readFileSync(absolutePath, "utf8") };
    } catch (error) {
      return handleUnresolvedAssetSource(
        "asset_source_unreadable",
        `Asset SVG source could not be read: ${normalizedSource}. ${errorMessage(error)}`,
        context
      );
    }
  }

  return { href: `../../${normalizedSource}` };
}

function isLocalProductDesignOsSource(source: string): boolean {
  return source === "product-design-os" || source.startsWith("product-design-os/");
}

function sourceMustResolveToFile(asset: AssetManifestEntry): boolean {
  const normalizedSource = asset.source.replace(/\\/g, "/");
  return normalizedSource !== "product-design-os" || asset.type === "background" || /\.(?:svg|png|jpe?g|webp|gif|avif)$/i.test(asset.source);
}

function isSvgAssetSource(source: string): boolean {
  return /\.svg$/i.test(source);
}

function isRasterImageHref(href: string): boolean {
  return /\.(?:png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i.test(href);
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const spec = readJson<CompositionSpec>(path.join(pdosRoot, "specs", "examples", "buildable-marketing.composition.json"));
  const result = renderComposition(spec, pdosRoot);
  const pageResult = renderCompositionPage(spec, pdosRoot);
  const outputDir = path.join(repoRoot, "output", "render");
  const outputPath = path.join(outputDir, "sharp-positioning-hero.html");
  const pageOutputPath = path.join(outputDir, "landing-page.html");

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, result.html, "utf8");
  writeFileSync(pageOutputPath, pageResult.html, "utf8");

  const contract = readPatternContract(pdosRoot, "sharp-positioning-hero");
  const report = checkRenderedContract(result.html, contract);
  if (report.errors.length > 0) {
    throw new Error(`Rendered contract failed: ${report.errors.map((issue) => issue.code).join(", ")}`);
  }

  const pageContractFailures = pageResult.sections.filter((section) => section.contractErrors.length > 0);
  if (pageContractFailures.length > 0) {
    throw new Error(
      `Rendered page contract failed: ${pageContractFailures
        .map((section) => `${section.node_id}:${section.contractErrors.map((issue) => issue.code).join(",")}`)
        .join("; ")}`
    );
  }

  console.log(`Rendered ${path.relative(repoRoot, outputPath).replace(/\\/g, "/")}`);
  console.log(`Rendered ${path.relative(repoRoot, pageOutputPath).replace(/\\/g, "/")}`);
}
