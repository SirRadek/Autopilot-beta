import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";
import { approveRunRevision, createRunDraft, readRunStore, resolveRunProfile, reviseRunDraft, resolveLegacyRequestedReasoning, resolveLegacyPromotionPacketId, requestRunCancellation } from "../../src/data/delivery-system/runStore";

const fixtureProjectRoot = mkdtempSync(join(tmpdir(), "run-store-profile-projects-"));
const fixtureProjectCwd = join(fixtureProjectRoot, "autopilot-beta");
mkdirSync(fixtureProjectCwd);
const fixtureRegistryOptions = { projectRoot: fixtureProjectRoot };

const baseInput = { project_id: "autopilot-beta", prompt: "Inspect status", provider: "codex_cli", model: null, estimated_tokens: 20_000, requested_artifacts: ["text"] } as const;

function stateDir(): string {
  const path = mkdtempSync(join(tmpdir(), "runstore-"));
  writeProjectRegistry(path, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: fixtureProjectCwd, enabled: true }] });
  return path;
}

describe("runStore profile", () => {
  it("stamps the requested profile on new drafts", () => {
    const dir = stateDir();
    const draft = createRunDraft(dir, { ...baseInput, profile: "dev", requested_reasoning_effort: "medium" }, "2026-07-21T10:00:00.000Z", fixtureRegistryOptions);
    expect(draft.profile).toBe("dev");
    expect(draft.requested_reasoning_effort).toBe("medium");
    expect(draft.promotion_packet_id).toBeNull();
  });

  it("resolves a stored record with no profile field as legacy", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "runstore-"));
    const legacyDraft = { run_id: "r1", revision: 1, project_id: "p", prompt: "x", provider: "codex_cli", model: null, estimated_tokens: 8_193, input_token_bound: 1, output_token_allowance: 8_192, requested_artifacts: ["text"], prompt_review_acknowledged: true, created_at: "2026-01-01T00:00:00.000Z" };
    writeFileSync(join(stateDir, "runs.json"), JSON.stringify({ schema_version: "v1", runs: [{ schema_version: "v1", current: legacyDraft, revisions: [legacyDraft], status: "completed", approved_revision: 1, approved_by: "owner", approved_at: "2026-01-01T00:00:00.000Z", supervisor_task_id: null, worker_run_id: null, terminal_reason: null, token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: "2026-01-01T00:00:00.000Z" }] }));
    const record = readRunStore(stateDir).runs[0];
    if (record === undefined) throw new Error("expected legacy record");
    expect(resolveRunProfile(record)).toBe("legacy");
  });

  it("rejects a PROD draft without a promotion ref", () => {
    const dir = stateDir();
    expect(() => createRunDraft(dir, { ...baseInput, profile: "prod", requested_reasoning_effort: null }, "2026-07-21T10:00:00.000Z", fixtureRegistryOptions))
      .toThrow("invalid_run_draft");
  });

  it("accepts a PROD draft with a bounded promotion ref", () => {
    const dir = stateDir();
    const draft = createRunDraft(dir, { ...baseInput, profile: "prod", requested_reasoning_effort: null, promotion_packet_id: "packet-1" }, "2026-07-21T10:00:00.000Z", fixtureRegistryOptions);
    expect(draft.promotion_packet_id).toBe("packet-1");
  });

  it("rejects a DEV draft carrying a non-null promotion ref", () => {
    const dir = stateDir();
    expect(() => createRunDraft(dir, { ...baseInput, profile: "dev", requested_reasoning_effort: null, promotion_packet_id: "packet-1" }, "2026-07-21T10:00:00.000Z", fixtureRegistryOptions))
      .toThrow("invalid_run_draft");
  });

  it("rejects an unsupported provider/reasoning-effort combination", () => {
    const dir = stateDir();
    expect(() => createRunDraft(dir, { ...baseInput, provider: "openrouter_api", profile: "dev", requested_reasoning_effort: "high" }, "2026-07-21T10:00:00.000Z", fixtureRegistryOptions))
      .toThrow("invalid_run_draft");
    expect(() => createRunDraft(dir, { ...baseInput, provider: "agy_cli", profile: "dev", requested_reasoning_effort: "xhigh" }, "2026-07-21T10:00:00.000Z", fixtureRegistryOptions))
      .toThrow("invalid_run_draft");
    const accepted = createRunDraft(dir, { ...baseInput, provider: "openrouter_api", profile: "dev", requested_reasoning_effort: null }, "2026-07-21T10:00:00.000Z", fixtureRegistryOptions);
    expect(accepted.requested_reasoning_effort).toBeNull();
  });

  it("keeps every route field immutable after approval", () => {
    const dir = stateDir();
    const draft = createRunDraft(dir, { ...baseInput, profile: "dev", requested_reasoning_effort: "medium" }, "2026-07-21T10:00:00.000Z", fixtureRegistryOptions);
    approveRunRevision(dir, draft.run_id, draft.revision, "owner", "2026-07-21T10:01:00.000Z");
    expect(() => reviseRunDraft(dir, draft.run_id, draft.revision, { ...baseInput, profile: "prod", requested_reasoning_effort: "medium", promotion_packet_id: "packet-1" }, "2026-07-21T10:02:00.000Z", fixtureRegistryOptions))
      .toThrow("run_revision_conflict");
    expect(() => reviseRunDraft(dir, draft.run_id, draft.revision, { ...baseInput, provider: "claude_cli", profile: "dev", requested_reasoning_effort: "medium" }, "2026-07-21T10:02:00.000Z", fixtureRegistryOptions))
      .toThrow("run_revision_conflict");
    expect(() => reviseRunDraft(dir, draft.run_id, draft.revision, { ...baseInput, model: "model-b", profile: "dev", requested_reasoning_effort: "medium" }, "2026-07-21T10:02:00.000Z", fixtureRegistryOptions))
      .toThrow("run_revision_conflict");
    expect(() => reviseRunDraft(dir, draft.run_id, draft.revision, { ...baseInput, profile: "dev", requested_reasoning_effort: "high" }, "2026-07-21T10:02:00.000Z", fixtureRegistryOptions))
      .toThrow("run_revision_conflict");
  });

  it("resolves legacy reasoning and promotion id to null without disk writes", () => {
    const legacyStoreDir = mkdtempSync(join(tmpdir(), "runstore-legacy-"));
    const legacyDraft = { run_id: "r1", revision: 1, project_id: "p", prompt: "x", provider: "codex_cli", model: null, estimated_tokens: 8_193, input_token_bound: 1, output_token_allowance: 8_192, requested_artifacts: ["text"], prompt_review_acknowledged: true, created_at: "2026-01-01T00:00:00.000Z" };
    const storePath = join(legacyStoreDir, "runs.json");
    writeFileSync(storePath, JSON.stringify({ schema_version: "v1", runs: [{ schema_version: "v1", current: legacyDraft, revisions: [legacyDraft], status: "completed", approved_revision: 1, approved_by: "owner", approved_at: "2026-01-01T00:00:00.000Z", supervisor_task_id: null, worker_run_id: null, terminal_reason: null, token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: "2026-01-01T00:00:00.000Z" }] }));
    const bytesBefore = readFileSync(storePath, "utf8");
    const record = readRunStore(legacyStoreDir).runs[0];
    if (record === undefined) throw new Error("expected legacy record");
    expect(resolveLegacyRequestedReasoning(record)).toBeNull();
    expect(resolveLegacyPromotionPacketId(record)).toBeNull();
    const bytesAfter = readFileSync(storePath, "utf8");
    expect(bytesAfter).toBe(bytesBefore);
  });

  it("rejects mutations of legacy records with legacy_run_read_only", () => {
    const legacyStoreDir = mkdtempSync(join(tmpdir(), "runstore-legacy-mutation-"));
    const legacyDraft = { run_id: "r1", revision: 1, project_id: "p", prompt: "x", provider: "codex_cli", model: null, estimated_tokens: 8_193, input_token_bound: 1, output_token_allowance: 8_192, requested_artifacts: ["text"], prompt_review_acknowledged: true, created_at: "2026-01-01T00:00:00.000Z" };
    writeFileSync(join(legacyStoreDir, "runs.json"), JSON.stringify({ schema_version: "v1", runs: [{ schema_version: "v1", current: legacyDraft, revisions: [legacyDraft], status: "draft", approved_revision: null, approved_by: null, approved_at: null, supervisor_task_id: null, worker_run_id: null, terminal_reason: null, token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: "2026-01-01T00:00:00.000Z" }] }));
    expect(() => requestRunCancellation(legacyStoreDir, "r1", "2026-01-02T00:00:00.000Z")).toThrow("legacy_run_read_only");
  });

  it("accepts separate route-field comparisons in draft equivalence", () => {
    const dir = stateDir();
    const input1 = { project_id: "autopilot-beta", prompt: "Inspect status", provider: "codex_cli" as const, model: null, estimated_tokens: 20_000, requested_artifacts: ["text"] as const, profile: "dev" as const, requested_reasoning_effort: "medium" as const };
    const draft1 = createRunDraft(dir, input1, "2026-07-21T10:00:00.000Z", fixtureRegistryOptions);
    approveRunRevision(dir, draft1.run_id, draft1.revision, "owner", "2026-07-21T10:01:00.000Z");
    const input2 = { project_id: "autopilot-beta", prompt: "Inspect status", provider: "codex_cli" as const, model: "upgraded-model", estimated_tokens: 20_000, requested_artifacts: ["text"] as const, profile: "dev" as const, requested_reasoning_effort: "medium" as const };
    expect(() => reviseRunDraft(dir, draft1.run_id, draft1.revision, input2, "2026-07-21T10:02:00.000Z", fixtureRegistryOptions))
      .toThrow("run_revision_conflict");
  });

  it("rejects a corrupt on-disk record with agy_cli provider and xhigh reasoning effort", () => {
    const legacyStoreDir = mkdtempSync(join(tmpdir(), "runstore-corrupt-agy-"));
    const draft = { run_id: "r1", revision: 1, project_id: "p", prompt: "x", provider: "agy_cli", model: null, estimated_tokens: 8_193, input_token_bound: 1, output_token_allowance: 8_192, requested_artifacts: ["text"], prompt_review_acknowledged: true, created_at: "2026-01-01T00:00:00.000Z", profile: "dev", requested_reasoning_effort: "xhigh", promotion_packet_id: null };
    writeFileSync(join(legacyStoreDir, "runs.json"), JSON.stringify({ schema_version: "v1", runs: [{ schema_version: "v1", current: draft, revisions: [draft], status: "completed", approved_revision: 1, approved_by: "owner", approved_at: "2026-01-01T00:00:00.000Z", supervisor_task_id: null, worker_run_id: null, terminal_reason: null, token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: "2026-01-01T00:00:00.000Z" }] }));
    expect(() => readRunStore(legacyStoreDir)).toThrow("invalid_run_store");
  });

  it("rejects a corrupt on-disk record with openrouter_api provider and high reasoning effort", () => {
    const legacyStoreDir = mkdtempSync(join(tmpdir(), "runstore-corrupt-openrouter-"));
    const draft = { run_id: "r1", revision: 1, project_id: "p", prompt: "x", provider: "openrouter_api", model: null, estimated_tokens: 8_193, input_token_bound: 1, output_token_allowance: 8_192, requested_artifacts: ["text"], prompt_review_acknowledged: true, created_at: "2026-01-01T00:00:00.000Z", profile: "dev", requested_reasoning_effort: "high", promotion_packet_id: null };
    writeFileSync(join(legacyStoreDir, "runs.json"), JSON.stringify({ schema_version: "v1", runs: [{ schema_version: "v1", current: draft, revisions: [draft], status: "completed", approved_revision: 1, approved_by: "owner", approved_at: "2026-01-01T00:00:00.000Z", supervisor_task_id: null, worker_run_id: null, terminal_reason: null, token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: "2026-01-01T00:00:00.000Z" }] }));
    expect(() => readRunStore(legacyStoreDir)).toThrow("invalid_run_store");
  });

  it("rejects reviseRunDraft on a legacy record with legacy_run_read_only", () => {
    const legacyStoreDir = mkdtempSync(join(tmpdir(), "runstore-legacy-revise-"));
    const legacyDraft = { run_id: "r1", revision: 1, project_id: "autopilot-beta", prompt: "x", provider: "codex_cli", model: null, estimated_tokens: 8_193, input_token_bound: 1, output_token_allowance: 8_192, requested_artifacts: ["text"], prompt_review_acknowledged: true, created_at: "2026-01-01T00:00:00.000Z" };
    writeFileSync(join(legacyStoreDir, "runs.json"), JSON.stringify({ schema_version: "v1", runs: [{ schema_version: "v1", current: legacyDraft, revisions: [legacyDraft], status: "draft", approved_revision: null, approved_by: null, approved_at: null, supervisor_task_id: null, worker_run_id: null, terminal_reason: null, token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: "2026-01-01T00:00:00.000Z" }] }));
    writeProjectRegistry(legacyStoreDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: fixtureProjectCwd, enabled: true }] });
    expect(() => reviseRunDraft(legacyStoreDir, "r1", 1, { ...baseInput, profile: "dev", requested_reasoning_effort: null }, "2026-01-02T00:00:00.000Z", fixtureRegistryOptions))
      .toThrow("legacy_run_read_only");
  });

  it("rejects mismatched reasoning effort for provider constraints", () => {
    const dir = stateDir();
    expect(() => createRunDraft(dir, { project_id: "autopilot-beta", prompt: "Inspect status", provider: "openrouter_api" as const, model: null, estimated_tokens: 20_000, requested_artifacts: ["text"], profile: "dev" as const, requested_reasoning_effort: "low" }, "2026-07-21T10:00:00.000Z", fixtureRegistryOptions))
      .toThrow("invalid_run_draft");
    expect(() => createRunDraft(dir, { project_id: "autopilot-beta", prompt: "Inspect status", provider: "agy_cli" as const, model: null, estimated_tokens: 20_000, requested_artifacts: ["text"], profile: "dev" as const, requested_reasoning_effort: "xhigh" }, "2026-07-21T10:00:00.000Z", fixtureRegistryOptions))
      .toThrow("invalid_run_draft");
  });
});
