import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FigmaMutationStore } from "../../src/data/delivery-system/figmaMutationStore";
import type { MutationProposal } from "../../src/data/delivery-system/figmaMutation";

function proposal(overrides: Partial<MutationProposal> = {}): MutationProposal {
  return {
    schemaVersion: "autopilot.figma-mutation/1",
    source: { provider: "figma", fileKey: "FILEKEY" },
    briefHash: "a".repeat(64),
    expectedVersion: "figma-v1",
    ops: [{ op: "createFrame", args: { name: "RunCard" } }],
    rollbackPlan: { versionCheckpoint: true },
    ...overrides,
  };
}

let dir: string;
let store: FigmaMutationStore;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "figma-mut-")); store = new FigmaMutationStore(dir); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("FigmaMutationStore", () => {
  it("submits a proposal as pending; a worker cannot approve", () => {
    const record = store.submit(proposal());
    expect(record.status).toBe("pending");
    expect(record.lease).toBeUndefined();
    expect(store.list("pending")).toHaveLength(1);
  });

  it("rejects a proposal with an op outside the allowlist", () => {
    expect(() => store.submit(proposal({ ops: [{ op: "executeJS" as never, args: {} }] }))).toThrow(/invalid_mutation_proposal/);
  });

  it("rejects a proposal without a version checkpoint", () => {
    expect(() => store.submit(proposal({ rollbackPlan: { versionCheckpoint: false as never } }))).toThrow(/versionCheckpoint/);
  });

  it("approve issues a one-time lease; claim with it returns ops and is single-use", () => {
    const { id } = store.submit(proposal());
    const { record, lease } = store.approve(id, "owner");
    expect(record.status).toBe("approved");
    expect(lease).toMatch(/^[a-f0-9]{64}$/);
    expect(store.list("pending")).toHaveLength(0);

    const claimed = store.claim("FILEKEY", lease);
    expect(claimed.ops[0]?.op).toBe("createFrame");
    // single-use: a second claim with the same lease fails
    expect(() => store.claim("FILEKEY", lease)).toThrow(/invalid_or_expired_lease/);
  });

  it("rejects a wrong lease, a wrong fileKey, and an expired lease", () => {
    const { id } = store.submit(proposal());
    const { lease } = store.approve(id, "owner", 1_000);
    expect(() => store.claim("FILEKEY", "b".repeat(64))).toThrow(/invalid_or_expired_lease/);
    expect(() => store.claim("OTHER", lease)).toThrow(/invalid_or_expired_lease/);
    // 11 minutes later the lease has expired
    expect(() => store.claim("FILEKEY", lease, 1_000 + 11 * 60 * 1000)).toThrow(/invalid_or_expired_lease/);
  });

  it("records the executor result and reflects success/failure", () => {
    const { id } = store.submit(proposal());
    const { lease } = store.approve(id, "owner");
    store.claim("FILEKEY", lease);
    const done = store.recordResult(id, { node_ids: ["42:7"], digest: "abc" });
    expect(done.status).toBe("executed");
  });

  it("supports owner rejection of a pending proposal", () => {
    const { id } = store.submit(proposal());
    const rejected = store.reject(id, "owner", "not now");
    expect(rejected.status).toBe("rejected");
    expect(rejected.reason).toBe("not now");
  });
});
