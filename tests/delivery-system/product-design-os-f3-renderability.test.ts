import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyProductDesignRenderabilityCliExitCode,
  analyzeProductDesignRenderability,
  createProductDesignRenderabilityCliRun,
  getDefaultPdosCompositionSpecPaths,
  type PdosRenderabilityReport
} from "../../product-design-os/scripts/check-renderability-product-design-os";

const repoRoot = process.cwd();
const buildableSpecPath = "product-design-os/specs/examples/buildable-marketing.composition.json";
const fixtureInput = {
  contractManifestPath: "product-design-os/qa/renderability/fixtures/component-contract-manifest.fixture.json",
  targetPaths: [
    "product-design-os/qa/renderability/fixtures/buildable-marketing.json",
    "product-design-os/qa/renderability/fixtures/nonbuildable-motion.json"
  ]
} as const;

function byId(report: PdosRenderabilityReport, id: string) {
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

function analyzeTempTarget(target: Record<string, unknown>): PdosRenderabilityReport {
  const tempRoot = mkdtempSync(join(tmpdir(), "pdos-f3-renderability-"));
  const tempTarget = join(tempRoot, "target.json");

  try {
    writeJson(tempTarget, target);
    return analyzeProductDesignRenderability(
      {
        contractManifestPath: fixtureInput.contractManifestPath,
        targetPaths: [tempTarget]
      },
      repoRoot
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function replaceProofAssetFills(target: Record<string, unknown>, fills: readonly unknown[]): void {
  const proofNode = getRecordArray(target.nodes).find((node) => node.node_id === "proof-section");
  if (proofNode === undefined) {
    throw new Error("Missing proof-section node.");
  }

  const proofAssetSlot = getRecordArray(proofNode.slot_fills).find((slotFill) => slotFill.slot === "proof_asset");
  if (proofAssetSlot === undefined) {
    throw new Error("Missing proof_asset slot fill.");
  }

  proofAssetSlot.fills = [...fills];
}

function getRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("Product Design OS F3 renderability", () => {
  it("defaults the no-arg CLI to all committed composition examples", () => {
    const defaultSpecPaths = getDefaultPdosCompositionSpecPaths(repoRoot);
    const previousExitCode = process.exitCode;

    try {
      const cliRun = createProductDesignRenderabilityCliRun([], repoRoot);
      const compositionIds = cliRun.report.compositions.map((composition) => composition.id);

      expect(defaultSpecPaths).toEqual([...defaultSpecPaths].sort());
      expect(defaultSpecPaths.length).toBeGreaterThan(0);
      expect(defaultSpecPaths.every((specPath) => specPath.startsWith("product-design-os/specs/examples/"))).toBe(true);
      expect(defaultSpecPaths.every((specPath) => specPath.endsWith(".composition.json"))).toBe(true);
      expect(cliRun.report.ok).toBe(true);
      expect(cliRun.report.summary.target_count).toBe(defaultSpecPaths.length);
      expect(compositionIds).toContain("buildable-marketing");
      expect(compositionIds).toContain("local-bricklayer");
      expect(cliRun.exitCode).toBe(0);
      expect(applyProductDesignRenderabilityCliExitCode(cliRun.report)).toBe(0);
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("lets explicit --targets override the committed-example default", () => {
    const cliRun = createProductDesignRenderabilityCliRun(["--targets", buildableSpecPath], repoRoot);

    expect(cliRun.report.ok).toBe(true);
    expect(cliRun.report.summary.target_count).toBe(1);
    expect(cliRun.report.compositions.map((composition) => composition.id)).toEqual(["buildable-marketing"]);
    expect(cliRun.exitCode).toBe(0);
  });

  it("maps a synthetic non-buildable composition spec to CLI exit code 1", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pdos-f3-cli-gate-"));
    const tempSpec = join(tempRoot, "missing-proof-asset.composition.json");
    const previousExitCode = process.exitCode;

    try {
      const spec = cloneRecord(readJsonRecord(join(repoRoot, buildableSpecPath)));
      replaceProofAssetFills(spec, [{ target_kind: "asset" }]);
      writeJson(tempSpec, spec);

      const cliRun = createProductDesignRenderabilityCliRun(["--target", tempSpec], repoRoot);
      const composition = byId(cliRun.report, "buildable-marketing");
      const codes = composition.non_buildable.map((issue) => issue.code);

      expect(cliRun.report.ok).toBe(false);
      expect(cliRun.report.summary.target_count).toBe(1);
      expect(codes).toContain("SLOT_MISSING");
      expect(cliRun.exitCode).toBe(1);
      expect(applyProductDesignRenderabilityCliExitCode(cliRun.report)).toBe(1);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps the fixture report shape stable and does not throw", () => {
    let report: PdosRenderabilityReport | undefined;

    expect(() => {
      report = analyzeProductDesignRenderability(fixtureInput, repoRoot);
    }).not.toThrow();

    expect(report).toEqual(
      expect.objectContaining({
        ok: false,
        checked_files: expect.any(Array),
        compositions: expect.any(Array),
        summary: expect.objectContaining({
          target_count: 2,
          buildable_count: 1,
          non_buildable_count: 1
        })
      })
    );
  });

  it("reports buildable-marketing as buildable", () => {
    const report = analyzeProductDesignRenderability(fixtureInput, repoRoot);
    const composition = byId(report, "buildable-marketing");

    expect(composition.buildable).toBe(true);
    expect(composition.non_buildable).toEqual([]);
  });

  it("reports the intentional motion fixture failures", () => {
    const report = analyzeProductDesignRenderability(fixtureInput, repoRoot);
    const composition = byId(report, "nonbuildable-motion");
    const codes = new Set(composition.non_buildable.map((issue) => issue.code));

    expect(composition.buildable).toBe(false);
    expect(codes).toEqual(
      new Set(["CONTRACT_MISSING", "SLOT_MISSING", "INVARIANT_UNDECLARED", "VISUAL_QA_ERROR"])
    );
  });

  it("accepts inline content slot fills as satisfying required asset slots", () => {
    const target = cloneRecord(readJsonRecord(join(repoRoot, fixtureInput.targetPaths[0])));
    replaceProofAssetFills(target, [
      {
        target_kind: "asset",
        content: {
          href: "./assets/proof-strip.jpg",
          alt: "Proof strip",
          license: "CC0-1.0",
          source_url: "https://example.com/proof-strip"
        }
      }
    ]);

    const report = analyzeTempTarget(target);
    const composition = byId(report, "buildable-marketing");
    const codes = composition.non_buildable.map((issue) => issue.code);

    expect(composition.buildable).toBe(true);
    expect(codes).not.toContain("SLOT_MISSING");
  });

  it("still fails a required slot fill without target_id or inline content", () => {
    const target = cloneRecord(readJsonRecord(join(repoRoot, fixtureInput.targetPaths[0])));
    replaceProofAssetFills(target, [{ target_kind: "asset" }]);

    const report = analyzeTempTarget(target);
    const composition = byId(report, "buildable-marketing");
    const codes = composition.non_buildable.map((issue) => issue.code);

    expect(composition.buildable).toBe(false);
    expect(codes).toContain("SLOT_MISSING");
  });

  it("accepts a current F4 composition spec without schema false positives", () => {
    const report = analyzeProductDesignRenderability({ targetPaths: [buildableSpecPath] }, repoRoot);
    const composition = byId(report, "buildable-marketing");
    const codes = composition.non_buildable.map((issue) => issue.code);

    expect(composition.buildable).toBe(true);
    expect(codes).not.toContain("SCHEMA_INVALID");
  });
});
