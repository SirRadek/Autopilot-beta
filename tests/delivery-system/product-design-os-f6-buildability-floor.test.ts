import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyBuildabilityFloorCliExitCode,
  analyzeBuildabilityFloor,
  createBuildabilityFloorCliRun,
  type PdosBuildabilityFloorReport
} from "../../product-design-os/qa/buildability-floor/check-buildability-floor-product-design-os";
import { getDefaultPdosCompositionSpecPaths } from "../../product-design-os/scripts/check-renderability-product-design-os";
import {
  isKnownRequirementCode,
  PATTERN_REQUIREMENT_CODES
} from "../../product-design-os/scripts/pattern-requirement-taxonomy";

const repoRoot = process.cwd();
const buildableSpecPath = "product-design-os/specs/examples/buildable-marketing.composition.json";
const localBricklayerSpecPath = "product-design-os/specs/examples/local-bricklayer.composition.json";
const nonbuildableTargetPath = "product-design-os/qa/renderability/fixtures/nonbuildable-motion.json";
const patternManifestFile = join(repoRoot, "product-design-os", "patterns", "pattern-manifest.json");
const patternSchemaFile = join(repoRoot, "product-design-os", "patterns", "pattern.schema.json");

function byId(report: PdosBuildabilityFloorReport, id: string) {
  const composition = report.compositions.find((candidate) => candidate.id === id);
  if (composition === undefined) {
    throw new Error(`Missing composition report for ${id}`);
  }
  return composition;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function readJsonRecord(file: string): Record<string, unknown> {
  const value = readJson(file);
  if (!isRecord(value)) {
    throw new Error(`Expected JSON object in ${file}.`);
  }
  return value;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function replaceProofAssetFills(spec: Record<string, unknown>, fills: readonly unknown[]): void {
  const proofNode = getRecordArray(spec.nodes).find((node) => node.node_id === "proof-section" || node.node_id === "proof");
  if (proofNode === undefined) {
    throw new Error("Missing proof node.");
  }

  const proofAssetSlot = getRecordArray(proofNode.slot_fills).find((slotFill) => slotFill.slot === "proof_asset");
  if (proofAssetSlot === undefined) {
    throw new Error("Missing proof_asset slot fill.");
  }

  proofAssetSlot.fills = [...fills];
}

function getRecordProperty(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const property = value[key];
  if (!isRecord(property)) {
    throw new Error(`Expected object property ${key}.`);
  }
  return property;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("Product Design OS F6 buildability floor", () => {
  it("defaults the no-arg CLI to all committed composition examples", () => {
    const defaultSpecPaths = getDefaultPdosCompositionSpecPaths(repoRoot);
    const previousExitCode = process.exitCode;

    try {
      const cliRun = createBuildabilityFloorCliRun([], repoRoot);
      const compositionIds = cliRun.report.compositions.map((composition) => composition.id);

      expect(defaultSpecPaths.length).toBeGreaterThan(0);
      expect(cliRun.report.ok).toBe(true);
      expect(cliRun.report.summary.composition_count).toBe(defaultSpecPaths.length);
      expect(compositionIds).toContain("buildable-marketing");
      expect(compositionIds).toContain("local-bricklayer");
      expect(cliRun.exitCode).toBe(0);
      expect(applyBuildabilityFloorCliExitCode(cliRun.report)).toBe(0);
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("lets explicit --spec override the committed-example default", () => {
    const cliRun = createBuildabilityFloorCliRun(["--spec", localBricklayerSpecPath], repoRoot);

    expect(cliRun.report.ok).toBe(true);
    expect(cliRun.report.summary.composition_count).toBe(1);
    expect(cliRun.report.compositions.map((composition) => composition.id)).toEqual(["local-bricklayer"]);
    expect(cliRun.exitCode).toBe(0);
  });

  it("passes the committed F4 buildable marketing composition", () => {
    const report = analyzeBuildabilityFloor({ specPaths: [buildableSpecPath] }, repoRoot);
    const composition = byId(report, "buildable-marketing");

    expect(report.ok).toBe(true);
    expect(composition.build_floor_passed).toBe(true);
    expect(composition.structural_non_buildable).toEqual([]);
    expect(composition.taxonomy_floor).toEqual([]);
  });

  it("passes inline content slot fills in the committed local-bricklayer composition", () => {
    const report = analyzeBuildabilityFloor({ specPaths: [localBricklayerSpecPath] }, repoRoot);
    const composition = byId(report, "local-bricklayer");
    const structuralCodes = composition.structural_non_buildable.map((issue) => issue.code);

    expect(report.ok).toBe(true);
    expect(composition.build_floor_passed).toBe(true);
    expect(structuralCodes).not.toContain("SLOT_MISSING");
    expect(composition.taxonomy_floor).toEqual([]);
  });

  it("fails the F3 nonbuildable motion target on structural buildability errors", () => {
    const report = analyzeBuildabilityFloor({ targetPaths: [nonbuildableTargetPath] }, repoRoot);
    const composition = byId(report, "nonbuildable-motion");
    const structuralCodes = new Set(composition.structural_non_buildable.map((issue) => issue.code));

    expect(report.ok).toBe(false);
    expect(composition.build_floor_passed).toBe(false);
    expect(structuralCodes).toEqual(new Set(["CONTRACT_MISSING", "SLOT_MISSING", "INVARIANT_UNDECLARED"]));
    expect(structuralCodes.has("VISUAL_QA_ERROR")).toBe(false);
  });

  it("fails a required slot fill with neither target_id nor inline content", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pdos-f6-slot-"));
    const tempSpec = join(tempRoot, "missing-proof-asset.composition.json");
    const previousExitCode = process.exitCode;

    try {
      const spec = cloneRecord(readJsonRecord(join(repoRoot, buildableSpecPath)));
      replaceProofAssetFills(spec, [{ target_kind: "asset" }]);
      writeJson(tempSpec, spec);

      const cliRun = createBuildabilityFloorCliRun(["--spec", tempSpec], repoRoot);
      const report = cliRun.report;
      const composition = byId(report, "buildable-marketing");
      const structuralCodes = composition.structural_non_buildable.map((issue) => issue.code);

      expect(report.ok).toBe(false);
      expect(report.summary.composition_count).toBe(1);
      expect(composition.build_floor_passed).toBe(false);
      expect(structuralCodes).toContain("SLOT_MISSING");
      expect(cliRun.exitCode).toBe(1);
      expect(applyBuildabilityFloorCliExitCode(report)).toBe(1);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps visual QA independent from the buildability floor verdict", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pdos-f6-visual-"));
    const tempSpec = join(tempRoot, "visual-qa-fails.composition.json");

    try {
      const spec = cloneRecord(readJsonRecord(join(repoRoot, buildableSpecPath)));
      const visualQaProbe = getRecordProperty(spec, "visual_qa_probe");
      visualQaProbe.viewports = getRecordArray(visualQaProbe.viewports).map((viewport, index) =>
        index === 0 ? { ...viewport, low_contrast: true } : viewport
      );
      writeJson(tempSpec, spec);

      const report = analyzeBuildabilityFloor({ specPaths: [tempSpec] }, repoRoot);
      const composition = byId(report, "buildable-marketing");

      expect(composition.structural_non_buildable).toEqual([]);
      expect(composition.taxonomy_floor).toEqual([]);
      expect(composition.build_floor_passed).toBe(true);
      expect(composition.visual_qa.ok).toBe(false);
      expect(composition.visual_qa.issues.map((issue) => issue.code)).toContain("low_contrast");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps pattern requirement codes complete and aligned with the schema enum", () => {
    const patternManifest = readJsonRecord(patternManifestFile);
    const patterns = getRecordArray(patternManifest.patterns);
    const taxonomyProblems: string[] = [];

    expect(patterns).toHaveLength(44);

    for (const pattern of patterns) {
      const patternId = typeof pattern.id === "string" ? pattern.id : "unknown-pattern";
      const requiresCodes = getStringArray(pattern.requires_codes);
      if (requiresCodes.length === 0) {
        taxonomyProblems.push(`${patternId}: missing requires_codes`);
      }

      for (const requirementCode of requiresCodes) {
        if (!isKnownRequirementCode(requirementCode)) {
          taxonomyProblems.push(`${patternId}: unknown ${requirementCode}`);
        }
      }
    }

    const schema = readJsonRecord(patternSchemaFile);
    const schemaProperties = getRecordProperty(schema, "properties");
    const requiresCodes = getRecordProperty(schemaProperties, "requires_codes");
    const requiresCodeItems = getRecordProperty(requiresCodes, "items");
    const schemaCodes = getStringArray(requiresCodeItems.enum);

    expect(taxonomyProblems).toEqual([]);
    expect(schemaCodes).toEqual([...PATTERN_REQUIREMENT_CODES]);
  });
});
