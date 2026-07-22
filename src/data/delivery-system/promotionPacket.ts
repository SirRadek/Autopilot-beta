import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

import type { RunRecord } from "./runStore";
import { readManagedStateTextFile } from "./managedStateFile";
import { redactTelemetryText } from "./telemetryRedaction";
import { withStateMaintenanceLock, writeStateFileAtomically } from "./stateMaintenanceLock";

export type PromotionStatus = "promotion_pending" | "approved" | "rejected" | "published" | "rolled_back";

export interface PromotionApproval {
  readonly approver: string;
  readonly approved_at: string;
  readonly review_ref: string;
}

export interface PromotionPublishEvidence {
  readonly prod_run_id: string;
  readonly full_verification_ref: string;
  readonly release_acceptance_ref: string;
  readonly rollback_ref: string;
}

export interface PromotionPacket {
  readonly schema_version: "v1";
  readonly packet_id: string;
  readonly source_run_id: string;
  readonly source_revision: number;
  readonly intent: string;
  readonly artifact_hash: string;
  readonly artifact_ref: string;
  readonly diff_summary: string;
  readonly tests: readonly string[];
  readonly risks: readonly string[];
  readonly approvals: readonly PromotionApproval[];
  readonly prod_run_id: string | null;
  readonly full_verification_ref: string | null;
  readonly release_acceptance_ref: string | null;
  readonly rollback_ref: string | null;
  readonly status: PromotionStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PromotionStoreDocument {
  readonly schema_version: "v1";
  readonly packets: readonly PromotionPacket[];
}

const FILE = "promotions.json";
const MAX_STORE_BYTES = 4 * 1024 * 1024;
const MAX_PACKETS = 256;
const MAX_INTENT = 2_000;
const MAX_DIFF = 32_000;
const MAX_TESTS = 32;
const MAX_RISKS = 20;
const MAX_LIST_ITEM = 512;
const MAX_APPROVALS = 8;
const MAX_ID = 256;
const MAX_REF = 2_000;
const STATUSES = new Set<PromotionStatus>(["promotion_pending", "approved", "rejected", "published", "rolled_back"]);
const PACKET_KEYS = [
  "schema_version", "packet_id", "source_run_id", "source_revision", "intent", "artifact_hash", "artifact_ref",
  "diff_summary", "tests", "risks", "approvals", "prod_run_id", "full_verification_ref", "release_acceptance_ref",
  "rollback_ref", "status", "created_at", "updated_at"
] as const;

export function promotionStorePath(stateDir: string): string {
  return join(stateDir, FILE);
}

export function readPromotionStore(stateDir: string): PromotionStoreDocument {
  let managed;
  try {
    managed = readManagedStateTextFile(promotionStorePath(stateDir), { maxBytes: MAX_STORE_BYTES });
  } catch {
    throw new Error("invalid_promotion_store");
  }
  if (managed.status === "missing") return { schema_version: "v1", packets: [] };
  let value: unknown;
  try {
    value = JSON.parse(managed.text);
  } catch {
    throw new Error("invalid_promotion_store");
  }
  return parsePromotionStore(value);
}

export function buildPromotionPacket(
  stateDir: string,
  run: RunRecord,
  input: { readonly intent: string; readonly diff_summary: string; readonly tests: readonly string[]; readonly risks: readonly string[] },
  now: string
): PromotionPacket {
  if (run.status !== "completed") throw new Error("promotion_source_not_completed");
  if ((run.current as { readonly profile?: string }).profile !== "dev") throw new Error("promotion_source_not_dev");
  if (!boundedString(run.current.run_id, MAX_ID) || !Number.isSafeInteger(run.current.revision) || run.current.revision < 1 ||
    !validTimestamp(now) || !Array.isArray(run.artifacts)) throw new Error("invalid_promotion_packet");
  const intent = boundedRedactedText(input.intent, MAX_INTENT);
  const diffSummary = boundedRedactedText(input.diff_summary, MAX_DIFF);
  const tests = boundedRedactedList(input.tests, MAX_TESTS);
  const risks = boundedRedactedList(input.risks, MAX_RISKS);

  return withStateMaintenanceLock(stateDir, () => {
    const store = readPromotionStore(stateDir);
    if (store.packets.length >= MAX_PACKETS) throw new Error("promotion_limit");
    const packet: PromotionPacket = {
      schema_version: "v1",
      packet_id: `promo-${run.current.run_id}-${run.current.revision}-${randomUUID().slice(0, 8)}`,
      source_run_id: run.current.run_id,
      source_revision: run.current.revision,
      intent,
      artifact_hash: artifactHash(run),
      artifact_ref: `run:${run.current.run_id}@${run.current.revision}`,
      diff_summary: diffSummary,
      tests,
      risks,
      approvals: [],
      prod_run_id: null,
      full_verification_ref: null,
      release_acceptance_ref: null,
      rollback_ref: null,
      status: "promotion_pending",
      created_at: now,
      updated_at: now
    };
    writePromotionStore(stateDir, { schema_version: "v1", packets: [...store.packets, packet] });
    return packet;
  });
}

export function approvePromotion(
  stateDir: string,
  packetId: string,
  approval: PromotionApproval,
  now: string
): PromotionPacket {
  if (!isRecord(approval) || !boundedString(approval.approver, MAX_ID) || !boundedString(approval.review_ref, MAX_REF) ||
    !validTimestamp(approval.approved_at) || !validTimestamp(now)) throw new Error("promotion_not_approved");
  const normalized: PromotionApproval = {
    approver: boundedRedactedText(approval.approver, MAX_ID),
    approved_at: approval.approved_at,
    review_ref: boundedRedactedText(approval.review_ref, MAX_REF)
  };
  return transition(stateDir, packetId, (packet) => {
    if (packet.status !== "promotion_pending") throw new Error("invalid_promotion_transition");
    return { ...packet, approvals: [normalized], status: "approved", updated_at: now };
  });
}

export function rejectPromotion(stateDir: string, packetId: string, now: string): PromotionPacket {
  requireTimestamp(now);
  return transition(stateDir, packetId, (packet) => {
    if (packet.status !== "promotion_pending") throw new Error("invalid_promotion_transition");
    return { ...packet, status: "rejected", updated_at: now };
  });
}

export function recordPromotionVerification(
  stateDir: string,
  packetId: string,
  fullVerificationRef: string,
  now: string
): PromotionPacket {
  if (!boundedString(fullVerificationRef, MAX_REF)) throw new Error("promotion_evidence_required");
  requireTimestamp(now);
  const normalized = boundedRedactedText(fullVerificationRef, MAX_REF);
  return transition(stateDir, packetId, (packet) => {
    if (packet.status !== "approved" || packet.approvals.length === 0) throw new Error("promotion_not_approved");
    if (packet.full_verification_ref !== null && packet.full_verification_ref !== normalized) {
      throw new Error("promotion_verification_mismatch");
    }
    return { ...packet, full_verification_ref: normalized, updated_at: now };
  });
}

export function markPromotionPublished(
  stateDir: string,
  packetId: string,
  evidence: PromotionPublishEvidence,
  now: string
): PromotionPacket {
  if (!isRecord(evidence) || ![evidence.prod_run_id, evidence.full_verification_ref, evidence.release_acceptance_ref, evidence.rollback_ref]
    .every((value) => boundedString(value, MAX_REF)) || !validTimestamp(now)) throw new Error("promotion_evidence_required");
  const normalized: PromotionPublishEvidence = {
    prod_run_id: boundedRedactedText(evidence.prod_run_id, MAX_ID),
    full_verification_ref: boundedRedactedText(evidence.full_verification_ref, MAX_REF),
    release_acceptance_ref: boundedRedactedText(evidence.release_acceptance_ref, MAX_REF),
    rollback_ref: boundedRedactedText(evidence.rollback_ref, MAX_REF)
  };
  return transition(stateDir, packetId, (packet) => {
    if (packet.status !== "approved" || packet.approvals.length === 0 || packet.full_verification_ref === null) {
      throw new Error("promotion_not_ready");
    }
    if (packet.full_verification_ref !== normalized.full_verification_ref) throw new Error("promotion_verification_mismatch");
    return { ...packet, ...normalized, status: "published", updated_at: now };
  });
}

export function markPromotionRolledBack(stateDir: string, packetId: string, now: string): PromotionPacket {
  requireTimestamp(now);
  return transition(stateDir, packetId, (packet) => {
    if (packet.status !== "published") throw new Error("promotion_not_published");
    return { ...packet, status: "rolled_back", updated_at: now };
  });
}

function transition(stateDir: string, packetId: string, update: (packet: PromotionPacket) => PromotionPacket): PromotionPacket {
  if (!boundedString(packetId, MAX_ID)) throw new Error("promotion_not_found");
  return withStateMaintenanceLock(stateDir, () => {
    const store = readPromotionStore(stateDir);
    const index = store.packets.findIndex((packet) => packet.packet_id === packetId);
    if (index < 0) throw new Error("promotion_not_found");
    const next = update(store.packets[index]!);
    const packets = [...store.packets];
    packets[index] = next;
    writePromotionStore(stateDir, { schema_version: "v1", packets });
    return next;
  });
}

function artifactHash(run: RunRecord): string {
  const material = JSON.stringify({
    run: run.current.run_id,
    rev: run.current.revision,
    artifacts: run.artifacts.map((artifact) => ({ id: artifact.artifact_id, type: artifact.type, preview: artifact.preview }))
  });
  return createHash("sha256").update(material).digest("hex");
}

function writePromotionStore(stateDir: string, document: PromotionStoreDocument): void {
  const validated = parsePromotionStore(document);
  const serialized = `${JSON.stringify(validated, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) throw new Error("invalid_promotion_store");
  writeStateFileAtomically(stateDir, promotionStorePath(stateDir), serialized);
}

function parsePromotionStore(value: unknown): PromotionStoreDocument {
  if (!isExactRecord(value, ["schema_version", "packets"]) || value.schema_version !== "v1" ||
    !Array.isArray(value.packets) || value.packets.length > MAX_PACKETS) throw new Error("invalid_promotion_store");
  const packetIds = new Set<string>();
  for (const packet of value.packets) {
    if (!isPromotionPacket(packet) || packetIds.has(packet.packet_id)) throw new Error("invalid_promotion_store");
    packetIds.add(packet.packet_id);
  }
  return value as unknown as PromotionStoreDocument;
}

function isPromotionPacket(value: unknown): value is PromotionPacket {
  if (!isExactRecord(value, PACKET_KEYS) || value.schema_version !== "v1" ||
    !boundedString(value.packet_id, MAX_ID) || !boundedString(value.source_run_id, MAX_ID) ||
    !Number.isSafeInteger(value.source_revision) || Number(value.source_revision) < 1 ||
    !safeStoredString(value.intent, MAX_INTENT) || typeof value.artifact_hash !== "string" || !/^[a-f0-9]{64}$/.test(value.artifact_hash) ||
    !safeStoredString(value.artifact_ref, MAX_REF) || !safeStoredString(value.diff_summary, MAX_DIFF) ||
    !safeStoredList(value.tests, MAX_TESTS) || !safeStoredList(value.risks, MAX_RISKS) ||
    !isDenseArray(value.approvals) || value.approvals.length > MAX_APPROVALS || !value.approvals.every(isApproval) ||
    !nullableSafeStoredString(value.prod_run_id, MAX_ID) || !nullableSafeStoredString(value.full_verification_ref, MAX_REF) ||
    !nullableSafeStoredString(value.release_acceptance_ref, MAX_REF) || !nullableSafeStoredString(value.rollback_ref, MAX_REF) ||
    !STATUSES.has(value.status as PromotionStatus) || !validTimestamp(value.created_at) || !validTimestamp(value.updated_at)) return false;

  const noEvidence = value.prod_run_id === null && value.full_verification_ref === null &&
    value.release_acceptance_ref === null && value.rollback_ref === null;
  if (value.status === "promotion_pending" || value.status === "rejected") return value.approvals.length === 0 && noEvidence;
  if (value.status === "approved") {
    return value.approvals.length > 0 && value.prod_run_id === null && value.release_acceptance_ref === null && value.rollback_ref === null;
  }
  return value.approvals.length > 0 && value.prod_run_id !== null && value.full_verification_ref !== null &&
    value.release_acceptance_ref !== null && value.rollback_ref !== null;
}

function isApproval(value: unknown): value is PromotionApproval {
  return isExactRecord(value, ["approver", "approved_at", "review_ref"]) && safeStoredString(value.approver, MAX_ID) &&
    validTimestamp(value.approved_at) && safeStoredString(value.review_ref, MAX_REF);
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function safeStoredString(value: unknown, maximum: number): value is string {
  return boundedString(value, maximum) && redactTelemetryText(value, maximum) === value;
}

function nullableSafeStoredString(value: unknown, maximum: number): value is string | null {
  return value === null || safeStoredString(value, maximum);
}

function safeStoredList(value: unknown, maximumItems: number): value is string[] {
  return isDenseArray(value) && value.length <= maximumItems && value.every((item) => safeStoredString(item, MAX_LIST_ITEM));
}

function boundedRedactedText(value: unknown, maximum: number): string {
  if (!boundedString(value, Math.max(maximum, typeof value === "string" ? value.length : maximum))) {
    throw new Error("invalid_promotion_packet");
  }
  const redacted = redactTelemetryText(value, maximum);
  if (!boundedString(redacted, maximum)) throw new Error("invalid_promotion_packet");
  return redacted;
}

function boundedRedactedList(value: unknown, maximumItems: number): string[] {
  if (!isDenseArray(value) || value.length > maximumItems) throw new Error("invalid_promotion_packet");
  return value.map((item) => boundedRedactedText(item, MAX_LIST_ITEM));
}

function isDenseArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.keys(value).length === value.length;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function requireTimestamp(value: string): void {
  if (!validTimestamp(value)) throw new Error("invalid_promotion_packet");
}
