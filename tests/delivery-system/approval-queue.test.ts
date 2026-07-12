import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createApprovalRecord,
  decideApproval,
  readApprovalQueue,
  writeApprovalQueue
  ,requireApprovedApproval
} from "../../src/data/delivery-system/approvalQueue";

describe("approval queue", () => {
  it("bounds previews and keeps approvals pending until decided", () => {
    const record = createApprovalRecord({
      approvalId: "approval-1",
      sessionId: "session-1",
      vendor: "openrouter_api",
      model: "nemotron",
      skillIds: ["model-usage", "model-usage"],
      prompt: "x".repeat(700),
      estimatedTokens: 12.8,
      now: "2026-07-10T16:00:00.000Z"
    });
    expect(record.status).toBe("pending");
    expect(record.prompt_preview).toHaveLength(500);
    expect(record.skill_ids).toEqual(["model-usage"]);
    expect(decideApproval(record, "approved", "2026-07-10T16:01:00.000Z").status).toBe("approved");
  });

  it("persists and rejects a pending approval once", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "approval-queue-"));
    const record = createApprovalRecord({ approvalId: "approval-2", sessionId: "s", vendor: "claude_cli", skillIds: [], prompt: "review", estimatedTokens: 4 });
    writeApprovalQueue(stateDir, { schema_version: "v1", records: [record] });
    const loaded = readApprovalQueue(stateDir);
    const rejected = decideApproval(loaded.records[0]!, "rejected", "2026-07-10T16:02:00.000Z", "budget");
    expect(rejected.rejection_reason).toBe("budget");
    expect(() => decideApproval(rejected, "approved")).toThrow("approval_already_decided");
    expect(() => requireApprovedApproval(loaded, "approval-2")).toThrow("approval_not_approved");
    const approved = decideApproval(record, "approved");
    expect(requireApprovedApproval({ schema_version: "v1", records: [approved] }, "approval-2")).toEqual(approved);
  });
});
