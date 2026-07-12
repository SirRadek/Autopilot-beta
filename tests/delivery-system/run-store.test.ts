import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";

import {
  appendRunArtifact,
  approveRunRevision,
  createRunDraft,
  readRunStore,
  reviseRunDraft,
  transitionRun
} from "../../src/data/delivery-system/runStore";

const stateDirs: string[] = [];
const input = {
  project_id: "autopilot-beta",
  prompt: "Build the governed run",
  provider: "codex_cli" as const,
  model: null,
  estimated_tokens: 1_000,
  requested_artifacts: ["text"] as const
};

function stateDir(): string {
  const path = mkdtempSync(join(tmpdir(), "run-store-"));
  stateDirs.push(path);
  writeProjectRegistry(path, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: "/srv/autopilot-beta", enabled: true }] });
  return path;
}

afterEach(() => {
  for (const path of stateDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("run store", () => {
  it("approves one immutable revision and rejects a superseded revision", () => {
    const dir = stateDir();
    const first = createRunDraft(dir, input, "2026-07-12T10:00:00.000Z");
    const second = reviseRunDraft(dir, first.run_id, first.revision, { ...input, prompt: "revised" }, "2026-07-12T10:01:00.000Z");

    expect(() => approveRunRevision(dir, first.run_id, first.revision, "owner", "2026-07-12T10:02:00.000Z")).toThrow("run_revision_conflict");
    expect(approveRunRevision(dir, second.run_id, second.revision, "owner", "2026-07-12T10:02:00.000Z").status).toBe("approved");
    expect(readRunStore(dir).runs[0]?.revisions).toEqual([first, second]);
  });

  it("returns deep equality when the same operator re-approves a revision", () => {
    const dir = stateDir();
    const draft = createRunDraft(dir, input, "2026-07-12T10:00:00.000Z");
    const approved = approveRunRevision(dir, draft.run_id, draft.revision, "owner", "2026-07-12T10:01:00.000Z");
    expect(approveRunRevision(dir, draft.run_id, draft.revision, "owner", "2026-07-12T11:00:00.000Z")).toEqual(approved);
  });

  it("permits only legal status transitions", () => {
    const dir = stateDir();
    const draft = createRunDraft(dir, input, "2026-07-12T10:00:00.000Z");
    expect(() => transitionRun(dir, draft.run_id, "running", "2026-07-12T10:01:00.000Z")).toThrow("invalid_run_transition");
    approveRunRevision(dir, draft.run_id, draft.revision, "owner", "2026-07-12T10:01:00.000Z");
    transitionRun(dir, draft.run_id, "queued", "2026-07-12T10:02:00.000Z");
    transitionRun(dir, draft.run_id, "running", "2026-07-12T10:03:00.000Z");
    expect(transitionRun(dir, draft.run_id, "completed", "2026-07-12T10:04:00.000Z").status).toBe("completed");
  });

  it("bounds prompts, revisions, and artifact previews", () => {
    const dir = stateDir();
    expect(() => createRunDraft(dir, { ...input, prompt: "x".repeat(32_001) }, "2026-07-12T10:00:00.000Z")).toThrow("invalid_run_draft");
    const draft = createRunDraft(dir, input, "2026-07-12T10:00:00.000Z");
    expect(() => appendRunArtifact(dir, draft.run_id, { artifact_id: "a", type: "text", preview: "x".repeat(32_001) }, "2026-07-12T10:01:00.000Z")).toThrow("invalid_run_artifact");
    let current = draft;
    for (let revision = 2; revision <= 20; revision += 1) current = reviseRunDraft(dir, current.run_id, current.revision, { ...input, prompt: `revision ${revision}` }, `2026-07-12T10:${String(revision).padStart(2, "0")}:00.000Z`);
    expect(() => reviseRunDraft(dir, current.run_id, current.revision, input, "2026-07-12T11:00:00.000Z")).toThrow("run_revision_limit");
  });

  it("persists artifacts across reloads", () => {
    const dir = stateDir();
    const draft = createRunDraft(dir, input, "2026-07-12T10:00:00.000Z");
    const record = appendRunArtifact(dir, draft.run_id, { artifact_id: "answer", type: "text", preview: "done" }, "2026-07-12T10:01:00.000Z");
    expect(readRunStore(dir).runs).toEqual([record]);
  });

  it("caps artifacts per run", () => {
    const dir = stateDir();
    const draft = createRunDraft(dir, input, "2026-07-12T10:00:00.000Z");
    for (let index = 0; index < 32; index += 1) {
      appendRunArtifact(dir, draft.run_id, { artifact_id: `artifact-${index}`, type: "text", preview: "done" }, "2026-07-12T10:01:00.000Z");
    }
    expect(() => appendRunArtifact(dir, draft.run_id, { artifact_id: "overflow", type: "text", preview: "done" }, "2026-07-12T10:02:00.000Z")).toThrow("run_artifact_limit");
  });
});
