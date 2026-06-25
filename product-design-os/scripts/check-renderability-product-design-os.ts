import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateJsonSchema } from "../../src/lib/delivery-system/validation";
import { isSafeHref } from "../renderer/safe-url";
import { analyzeProductDesignVisualQa } from "./visual-qa-product-design-os";
import type { PdosVisualQaInput, PdosVisualQaReport } from "./visual-qa-product-design-os";

export type PdosRenderabilityReasonCode =
  | "SCHEMA_INVALID"
  | "DUPLICATE_CONTRACT"
  | "UNKNOWN_RECIPE"
  | "UNKNOWN_PATTERN"
  | "UNKNOWN_ASSET"
  | "PATTERN_NOT_ALLOWED"
  | "CONTRACT_MISSING"
  | "REQUIRED_PROP_MISSING"
  | "PROP_VALUE_INVALID"
  | "SLOT_MISSING"
  | "SLOT_FILL_INVALID"
  | "SECTION_UNSATISFIED"
  | "INVARIANT_UNDECLARED"
  | "SOURCE_FLOOR_DRIFT"
  | "VISUAL_QA_ERROR";

export type PdosRenderabilitySeverity = "error" | "warning";
export type PdosTargetKind = "asset" | "pattern";

export interface PdosRenderabilityInput {
  readonly contractManifestPath?: string;
  readonly targetPaths: readonly string[];
}

export interface PdosRenderabilityIssue {
  readonly code: PdosRenderabilityReasonCode;
  readonly severity: PdosRenderabilitySeverity;
  readonly target_kind?: PdosTargetKind;
  readonly target_id?: string;
  readonly node_id?: string;
  readonly message: string;
}

export interface PdosRenderabilityCompositionReport {
  readonly id: string;
  readonly buildable: boolean;
  readonly non_buildable: readonly PdosRenderabilityIssue[];
  readonly warnings: readonly PdosRenderabilityIssue[];
  readonly visual_qa?: PdosVisualQaReport;
}

export interface PdosRenderabilitySummary {
  readonly target_count: number;
  readonly buildable_count: number;
  readonly non_buildable_count: number;
  readonly warning_count: number;
  readonly reason_counts: Readonly<Record<string, number>>;
}

export interface PdosRenderabilityReport {
  readonly ok: boolean;
  readonly checked_files: readonly string[];
  readonly compositions: readonly PdosRenderabilityCompositionReport[];
  readonly summary: PdosRenderabilitySummary;
}

interface IssueContext {
  readonly targetKind?: PdosTargetKind | undefined;
  readonly targetId?: string | undefined;
  readonly nodeId?: string | undefined;
}

interface ComponentContract {
  readonly id: string;
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
  readonly min_items?: number;
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
  readonly severity: PdosRenderabilitySeverity;
  readonly source_floors: readonly string[];
}

interface CompositionTarget {
  readonly id: string;
  readonly recipe_id: string;
  readonly pattern_ids: readonly string[];
  readonly asset_ids: readonly string[];
  readonly required_sections: readonly string[];
  readonly sections: readonly unknown[];
  readonly nodes: readonly unknown[];
  readonly visual_qa_probe: unknown;
}

interface CompositionSection {
  readonly section_id: string;
  readonly role: string;
}

interface CompositionNode {
  readonly node_id: string;
  readonly target_kind: PdosTargetKind;
  readonly target_id: string;
  readonly section_id: string;
  readonly pattern_ids?: readonly string[];
  readonly props: readonly unknown[];
  readonly slot_fills: readonly unknown[];
  readonly declared_invariants?: readonly string[];
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

interface CompositionSlotFill {
  readonly slot: string;
  readonly fills: readonly unknown[];
}

interface CompositionSlotFillItem {
  readonly target_kind: PdosTargetKind;
  readonly target_id?: string;
  readonly content?: CompositionInlineContent;
}

interface CompositionInlineContent {
  readonly href?: string;
  readonly alt?: string;
  readonly license?: string;
  readonly source_url?: string;
  readonly inline_svg?: string;
  readonly asset_type?: string;
}

interface RecipeRegistryEntry {
  readonly id: string;
  readonly allowed_pattern_ids: readonly string[];
}

interface PatternRegistryEntry {
  readonly id: string;
  readonly type: string;
  readonly requires: readonly string[];
}

interface AssetRegistryEntry {
  readonly id: string;
  readonly type: string;
  readonly avoid_with_tags: readonly string[];
}

interface PdosRegistries {
  readonly recipes: ReadonlyMap<string, RecipeRegistryEntry>;
  readonly patterns: ReadonlyMap<string, PatternRegistryEntry>;
  readonly assets: ReadonlyMap<string, AssetRegistryEntry>;
}

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

type TypedValueField = "string_value" | "number_value" | "integer_value" | "boolean_value" | "ref_value";

const DEFAULT_CONTRACT_MANIFEST = "product-design-os/contracts/component-contract-manifest.json";
const COMPONENT_CONTRACT_SCHEMA = "product-design-os/contracts/component-contract.schema.json";
const COMPOSITION_TARGET_SCHEMA = "product-design-os/composition/composition-target.schema.json";
const COMPOSITION_SPEC_SCHEMA = "product-design-os/specs/composition.schema.json";
const VALUE_FIELDS: readonly TypedValueField[] = [
  "string_value",
  "number_value",
  "integer_value",
  "boolean_value",
  "ref_value"
];

export function analyzeProductDesignRenderability(
  input: PdosRenderabilityInput,
  repoRoot = process.cwd()
): PdosRenderabilityReport {
  const checkedFiles = new Set<string>();
  const componentContractSchema = readJsonChecked(resolveRepoPath(repoRoot, COMPONENT_CONTRACT_SCHEMA), repoRoot, checkedFiles);
  const compositionTargetSchema = readJsonChecked(resolveRepoPath(repoRoot, COMPOSITION_TARGET_SCHEMA), repoRoot, checkedFiles);
  const compositionSpecSchema = readJsonChecked(resolveRepoPath(repoRoot, COMPOSITION_SPEC_SCHEMA), repoRoot, checkedFiles);
  const registries = loadRegistries(repoRoot, checkedFiles);
  const contractContext = loadContractContext(
    resolveRepoPath(repoRoot, input.contractManifestPath ?? DEFAULT_CONTRACT_MANIFEST),
    componentContractSchema,
    repoRoot,
    checkedFiles
  );

  const compositions = input.targetPaths.map((targetPath) =>
    analyzeCompositionTarget({
      file: resolveRepoPath(repoRoot, targetPath),
      repoRoot,
      checkedFiles,
      compositionTargetSchema,
      compositionSpecSchema,
      registries,
      contracts: contractContext.contracts,
      globalIssues: contractContext.issues
    })
  );

  const summary = summarizeCompositions(compositions);

  return {
    ok: compositions.every((composition) => composition.buildable),
    checked_files: [...checkedFiles].sort(),
    compositions,
    summary
  };
}

export function formatRenderabilityReport(
  report: PdosRenderabilityReport,
  format: "json" | "markdown" = "json"
): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  return `${[
    "# Product & Design OS Renderability Report",
    "",
    "## Summary",
    `- OK: ${String(report.ok)}`,
    `- Targets: ${report.summary.target_count}`,
    `- Buildable: ${report.summary.buildable_count}`,
    `- Non-buildable: ${report.summary.non_buildable_count}`,
    `- Warnings: ${report.summary.warning_count}`,
    "",
    "## Reason Counts",
    ...formatReasonCounts(report.summary.reason_counts),
    "",
    "## Compositions",
    ...report.compositions.flatMap(formatCompositionMarkdown)
  ].join("\n").trimEnd()}\n`;
}

function analyzeCompositionTarget(input: {
  readonly file: string;
  readonly repoRoot: string;
  readonly checkedFiles: Set<string>;
  readonly compositionTargetSchema: unknown;
  readonly compositionSpecSchema: unknown;
  readonly registries: PdosRegistries;
  readonly contracts: ReadonlyMap<string, ComponentContract>;
  readonly globalIssues: readonly PdosRenderabilityIssue[];
}): PdosRenderabilityCompositionReport {
  const sourceValue = readJsonChecked(input.file, input.repoRoot, input.checkedFiles);
  const targetValue = toF3CompositionTarget(sourceValue);
  const nonBuildable: PdosRenderabilityIssue[] = [...input.globalIssues];
  const warnings: PdosRenderabilityIssue[] = [];
  const targetId = isRecord(sourceValue) && typeof sourceValue.id === "string" ? sourceValue.id : basename(input.file, ".json");

  if (!isRecord(sourceValue)) {
    addIssue(nonBuildable, "SCHEMA_INVALID", "error", "Composition target must be a JSON object.");
    return {
      id: targetId,
      buildable: false,
      non_buildable: nonBuildable,
      warnings
    };
  }

  const schema = isCompositionSpec(sourceValue) ? input.compositionSpecSchema : input.compositionTargetSchema;
  const schemaValue = isCompositionSpec(sourceValue) ? sourceValue : targetValue;
  for (const issue of validateJsonSchema(schemaValue, schema)) {
    addIssue(nonBuildable, "SCHEMA_INVALID", "error", `${issue.path}: ${issue.message}`);
  }

  if (!isCompositionTarget(targetValue)) {
    return {
      id: targetId,
      buildable: false,
      non_buildable: nonBuildable,
      warnings
    };
  }

  validateTargetRegistryReferences(targetValue, input.registries, nonBuildable);
  validateRequiredSections(targetValue, nonBuildable);

  const referencedContractKeys = new Set<string>();
  for (const node of targetValue.nodes.filter(isCompositionNode)) {
    validateNodeContractCoverage(node, input.contracts, referencedContractKeys, nonBuildable);
    validateNodePatternContractCoverage(node, input.contracts, referencedContractKeys, nonBuildable);

    const contract = input.contracts.get(contractKey(node.target_kind, node.target_id));
    if (contract === undefined) {
      continue;
    }

    validateNodeProps(node, contract, nonBuildable);
    validateNodeSlots(node, contract, input.contracts, referencedContractKeys, input.registries, nonBuildable);
    validateNodeInvariants(node, contract, nonBuildable);
  }

  for (const key of referencedContractKeys) {
    const contract = input.contracts.get(key);
    if (contract !== undefined) {
      validateSourceFloorDrift(contract, input.registries, nonBuildable);
    }
  }

  const visualQa = isVisualQaInput(targetValue.visual_qa_probe)
    ? analyzeProductDesignVisualQa(targetValue.visual_qa_probe)
    : undefined;
  if (visualQa !== undefined) {
    const visualErrors = visualQa.issues.filter((issue) => issue.severity === "error");
    if (visualErrors.length > 0) {
      addIssue(
        nonBuildable,
        "VISUAL_QA_ERROR",
        "error",
        `Visual QA reported error-level issues: ${visualErrors.map((issue) => issue.code).join(", ")}.`
      );
    }
  }

  const report: {
    id: string;
    buildable: boolean;
    non_buildable: readonly PdosRenderabilityIssue[];
    warnings: readonly PdosRenderabilityIssue[];
    visual_qa?: PdosVisualQaReport;
  } = {
    id: targetValue.id,
    buildable: nonBuildable.length === 0,
    non_buildable: nonBuildable,
    warnings
  };

  if (visualQa !== undefined) {
    report.visual_qa = visualQa;
  }

  return report;
}

function loadContractContext(
  manifestFile: string,
  componentContractSchema: unknown,
  repoRoot: string,
  checkedFiles: Set<string>
): {
  readonly contracts: ReadonlyMap<string, ComponentContract>;
  readonly issues: readonly PdosRenderabilityIssue[];
} {
  const manifest = readJsonChecked(manifestFile, repoRoot, checkedFiles);
  const issues: PdosRenderabilityIssue[] = [];
  const contracts = new Map<string, ComponentContract>();

  if (!isRecord(manifest) || !Array.isArray(manifest.contracts)) {
    addIssue(issues, "SCHEMA_INVALID", "error", "Contract manifest must contain a contracts array.");
    return { contracts, issues };
  }

  manifest.contracts.forEach((entry, index) => {
    for (const issue of validateJsonSchema(entry, componentContractSchema)) {
      const context = issueContextFromUnknownTarget(entry);
      addIssue(issues, "SCHEMA_INVALID", "error", `contracts[${index}] ${issue.path}: ${issue.message}`, context);
    }

    if (!isComponentContract(entry)) {
      return;
    }

    const key = contractKey(entry.target_kind, entry.target_id);
    if (contracts.has(key)) {
      addIssue(
        issues,
        "DUPLICATE_CONTRACT",
        "error",
        `Duplicate contract for ${entry.target_kind}:${entry.target_id}.`,
        { targetKind: entry.target_kind, targetId: entry.target_id }
      );
      return;
    }

    contracts.set(key, entry);
  });

  return { contracts, issues };
}

function validateTargetRegistryReferences(
  target: CompositionTarget,
  registries: PdosRegistries,
  issues: PdosRenderabilityIssue[]
): void {
  const recipe = registries.recipes.get(target.recipe_id);
  if (recipe === undefined) {
    addIssue(issues, "UNKNOWN_RECIPE", "error", `Unknown recipe_id ${target.recipe_id}.`);
  }

  for (const patternId of target.pattern_ids) {
    if (!registries.patterns.has(patternId)) {
      addIssue(issues, "UNKNOWN_PATTERN", "error", `Unknown pattern_id ${patternId}.`, {
        targetKind: "pattern",
        targetId: patternId
      });
    }

    if (recipe !== undefined && !recipe.allowed_pattern_ids.includes(patternId)) {
      addIssue(issues, "PATTERN_NOT_ALLOWED", "error", `Pattern ${patternId} is not allowed by recipe ${recipe.id}.`, {
        targetKind: "pattern",
        targetId: patternId
      });
    }
  }

  for (const assetId of target.asset_ids) {
    if (!registries.assets.has(assetId)) {
      addIssue(issues, "UNKNOWN_ASSET", "error", `Unknown asset_id ${assetId}.`, {
        targetKind: "asset",
        targetId: assetId
      });
    }
  }
}

function validateRequiredSections(target: CompositionTarget, issues: PdosRenderabilityIssue[]): void {
  const sections = target.sections.filter(isCompositionSection);
  const sectionIds = new Set(sections.map((section) => section.section_id));
  const sectionRoles = new Set(sections.map((section) => section.role));

  for (const requiredSection of target.required_sections) {
    if (!sectionIds.has(requiredSection) && !sectionRoles.has(requiredSection)) {
      addIssue(issues, "SECTION_UNSATISFIED", "error", `Required section ${requiredSection} is not represented.`);
    }
  }
}

function validateNodeContractCoverage(
  node: CompositionNode,
  contracts: ReadonlyMap<string, ComponentContract>,
  referencedContractKeys: Set<string>,
  issues: PdosRenderabilityIssue[]
): void {
  const key = contractKey(node.target_kind, node.target_id);
  if (!contracts.has(key)) {
    addIssue(issues, "CONTRACT_MISSING", "error", `Missing contract for ${node.target_kind}:${node.target_id}.`, {
      targetKind: node.target_kind,
      targetId: node.target_id,
      nodeId: node.node_id
    });
    return;
  }

  referencedContractKeys.add(key);
}

function validateNodePatternContractCoverage(
  node: CompositionNode,
  contracts: ReadonlyMap<string, ComponentContract>,
  referencedContractKeys: Set<string>,
  issues: PdosRenderabilityIssue[]
): void {
  for (const patternId of getStringArray(node.pattern_ids)) {
    const key = contractKey("pattern", patternId);
    if (!contracts.has(key)) {
      addIssue(issues, "CONTRACT_MISSING", "error", `Missing contract for node pattern ${patternId}.`, {
        targetKind: "pattern",
        targetId: patternId,
        nodeId: node.node_id
      });
      continue;
    }
    referencedContractKeys.add(key);
  }
}

function validateNodeProps(
  node: CompositionNode,
  contract: ComponentContract,
  issues: PdosRenderabilityIssue[]
): void {
  const contractProps = contract.props.filter(isContractProp);
  const contractPropsByName = new Map(contractProps.map((prop) => [prop.name, prop]));
  const nodeProps = node.props.filter(isCompositionProp);
  const nodePropsByName = new Map<string, CompositionProp>();

  for (const prop of nodeProps) {
    if (!nodePropsByName.has(prop.name)) {
      nodePropsByName.set(prop.name, prop);
    }

    for (const message of validatePropValue(prop, contractPropsByName.get(prop.name))) {
      addIssue(issues, "PROP_VALUE_INVALID", "error", message, {
        targetKind: node.target_kind,
        targetId: node.target_id,
        nodeId: node.node_id
      });
    }
  }

  for (const prop of contractProps) {
    if (prop.required && !nodePropsByName.has(prop.name)) {
      addIssue(
        issues,
        "REQUIRED_PROP_MISSING",
        "error",
        `Required prop ${prop.name} is missing for ${contract.target_kind}:${contract.target_id}.`,
        {
          targetKind: contract.target_kind,
          targetId: contract.target_id,
          nodeId: node.node_id
        }
      );
    }
  }
}

function validateNodeSlots(
  node: CompositionNode,
  contract: ComponentContract,
  contracts: ReadonlyMap<string, ComponentContract>,
  referencedContractKeys: Set<string>,
  registries: PdosRegistries,
  issues: PdosRenderabilityIssue[]
): void {
  const contractSlots = contract.slots.filter(isContractSlot);
  const contractSlotsByName = new Map(contractSlots.map((slot) => [slot.name, slot]));
  const slotFills = node.slot_fills.filter(isCompositionSlotFill);
  const slotFillsByName = new Map(slotFills.map((slotFill) => [slotFill.slot, slotFill]));

  for (const slotFill of slotFills) {
    if (!contractSlotsByName.has(slotFill.slot)) {
      addIssue(issues, "SLOT_FILL_INVALID", "error", `Unknown slot ${slotFill.slot} on ${contract.target_id}.`, {
        targetKind: contract.target_kind,
        targetId: contract.target_id,
        nodeId: node.node_id
      });
    }
  }

  for (const slot of contractSlots) {
    const fillItems = (slotFillsByName.get(slot.name)?.fills ?? []).filter(isCompositionSlotFillItem);
    const minItems = slot.min_items ?? (slot.required ? 1 : 0);
    if (fillItems.length < minItems) {
      addIssue(
        issues,
        "SLOT_MISSING",
        "error",
        `Slot ${slot.name} requires at least ${minItems} fill item(s).`,
        {
          targetKind: contract.target_kind,
          targetId: contract.target_id,
          nodeId: node.node_id
        }
      );
    }

    if (slot.max_items !== undefined && fillItems.length > slot.max_items) {
      addIssue(
        issues,
        "SLOT_FILL_INVALID",
        "error",
        `Slot ${slot.name} allows at most ${slot.max_items} fill item(s).`,
        {
          targetKind: contract.target_kind,
          targetId: contract.target_id,
          nodeId: node.node_id
        }
      );
    }

    for (const fill of fillItems) {
      validateSlotFill(slot, fill, node, contract, registries, issues);
      if (isInlineContentSlotFill(fill)) {
        continue;
      }

      if (fill.target_id === undefined) {
        continue;
      }

      const key = contractKey(fill.target_kind, fill.target_id);
      if (!contracts.has(key)) {
        addIssue(issues, "CONTRACT_MISSING", "error", `Missing contract for slot fill ${fill.target_kind}:${fill.target_id}.`, {
          targetKind: fill.target_kind,
          targetId: fill.target_id,
          nodeId: node.node_id
        });
      } else {
        referencedContractKeys.add(key);
      }
    }
  }
}

function validateSlotFill(
  slot: ComponentContractSlot,
  fill: CompositionSlotFillItem,
  node: CompositionNode,
  contract: ComponentContract,
  registries: PdosRegistries,
  issues: PdosRenderabilityIssue[]
): void {
  const context = {
    targetKind: contract.target_kind,
    targetId: contract.target_id,
    nodeId: node.node_id
  };

  if (slot.accepts_target_kinds !== undefined && !slot.accepts_target_kinds.includes(fill.target_kind)) {
    addIssue(issues, "SLOT_FILL_INVALID", "error", `Slot ${slot.name} does not accept ${fill.target_kind} fills.`, context);
  }

  if (fill.target_kind === "asset") {
    if (fill.content !== undefined) {
      validateInlineContentSlotFill(slot, fill, context, issues);
      return;
    }

    if (fill.target_id === undefined) {
      addIssue(issues, "SLOT_FILL_INVALID", "error", `Slot ${slot.name} asset fill requires target_id or content.`, context);
      return;
    }

    const asset = registries.assets.get(fill.target_id);
    if (slot.allowed_asset_ids !== undefined && !slot.allowed_asset_ids.includes(fill.target_id)) {
      addIssue(issues, "SLOT_FILL_INVALID", "error", `Slot ${slot.name} does not allow asset ${fill.target_id}.`, context);
    }
    if (slot.accepts_asset_types !== undefined && (asset === undefined || !slot.accepts_asset_types.includes(asset.type))) {
      addIssue(
        issues,
        "SLOT_FILL_INVALID",
        "error",
        `Slot ${slot.name} does not accept asset type ${asset?.type ?? "unknown"}.`,
        context
      );
    }
  } else {
    if (fill.target_id === undefined) {
      addIssue(issues, "SLOT_FILL_INVALID", "error", `Slot ${slot.name} pattern fill requires target_id.`, context);
      return;
    }

    const pattern = registries.patterns.get(fill.target_id);
    if (slot.allowed_pattern_ids !== undefined && !slot.allowed_pattern_ids.includes(fill.target_id)) {
      addIssue(issues, "SLOT_FILL_INVALID", "error", `Slot ${slot.name} does not allow pattern ${fill.target_id}.`, context);
    }
    if (slot.accepts_pattern_types !== undefined && (pattern === undefined || !slot.accepts_pattern_types.includes(pattern.type))) {
      addIssue(
        issues,
        "SLOT_FILL_INVALID",
        "error",
        `Slot ${slot.name} does not accept pattern type ${pattern?.type ?? "unknown"}.`,
        context
      );
    }
  }
}

function validateInlineContentSlotFill(
  slot: ComponentContractSlot,
  fill: CompositionSlotFillItem,
  context: IssueContext,
  issues: PdosRenderabilityIssue[]
): void {
  if (!hasUsableInlineContent(fill.content)) {
    addIssue(issues, "SLOT_FILL_INVALID", "error", `Slot ${slot.name} inline asset content requires href or inline_svg.`, context);
    return;
  }

  const href = optionalTrimmedString(fill.content.href);
  if (href !== undefined) {
    if (!isSafeHref(href)) {
      addIssue(issues, "SLOT_FILL_INVALID", "error", `Slot ${slot.name} inline asset href is not safe.`, context);
    } else if (!isRasterImageHref(href)) {
      addIssue(issues, "SLOT_FILL_INVALID", "error", `Slot ${slot.name} inline asset href must point to a raster image.`, context);
    }
  }

  const sourceUrl = optionalTrimmedString(fill.content.source_url);
  if (sourceUrl !== undefined && !isSafeHref(sourceUrl)) {
    addIssue(issues, "SLOT_FILL_INVALID", "error", `Slot ${slot.name} inline asset source_url is not safe.`, context);
  }

  const assetType = inlineAssetTypeForSlot(fill.content, slot);
  if (slot.accepts_asset_types !== undefined && !slot.accepts_asset_types.includes(assetType)) {
    addIssue(issues, "SLOT_FILL_INVALID", "error", `Slot ${slot.name} does not accept inline asset type ${assetType}.`, context);
  }
}

function validateNodeInvariants(
  node: CompositionNode,
  contract: ComponentContract,
  issues: PdosRenderabilityIssue[]
): void {
  const declaredInvariants = new Set(getStringArray(node.declared_invariants));
  for (const invariant of contract.output_invariants.filter(isContractInvariant)) {
    if (invariant.required && !declaredInvariants.has(invariant.code)) {
      addIssue(
        issues,
        "INVARIANT_UNDECLARED",
        invariant.severity,
        `Required invariant ${invariant.code} is not declared by node ${node.node_id}.`,
        {
          targetKind: contract.target_kind,
          targetId: contract.target_id,
          nodeId: node.node_id
        }
      );
    }
  }
}

function validateSourceFloorDrift(
  contract: ComponentContract,
  registries: PdosRegistries,
  issues: PdosRenderabilityIssue[]
): void {
  const floors =
    contract.target_kind === "pattern"
      ? registries.patterns.get(contract.target_id)?.requires
      : registries.assets.get(contract.target_id)?.avoid_with_tags;

  if (floors === undefined) {
    return;
  }

  const floorSet = new Set(floors);
  for (const invariant of contract.output_invariants.filter(isContractInvariant)) {
    for (const sourceFloor of invariant.source_floors) {
      if (!floorSet.has(sourceFloor)) {
        addIssue(
          issues,
          "SOURCE_FLOOR_DRIFT",
          invariant.severity,
          `Invariant ${invariant.code} source floor ${sourceFloor} is no longer present on ${contract.target_kind}:${contract.target_id}.`,
          {
            targetKind: contract.target_kind,
            targetId: contract.target_id
          }
        );
      }
    }
  }
}

function validatePropValue(prop: CompositionProp, contractProp: ComponentContractProp | undefined): readonly string[] {
  const messages: string[] = [];
  const presentFields = VALUE_FIELDS.filter((field) => hasOwn(prop, field));
  const expectedField = typedFieldForValueType(prop.value_type);

  if (contractProp !== undefined && prop.value_type !== contractProp.value_type) {
    messages.push(`Prop ${prop.name} declares value_type ${prop.value_type}; expected ${contractProp.value_type}.`);
  }

  if (presentFields.length !== 1) {
    messages.push(`Prop ${prop.name} must set exactly one typed value field.`);
    return messages;
  }

  const actualField = presentFields[0];
  if (actualField !== expectedField) {
    messages.push(`Prop ${prop.name} uses ${actualField}; expected ${expectedField} for ${prop.value_type}.`);
    return messages;
  }

  const value = prop[actualField];
  if (!fieldValueMatches(actualField, value)) {
    messages.push(`Prop ${prop.name} has an invalid ${actualField} value.`);
    return messages;
  }

  if (contractProp?.min_length !== undefined && typeof value === "string" && value.length < contractProp.min_length) {
    messages.push(`Prop ${prop.name} must have at least ${contractProp.min_length} characters.`);
  }

  if (contractProp?.allowed_values !== undefined && typeof value === "string" && !contractProp.allowed_values.includes(value)) {
    messages.push(`Prop ${prop.name} must be one of: ${contractProp.allowed_values.join(", ")}.`);
  }

  return messages;
}

function loadRegistries(repoRoot: string, checkedFiles: Set<string>): PdosRegistries {
  const pdosRoot = join(repoRoot, "product-design-os");
  const recipes = new Map<string, RecipeRegistryEntry>();
  const recipesRoot = join(pdosRoot, "recipes");

  if (existsSync(recipesRoot)) {
    const recipeFiles = readdirSync(recipesRoot)
      .filter((file) => file.endsWith(".json") && file !== "recipe.schema.json")
      .sort();

    for (const recipeFile of recipeFiles) {
      const value = readJsonChecked(join(recipesRoot, recipeFile), repoRoot, checkedFiles);
      if (!isRecord(value) || typeof value.id !== "string") {
        continue;
      }

      recipes.set(value.id, {
        id: value.id,
        allowed_pattern_ids: [
          ...new Set([...getStringArray(value.allowed_patterns), ...getStringArray(value.allowed_pattern_ids)])
        ]
      });
    }
  }

  const patternManifest = readJsonChecked(join(pdosRoot, "patterns", "pattern-manifest.json"), repoRoot, checkedFiles);
  const patterns = new Map<string, PatternRegistryEntry>();
  for (const pattern of getRecordArray(patternManifest, "patterns")) {
    if (typeof pattern.id === "string" && typeof pattern.type === "string") {
      patterns.set(pattern.id, {
        id: pattern.id,
        type: pattern.type,
        requires: getStringArray(pattern.requires)
      });
    }
  }

  const assetManifest = readJsonChecked(join(pdosRoot, "assets", "asset-manifest.json"), repoRoot, checkedFiles);
  const assets = new Map<string, AssetRegistryEntry>();
  for (const asset of getRecordArray(assetManifest, "assets")) {
    if (typeof asset.id === "string" && typeof asset.type === "string") {
      assets.set(asset.id, {
        id: asset.id,
        type: asset.type,
        avoid_with_tags: getStringArray(asset.avoid_with_tags)
      });
    }
  }

  return { recipes, patterns, assets };
}

function summarizeCompositions(
  compositions: readonly PdosRenderabilityCompositionReport[]
): PdosRenderabilitySummary {
  const reasonCounts: Record<string, number> = {};
  let warningCount = 0;

  for (const composition of compositions) {
    warningCount += composition.warnings.length;
    for (const issue of composition.non_buildable) {
      reasonCounts[issue.code] = (reasonCounts[issue.code] ?? 0) + 1;
    }
  }

  return {
    target_count: compositions.length,
    buildable_count: compositions.filter((composition) => composition.buildable).length,
    non_buildable_count: compositions.filter((composition) => !composition.buildable).length,
    warning_count: warningCount,
    reason_counts: Object.fromEntries(Object.entries(reasonCounts).sort())
  };
}

function formatReasonCounts(reasonCounts: Readonly<Record<string, number>>): readonly string[] {
  const entries = Object.entries(reasonCounts);
  if (entries.length === 0) {
    return ["- None."];
  }
  return entries.map(([code, count]) => `- ${code}: ${count}`);
}

function formatCompositionMarkdown(composition: PdosRenderabilityCompositionReport): readonly string[] {
  return [
    `### ${composition.id}`,
    `- Buildable: ${String(composition.buildable)}`,
    `- Non-buildable entries: ${composition.non_buildable.length}`,
    ...formatIssues(composition.non_buildable),
    `- Warnings: ${composition.warnings.length}`
  ];
}

function formatIssues(issues: readonly PdosRenderabilityIssue[]): readonly string[] {
  if (issues.length === 0) {
    return ["- Issues: none."];
  }
  return issues.map((issue) => {
    const target = issue.target_kind !== undefined && issue.target_id !== undefined ? ` ${issue.target_kind}:${issue.target_id}` : "";
    const node = issue.node_id !== undefined ? ` (${issue.node_id})` : "";
    return `- [${issue.severity}] ${issue.code}${target}${node}: ${issue.message}`;
  });
}

function readJsonChecked(file: string, repoRoot: string, checkedFiles: Set<string>): unknown {
  checkedFiles.add(toRepoPath(repoRoot, file));
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

export function toF3CompositionTarget(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const target = cloneJsonRecord(value);
  delete target.spec_kind;
  delete target.evidence;
  delete target.token_overrides;

  for (const section of getRecordArray(target, "sections")) {
    delete section.evidence_ids;
  }

  for (const node of getRecordArray(target, "nodes")) {
    delete node.evidence_ids;
  }

  return target;
}

function resolveRepoPath(repoRoot: string, path: string): string {
  return resolve(repoRoot, path);
}

function toRepoPath(repoRoot: string, file: string): string {
  return relative(repoRoot, file).replace(/\\/g, "/");
}

function contractKey(targetKind: PdosTargetKind, targetId: string): string {
  return `${targetKind}:${targetId}`;
}

function addIssue(
  issues: PdosRenderabilityIssue[],
  code: PdosRenderabilityReasonCode,
  severity: PdosRenderabilitySeverity,
  message: string,
  context: IssueContext = {}
): void {
  const issue: {
    code: PdosRenderabilityReasonCode;
    severity: PdosRenderabilitySeverity;
    target_kind?: PdosTargetKind;
    target_id?: string;
    node_id?: string;
    message: string;
  } = { code, severity, message };

  if (context.targetKind !== undefined) {
    issue.target_kind = context.targetKind;
  }
  if (context.targetId !== undefined) {
    issue.target_id = context.targetId;
  }
  if (context.nodeId !== undefined) {
    issue.node_id = context.nodeId;
  }

  issues.push(issue);
}

function issueContextFromUnknownTarget(value: unknown): IssueContext {
  if (!isRecord(value)) {
    return {};
  }

  const context: {
    targetKind?: PdosTargetKind;
    targetId?: string;
  } = {};

  if (isTargetKind(value.target_kind)) {
    context.targetKind = value.target_kind;
  }
  if (typeof value.target_id === "string") {
    context.targetId = value.target_id;
  }

  return context;
}

function inlineAssetTypeForSlot(content: CompositionInlineContent, slot: ComponentContractSlot): string {
  const explicitType = optionalTrimmedString(content.asset_type);
  if (explicitType !== undefined) {
    return explicitType;
  }

  return slot.accepts_asset_types?.length === 1 ? slot.accepts_asset_types[0] ?? "inline-content" : "inline-content";
}

function typedFieldForValueType(valueType: ContractPropValueType): TypedValueField {
  if (valueType === "boolean") {
    return "boolean_value";
  }
  if (valueType === "integer") {
    return "integer_value";
  }
  if (valueType === "number") {
    return "number_value";
  }
  if (valueType.endsWith("_ref")) {
    return "ref_value";
  }
  return "string_value";
}

function fieldValueMatches(field: TypedValueField, value: unknown): boolean {
  if (field === "string_value") {
    return typeof value === "string";
  }
  if (field === "number_value") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (field === "integer_value") {
    return typeof value === "number" && Number.isInteger(value);
  }
  if (field === "boolean_value") {
    return typeof value === "boolean";
  }
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTargetKind(value: unknown): value is PdosTargetKind {
  return value === "asset" || value === "pattern";
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

function isComponentContract(value: unknown): value is ComponentContract {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isTargetKind(value.target_kind) &&
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
    typeof value.required === "boolean"
  );
}

function isContractSlot(value: unknown): value is ComponentContractSlot {
  return isRecord(value) && typeof value.name === "string" && typeof value.required === "boolean";
}

function isContractInvariant(value: unknown): value is ComponentContractInvariant {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.required === "boolean" &&
    (value.severity === "error" || value.severity === "warning") &&
    Array.isArray(value.source_floors) &&
    value.source_floors.every((item) => typeof item === "string")
  );
}

function isCompositionTarget(value: unknown): value is CompositionTarget {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.recipe_id === "string" &&
    Array.isArray(value.pattern_ids) &&
    value.pattern_ids.every((item) => typeof item === "string") &&
    Array.isArray(value.asset_ids) &&
    value.asset_ids.every((item) => typeof item === "string") &&
    Array.isArray(value.required_sections) &&
    value.required_sections.every((item) => typeof item === "string") &&
    Array.isArray(value.sections) &&
    Array.isArray(value.nodes)
  );
}

function isCompositionSpec(value: unknown): boolean {
  return isRecord(value) && value.spec_kind === "composition_spec";
}

function isCompositionSection(value: unknown): value is CompositionSection {
  return isRecord(value) && typeof value.section_id === "string" && typeof value.role === "string";
}

function isCompositionNode(value: unknown): value is CompositionNode {
  return (
    isRecord(value) &&
    typeof value.node_id === "string" &&
    isTargetKind(value.target_kind) &&
    typeof value.target_id === "string" &&
    typeof value.section_id === "string" &&
    Array.isArray(value.props) &&
    Array.isArray(value.slot_fills)
  );
}

function isCompositionProp(value: unknown): value is CompositionProp {
  return isRecord(value) && typeof value.name === "string" && isContractValueType(value.value_type);
}

function isCompositionSlotFill(value: unknown): value is CompositionSlotFill {
  return isRecord(value) && typeof value.slot === "string" && Array.isArray(value.fills);
}

function isCompositionSlotFillItem(value: unknown): value is CompositionSlotFillItem {
  if (!isRecord(value) || !isTargetKind(value.target_kind)) {
    return false;
  }

  if (optionalTrimmedString(value.target_id) !== undefined) {
    return true;
  }

  return value.target_kind === "asset" && hasUsableInlineContent(value.content);
}

function isVisualQaInput(value: unknown): value is PdosVisualQaInput {
  return isRecord(value) && Array.isArray(value.viewports);
}

function getRecordArray(value: unknown, key: string): readonly Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    return [];
  }

  return value[key].filter(isRecord);
}

function getStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => typeof item === "string");
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isInlineContentSlotFill(fill: CompositionSlotFillItem): boolean {
  return fill.target_kind === "asset" && fill.content !== undefined;
}

function hasUsableInlineContent(value: unknown): value is CompositionInlineContent {
  return (
    isRecord(value) &&
    (optionalTrimmedString(value.href) !== undefined || optionalTrimmedString(value.inline_svg) !== undefined)
  );
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRasterImageHref(href: string): boolean {
  return /\.(?:png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i.test(href);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseArgs(args: readonly string[]): {
  contractManifestPath?: string;
  targetPaths: string[];
  format?: "json" | "markdown";
} {
  const result: {
    contractManifestPath?: string;
    targetPaths: string[];
    format?: "json" | "markdown";
  } = { targetPaths: [] };

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (!value) {
      continue;
    }

    if (key === "--contract-manifest") {
      result.contractManifestPath = value;
      index += 1;
    } else if (key === "--target") {
      result.targetPaths.push(value);
      index += 1;
    } else if (key === "--targets") {
      result.targetPaths.push(...value.split(",").map((targetPath) => targetPath.trim()).filter(Boolean));
      index += 1;
    } else if (key === "--format" && (value === "json" || value === "markdown")) {
      result.format = value;
      index += 1;
    }
  }

  return result;
}

function printUsage(): void {
  console.log(`Usage:
  tsx product-design-os/scripts/check-renderability-product-design-os.ts --target product-design-os/qa/renderability/fixtures/buildable-marketing.json
  tsx product-design-os/scripts/check-renderability-product-design-os.ts --contract-manifest product-design-os/qa/renderability/fixtures/component-contract-manifest.fixture.json --targets product-design-os/qa/renderability/fixtures/buildable-marketing.json,product-design-os/qa/renderability/fixtures/nonbuildable-motion.json --format markdown`);
}

function runCli(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.targetPaths.length === 0) {
      printUsage();
      return;
    }

    const input: {
      contractManifestPath?: string;
      targetPaths: readonly string[];
    } = { targetPaths: args.targetPaths };
    if (args.contractManifestPath !== undefined) {
      input.contractManifestPath = args.contractManifestPath;
    }

    const report = analyzeProductDesignRenderability(input, process.cwd());
    console.log(formatRenderabilityReport(report, args.format));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown renderability failure.";
    console.error(`Renderability check failed: ${message}`);
    process.exit(1);
  }
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (basename(invokedFile) === basename(currentFile) && invokedFile === currentFile) {
  runCli();
}
