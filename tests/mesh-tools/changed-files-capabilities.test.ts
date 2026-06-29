import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadDecisionMesh } from "../../src/lib/decision-mesh";
import { activateForChangedFiles } from "../../src/lib/mesh-tools/changed-files-capabilities";

const here = dirname(fileURLToPath(import.meta.url));
const MESH = join(here, "../fixtures/mesh-tools/changed-files/mesh");
const mesh = loadDecisionMesh(MESH);

describe("changed-files-capabilities (bind-point ②)", () => {
  it("activates the governing node + its blocker + escalation when a changed file is under a dir hint", () => {
    const r = activateForChangedFiles(mesh, ["src/api/upload/handler.ts"]);
    expect(r.activatedNodes.map((n) => n.id)).toContain("upload");
    expect(r.blockers).toContain("SEC-UPLOAD-001");
    expect(r.stopConditions).toContain("unbounded_upload");
    expect(r.escalations.some((e) => e.from === "upload" && e.to === "security")).toBe(true);
    expect(r.mustNotAssume).toContain("Do not assume a storage provider.");
    // blocker is ranked before the major rule
    expect(r.rules[0]?.severity).toBe("blocker");
  });

  it("activates on an exact related_files match", () => {
    const r = activateForChangedFiles(mesh, ["src/storage/index.ts"]);
    expect(r.activatedNodes.map((n) => n.id)).toContain("upload");
    expect(r.activatedNodes.find((n) => n.id === "upload")?.matchedFiles).toContain("src/storage/index.ts");
  });

  it("no activation, no blockers, no false positives when nothing matches (no LLM)", () => {
    const r = activateForChangedFiles(mesh, ["README.md", "unrelated/file.txt"]);
    expect(r.activatedNodes).toEqual([]);
    expect(r.blockers).toEqual([]);
    expect(r.rules).toEqual([]);
  });

  it("ignores placeholder/templated hints (never matches a concrete file)", () => {
    // no node hint is a placeholder here, but a concrete path that looks templated must not crash/match
    const r = activateForChangedFiles(mesh, ["docs/projects/<slug>/architecture.md"]);
    expect(r.activatedNodes).toEqual([]);
  });
});
