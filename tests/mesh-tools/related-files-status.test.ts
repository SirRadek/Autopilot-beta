import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  computeRelatedFilesStatus,
  currentMissingKeys,
  diffAgainstBaseline,
  gitBlobHash,
  parseRelatedFiles,
} from "../../src/lib/mesh-tools/related-files-status";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, "../fixtures/mesh-tools/sample-repo");

describe("related-files-status (bind-point ①)", () => {
  it("classifies VERIFIED(file+dir) / MISSING / PLACEHOLDER against a real mesh, no DB", () => {
    const r = computeRelatedFilesStatus(SAMPLE);
    expect(r.summary.verified).toBe(2); // src/real.ts (file) + src/area (dir)
    expect(r.summary.missing).toBe(1); // src/gone.ts
    expect(r.summary.placeholder).toBe(1); // docs/projects/<slug>/...
    const file = r.entries.find((e) => e.relatedFile === "src/real.ts");
    expect(file?.status).toBe("VERIFIED");
    expect(file?.blobHash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("treats an existing directory hint as VERIFIED with no blob hash (coarse, no crash)", () => {
    const r = computeRelatedFilesStatus(SAMPLE);
    const dir = r.entries.find((e) => e.relatedFile === "src/area");
    expect(dir?.status).toBe("VERIFIED");
    expect(dir?.blobHash).toBeUndefined();
    expect(r.snapshot["src/area"]).toBeUndefined(); // dirs are not snapshotted
  });

  it("flips a file VERIFIED → STALE when its prior blob hash no longer matches (no manual edit, no DB)", () => {
    const base = computeRelatedFilesStatus(SAMPLE);
    const stalePrior = { ...base.snapshot };
    stalePrior["src/real.ts"] = "0".repeat(40);
    const r = computeRelatedFilesStatus(SAMPLE, { prior: stalePrior });
    expect(r.summary.stale).toBe(1);
    expect(r.entries.find((e) => e.relatedFile === "src/real.ts")?.status).toBe("STALE");
  });

  it("treats a matching prior snapshot as VERIFIED (no false STALE)", () => {
    const base = computeRelatedFilesStatus(SAMPLE);
    const r = computeRelatedFilesStatus(SAMPLE, { prior: base.snapshot });
    expect(r.summary.stale).toBe(0);
    expect(r.entries.find((e) => e.relatedFile === "src/real.ts")?.status).toBe("VERIFIED");
  });

  it("flags a file hint absent from a SUPPLIED prior as UNSNAPSHOTTED (fail-closed coverage gap)", () => {
    // A non-empty prior that does NOT cover src/real.ts must not silently pass it as VERIFIED —
    // that is how the snapshot used to fall out of coverage and the gate go drift-blind.
    const r = computeRelatedFilesStatus(SAMPLE, { prior: { "some/unrelated.ts": "0".repeat(40) } });
    expect(r.entries.find((e) => e.relatedFile === "src/real.ts")?.status).toBe("UNSNAPSHOTTED");
    expect(r.summary.unsnapshotted).toBeGreaterThanOrEqual(1);
  });

  it("a full matching prior yields zero UNSNAPSHOTTED; no prior at all also yields zero (strict mode unchanged)", () => {
    const base = computeRelatedFilesStatus(SAMPLE);
    expect(computeRelatedFilesStatus(SAMPLE, { prior: base.snapshot }).summary.unsnapshotted).toBe(0);
    const noPrior = computeRelatedFilesStatus(SAMPLE);
    expect(noPrior.summary.unsnapshotted).toBe(0);
    expect(noPrior.entries.find((e) => e.relatedFile === "src/real.ts")?.status).toBe("VERIFIED");
  });

  it("computes the same blob hash as real `git hash-object` (provenance honesty)", () => {
    const target = join(SAMPLE, "src/real.ts");
    const real = execFileSync("git", ["hash-object", target], { encoding: "utf8" }).trim();
    const ours = computeRelatedFilesStatus(SAMPLE).snapshot["src/real.ts"];
    expect(ours).toBe(real);
    expect(gitBlobHash(Buffer.from("export const real = true;\n"))).toBe(real);
  });

  it("honors a custom nodesSubdir (per-project mesh at .autopilot/decision-mesh/nodes)", () => {
    expect(computeRelatedFilesStatus(SAMPLE, { nodesSubdir: "mesh/nodes" }).summary.total).toBeGreaterThan(0);
    expect(computeRelatedFilesStatus(SAMPLE, { nodesSubdir: "does/not/exist" }).summary.total).toBe(0);
  });

  it("parses only the related_files block", () => {
    const yaml = ["name: x", "related_files:", "  - a/b.ts", "  - c/d.ts", "required_checks:", "  - z"].join("\n");
    expect(parseRelatedFiles(yaml)).toEqual(["a/b.ts", "c/d.ts"]);
  });

  it("ratchet: a new dead pointer fails vs an empty floor; known rot does not", () => {
    const report = computeRelatedFilesStatus(SAMPLE);
    const ownFloor = currentMissingKeys(report);
    expect(diffAgainstBaseline(report, ownFloor).newMissing).toEqual([]); // same state => no new rot
    const diff = diffAgainstBaseline(report, []); // nothing known-missing => existing rot reads as new
    expect(diff.newMissing).toContain("sample.yaml::src/gone.ts");
  });

  it("ratchet: a known-missing hint that disappears is reported as resolved", () => {
    const report = computeRelatedFilesStatus(SAMPLE);
    const floor = [...currentMissingKeys(report), "sample.yaml::src/was-here.ts"];
    const diff = diffAgainstBaseline(report, floor);
    expect(diff.resolved).toContain("sample.yaml::src/was-here.ts");
    expect(diff.newMissing).toEqual([]);
  });
});
