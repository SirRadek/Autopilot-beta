import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  estimated_tokens: 20_000,
  requested_artifacts: ["text"] as const
};

function stateDir(): string {
  const path = mkdtempSync(join(tmpdir(), "run-store-"));
  stateDirs.push(path);
  writeProjectRegistry(path, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: "/srv/autopilot-beta", enabled: true }] });
  return path;
}

function tamper(dir: string, mutate: (document: any) => void): void {
  const document = readRunStore(dir);
  mutate(document);
  writeFileSync(join(dir, "runs.json"), JSON.stringify(document));
}

afterEach(() => {
  for (const path of stateDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("run store", () => {
  it("enforces the configured project root for drafts and revisions", () => {
    const dir = stateDir();
    const projectRoot = join(dir, "projects");
    const inside = join(projectRoot, "inside");
    const outside = join(dir, "outside");
    mkdirSync(inside, { recursive: true });
    mkdirSync(outside);
    writeProjectRegistry(dir, { schema_version: "v1", projects: [{
      schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: inside, enabled: true
    }] });
    const draft = createRunDraft(dir, input, "2026-07-12T10:00:00.000Z", { projectRoot });
    writeProjectRegistry(dir, { schema_version: "v1", projects: [{
      schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: outside, enabled: true
    }] });

    expect(() => reviseRunDraft(dir, draft.run_id, draft.revision, input, "2026-07-12T10:01:00.000Z", { projectRoot }))
      .toThrow("project_path_outside_root");
  });

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

  it("keeps approval idempotent after execution progresses", () => {
    const dir = stateDir();
    const draft = createRunDraft(dir, input, "2026-07-12T10:00:00.000Z");
    approveRunRevision(dir, draft.run_id, draft.revision, "owner", "2026-07-12T10:01:00.000Z");
    transitionRun(dir, draft.run_id, "queued", "2026-07-12T10:02:00.000Z");
    const running = transitionRun(dir, draft.run_id, "running", "2026-07-12T10:03:00.000Z");

    expect(approveRunRevision(dir, draft.run_id, draft.revision, "owner", "2026-07-12T11:00:00.000Z")).toEqual(running);
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
    expect(() => createRunDraft(dir, { ...input, prompt: "x".repeat(32_001) }, "2026-07-12T10:00:00.000Z")).toThrow("run_prompt_token_cap_exceeded");
    const draft = createRunDraft(dir, input, "2026-07-12T10:00:00.000Z");
    expect(() => appendRunArtifact(dir, draft.run_id, { artifact_id: "a", type: "text", preview: "x".repeat(32_001) }, "2026-07-12T10:01:00.000Z")).toThrow("invalid_run_artifact");
    let current = draft;
    for (let revision = 2; revision <= 20; revision += 1) current = reviseRunDraft(dir, current.run_id, current.revision, { ...input, prompt: `revision ${revision}` }, `2026-07-12T10:${String(revision).padStart(2, "0")}:00.000Z`);
    expect(() => reviseRunDraft(dir, current.run_id, current.revision, input, "2026-07-12T11:00:00.000Z")).toThrow("run_revision_limit");
  });

  it("keeps prompt review acknowledgement immutable per revision", () => {
    const dir = stateDir();
    const first = createRunDraft(dir, { ...input, prompt: "x".repeat(1_001), estimated_tokens: 20_000, prompt_review_acknowledged: true }, "2026-07-12T10:00:00.000Z");
    reviseRunDraft(dir, first.run_id, 1, { ...input, prompt: "small", prompt_review_acknowledged: false }, "2026-07-12T10:01:00.000Z");
    expect(readRunStore(dir).runs[0]?.revisions.map((revision) => revision.prompt_review_acknowledged)).toEqual([true, false]);
  });

  it("rejects zero and underestimated budgets and persists only the canonical budget", () => {
    const dir = stateDir();
    expect(() => createRunDraft(dir, { ...input, prompt: "nonempty", estimated_tokens: 0 }, "2026-07-12T10:00:00.000Z")).toThrow("run_token_budget_underestimated");
    expect(() => createRunDraft(dir, { ...input, prompt: "nonempty", estimated_tokens: 71 }, "2026-07-12T10:00:00.000Z")).toThrow("run_token_budget_underestimated");
    const draft = createRunDraft(dir, { ...input, prompt: "nonempty", estimated_tokens: 10_000 }, "2026-07-12T10:00:00.000Z");
    expect(draft).toMatchObject({ input_token_bound: 8, output_token_allowance: 8_192, estimated_tokens: 8_200 });
    expect(() => reviseRunDraft(dir, draft.run_id, 1, { ...input, prompt: "revised", estimated_tokens: 70 }, "2026-07-12T10:01:00.000Z")).toThrow("run_token_budget_underestimated");
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

  it("rejects tampered draft identity, revision metadata, and non-identical current values", () => {
    for (const mutate of [
      (document: any) => { document.runs[0].current.run_id = ""; document.runs[0].revisions[0].run_id = ""; },
      (document: any) => { document.runs[0].revisions[0].revision = 0; },
      (document: any) => { document.runs[0].current.prompt = "not-the-revision"; },
      (document: any) => { document.runs[0].current.created_at = "not-a-timestamp"; document.runs[0].revisions[0].created_at = "not-a-timestamp"; }
    ]) {
      const dir = stateDir();
      createRunDraft(dir, input, "2026-07-12T10:00:00.000Z");
      tamper(dir, mutate);
      expect(() => readRunStore(dir)).toThrow("invalid_run_store");
    }
  });

  it("rejects unknown statuses and inconsistent approval state on reload", () => {
    for (const mutate of [
      (document: any) => { document.runs[0].status = "mystery"; },
      (document: any) => { document.runs[0].status = "approved"; },
      (document: any) => { document.runs[0].approved_revision = 1; document.runs[0].approved_by = "owner"; document.runs[0].approved_at = "2026-07-12T10:01:00.000Z"; }
    ]) {
      const dir = stateDir();
      createRunDraft(dir, input, "2026-07-12T10:00:00.000Z");
      tamper(dir, mutate);
      expect(() => readRunStore(dir)).toThrow("invalid_run_store");
    }
  });

  it("bounds every persisted draft and artifact collection field", () => {
    const dir = stateDir();
    expect(() => createRunDraft(dir, { ...input, project_id: "p".repeat(81) }, "2026-07-12T10:00:00.000Z")).toThrow();
    expect(() => createRunDraft(dir, { ...input, model: "m".repeat(257) }, "2026-07-12T10:00:00.000Z")).toThrow("invalid_run_draft");
    expect(() => createRunDraft(dir, { ...input, requested_artifacts: Array(3).fill("text") }, "2026-07-12T10:00:00.000Z")).toThrow("invalid_run_draft");
    const draft = createRunDraft(dir, input, "2026-07-12T10:00:00.000Z");
    expect(() => appendRunArtifact(dir, draft.run_id, { artifact_id: "a".repeat(257), type: "text", preview: "done" }, "2026-07-12T10:01:00.000Z")).toThrow("invalid_run_artifact");
  });

  it("rejects oversized stores before parsing", () => {
    const dir = stateDir();
    writeFileSync(join(dir, "runs.json"), Buffer.alloc(16 * 1024 * 1024 + 1, 0x20));
    expect(() => readRunStore(dir)).toThrow("invalid_run_store");
  });

  it("rejects a write above the read cap without replacing the readable store", () => {
    const dir = stateDir();
    const draft = createRunDraft(dir, input, "2026-07-12T10:00:00.000Z");
    const template: any = readRunStore(dir).runs[0];
    const document: any = { schema_version: "v1", runs: [] };
    for (let runIndex = 0; runIndex < 17; runIndex += 1) {
      const record = structuredClone(template);
      const runId = `${draft.run_id}-${runIndex}`;
      record.current.run_id = runId;
      record.revisions = [structuredClone(record.current)];
      const artifactCount = runIndex === 0 ? 31 : 32;
      record.artifacts = Array.from({ length: artifactCount }, (_, artifactIndex) => ({
        artifact_id: `artifact-${artifactIndex}`,
        type: "text",
        preview: "",
        created_at: "2026-07-12T10:00:00.000Z"
      }));
      document.runs.push(record);
    }
    const cap = 16 * 1024 * 1024;
    let remaining = cap - 1_000 - Buffer.byteLength(`${JSON.stringify(document, null, 2)}\n`);
    for (const record of document.runs) {
      for (const artifact of record.artifacts) {
        const length = Math.min(32_000, remaining);
        artifact.preview = "x".repeat(length);
        remaining -= length;
      }
    }
    expect(remaining).toBe(0);
    writeFileSync(join(dir, "runs.json"), `${JSON.stringify(document, null, 2)}\n`);
    expect(readRunStore(dir).runs).toHaveLength(17);

    expect(() => appendRunArtifact(dir, document.runs[0].current.run_id, {
      artifact_id: "overflow", type: "text", preview: "x".repeat(2_000)
    }, "2026-07-12T10:01:00.000Z")).toThrow("invalid_run_store");
    expect(readRunStore(dir).runs[0]?.artifacts).toHaveLength(31);
  });

  it("allows exactly 256 runs and rejects the next", () => {
    const dir = stateDir();
    for (let index = 0; index < 256; index += 1) createRunDraft(dir, { ...input, prompt: `run ${index}` }, "2026-07-12T10:00:00.000Z");
    expect(readRunStore(dir).runs).toHaveLength(256);
    expect(() => createRunDraft(dir, input, "2026-07-12T10:01:00.000Z")).toThrow("run_limit");
  });
});
