import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyzeProductDesignRenderability,
  type PdosRenderabilityIssue,
  type PdosTargetKind
} from "../../scripts/check-renderability-product-design-os";
import {
  analyzeProductDesignVisualQa,
  type PdosVisualIssue,
  type PdosVisualQaInput
} from "../../scripts/visual-qa-product-design-os";
import {
  HARD_BUILDABILITY_CODES,
  isKnownRequirementCode,
  type PatternRequirementCode
} from "../../scripts/pattern-requirement-taxonomy";

export type PdosBuildabilityTaxonomyCode =
  | "TAXONOMY_CODES_MISSING"
  | "TAXONOMY_UNKNOWN_CODE"
  | "TAXONOMY_INVARIANT_UNGROUNDED";

export interface PdosBuildabilityFloorInput {
  readonly contractManifestPath?: string;
  readonly specPaths?: readonly string[];
  readonly targetPaths?: readonly string[];
}

export interface PdosBuildabilityTaxonomyIssue {
  readonly code: PdosBuildabilityTaxonomyCode;
  readonly severity: "error";
  readonly target_kind: "pattern";
  readonly target_id: string;
  readonly message: string;
  readonly requirement_code?: string;
  readonly invariant_code?: string;
}

export interface PdosBuildabilityVisualQaAxis {
  readonly ok: boolean;
  readonly issues: readonly PdosVisualIssue[];
}

export interface PdosBuildabilityCompositionReport {
  readonly id: string;
  readonly build_floor_passed: boolean;
  readonly structural_non_buildable: readonly PdosRenderabilityIssue[];
  readonly taxonomy_floor: readonly PdosBuildabilityTaxonomyIssue[];
  readonly visual_qa: PdosBuildabilityVisualQaAxis;
}

export interface PdosBuildabilityFloorSummary {
  readonly composition_count: number;
  readonly build_floor_passed_count: number;
  readonly build_floor_failed_count: number;
  readonly structural_non_buildable_count: number;
  readonly taxonomy_floor_count: number;
  readonly visual_qa_failed_count: number;
  readonly reason_counts: Readonly<Record<string, number>>;
}

export interface PdosBuildabilityFloorReport {
  readonly ok: boolean;
  readonly compositions: readonly PdosBuildabilityCompositionReport[];
  readonly summary: PdosBuildabilityFloorSummary;
}

interface CompositionSource {
  readonly path: string;
  readonly value: unknown;
}

interface PatternManifestEntry {
  readonly id: string;
  readonly requires_codes?: readonly string[];
}

interface ComponentContract {
  readonly target_kind: PdosTargetKind;
  readonly target_id: string;
  readonly output_invariants: readonly unknown[];
}

interface ComponentContractInvariant {
  readonly code: string;
  readonly required: boolean;
}

const DEFAULT_CONTRACT_MANIFEST = "product-design-os/contracts/component-contract-manifest.json";
const PATTERN_MANIFEST = "product-design-os/patterns/pattern-manifest.json";
const VISUAL_QA_RENDERABILITY_CODE = "VISUAL_QA_ERROR";
const hardBuildabilityCodes = new Set<string>(HARD_BUILDABILITY_CODES);

export function analyzeBuildabilityFloor(
  input: PdosBuildabilityFloorInput,
  repoRoot = process.cwd()
): PdosBuildabilityFloorReport {
  const tempRoot = input.specPaths !== undefined && input.specPaths.length > 0
    ? mkdtempSync(join(tmpdir(), "pdos-f6-buildability-"))
    : undefined;

  try {
    const specSources = (input.specPaths ?? []).map((specPath, index) =>
      createSpecSource(specPath, index, repoRoot, tempRoot)
    );
    const targetSources = (input.targetPaths ?? []).map((targetPath) =>
      createTargetSource(targetPath, repoRoot)
    );
    const sources = [...specSources, ...targetSources];
    const targetPaths = sources.map((source) => source.path);
    const renderabilityInput: {
      contractManifestPath?: string;
      targetPaths: readonly string[];
    } = { targetPaths };

    if (input.contractManifestPath !== undefined) {
      renderabilityInput.contractManifestPath = input.contractManifestPath;
    }

    const renderabilityReport = analyzeProductDesignRenderability(renderabilityInput, repoRoot);
    const patternManifest = loadPatternManifest(repoRoot);
    const contracts = loadPatternContracts(repoRoot, input.contractManifestPath ?? DEFAULT_CONTRACT_MANIFEST);

    const compositions = sources.map((source, index) => {
      const renderabilityComposition = renderabilityReport.compositions[index];
      if (renderabilityComposition === undefined) {
        throw new Error(`Missing renderability result for ${source.path}.`);
      }

      const structuralNonBuildable = renderabilityComposition.non_buildable.filter(
        (issue) => issue.code !== VISUAL_QA_RENDERABILITY_CODE
      );
      const taxonomyFloor = analyzeTaxonomyFloor(source.value, patternManifest, contracts);
      const visualQa = analyzeVisualQaAxis(source.value);

      return {
        id: renderabilityComposition.id,
        build_floor_passed: structuralNonBuildable.length === 0 && taxonomyFloor.length === 0,
        structural_non_buildable: structuralNonBuildable,
        taxonomy_floor: taxonomyFloor,
        visual_qa: visualQa
      };
    });

    return {
      ok: compositions.every((composition) => composition.build_floor_passed),
      compositions,
      summary: summarizeCompositions(compositions)
    };
  } finally {
    if (tempRoot !== undefined) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

export function formatBuildabilityFloorReport(
  report: PdosBuildabilityFloorReport,
  format: "json" | "markdown" = "json"
): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  return `${[
    "# Product & Design OS Buildability Floor Report",
    "",
    "## Summary",
    `- OK: ${String(report.ok)}`,
    `- Compositions: ${report.summary.composition_count}`,
    `- Floor passed: ${report.summary.build_floor_passed_count}`,
    `- Floor failed: ${report.summary.build_floor_failed_count}`,
    `- Structural non-buildable entries: ${report.summary.structural_non_buildable_count}`,
    `- Taxonomy-floor entries: ${report.summary.taxonomy_floor_count}`,
    `- Visual QA failed: ${report.summary.visual_qa_failed_count}`,
    "",
    "## Reason Counts",
    ...formatReasonCounts(report.summary.reason_counts),
    "",
    "## Compositions",
    ...report.compositions.flatMap(formatCompositionMarkdown)
  ].join("\n").trimEnd()}\n`;
}

function createSpecSource(
  specPath: string,
  index: number,
  repoRoot: string,
  tempRoot: string | undefined
): CompositionSource {
  if (tempRoot === undefined) {
    throw new Error("Internal error: temp root missing for composition spec normalization.");
  }

  const specValue = readJson(resolveRepoPath(repoRoot, specPath));
  const targetValue = toF3CompositionTarget(specValue);
  const tempTargetPath = join(tempRoot, `${String(index).padStart(3, "0")}-${safeTempBasename(specPath)}`);
  writeFileSync(tempTargetPath, `${JSON.stringify(targetValue, null, 2)}\n`);
  return { path: tempTargetPath, value: specValue };
}

function createTargetSource(targetPath: string, repoRoot: string): CompositionSource {
  const resolvedPath = resolveRepoPath(repoRoot, targetPath);
  return {
    path: targetPath,
    value: readJson(resolvedPath)
  };
}

function toF3CompositionTarget(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const target = cloneJsonRecord(value);
  delete target.spec_kind;
  delete target.evidence;
  delete target.token_overrides;

  for (const section of getRecordArray(target.sections)) {
    delete section.evidence_ids;
  }

  for (const node of getRecordArray(target.nodes)) {
    delete node.evidence_ids;
  }

  return target;
}

function analyzeTaxonomyFloor(
  composition: unknown,
  patternManifest: ReadonlyMap<string, PatternManifestEntry>,
  contracts: ReadonlyMap<string, ComponentContract>
): readonly PdosBuildabilityTaxonomyIssue[] {
  const issues: PdosBuildabilityTaxonomyIssue[] = [];
  const referencedPatternIds = getReferencedPatternIds(composition);

  for (const patternId of referencedPatternIds) {
    const pattern = patternManifest.get(patternId);
    const requiresCodes = getStringArray(pattern?.requires_codes);
    const requiresCodeSet = new Set(requiresCodes);

    if (requiresCodes.length === 0) {
      issues.push({
        code: "TAXONOMY_CODES_MISSING",
        severity: "error",
        target_kind: "pattern",
        target_id: patternId,
        message: `Pattern ${patternId} is missing non-empty requires_codes.`
      });
    }

    for (const requirementCode of requiresCodes) {
      if (!isKnownRequirementCode(requirementCode)) {
        issues.push({
          code: "TAXONOMY_UNKNOWN_CODE",
          severity: "error",
          target_kind: "pattern",
          target_id: patternId,
          requirement_code: requirementCode,
          message: `Pattern ${patternId} declares unknown requires_codes value ${requirementCode}.`
        });
      }
    }

    const contract = contracts.get(contractKey("pattern", patternId));
    if (contract === undefined) {
      continue;
    }

    for (const invariant of contract.output_invariants.filter(isComponentContractInvariant)) {
      if (!invariant.required || !isHardBuildabilityCode(invariant.code) || requiresCodeSet.has(invariant.code)) {
        continue;
      }

      issues.push({
        code: "TAXONOMY_INVARIANT_UNGROUNDED",
        severity: "error",
        target_kind: "pattern",
        target_id: patternId,
        invariant_code: invariant.code,
        message: `Pattern ${patternId} does not back required hard invariant ${invariant.code} in requires_codes.`
      });
    }
  }

  return issues;
}

function analyzeVisualQaAxis(composition: unknown): PdosBuildabilityVisualQaAxis {
  const visualQaProbe = isRecord(composition) ? composition.visual_qa_probe : undefined;
  if (isVisualQaInput(visualQaProbe)) {
    const report = analyzeProductDesignVisualQa(visualQaProbe);
    return {
      ok: report.ok,
      issues: report.issues
    };
  }

  return {
    ok: false,
    issues: [
      {
        code: "visual_qa_probe_invalid",
        severity: "error",
        message: "Composition visual_qa_probe is missing or invalid."
      }
    ]
  };
}

function loadPatternManifest(repoRoot: string): ReadonlyMap<string, PatternManifestEntry> {
  const manifest = readJson(resolveRepoPath(repoRoot, PATTERN_MANIFEST));
  const patterns = new Map<string, PatternManifestEntry>();

  for (const pattern of getRecordArray(isRecord(manifest) ? manifest.patterns : undefined)) {
    if (typeof pattern.id !== "string") {
      continue;
    }

    const entry: {
      id: string;
      requires_codes?: readonly string[];
    } = { id: pattern.id };
    const requiresCodes = getStringArray(pattern.requires_codes);
    if (requiresCodes.length > 0 || Array.isArray(pattern.requires_codes)) {
      entry.requires_codes = requiresCodes;
    }
    patterns.set(pattern.id, entry);
  }

  return patterns;
}

function loadPatternContracts(repoRoot: string, contractManifestPath: string): ReadonlyMap<string, ComponentContract> {
  const manifest = readJson(resolveRepoPath(repoRoot, contractManifestPath));
  const contracts = new Map<string, ComponentContract>();

  for (const contract of getRecordArray(isRecord(manifest) ? manifest.contracts : undefined)) {
    if (!isComponentContract(contract) || contract.target_kind !== "pattern") {
      continue;
    }

    contracts.set(contractKey(contract.target_kind, contract.target_id), contract);
  }

  return contracts;
}

function summarizeCompositions(
  compositions: readonly PdosBuildabilityCompositionReport[]
): PdosBuildabilityFloorSummary {
  const reasonCounts: Record<string, number> = {};
  let structuralNonBuildableCount = 0;
  let taxonomyFloorCount = 0;

  for (const composition of compositions) {
    structuralNonBuildableCount += composition.structural_non_buildable.length;
    taxonomyFloorCount += composition.taxonomy_floor.length;

    for (const issue of composition.structural_non_buildable) {
      reasonCounts[issue.code] = (reasonCounts[issue.code] ?? 0) + 1;
    }
    for (const issue of composition.taxonomy_floor) {
      reasonCounts[issue.code] = (reasonCounts[issue.code] ?? 0) + 1;
    }
  }

  const buildFloorPassedCount = compositions.filter((composition) => composition.build_floor_passed).length;

  return {
    composition_count: compositions.length,
    build_floor_passed_count: buildFloorPassedCount,
    build_floor_failed_count: compositions.length - buildFloorPassedCount,
    structural_non_buildable_count: structuralNonBuildableCount,
    taxonomy_floor_count: taxonomyFloorCount,
    visual_qa_failed_count: compositions.filter((composition) => !composition.visual_qa.ok).length,
    reason_counts: Object.fromEntries(Object.entries(reasonCounts).sort())
  };
}

function getReferencedPatternIds(composition: unknown): readonly string[] {
  if (!isRecord(composition)) {
    return [];
  }

  const ids = new Set<string>();
  for (const patternId of getStringArray(composition.pattern_ids)) {
    ids.add(patternId);
  }

  for (const node of getRecordArray(composition.nodes)) {
    if (node.target_kind === "pattern" && typeof node.target_id === "string") {
      ids.add(node.target_id);
    }
  }

  return [...ids].sort();
}

function formatCompositionMarkdown(composition: PdosBuildabilityCompositionReport): readonly string[] {
  return [
    `### ${composition.id}`,
    `- Build floor passed: ${String(composition.build_floor_passed)}`,
    `- Structural non-buildable entries: ${composition.structural_non_buildable.length}`,
    ...formatRenderabilityIssues(composition.structural_non_buildable),
    `- Taxonomy-floor entries: ${composition.taxonomy_floor.length}`,
    ...formatTaxonomyIssues(composition.taxonomy_floor),
    `- Visual QA OK: ${String(composition.visual_qa.ok)}`,
    `- Visual QA issues: ${composition.visual_qa.issues.length}`,
    ...formatVisualIssues(composition.visual_qa.issues)
  ];
}

function formatReasonCounts(reasonCounts: Readonly<Record<string, number>>): readonly string[] {
  const entries = Object.entries(reasonCounts);
  if (entries.length === 0) {
    return ["- None."];
  }
  return entries.map(([code, count]) => `- ${code}: ${count}`);
}

function formatRenderabilityIssues(issues: readonly PdosRenderabilityIssue[]): readonly string[] {
  if (issues.length === 0) {
    return ["- Structural issues: none."];
  }
  return issues.map((issue) => {
    const target = issue.target_kind !== undefined && issue.target_id !== undefined ? ` ${issue.target_kind}:${issue.target_id}` : "";
    const node = issue.node_id !== undefined ? ` (${issue.node_id})` : "";
    return `- [${issue.severity}] ${issue.code}${target}${node}: ${issue.message}`;
  });
}

function formatTaxonomyIssues(issues: readonly PdosBuildabilityTaxonomyIssue[]): readonly string[] {
  if (issues.length === 0) {
    return ["- Taxonomy issues: none."];
  }
  return issues.map((issue) => `- [${issue.severity}] ${issue.code} pattern:${issue.target_id}: ${issue.message}`);
}

function formatVisualIssues(issues: readonly PdosVisualIssue[]): readonly string[] {
  if (issues.length === 0) {
    return ["- Visual QA details: none."];
  }
  return issues.map((issue) => {
    const viewport = issue.viewport !== undefined ? ` (${issue.viewport})` : "";
    return `- [${issue.severity}] ${issue.code}${viewport}: ${issue.message}`;
  });
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function resolveRepoPath(repoRoot: string, path: string): string {
  return resolve(repoRoot, path);
}

function contractKey(targetKind: PdosTargetKind, targetId: string): string {
  return `${targetKind}:${targetId}`;
}

function safeTempBasename(file: string): string {
  const name = basename(file).replace(/[^A-Za-z0-9.-]/g, "_");
  return name.endsWith(".json") ? name : `${name}.json`;
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isHardBuildabilityCode(code: string): code is PatternRequirementCode {
  return hardBuildabilityCodes.has(code);
}

function isComponentContract(value: unknown): value is ComponentContract {
  return (
    isRecord(value) &&
    (value.target_kind === "asset" || value.target_kind === "pattern") &&
    typeof value.target_id === "string" &&
    Array.isArray(value.output_invariants)
  );
}

function isComponentContractInvariant(value: unknown): value is ComponentContractInvariant {
  return isRecord(value) && typeof value.code === "string" && typeof value.required === "boolean";
}

function isVisualQaInput(value: unknown): value is PdosVisualQaInput {
  return isRecord(value) && Array.isArray(value.viewports);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecordArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

function getStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function parseArgs(args: readonly string[]): {
  contractManifestPath?: string;
  specPaths: string[];
  targetPaths: string[];
  format?: "json" | "markdown";
} {
  const result: {
    contractManifestPath?: string;
    specPaths: string[];
    targetPaths: string[];
    format?: "json" | "markdown";
  } = { specPaths: [], targetPaths: [] };

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key === undefined || value === undefined) {
      continue;
    }

    if (key === "--contract-manifest") {
      result.contractManifestPath = value;
      index += 1;
    } else if (key === "--spec") {
      result.specPaths.push(value);
      index += 1;
    } else if (key === "--specs") {
      result.specPaths.push(...splitPathList(value));
      index += 1;
    } else if (key === "--target") {
      result.targetPaths.push(value);
      index += 1;
    } else if (key === "--targets") {
      result.targetPaths.push(...splitPathList(value));
      index += 1;
    } else if (key === "--format" && (value === "json" || value === "markdown")) {
      result.format = value;
      index += 1;
    }
  }

  return result;
}

function splitPathList(value: string): readonly string[] {
  return value.split(",").map((path) => path.trim()).filter(Boolean);
}

function printUsage(): void {
  console.log(`Usage:
  tsx product-design-os/qa/buildability-floor/check-buildability-floor-product-design-os.ts --spec product-design-os/specs/examples/buildable-marketing.composition.json
  tsx product-design-os/qa/buildability-floor/check-buildability-floor-product-design-os.ts --target product-design-os/qa/renderability/fixtures/nonbuildable-motion.json --format markdown`);
}

function runCli(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.specPaths.length === 0 && args.targetPaths.length === 0) {
      printUsage();
      return;
    }

    const input: {
      contractManifestPath?: string;
      specPaths?: readonly string[];
      targetPaths?: readonly string[];
    } = {};
    if (args.contractManifestPath !== undefined) {
      input.contractManifestPath = args.contractManifestPath;
    }
    if (args.specPaths.length > 0) {
      input.specPaths = args.specPaths;
    }
    if (args.targetPaths.length > 0) {
      input.targetPaths = args.targetPaths;
    }

    const report = analyzeBuildabilityFloor(input, process.cwd());
    console.log(formatBuildabilityFloorReport(report, args.format));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown buildability-floor failure.";
    console.error(`Buildability floor check failed: ${message}`);
    process.exit(1);
  }
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (basename(invokedFile) === basename(currentFile) && invokedFile === currentFile) {
  runCli();
}
