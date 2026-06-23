import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyzeBuildabilityFloor,
  type PdosBuildabilityCompositionReport,
  type PdosBuildabilityFloorReport,
  type PdosBuildabilityFloorSummary
} from "../buildability-floor/check-buildability-floor-product-design-os";
import {
  formatPdosScoreReport,
  scoreProductDesignOs,
  type PdosScoredItem,
  type PdosScoreInput,
  type PdosScoreReport
} from "../../scripts/score-product-design-os";

export interface PdosVariantSamplerOptions {
  readonly variant_count?: number;
  readonly limit?: number;
  readonly include_floor_report?: boolean;
}

export interface PdosVariantFloorReportCompact {
  readonly ok: boolean;
  readonly summary: PdosBuildabilityFloorSummary;
  readonly composition?: {
    readonly id: string;
    readonly build_floor_passed: boolean;
    readonly structural_non_buildable_count: number;
    readonly structural_non_buildable_codes: readonly string[];
    readonly taxonomy_floor_count: number;
    readonly taxonomy_floor_codes: readonly string[];
    readonly visual_qa_ok: boolean;
    readonly visual_qa_issue_count: number;
  };
}

export interface PdosProductDesignVariant {
  readonly id: string;
  readonly candidate_index: number;
  readonly selected_patterns: readonly string[];
  readonly build_floor_passed: boolean;
  readonly floor_report: PdosVariantFloorReportCompact | PdosBuildabilityFloorReport;
}

export interface PdosProductDesignVariantsReport {
  readonly requested: number;
  readonly returned: number;
  readonly shortfall: number;
  readonly limit: number;
  readonly route: PdosScoreReport["route"];
  readonly warnings: readonly string[];
  readonly variants: readonly PdosProductDesignVariant[];
}

type PdosTargetKind = "asset" | "pattern";
type ContractPropValueType =
  | "string"
  | "url"
  | "boolean"
  | "integer"
  | "number"
  | "text"
  | "data_ref"
  | "asset_ref"
  | "pattern_ref"
  | "list_ref"
  | "object_ref";

interface ComponentContract {
  readonly target_kind: PdosTargetKind;
  readonly target_id: string;
  readonly props: readonly unknown[];
  readonly slots: readonly unknown[];
  readonly output_invariants: readonly unknown[];
}

interface ComponentContractProp {
  readonly name: string;
  readonly value_type: ContractPropValueType;
  readonly required: boolean;
  readonly min_length?: number;
  readonly allowed_values?: readonly string[];
}

interface ComponentContractSlot {
  readonly name: string;
  readonly required: boolean;
  readonly min_items?: number;
  readonly max_items?: number;
  readonly accepts_target_kinds?: readonly PdosTargetKind[];
  readonly accepts_asset_types?: readonly string[];
  readonly accepts_pattern_types?: readonly string[];
  readonly allowed_asset_ids?: readonly string[];
  readonly allowed_pattern_ids?: readonly string[];
}

interface ComponentContractInvariant {
  readonly code: string;
  readonly required: boolean;
}

interface RegistryEntry {
  readonly id: string;
  readonly type: string;
}

interface ContractContext {
  readonly contracts: ReadonlyMap<string, ComponentContract>;
  readonly patterns: ReadonlyMap<string, RegistryEntry>;
  readonly assets: ReadonlyMap<string, RegistryEntry>;
}

interface CandidateBundle {
  readonly candidateIndex: number;
  readonly patternIds: readonly string[];
}

interface CandidateFloorEvaluation {
  readonly buildFloorPassed: boolean;
  readonly floorReport: PdosVariantFloorReportCompact | PdosBuildabilityFloorReport;
  readonly missingPatternContracts: readonly string[];
}

interface CompositionProp {
  readonly name: string;
  readonly value_type: ContractPropValueType;
  readonly string_value?: string;
  readonly number_value?: number;
  readonly integer_value?: number;
  readonly boolean_value?: boolean;
  readonly ref_value?: string;
}

interface CompositionSlotFillItem {
  readonly target_kind: PdosTargetKind;
  readonly target_id: string;
}

interface CompositionSlotFill {
  readonly slot: string;
  readonly fills: readonly CompositionSlotFillItem[];
}

interface CompositionNode {
  readonly node_id: string;
  readonly target_kind: PdosTargetKind;
  readonly target_id: string;
  readonly section_id: string;
  readonly props: readonly CompositionProp[];
  readonly slot_fills: readonly CompositionSlotFill[];
  readonly declared_invariants: readonly string[];
  readonly evidence_ids: readonly string[];
}

interface CompositionSection {
  readonly section_id: string;
  readonly role: string;
  readonly node_ids: readonly string[];
  readonly evidence_ids: readonly string[];
}

interface CompositionSpec {
  readonly spec_kind: "composition_spec";
  readonly id: string;
  readonly schema_version: string;
  readonly recipe_id: string;
  readonly pattern_ids: readonly string[];
  readonly asset_ids: readonly string[];
  readonly required_sections: readonly string[];
  readonly sections: readonly CompositionSection[];
  readonly nodes: readonly CompositionNode[];
  readonly evidence: {
    readonly items: readonly {
      readonly id: string;
      readonly kind: string;
      readonly summary: string;
      readonly pattern_ids: readonly string[];
      readonly asset_ids: readonly string[];
      readonly notes: string;
    }[];
    readonly required_section_evidence: readonly {
      readonly section_id: string;
      readonly evidence_ids: readonly string[];
    }[];
  };
  readonly visual_qa_probe: {
    readonly url: string;
    readonly project_type: string;
    readonly primary_goal: string;
    readonly target_users: readonly string[];
    readonly viewports: readonly {
      readonly name: string;
      readonly width: number;
      readonly height: number;
      readonly heading_count: number;
      readonly cta_count: number;
      readonly visible_text_characters: number;
      readonly repeated_card_count: number;
      readonly text_overlap: boolean;
      readonly horizontal_overflow: boolean;
      readonly low_contrast: boolean;
      readonly primary_content_in_canvas: boolean;
      readonly motion_level: number;
      readonly reduced_motion_supported: boolean;
    }[];
    readonly headings: readonly string[];
    readonly ctas: readonly string[];
    readonly template_signals: readonly string[];
  };
  readonly token_overrides: {
    readonly enabled: false;
    readonly values: readonly [];
  };
}

const CONTRACT_MANIFEST = "product-design-os/contracts/component-contract-manifest.json";
const PATTERN_MANIFEST = "product-design-os/patterns/pattern-manifest.json";
const ASSET_MANIFEST = "product-design-os/assets/asset-manifest.json";
const REQUIRED_SECTIONS = ["hero", "proof", "cta"] as const;
const SECTION_ROLES: Readonly<Record<(typeof REQUIRED_SECTIONS)[number], string>> = {
  hero: "first viewport offer and CTA",
  proof: "case evidence and outcome proof",
  cta: "proof-adjacent closing action"
};
const EVIDENCE_ID = "variant-evidence";

export function sampleProductDesignVariants(
  input: PdosScoreInput | string,
  opts: PdosVariantSamplerOptions = {},
  repoRoot = process.cwd()
): PdosProductDesignVariantsReport {
  const requested = clampVariantCount(opts.variant_count);
  const limit = clampLimit(opts.limit ?? inputLimit(input));
  const score = scoreProductDesignOs(inputWithLimit(input, limit), repoRoot);
  const rankedPatternPool = buildRankedPatternPool(score);
  const context = loadContractContext(repoRoot);
  const selectedAssetIds = score.selected.assets.map((asset) => asset.id);
  const variants: PdosProductDesignVariant[] = [];
  const missingPatternContracts = new Set<string>();

  for (const candidate of enumerateCandidateBundles(rankedPatternPool, limit, requested)) {
    const variantId = variantIdForIndex(candidate.candidateIndex);
    const evaluation = evaluateCandidateFloor(
      {
        variantId,
        candidatePatternIds: candidate.patternIds,
        recipeId: score.selected.recipes[0]?.id ?? score.route.selected_recipe,
        selectedAssetIds,
        route: score.route,
        includeFloorReport: opts.include_floor_report === true,
        context
      },
      repoRoot
    );

    for (const patternId of evaluation.missingPatternContracts) {
      missingPatternContracts.add(patternId);
    }

    if (requested === 1 || evaluation.buildFloorPassed) {
      variants.push({
        id: variantId,
        candidate_index: candidate.candidateIndex,
        selected_patterns: candidate.patternIds,
        build_floor_passed: evaluation.buildFloorPassed,
        floor_report: evaluation.floorReport
      });
    }

    if (requested === 1 || variants.length >= requested) {
      break;
    }
  }

  const warnings = [
    ...score.warnings,
    ...(missingPatternContracts.size > 0
      ? [`missing_pattern_contracts: ${[...missingPatternContracts].sort().join(", ")}`]
      : []),
    ...(requested > 1 && variants.length < requested
      ? [`variant_shortfall: requested ${requested}, returned ${variants.length}`]
      : [])
  ];

  return {
    requested,
    returned: variants.length,
    shortfall: Math.max(0, requested - variants.length),
    limit,
    route: score.route,
    warnings: [...new Set(warnings)],
    variants
  };
}

export function formatVariantsReport(
  report: PdosProductDesignVariantsReport,
  format: "json" | "markdown" = "json"
): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  return `${[
    "# Product & Design OS Variants Report",
    "",
    "## Summary",
    `- Requested: ${report.requested}`,
    `- Returned: ${report.returned}`,
    `- Shortfall: ${report.shortfall}`,
    `- Limit: ${report.limit}`,
    `- Route: ${report.route.project_type} / ${report.route.selected_recipe}`,
    "",
    "## Warnings",
    ...formatMarkdownList(report.warnings, "None."),
    "",
    "## Variants",
    ...formatVariantMarkdown(report.variants)
  ].join("\n").trimEnd()}\n`;
}

function evaluateCandidateFloor(
  input: {
    readonly variantId: string;
    readonly candidatePatternIds: readonly string[];
    readonly recipeId: string;
    readonly selectedAssetIds: readonly string[];
    readonly route: PdosScoreReport["route"];
    readonly includeFloorReport: boolean;
    readonly context: ContractContext;
  },
  repoRoot: string
): CandidateFloorEvaluation {
  if (input.candidatePatternIds.length === 0) {
    return {
      buildFloorPassed: false,
      floorReport: emptyCompactFloorReport(input.variantId),
      missingPatternContracts: []
    };
  }

  const spec = synthesizeCompositionSpec(input);
  const tempRoot = mkdtempSync(join(tmpdir(), "pdos-f7-variants-"));
  const tempSpec = join(tempRoot, `${input.variantId}.composition.json`);

  try {
    writeFileSync(tempSpec, `${JSON.stringify(spec, null, 2)}\n`);
    const report = analyzeBuildabilityFloor({ specPaths: [tempSpec] }, repoRoot);
    const composition = report.compositions[0];
    const missingPatternContracts = input.candidatePatternIds.filter(
      (patternId) => !input.context.contracts.has(contractKey("pattern", patternId))
    );
    const buildFloorPassed = missingPatternContracts.length === 0 && (composition?.build_floor_passed ?? false);

    return {
      buildFloorPassed,
      floorReport: input.includeFloorReport ? report : compactFloorReport(report),
      missingPatternContracts
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function synthesizeCompositionSpec(input: {
  readonly variantId: string;
  readonly candidatePatternIds: readonly string[];
  readonly recipeId: string;
  readonly selectedAssetIds: readonly string[];
  readonly route: PdosScoreReport["route"];
  readonly context: ContractContext;
}): CompositionSpec {
  const nodes: CompositionNode[] = [];
  const nodeKeys = new Set<string>();
  const visitingKeys = new Set<string>();
  const patternIds = new OrderedStringSet(input.candidatePatternIds);
  const assetIds = new OrderedStringSet(input.selectedAssetIds);

  const ensureNode = (targetKind: PdosTargetKind, targetId: string): void => {
    const key = contractKey(targetKind, targetId);
    if (nodeKeys.has(key)) {
      return;
    }

    const contract = input.context.contracts.get(key);
    if (contract === undefined) {
      nodes.push(genericNode(targetKind, targetId, input.context));
      nodeKeys.add(key);
      if (targetKind === "pattern") {
        patternIds.add(targetId);
      } else {
        assetIds.add(targetId);
      }
      return;
    }

    nodeKeys.add(key);
    if (targetKind === "pattern") {
      patternIds.add(targetId);
    } else {
      assetIds.add(targetId);
    }

    const slotFills = buildRequiredSlotFills(contract, input.context);
    nodes.push({
      node_id: nodeIdForTarget(targetKind, targetId),
      target_kind: targetKind,
      target_id: targetId,
      section_id: sectionForTarget(targetKind, targetId, input.context),
      props: buildRequiredProps(contract),
      slot_fills: slotFills,
      declared_invariants: requiredInvariantCodes(contract),
      evidence_ids: [EVIDENCE_ID]
    });

    if (visitingKeys.has(key)) {
      return;
    }

    visitingKeys.add(key);
    for (const slotFill of slotFills) {
      for (const fill of slotFill.fills) {
        ensureNode(fill.target_kind, fill.target_id);
      }
    }
    visitingKeys.delete(key);
  };

  for (const patternId of input.candidatePatternIds) {
    ensureNode("pattern", patternId);
  }

  const sections = buildSections(nodes);
  const patternIdList = patternIds.values();
  const assetIdList = assetIds.values();

  return {
    spec_kind: "composition_spec",
    id: input.variantId,
    schema_version: "1.0.0",
    recipe_id: input.recipeId,
    pattern_ids: patternIdList,
    asset_ids: assetIdList,
    required_sections: [...REQUIRED_SECTIONS],
    sections,
    nodes,
    evidence: {
      items: [
        {
          id: EVIDENCE_ID,
          kind: "variant-synthesis",
          summary: "Deterministic F7 candidate synthesized from score-ranked pattern contracts.",
          pattern_ids: patternIdList,
          asset_ids: assetIdList,
          notes: "Required contract props, slot fills, and hard invariants are filled with stable structural placeholders."
        }
      ],
      required_section_evidence: sections.map((section) => ({
        section_id: section.section_id,
        evidence_ids: [EVIDENCE_ID]
      }))
    },
    visual_qa_probe: {
      url: `fixture://${input.variantId}`,
      project_type: input.route.project_type,
      primary_goal: "Provide a buildable product-design variant with readable content and a clear action.",
      target_users: ["owner", "primary-user"],
      viewports: [
        {
          name: "desktop-1440",
          width: 1440,
          height: 1000,
          heading_count: 2,
          cta_count: 2,
          visible_text_characters: 640,
          repeated_card_count: 2,
          text_overlap: false,
          horizontal_overflow: false,
          low_contrast: false,
          primary_content_in_canvas: false,
          motion_level: Math.min(input.route.motion_level, 4),
          reduced_motion_supported: true
        },
        {
          name: "mobile-390",
          width: 390,
          height: 844,
          heading_count: 1,
          cta_count: 1,
          visible_text_characters: 320,
          repeated_card_count: 1,
          text_overlap: false,
          horizontal_overflow: false,
          low_contrast: false,
          primary_content_in_canvas: false,
          motion_level: Math.min(input.route.motion_level, 3),
          reduced_motion_supported: true
        }
      ],
      headings: ["Buildable variant direction", "Proof before action"],
      ctas: ["Request a plan"],
      template_signals: []
    },
    token_overrides: {
      enabled: false,
      values: []
    }
  };
}

function buildRequiredSlotFills(
  contract: ComponentContract,
  context: ContractContext
): readonly CompositionSlotFill[] {
  return contract.slots.filter(isContractSlot).flatMap((slot) => {
    const minItems = slot.min_items ?? (slot.required ? 1 : 0);
    if (minItems <= 0) {
      return [];
    }

    return [
      {
        slot: slot.name,
        fills: chooseSlotFillItems(slot, minItems, context)
      }
    ];
  });
}

function chooseSlotFillItems(
  slot: ComponentContractSlot,
  minItems: number,
  context: ContractContext
): readonly CompositionSlotFillItem[] {
  const fills: CompositionSlotFillItem[] = [];
  const acceptedKinds = slot.accepts_target_kinds ?? ["asset", "pattern"];

  if (acceptedKinds.includes("asset")) {
    for (const assetId of slot.allowed_asset_ids ?? []) {
      addFillIfAccepted(fills, { target_kind: "asset", target_id: assetId }, slot, context);
      if (fills.length >= minItems) {
        return fills;
      }
    }
  }

  if (acceptedKinds.includes("pattern")) {
    for (const patternId of slot.allowed_pattern_ids ?? []) {
      addFillIfAccepted(fills, { target_kind: "pattern", target_id: patternId }, slot, context);
      if (fills.length >= minItems) {
        return fills;
      }
    }
  }

  if (acceptedKinds.includes("asset")) {
    for (const asset of context.assets.values()) {
      addFillIfAccepted(fills, { target_kind: "asset", target_id: asset.id }, slot, context);
      if (fills.length >= minItems) {
        return fills;
      }
    }
  }

  if (acceptedKinds.includes("pattern")) {
    for (const pattern of context.patterns.values()) {
      addFillIfAccepted(fills, { target_kind: "pattern", target_id: pattern.id }, slot, context);
      if (fills.length >= minItems) {
        return fills;
      }
    }
  }

  return fills;
}

function addFillIfAccepted(
  fills: CompositionSlotFillItem[],
  fill: CompositionSlotFillItem,
  slot: ComponentContractSlot,
  context: ContractContext
): void {
  if (fills.some((item) => item.target_kind === fill.target_kind && item.target_id === fill.target_id)) {
    return;
  }

  const key = contractKey(fill.target_kind, fill.target_id);
  if (!context.contracts.has(key)) {
    return;
  }

  if (fill.target_kind === "asset") {
    const asset = context.assets.get(fill.target_id);
    if (slot.allowed_asset_ids !== undefined && !slot.allowed_asset_ids.includes(fill.target_id)) {
      return;
    }
    if (slot.accepts_asset_types !== undefined && (asset === undefined || !slot.accepts_asset_types.includes(asset.type))) {
      return;
    }
  } else {
    const pattern = context.patterns.get(fill.target_id);
    if (slot.allowed_pattern_ids !== undefined && !slot.allowed_pattern_ids.includes(fill.target_id)) {
      return;
    }
    if (
      slot.accepts_pattern_types !== undefined &&
      (pattern === undefined || !slot.accepts_pattern_types.includes(pattern.type))
    ) {
      return;
    }
  }

  fills.push(fill);
}

function buildRequiredProps(contract: ComponentContract): readonly CompositionProp[] {
  return contract.props
    .filter(isContractProp)
    .filter((prop) => prop.required)
    .map((prop) => propToCompositionProp(prop, contract.target_id));
}

function propToCompositionProp(prop: ComponentContractProp, targetId: string): CompositionProp {
  if (prop.value_type === "boolean") {
    return { name: prop.name, value_type: prop.value_type, boolean_value: true };
  }
  if (prop.value_type === "integer") {
    return { name: prop.name, value_type: prop.value_type, integer_value: 4 };
  }
  if (prop.value_type === "number") {
    return { name: prop.name, value_type: prop.value_type, number_value: 4 };
  }
  if (prop.value_type.endsWith("_ref")) {
    return {
      name: prop.name,
      value_type: prop.value_type,
      ref_value: `${targetId}-${safeIdPart(prop.name)}-ref`
    };
  }

  return {
    name: prop.name,
    value_type: prop.value_type,
    string_value: placeholderStringValue(prop)
  };
}

function placeholderStringValue(prop: ComponentContractProp): string {
  const allowedValue = prop.allowed_values?.[0];
  if (allowedValue !== undefined) {
    return allowedValue;
  }

  const baseValues: Readonly<Record<string, string>> = {
    headline: "Launch a clearer product page with proof",
    primary_cta: "Request a plan",
    cta_label: "Request a plan",
    trust_cue: "Case-backed proof",
    supporting_copy: "Readable supporting copy explains the offer, proof, and next action without hiding content in media.",
    outcome_statement: "Visitors understand the intended outcome before taking action.",
    proof_item: "A concrete proof item anchors the claim.",
    source_reference: "Case study",
    case_title: "Studio launch",
    outcome_summary: "A real outcome summary keeps the proof understandable.",
    evidence_source: "Case study",
    background_name: "Calm prism grid",
    accent_strategy: "Decorative accents stay behind readable text and actions.",
    primary_axis: "calm",
    contrast_axis: "prism",
    product_proof_axis: "case evidence",
    static_fallback_label: "Static fallback"
  };
  const value = baseValues[prop.name] ?? `Stable ${prop.name.replace(/[_-]/g, " ")} placeholder for buildability.`;
  const minLength = prop.min_length ?? 0;
  if (value.length >= minLength) {
    return value;
  }
  return `${value} ${"placeholder".repeat(Math.ceil((minLength - value.length) / "placeholder".length))}`;
}

function requiredInvariantCodes(contract: ComponentContract): readonly string[] {
  return contract.output_invariants
    .filter(isContractInvariant)
    .filter((invariant) => invariant.required)
    .map((invariant) => invariant.code);
}

function genericNode(targetKind: PdosTargetKind, targetId: string, context: ContractContext): CompositionNode {
  return {
    node_id: nodeIdForTarget(targetKind, targetId),
    target_kind: targetKind,
    target_id: targetId,
    section_id: sectionForTarget(targetKind, targetId, context),
    props: [],
    slot_fills: [],
    declared_invariants: [],
    evidence_ids: [EVIDENCE_ID]
  };
}

function buildSections(nodes: readonly CompositionNode[]): readonly CompositionSection[] {
  return REQUIRED_SECTIONS.map((sectionId) => ({
    section_id: sectionId,
    role: SECTION_ROLES[sectionId],
    node_ids: nodes.filter((node) => node.section_id === sectionId).map((node) => node.node_id),
    evidence_ids: [EVIDENCE_ID]
  }));
}

function sectionForTarget(targetKind: PdosTargetKind, targetId: string, context: ContractContext): (typeof REQUIRED_SECTIONS)[number] {
  const registry = targetKind === "pattern" ? context.patterns : context.assets;
  const type = registry.get(targetId)?.type ?? "";
  if (targetId.includes("hero") || targetId.includes("theme") || type === "hero" || type === "background") {
    return "hero";
  }
  if (targetId.includes("cta") || targetId.includes("outcome") || targetId.includes("conversion")) {
    return "cta";
  }
  if (targetId.includes("proof") || targetId.includes("case") || targetId.includes("trust") || type === "section") {
    return "proof";
  }
  return "proof";
}

function compactFloorReport(report: PdosBuildabilityFloorReport): PdosVariantFloorReportCompact {
  const composition = report.compositions[0];
  if (composition === undefined) {
    return {
      ok: report.ok,
      summary: report.summary
    };
  }

  return {
    ok: report.ok,
    summary: report.summary,
    composition: compactCompositionReport(composition)
  };
}

function compactCompositionReport(
  composition: PdosBuildabilityCompositionReport
): NonNullable<PdosVariantFloorReportCompact["composition"]> {
  return {
    id: composition.id,
    build_floor_passed: composition.build_floor_passed,
    structural_non_buildable_count: composition.structural_non_buildable.length,
    structural_non_buildable_codes: uniqueSorted(composition.structural_non_buildable.map((issue) => issue.code)),
    taxonomy_floor_count: composition.taxonomy_floor.length,
    taxonomy_floor_codes: uniqueSorted(composition.taxonomy_floor.map((issue) => issue.code)),
    visual_qa_ok: composition.visual_qa.ok,
    visual_qa_issue_count: composition.visual_qa.issues.length
  };
}

function emptyCompactFloorReport(id: string): PdosVariantFloorReportCompact {
  return {
    ok: false,
    summary: {
      composition_count: 0,
      build_floor_passed_count: 0,
      build_floor_failed_count: 0,
      structural_non_buildable_count: 0,
      taxonomy_floor_count: 0,
      visual_qa_failed_count: 0,
      reason_counts: {}
    },
    composition: {
      id,
      build_floor_passed: false,
      structural_non_buildable_count: 0,
      structural_non_buildable_codes: [],
      taxonomy_floor_count: 0,
      taxonomy_floor_codes: [],
      visual_qa_ok: false,
      visual_qa_issue_count: 0
    }
  };
}

function* enumerateCandidateBundles(
  pool: readonly PdosScoredItem[],
  limit: number,
  requested: number
): Iterable<CandidateBundle> {
  const basePatternIds = pool.slice(0, limit).map((pattern) => pattern.id);
  yield { candidateIndex: 1, patternIds: basePatternIds };

  if (requested === 1 || basePatternIds.length === 0) {
    return;
  }

  const fixedPatternIds = basePatternIds.slice(0, Math.max(0, basePatternIds.length - 1));
  for (let poolIndex = basePatternIds.length; poolIndex < pool.length; poolIndex += 1) {
    const replacement = pool[poolIndex];
    if (replacement !== undefined) {
      yield {
        candidateIndex: poolIndex - basePatternIds.length + 2,
        patternIds: [...fixedPatternIds, replacement.id]
      };
    }
  }
}

function buildRankedPatternPool(score: PdosScoreReport): readonly PdosScoredItem[] {
  const seen = new Set<string>();
  const pool: PdosScoredItem[] = [];
  for (const pattern of [...score.selected.patterns, ...score.rejected.patterns]) {
    if (seen.has(pattern.id)) {
      continue;
    }
    seen.add(pattern.id);
    pool.push(pattern);
  }
  return pool;
}

function loadContractContext(repoRoot: string): ContractContext {
  const contractManifest = readJson(resolve(repoRoot, CONTRACT_MANIFEST));
  const contracts = new Map<string, ComponentContract>();

  for (const contract of getRecordArray(isRecord(contractManifest) ? contractManifest.contracts : undefined)) {
    if (isComponentContract(contract)) {
      contracts.set(contractKey(contract.target_kind, contract.target_id), contract);
    }
  }

  return {
    contracts,
    patterns: loadRegistryEntries(resolve(repoRoot, PATTERN_MANIFEST), "patterns"),
    assets: loadRegistryEntries(resolve(repoRoot, ASSET_MANIFEST), "assets")
  };
}

function loadRegistryEntries(file: string, key: "patterns" | "assets"): ReadonlyMap<string, RegistryEntry> {
  const manifest = readJson(file);
  const entries = new Map<string, RegistryEntry>();
  for (const item of getRecordArray(isRecord(manifest) ? manifest[key] : undefined)) {
    if (typeof item.id === "string" && typeof item.type === "string") {
      entries.set(item.id, { id: item.id, type: item.type });
    }
  }
  return entries;
}

function inputWithLimit(input: PdosScoreInput | string, limit: number): PdosScoreInput {
  if (typeof input === "string") {
    return { text: input, limit };
  }
  return { ...input, limit };
}

function inputLimit(input: PdosScoreInput | string): number | undefined {
  return typeof input === "string" ? undefined : input.limit;
}

function clampLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return 3;
  }
  return Math.max(1, Math.min(10, value));
}

function clampVariantCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return 1;
  }
  return Math.max(1, Math.min(50, value));
}

function variantIdForIndex(candidateIndex: number): string {
  return `variant-${String(candidateIndex).padStart(3, "0")}`;
}

function nodeIdForTarget(targetKind: PdosTargetKind, targetId: string): string {
  return `${targetKind}-${targetId}-node`;
}

function contractKey(targetKind: PdosTargetKind, targetId: string): string {
  return `${targetKind}:${targetId}`;
}

function safeIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "value";
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function formatMarkdownList(items: readonly string[], fallback: string): readonly string[] {
  if (items.length === 0) {
    return [`- ${fallback}`];
  }
  return items.map((item) => `- ${item}`);
}

function formatVariantMarkdown(variants: readonly PdosProductDesignVariant[]): readonly string[] {
  if (variants.length === 0) {
    return ["- None."];
  }

  return variants.flatMap((variant) => [
    `### ${variant.id}`,
    `- Candidate index: ${variant.candidate_index}`,
    `- Build floor passed: ${String(variant.build_floor_passed)}`,
    `- Selected patterns: ${variant.selected_patterns.join(", ")}`
  ]);
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function isComponentContract(value: unknown): value is ComponentContract {
  return (
    isRecord(value) &&
    (value.target_kind === "asset" || value.target_kind === "pattern") &&
    typeof value.target_id === "string" &&
    Array.isArray(value.props) &&
    Array.isArray(value.slots) &&
    Array.isArray(value.output_invariants)
  );
}

function isContractProp(value: unknown): value is ComponentContractProp {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isContractValueType(value.value_type) &&
    typeof value.required === "boolean" &&
    (value.min_length === undefined || typeof value.min_length === "number") &&
    (value.allowed_values === undefined || isStringArray(value.allowed_values))
  );
}

function isContractSlot(value: unknown): value is ComponentContractSlot {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.required === "boolean" &&
    (value.min_items === undefined || typeof value.min_items === "number") &&
    (value.max_items === undefined || typeof value.max_items === "number") &&
    (value.accepts_target_kinds === undefined || isTargetKindArray(value.accepts_target_kinds)) &&
    (value.accepts_asset_types === undefined || isStringArray(value.accepts_asset_types)) &&
    (value.accepts_pattern_types === undefined || isStringArray(value.accepts_pattern_types)) &&
    (value.allowed_asset_ids === undefined || isStringArray(value.allowed_asset_ids)) &&
    (value.allowed_pattern_ids === undefined || isStringArray(value.allowed_pattern_ids))
  );
}

function isContractInvariant(value: unknown): value is ComponentContractInvariant {
  return isRecord(value) && typeof value.code === "string" && typeof value.required === "boolean";
}

function isContractValueType(value: unknown): value is ContractPropValueType {
  return (
    value === "string" ||
    value === "url" ||
    value === "boolean" ||
    value === "integer" ||
    value === "number" ||
    value === "text" ||
    value === "data_ref" ||
    value === "asset_ref" ||
    value === "pattern_ref" ||
    value === "list_ref" ||
    value === "object_ref"
  );
}

function isTargetKindArray(value: unknown): value is readonly PdosTargetKind[] {
  return Array.isArray(value) && value.every((item) => item === "asset" || item === "pattern");
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function getRecordArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class OrderedStringSet {
  readonly #values: string[] = [];
  readonly #seen = new Set<string>();

  constructor(values: readonly string[] = []) {
    for (const value of values) {
      this.add(value);
    }
  }

  add(value: string): void {
    if (this.#seen.has(value)) {
      return;
    }
    this.#seen.add(value);
    this.#values.push(value);
  }

  values(): readonly string[] {
    return [...this.#values];
  }
}

function parseArgs(args: readonly string[]): {
  readonly text?: string;
  readonly limit?: number;
  readonly variants?: number;
  readonly format?: "json" | "markdown";
  readonly includeFloorReport: boolean;
} {
  const result: {
    text?: string;
    limit?: number;
    variants?: number;
    format?: "json" | "markdown";
    includeFloorReport: boolean;
  } = { includeFloorReport: false };

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--include-floor-report") {
      result.includeFloorReport = true;
      continue;
    }

    const value = args[index + 1];
    if (key === undefined || value === undefined) {
      continue;
    }

    if (key === "--text") {
      result.text = value;
      index += 1;
    } else if (key === "--limit") {
      result.limit = Number.parseInt(value, 10);
      index += 1;
    } else if (key === "--variants") {
      result.variants = Number.parseInt(value, 10);
      index += 1;
    } else if (key === "--format" && (value === "json" || value === "markdown")) {
      result.format = value;
      index += 1;
    }
  }

  return result;
}

function runCli(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    const variantCount = args.variants ?? 1;
    const input: { text: string; limit?: number } = { text: args.text ?? "" };
    if (args.limit !== undefined) {
      input.limit = args.limit;
    }

    if (variantCount <= 1) {
      process.stdout.write(formatPdosScoreReport(scoreProductDesignOs(input), args.format));
      return;
    }

    process.stdout.write(
      formatVariantsReport(
        sampleProductDesignVariants(input, cliSamplerOptions(variantCount, args), process.cwd()),
        args.format
      )
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown variants sampler failure.";
    console.error(`Product Design OS variants sampler failed: ${message}`);
    process.exit(1);
  }
}

function cliSamplerOptions(
  variantCount: number,
  args: ReturnType<typeof parseArgs>
): PdosVariantSamplerOptions {
  const options: {
    variant_count: number;
    include_floor_report: boolean;
    limit?: number;
  } = {
    variant_count: variantCount,
    include_floor_report: args.includeFloorReport
  };
  if (args.limit !== undefined) {
    options.limit = args.limit;
  }
  return options;
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (basename(invokedFile) === basename(currentFile) && invokedFile === currentFile) {
  runCli();
}
