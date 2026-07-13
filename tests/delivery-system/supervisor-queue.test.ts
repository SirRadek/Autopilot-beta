import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SupervisorQueue } from "../../src/data/delivery-system/supervisorQueue";
import type { GovernedHandoff } from "../../src/governed-core/dispatch";

function handoff(id: string): GovernedHandoff {
  return {
    handoffId: id as GovernedHandoff["handoffId"],
    vendor: "codex_cli",
    prompt: `do ${id}`,
    parentSessionHash: "parent",
    parentTurnHash: "turn",
    task: `task ${id}`,
    agent: "worker",
    packet_hash: "packet-hash",
    required_checks: ["tests"]
  };
}

function queue() {
  return new SupervisorQueue({ stateDir: mkdtempSync(join(tmpdir(), "supervisor-")), baseRetryDelayMs: 100, maxRetryDelayMs: 500 });
}

describe("SupervisorQueue", () => {
  it("inspects the exact next claimable task without consuming an attempt", () => {
    const q = queue();
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });
    q.enqueue({ taskId: "b", handoff: handoff("hp-b"), now: "2026-07-12T00:00:00.000Z" });

    expect(q.peekClaimable("2026-07-12T00:00:01.000Z")).toMatchObject({ task_id: "a", status: "queued", attempt: 0 });
    expect(q.snapshot()[0]).toMatchObject({ task_id: "a", status: "queued", attempt: 0 });
    expect(q.claim("2026-07-12T00:00:01.000Z")).toMatchObject({ task_id: "a", status: "running", attempt: 1 });
  });

  it("enqueues and claims deterministically", () => {
    const q = queue();
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });
    const claimed = q.claim("2026-07-12T00:00:01.000Z");
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempt).toBe(1);
    expect(claimed?.handoff_ref.handoff_id).toBe("hp-a");
  });

  it("blocks for approval and releases after approval", () => {
    const q = queue();
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), requiresApproval: true, now: "2026-07-12T00:00:00.000Z" });
    expect(q.claim("2026-07-12T00:00:01.000Z")).toBeNull();
    expect(q.approve("a", "2026-07-12T00:00:02.000Z").status).toBe("queued");
    expect(q.claim("2026-07-12T00:00:03.000Z")?.status).toBe("running");
  });

  it("retries with backoff, then completes or cancels", () => {
    const q = queue();
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), maxAttempts: 3, now: "2026-07-12T00:00:00.000Z" });
    q.claim("2026-07-12T00:00:00.000Z");
    const retry = q.fail("a", "provider unavailable", "2026-07-12T00:00:01.000Z");
    expect(retry.status).toBe("queued");
    expect(retry.last_error).toBe("provider unavailable");
    q.cancel("a", "owner stopped", "2026-07-12T00:00:02.000Z");
    expect(q.snapshot()[0]?.status).toBe("cancelled");
  });

  it("times out and recovers running tasks after restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "supervisor-restart-"));
    const first = new SupervisorQueue({ stateDir: dir, baseRetryDelayMs: 100 });
    first.enqueue({ taskId: "a", handoff: handoff("hp-a"), timeoutMs: 1_000, now: "2026-07-12T00:00:00.000Z" });
    first.claim("2026-07-12T00:00:00.000Z");
    expect(first.recover("2026-07-12T00:00:02.000Z")[0]?.status).toBe("queued");
    const second = new SupervisorQueue({ stateDir: dir, baseRetryDelayMs: 100 });
    expect(second.snapshot()[0]?.status).toBe("queued");
    expect(second.claim("2026-07-12T00:00:02.050Z")).toBeNull();
    second.reconcile("2026-07-12T00:00:04.000Z");
  });

  it("honours dependencies", () => {
    const q = queue();
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });
    q.enqueue({ taskId: "b", handoff: handoff("hp-b"), dependencyIds: ["a"], now: "2026-07-12T00:00:00.000Z" });
    expect(q.claim("2026-07-12T00:00:00.000Z")?.task_id).toBe("a");
    expect(q.claim("2026-07-12T00:00:00.000Z")).toBeNull();
    q.complete("a", "2026-07-12T00:00:01.000Z");
    expect(q.claim("2026-07-12T00:00:02.000Z")?.task_id).toBe("b");
  });

  it("routes a claimed task through the existing dispatcher", async () => {
    const q = queue();
    q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: "2026-07-12T00:00:00.000Z" });
    const result = await q.runOnce("/tmp/state", async (packet) => ({
      ...({ workerRunId: "run", handoffId: packet.handoffId, vendor: packet.vendor, model: null, exitCode: 0, rawOutput: "ok", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn", workerOutputPath: null, errorReason: null } as const),
      refused: false as const,
      tier_id: null,
      provenance_verified: true as const
    }), "2026-07-12T00:00:01.000Z");
    expect(result?.task.status).toBe("completed");
    expect(result?.result.refused).toBe(false);
  });
});
