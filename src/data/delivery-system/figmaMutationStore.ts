// Figma mutation store — the governed lifecycle behind the approval queue:
//   submit (worker, proposal only) → approve (owner, issues one-time lease)
//   → claim (plugin executor, single-use lease) → recordResult.
// Workers may only submit; the plugin never receives anything but an approved,
// single-use, short-lived lease. See figma_write_boundary + the write ADR.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

import { validateProposalGovernance, type MutationOp, type MutationProposal } from "./figmaMutation";
import { readManagedStateTextFile } from "./managedStateFile";
import { withStateMaintenanceLock, writeStateFileAtomically } from "./stateMaintenanceLock";

export const FIGMA_MUTATIONS_FILE = "figma-mutations.json";
const LEASE_TTL_MS = 10 * 60 * 1000;
const MAX_BYTES = 4 * 1024 * 1024;

export type MutationStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "verified" | "drift";
export interface MutationLease { readonly digest: string; readonly expires_at: string; readonly used: boolean }
export interface MutationResult { readonly node_ids?: readonly string[]; readonly digest?: string; readonly error?: string; readonly diff?: string }
export interface MutationRecord {
  readonly id: string;
  readonly proposal: MutationProposal;
  readonly status: MutationStatus;
  readonly created_at: string;
  readonly updated_at: string;
  readonly decided_by?: string;
  readonly decided_at?: string;
  readonly reason?: string;
  readonly lease?: MutationLease;
  readonly result?: MutationResult;
}
interface StoreDocument { readonly schema_version: "v1"; readonly records: readonly MutationRecord[] }

function sha256(raw: string): string { return createHash("sha256").update(raw, "utf8").digest("hex"); }
function iso(now: number): string { return new Date(now).toISOString(); }

export class FigmaMutationStore {
  private readonly path: string;
  constructor(private readonly stateDir: string) { this.path = join(stateDir, FIGMA_MUTATIONS_FILE); }

  private read(): StoreDocument {
    const file = readManagedStateTextFile(this.path, { maxBytes: MAX_BYTES });
    if (file.status === "missing") return { schema_version: "v1", records: [] };
    const parsed = JSON.parse(file.text) as StoreDocument;
    if (parsed.schema_version !== "v1" || !Array.isArray(parsed.records)) throw new Error("invalid_figma_mutation_store");
    return parsed;
  }
  private write(records: readonly MutationRecord[]): void {
    writeStateFileAtomically(this.stateDir, this.path, JSON.stringify({ schema_version: "v1", records }));
  }
  private mutate<T>(fn: (records: MutationRecord[]) => { records: MutationRecord[]; result: T }): T {
    return withStateMaintenanceLock(this.stateDir, () => {
      const { records, result } = fn([...this.read().records]);
      this.write(records);
      return result;
    });
  }

  /** Worker path: submit a proposal (pending). Rejects anything outside the typed allowlist. */
  submit(proposal: MutationProposal, now = Date.now()): MutationRecord {
    const issues = validateProposalGovernance(proposal);
    if (issues.length > 0) throw new Error(`invalid_mutation_proposal: ${issues.join("; ")}`);
    return this.mutate((records) => {
      const record: MutationRecord = { id: `fm_${randomBytes(8).toString("hex")}`, proposal, status: "pending", created_at: iso(now), updated_at: iso(now) };
      records.push(record);
      return { records, result: record };
    });
  }

  list(status?: MutationStatus): readonly MutationRecord[] {
    const records = this.read().records;
    return status ? records.filter((record) => record.status === status) : records;
  }
  get(id: string): MutationRecord | undefined { return this.read().records.find((record) => record.id === id); }

  /** Owner path: approve a pending proposal and issue a one-time, short-lived lease (raw returned once). */
  approve(id: string, approver: string, now = Date.now()): { readonly record: MutationRecord; readonly lease: string } {
    const lease = randomBytes(32).toString("hex");
    const record = this.mutate((records) => {
      const index = records.findIndex((candidate) => candidate.id === id);
      const current = index >= 0 ? records[index] : undefined;
      if (!current || current.status !== "pending") throw new Error("mutation_not_pending");
      const updated: MutationRecord = { ...current, status: "approved", decided_by: approver, decided_at: iso(now), updated_at: iso(now), lease: { digest: sha256(lease), expires_at: iso(now + LEASE_TTL_MS), used: false } };
      records[index] = updated;
      return { records, result: updated };
    });
    return { record, lease };
  }

  reject(id: string, approver: string, reason?: string, now = Date.now()): MutationRecord {
    return this.mutate((records) => {
      const index = records.findIndex((candidate) => candidate.id === id);
      const current = index >= 0 ? records[index] : undefined;
      if (!current || current.status !== "pending") throw new Error("mutation_not_pending");
      const updated: MutationRecord = { ...current, status: "rejected", decided_by: approver, decided_at: iso(now), updated_at: iso(now), ...(reason === undefined ? {} : { reason }) };
      records[index] = updated;
      return { records, result: updated };
    });
  }

  /** Plugin executor path: claim an approved batch with a single-use lease bound to fileKey. */
  claim(fileKey: string, leaseRaw: string, now = Date.now()): { readonly record: MutationRecord; readonly ops: readonly MutationOp[] } {
    const suppliedDigest = sha256(leaseRaw);
    return this.mutate((records) => {
      const index = records.findIndex((candidate) => {
        if (candidate.status !== "approved" || candidate.proposal.source.fileKey !== fileKey || candidate.lease === undefined || candidate.lease.used) return false;
        if (Date.parse(candidate.lease.expires_at) <= now) return false;
        const expected = Buffer.from(candidate.lease.digest, "hex");
        const supplied = Buffer.from(suppliedDigest, "hex");
        return expected.length === supplied.length && timingSafeEqual(expected, supplied);
      });
      const current = index >= 0 ? records[index] : undefined;
      if (!current || !current.lease) throw new Error("invalid_or_expired_lease");
      const updated: MutationRecord = { ...current, updated_at: iso(now), lease: { ...current.lease, used: true } };
      records[index] = updated;
      return { records, result: { record: updated, ops: updated.proposal.ops } };
    });
  }

  recordResult(id: string, result: MutationResult, now = Date.now()): MutationRecord {
    return this.mutate((records) => {
      const index = records.findIndex((candidate) => candidate.id === id);
      const current = index >= 0 ? records[index] : undefined;
      if (!current || current.status !== "approved") throw new Error("mutation_not_claimable");
      const updated: MutationRecord = { ...current, status: result.error ? "failed" : "executed", updated_at: iso(now), result };
      records[index] = updated;
      return { records, result: updated };
    });
  }

  /**
   * Anti-drift: an executed mutation is only "done" once an INDEPENDENT re-fetch of the
   * frame (figma-fetch → regenerated brief) confirms the diff is empty. The plugin's
   * success narration is not proof; this verdict is. ok=false → drift.
   */
  verify(id: string, verdict: { readonly ok: boolean; readonly diff?: string }, now = Date.now()): MutationRecord {
    return this.mutate((records) => {
      const index = records.findIndex((candidate) => candidate.id === id);
      const current = index >= 0 ? records[index] : undefined;
      if (!current || current.status !== "executed") throw new Error("mutation_not_executed");
      const updated: MutationRecord = { ...current, status: verdict.ok ? "verified" : "drift", updated_at: iso(now), result: { ...current.result, ...(verdict.diff === undefined ? {} : { diff: verdict.diff }) } };
      records[index] = updated;
      return { records, result: updated };
    });
  }
}
