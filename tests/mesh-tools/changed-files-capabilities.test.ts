import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadDecisionMesh } from "../../src/lib/decision-mesh";
import {
  activateForChangedFiles,
  hintCovers,
  unacknowledgedBlockers
} from "../../src/lib/mesh-tools/changed-files-capabilities";

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

  it("no activation, no blockers when a NON-sensitive unmapped file changes (fail-open is intentional there)", () => {
    const r = activateForChangedFiles(mesh, ["README.md", "unrelated/file.txt"]);
    expect(r.activatedNodes).toEqual([]);
    expect(r.blockers).toEqual([]);
    expect(r.rules).toEqual([]);
    // non-sensitive unmapped files are NOT a fail-closed signal
    expect(r.ungovernedSensitive).toEqual([]);
  });

  it("flags an ungoverned change under a sensitive root as a fail-closed signal", () => {
    const r = activateForChangedFiles(mesh, [
      "src/data/delivery-system/cliWorkerCapture.ts", // vendor exec lane — sensitive, uncovered
      "docs/notes.md" // non-sensitive
    ]);
    expect(r.activatedNodes).toEqual([]); // fixture mesh covers neither
    expect(r.ungovernedSensitive).toContain("src/data/delivery-system/cliWorkerCapture.ts");
    expect(r.ungovernedSensitive).not.toContain("docs/notes.md");
  });

  it("treats newly-added mesh governance SOURCE as a sensitive surface (mesh launder defense)", () => {
    // The fixture mesh covers no mesh source, so an uncovered new node/rule/edge file is a
    // fail-closed signal. In the real mesh these are covered by capability_routing → governed.
    const r = activateForChangedFiles(mesh, ["mesh/nodes/backdoor.yaml", "mesh/rules.yaml", "mesh/edges.yaml"]);
    expect(r.ungovernedSensitive).toContain("mesh/nodes/backdoor.yaml");
    expect(r.ungovernedSensitive).toContain("mesh/rules.yaml");
    expect(r.ungovernedSensitive).toContain("mesh/edges.yaml");
  });

  it("does NOT treat generated mesh ratchet artifacts as sensitive (they are meant to grow)", () => {
    const r = activateForChangedFiles(mesh, [
      "mesh/related-files-baseline.json",
      "mesh/related-files-snapshot.json",
      "mesh/generated/decision-mesh.json"
    ]);
    expect(r.ungovernedSensitive).toEqual([]);
  });

  it("ignores placeholder/templated hints (never matches a concrete file)", () => {
    // no node hint is a placeholder here, but a concrete path that looks templated must not crash/match
    const r = activateForChangedFiles(mesh, ["docs/projects/<slug>/architecture.md"]);
    expect(r.activatedNodes).toEqual([]);
  });
});

describe("hintCovers — trailing-slash normalization (regression)", () => {
  it("a trailing-slash directory hint still covers files inside it", () => {
    // The bug: `model-output-evals/` produced `model-output-evals//` and matched nothing,
    // silently un-governing every file under the dir and disarming its blocker rules.
    expect(hintCovers("model-output-evals/records/run.json", "model-output-evals/")).toBe(true);
    expect(hintCovers("prompt-library/07-x/leaked.md", "prompt-library/")).toBe(true);
    expect(hintCovers("model-output-evals/records/a/b.json", "model-output-evals/records/")).toBe(true);
  });

  it("still behaves for slash-free hints (no regression)", () => {
    expect(hintCovers("src/storage/index.ts", "src/storage/index.ts")).toBe(true); // exact
    expect(hintCovers("src/api/upload/handler.ts", "src/api/upload")).toBe(true); // dir prefix
    expect(hintCovers("src/api", "src/api/upload/handler.ts")).toBe(true); // vice-versa
  });

  it("does NOT over-match a sibling whose name shares a prefix", () => {
    expect(hintCovers("src/apidocs/x.ts", "src/api")).toBe(false);
    expect(hintCovers("model-output-evals-archive/x.json", "model-output-evals/")).toBe(false);
  });

  it("rejects placeholder hints and degenerate slash-only hints", () => {
    expect(hintCovers("docs/projects/x/y.md", "docs/projects/<slug>/architecture.md")).toBe(false);
    expect(hintCovers("anything", "/")).toBe(false);
  });
});
describe("unacknowledgedBlockers", () => {
  it("removes only explicitly acknowledged blocker ids", () => {
    expect(unacknowledgedBlockers(["A", "B"], ["A"])).toEqual(["B"]);
    expect(unacknowledgedBlockers(["A"], ["A"])).toEqual([]);
    expect(unacknowledgedBlockers(["A", "B"], [])).toEqual(["A", "B"]);
  });
});
