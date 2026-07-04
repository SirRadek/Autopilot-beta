import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadDecisionMesh } from "../../src/lib/decision-mesh";
import { activateForChangedFiles, resolveAckedBlockers } from "../../src/lib/mesh-tools/changed-files-capabilities";

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

  it("matches a trailing-slash directory hint (BLIND1 regression)", () => {
    // docs_bundle declares `docs-bundle/` WITH a trailing slash; before the
    // normalization fix this matched nothing and its governance was silently skipped.
    const r = activateForChangedFiles(mesh, ["docs-bundle/guide.md"]);
    expect(r.activatedNodes.map((n) => n.id)).toContain("docs_bundle");
    expect(r.stopConditions).toContain("docs_unreviewed");
  });

  it("ignores placeholder/templated hints (never matches a concrete file)", () => {
    // no node hint is a placeholder here, but a concrete path that looks templated must not crash/match
    const r = activateForChangedFiles(mesh, ["docs/projects/<slug>/architecture.md"]);
    expect(r.activatedNodes).toEqual([]);
  });
});

describe("resolveAckedBlockers (Mesh-Ack)", () => {
  const activation = activateForChangedFiles(mesh, ["src/api/upload/handler.ts"]);

  it("without acks every blocker stays unacked (behavior identical to before)", () => {
    const a = resolveAckedBlockers(activation, []);
    expect(a.ackedBlockers).toEqual([]);
    expect(a.unackedBlockers).toContain("SEC-UPLOAD-001");
    expect(a.unknownAcks).toEqual([]);
  });

  it("acking the activated node excuses its blocker rules but keeps them reported upstream", () => {
    const a = resolveAckedBlockers(activation, ["upload"]);
    expect(a.ackedBlockers).toContain("SEC-UPLOAD-001");
    expect(a.unackedBlockers).toEqual([]);
  });

  it("an ack for a non-activated node excuses nothing and is surfaced (fail-closed)", () => {
    const a = resolveAckedBlockers(activation, ["security"]);
    expect(a.unackedBlockers).toContain("SEC-UPLOAD-001");
    expect(a.unknownAcks).toEqual(["security"]);
  });

  it("no activation means no blockers to ack and unknown acks are reported", () => {
    const empty = activateForChangedFiles(mesh, ["README.md"]);
    const a = resolveAckedBlockers(empty, ["upload"]);
    expect(a.ackedBlockers).toEqual([]);
    expect(a.unackedBlockers).toEqual([]);
    expect(a.unknownAcks).toEqual(["upload"]);
  });
});
