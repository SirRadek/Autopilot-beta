import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  approvePromotion,
  buildPromotionPacket,
  markPromotionPublished,
  markPromotionRolledBack,
  promotionStorePath,
  readPromotionStore,
  recordPromotionVerification,
  rejectPromotion
} from "../../src/data/delivery-system/promotionPacket";
import type { RunRecord } from "../../src/data/delivery-system/runStore";
import { acquireStateMaintenanceLock } from "../../src/data/delivery-system/stateMaintenanceLock";

const NOW = "2026-07-21T11:00:00.000Z";
const completedDevRun = {
  schema_version: "v1", orchestration_ref: null, orchestration_request: null, status: "completed", approved_revision: 2,
  current: { run_id: "run-1", revision: 2, project_id: "p", prompt: "secret Authorization: Bearer abc", provider: "codex_cli", model: null, requested_reasoning_effort: null, profile: "dev", promotion_packet_id: null, estimated_tokens: 0, input_token_bound: 0, output_token_allowance: 0, requested_artifacts: ["text"], prompt_review_acknowledged: true, created_at: "2026-07-21T10:00:00.000Z" },
  revisions: [], approved_by: "owner", approved_at: "2026-07-21T10:00:00.000Z", supervisor_task_id: null, worker_run_id: "w1", terminal_reason: null, token_reservation: null, token_settlement: null, reservation_status: "settled", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0,
  artifacts: [{ artifact_id: "a1", type: "text", preview: "showcase output", created_at: "2026-07-21T10:00:00.000Z" }], updated_at: "2026-07-21T10:00:00.000Z"
} as const satisfies RunRecord;

function createPacket(stateDir: string) {
  return buildPromotionPacket(stateDir, completedDevRun, {
    intent: "Publish showcase",
    diff_summary: "Authorization: Bearer abc + edits",
    tests: ["npm run verify"],
    risks: ["provider cost"]
  }, NOW);
}

describe("promotionPacket", () => {
  it("builds a compact, redacted, immutable-hash packet from a completed dev run", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "promo-"));
    const packet = createPacket(stateDir);

    expect(packet.status).toBe("promotion_pending");
    expect(packet.source_revision).toBe(2);
    expect(packet.approvals).toEqual([]);
    expect((packet as { revisions?: unknown }).revisions).toBeUndefined();
    expect(JSON.stringify(packet)).not.toContain("Bearer abc");
    expect(packet.artifact_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(statSync(promotionStorePath(stateDir)).mode & 0o777).toBe(0o600);
    expect(readdirSync(stateDir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("refuses an empty owner approval", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "promo-"));
    const packet = createPacket(stateDir);

    expect(() => approvePromotion(stateDir, packet.packet_id, {
      approver: "", approved_at: "2026-07-21T11:05:00.000Z", review_ref: ""
    }, "2026-07-21T11:05:00.000Z")).toThrow("promotion_not_approved");
  });

  it("enforces source and input bounds before writing", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "promo-"));
    expect(() => buildPromotionPacket(stateDir, { ...completedDevRun, status: "running" }, {
      intent: "Publish", diff_summary: "d", tests: [], risks: []
    }, NOW)).toThrow("promotion_source_not_completed");
    expect(() => buildPromotionPacket(stateDir, {
      ...completedDevRun, current: { ...completedDevRun.current, profile: "prod", promotion_packet_id: "promo-prior" }
    }, { intent: "Publish", diff_summary: "d", tests: [], risks: [] }, NOW)).toThrow("promotion_source_not_dev");
    expect(() => buildPromotionPacket(stateDir, completedDevRun, {
      intent: "Publish", diff_summary: "d", tests: Array.from({ length: 33 }, () => "test"), risks: []
    }, NOW)).toThrow("invalid_promotion_packet");
    expect(() => buildPromotionPacket(stateDir, completedDevRun, {
      intent: "Publish", diff_summary: "d", tests: [], risks: Array.from({ length: 21 }, () => "risk")
    }, NOW)).toThrow("invalid_promotion_packet");
    expect(() => buildPromotionPacket(stateDir, completedDevRun, {
      intent: "Publish", diff_summary: "d", tests: new Array(1), risks: []
    }, NOW)).toThrow("invalid_promotion_packet");
  });

  it("strictly rejects malformed, oversized, linked, duplicate, and unknown state", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "promo-invalid-"));
    const path = promotionStorePath(stateDir);
    writeFileSync(path, "{");
    expect(() => readPromotionStore(stateDir)).toThrow("invalid_promotion_store");

    writeFileSync(path, "x".repeat(4 * 1024 * 1024 + 1));
    expect(() => readPromotionStore(stateDir)).toThrow("invalid_promotion_store");

    const target = join(stateDir, "target.json");
    writeFileSync(target, '{"schema_version":"v1","packets":[]}');
    writeFileSync(path, "remove");
    // Replace the regular file with a symlink without importing a destructive helper.
    unlinkSync(path);
    symlinkSync(target, path);
    expect(() => readPromotionStore(stateDir)).toThrow("invalid_promotion_store");

    const clean = mkdtempSync(join(tmpdir(), "promo-invalid-shape-"));
    const packet = createPacket(clean);
    const invalidDocuments = [
      { schema_version: "v1", packets: [packet, packet] },
      { schema_version: "v1", packets: [{ ...packet, artifact_hash: "ABC" }] },
      { schema_version: "v1", packets: [{ ...packet, unknown: true }] },
      { schema_version: "v1", packets: [{ ...packet, status: "queued" }] },
      { schema_version: "v1", packets: [{ ...packet, risks: Array.from({ length: 21 }, () => "risk") }] }
    ];
    for (const value of invalidDocuments) {
      writeFileSync(promotionStorePath(clean), JSON.stringify(value));
      expect(() => readPromotionStore(clean)).toThrow("invalid_promotion_store");
    }
  });

  it("requires valid transitions and complete matching publish evidence", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "promo-transitions-"));
    const packet = createPacket(stateDir);
    expect(() => recordPromotionVerification(stateDir, packet.packet_id, "verify:1", NOW)).toThrow("promotion_not_approved");
    expect(() => markPromotionPublished(stateDir, packet.packet_id, {
      prod_run_id: "prod-1", full_verification_ref: "verify:1", release_acceptance_ref: "accept:1", rollback_ref: "rollback:1"
    }, NOW)).toThrow("promotion_not_ready");
    expect(() => markPromotionRolledBack(stateDir, packet.packet_id, NOW)).toThrow("promotion_not_published");

    const approved = approvePromotion(stateDir, packet.packet_id, {
      approver: "owner", approved_at: "2026-07-21T11:05:00.000Z", review_ref: "review:1"
    }, "2026-07-21T11:05:00.000Z");
    expect(approved.status).toBe("approved");
    expect(() => rejectPromotion(stateDir, packet.packet_id, NOW)).toThrow("invalid_promotion_transition");
    expect(() => recordPromotionVerification(stateDir, packet.packet_id, "", NOW)).toThrow("promotion_evidence_required");
    recordPromotionVerification(stateDir, packet.packet_id, "verify:1", "2026-07-21T11:06:00.000Z");
    expect(() => markPromotionPublished(stateDir, packet.packet_id, {
      prod_run_id: "prod-1", full_verification_ref: "verify:other", release_acceptance_ref: "accept:1", rollback_ref: "rollback:1"
    }, NOW)).toThrow("promotion_verification_mismatch");
    expect(() => markPromotionPublished(stateDir, packet.packet_id, {
      prod_run_id: "prod-1", full_verification_ref: "verify:1", release_acceptance_ref: "", rollback_ref: "rollback:1"
    }, NOW)).toThrow("promotion_evidence_required");

    const published = markPromotionPublished(stateDir, packet.packet_id, {
      prod_run_id: "prod-1", full_verification_ref: "verify:1", release_acceptance_ref: "accept:1", rollback_ref: "rollback:1"
    }, "2026-07-21T11:07:00.000Z");
    expect(published.status).toBe("published");
    expect(markPromotionRolledBack(stateDir, packet.packet_id, "2026-07-21T11:08:00.000Z").status).toBe("rolled_back");
  });

  it("supports rejection only while pending", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "promo-reject-"));
    const packet = createPacket(stateDir);
    expect(rejectPromotion(stateDir, packet.packet_id, NOW).status).toBe("rejected");
    expect(() => approvePromotion(stateDir, packet.packet_id, {
      approver: "owner", approved_at: NOW, review_ref: "review:1"
    }, NOW)).toThrow("invalid_promotion_transition");
  });

  it("does not lose concurrent promotion read-modify-write updates", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "promo-concurrent-"));
    const lease = acquireStateMaintenanceLock(stateDir);
    const childCode = [
      "import { buildPromotionPacket } from './src/data/delivery-system/promotionPacket.ts';",
      "const [stateDir, runId] = process.argv.slice(1);",
      `const run=${JSON.stringify(completedDevRun)};`,
      "run.current={...run.current,run_id:runId};",
      "buildPromotionPacket(stateDir,run,{intent:'Publish',diff_summary:'d',tests:[],risks:[]},'2026-07-21T11:00:00.000Z');"
    ].join("\n");
    const children = ["run-first", "run-second"].map((runId) => spawn(process.execPath, [
      "--import", "tsx", "--input-type=module", "--eval", childCode, stateDir, runId
    ], { cwd: process.cwd(), stdio: "ignore" }));

    await new Promise((resolve) => setTimeout(resolve, 750));
    lease.release();
    await Promise.all(children.map((child) => new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`child_exit:${code}`)));
    })));

    expect(readPromotionStore(stateDir).packets.map((packet) => packet.source_run_id).sort())
      .toEqual(["run-first", "run-second"]);
  }, 15_000);
});
