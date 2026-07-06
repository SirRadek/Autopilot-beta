import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  computeRelatedFilesStatus,
  hashDirectoryTree,
} from "../../src/lib/mesh-tools/related-files-status";

describe("related-files-status directory drift", () => {
  it("hashes a directory tree deterministically and detects file content drift", () => {
    const root = mkdtempSync(join(tmpdir(), "related-files-dir-drift-"));
    try {
      const dir = join(root, "src/area");
      mkdirSync(join(dir, "nested"), { recursive: true });
      writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
      writeFileSync(join(dir, "nested/b.ts"), "export const b = 2;\n");

      const first = hashDirectoryTree(dir);
      expect(first).toMatch(/^tree:[0-9a-f]{64}$/);
      expect(hashDirectoryTree(dir)).toBe(first);

      writeFileSync(join(dir, "nested/b.ts"), "export const b = 3;\n");
      expect(hashDirectoryTree(dir)).not.toBe(first);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("detects added and removed files under a hinted directory", () => {
    const root = mkdtempSync(join(tmpdir(), "related-files-dir-drift-"));
    try {
      const dir = join(root, "src/area");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");

      const base = hashDirectoryTree(dir);
      writeFileSync(join(dir, "b.ts"), "export const b = 2;\n");
      const added = hashDirectoryTree(dir);
      expect(added).not.toBe(base);

      unlinkSync(join(dir, "b.ts"));
      expect(hashDirectoryTree(dir)).toBe(base);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is independent of filesystem enumeration order", () => {
    const root = mkdtempSync(join(tmpdir(), "related-files-dir-drift-"));
    try {
      const left = join(root, "left");
      const right = join(root, "right");
      mkdirSync(join(left, "nested"), { recursive: true });
      mkdirSync(join(right, "nested"), { recursive: true });

      writeFileSync(join(left, "a.ts"), "export const a = 1;\n");
      writeFileSync(join(left, "nested/b.ts"), "export const b = 2;\n");
      writeFileSync(join(right, "nested/b.ts"), "export const b = 2;\n");
      writeFileSync(join(right, "a.ts"), "export const a = 1;\n");

      expect(hashDirectoryTree(left)).toBe(hashDirectoryTree(right));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks directory hints VERIFIED when unchanged and STALE when a child file changes", () => {
    const root = mkdtempSync(join(tmpdir(), "related-files-dir-drift-"));
    try {
      mkdirSync(join(root, "mesh/nodes"), { recursive: true });
      mkdirSync(join(root, "src/area"), { recursive: true });
      writeFileSync(join(root, "src/area/keep.ts"), "export const keep = true;\n");
      writeFileSync(
        join(root, "mesh/nodes/sample.yaml"),
        [
          "id: sample",
          "type: test",
          "name: Sample",
          "question: q",
          "why: w",
          "signals: []",
          "related_agents: []",
          "related_files:",
          "  - src/area",
          "required_checks: []",
        ].join("\n")
      );

      const base = computeRelatedFilesStatus(root);
      const unchanged = computeRelatedFilesStatus(root, { prior: base.snapshot });
      expect(unchanged.entries.find((entry) => entry.relatedFile === "src/area")?.status).toBe("VERIFIED");

      writeFileSync(join(root, "src/area/keep.ts"), "export const keep = false;\n");
      const drifted = computeRelatedFilesStatus(root, { prior: base.snapshot });
      const entry = drifted.entries.find((candidate) => candidate.relatedFile === "src/area");
      expect(entry?.status).toBe("STALE");
      expect(entry?.blobHash).toMatch(/^tree:[0-9a-f]{64}$/);
      expect(drifted.summary.stale).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
