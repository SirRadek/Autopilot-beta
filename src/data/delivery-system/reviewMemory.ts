import { createHash } from "node:crypto";

export type ReviewMode = "delta" | "release";
export type ReviewCheckStatus = "passed" | "failed" | "not_run";
export type ReviewMemoryDecision =
  | { readonly kind: "selected"; readonly invariant_ids: readonly string[] }
  | { readonly kind: "none"; readonly reason: string }
  | { readonly kind: "release_all" };

export interface ReviewMemoryDocument {
  readonly path: string;
  readonly sha256: string;
  readonly invariant_ids: readonly string[];
}

export interface ReviewTestEvidence {
  readonly check_id: string;
  readonly status: ReviewCheckStatus;
  readonly source_path: string | null;
}

export interface ReviewMemoryPacketInput {
  readonly mode: ReviewMode;
  readonly base_sha: string;
  readonly head_sha: string;
  readonly changed_files: readonly string[];
  readonly documents: readonly ReviewMemoryDocument[];
  readonly memory_decision: ReviewMemoryDecision;
  readonly test_evidence: readonly ReviewTestEvidence[];
}

export interface ReviewMemoryPacket {
  readonly schema_version: "autopilot-review-memory-packet-v1";
  readonly mode: ReviewMode;
  readonly base_sha: string;
  readonly head_sha: string;
  readonly changed_files: readonly string[];
  readonly memory_files: readonly ReviewMemoryDocument[];
  readonly affected_invariant_ids: readonly string[];
  readonly no_memory_reason: string | null;
  readonly test_evidence: readonly ReviewTestEvidence[];
  readonly review_requirements: readonly string[];
  readonly contains_raw_content: false;
}

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const INVARIANT_HEADING_PATTERN =
  /^#{2,3}\s+([A-Z][A-Z0-9]*-[0-9]{2})\s+—\s+/gm;
const CHECK_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const DELTA_REQUIREMENTS = [
  "review_only_declared_delta",
  "use_selected_memory_as_durable_context",
  "do_not_repeat_full_suite_when_evidence_is_complete",
  "new_finding_requires_regression_and_memory_update",
] as const;
const RELEASE_REQUIREMENTS = [
  "review_complete_branch_diff",
  "use_all_discovered_review_memory",
  "verify_release_gate_evidence",
  "new_finding_requires_regression_and_memory_update",
] as const;

function fail(code: string): never {
  throw new Error(code);
}

function unique(values: readonly string[], errorCode: string): readonly string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`${errorCode}:${value}`);
    seen.add(value);
  }
  return values;
}

function normalizeRepositoryPath(value: string): string {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    /[\0\r\n]/.test(value) ||
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value)
  ) {
    fail("invalid_review_path");
  }

  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    fail("invalid_review_path");
  }
  return normalized;
}

function validateSha(value: string, label: "base" | "head"): string {
  if (!SHA_PATTERN.test(value)) fail(`invalid_review_${label}_sha`);
  return value;
}

function validateDocument(document: ReviewMemoryDocument): ReviewMemoryDocument {
  const path = normalizeRepositoryPath(document.path);
  if (!/^[a-f0-9]{64}$/.test(document.sha256)) {
    fail("invalid_review_memory_digest");
  }
  if (document.invariant_ids.length === 0) {
    fail(`review_memory_invariants_missing:${path}`);
  }
  const invariantIds = unique(
    [...document.invariant_ids],
    "duplicate_review_invariant",
  );
  for (const invariantId of invariantIds) {
    if (!/^[A-Z][A-Z0-9]*-[0-9]{2}$/.test(invariantId)) {
      fail(`invalid_review_invariant:${invariantId}`);
    }
  }
  return { path, sha256: document.sha256, invariant_ids: invariantIds };
}

function validateEvidence(
  evidence: ReviewTestEvidence,
): ReviewTestEvidence {
  if (!CHECK_ID_PATTERN.test(evidence.check_id)) {
    fail("invalid_review_check_id");
  }
  if (!["passed", "failed", "not_run"].includes(evidence.status)) {
    fail("invalid_review_check_status");
  }
  return {
    check_id: evidence.check_id,
    status: evidence.status,
    source_path:
      evidence.source_path === null
        ? null
        : normalizeRepositoryPath(evidence.source_path),
  };
}

export function extractReviewMemoryDocument(
  path: string,
  markdown: string,
): ReviewMemoryDocument {
  const invariantIds = Array.from(
    markdown.matchAll(INVARIANT_HEADING_PATTERN),
    (match) => match[1] as string,
  );
  unique(invariantIds, "duplicate_review_invariant");
  if (invariantIds.length === 0) {
    fail(`review_memory_invariants_missing:${normalizeRepositoryPath(path)}`);
  }

  return {
    path: normalizeRepositoryPath(path),
    sha256: createHash("sha256").update(markdown, "utf8").digest("hex"),
    invariant_ids: invariantIds,
  };
}

export function buildReviewMemoryPacket(
  input: ReviewMemoryPacketInput,
): ReviewMemoryPacket {
  const baseSha = validateSha(input.base_sha, "base");
  const headSha = validateSha(input.head_sha, "head");
  if (baseSha === headSha) fail("review_base_equals_head");
  if (!(["delta", "release"] as const).includes(input.mode)) {
    fail("invalid_review_mode");
  }

  const changedFiles = unique(
    input.changed_files.map(normalizeRepositoryPath),
    "duplicate_review_changed_file",
  );
  if (changedFiles.length === 0) fail("review_changed_files_required");

  const documents = input.documents
    .map(validateDocument)
    .sort((left, right) => left.path.localeCompare(right.path));
  unique(
    documents.map((document) => document.path),
    "duplicate_review_memory_path",
  );

  const documentsByInvariant = new Map<string, ReviewMemoryDocument>();
  for (const document of documents) {
    for (const invariantId of document.invariant_ids) {
      if (documentsByInvariant.has(invariantId)) {
        fail(`duplicate_review_invariant:${invariantId}`);
      }
      documentsByInvariant.set(invariantId, document);
    }
  }

  const testEvidence = input.test_evidence.map(validateEvidence);
  unique(
    testEvidence.map((evidence) => evidence.check_id),
    "duplicate_review_check_id",
  );

  let memoryFiles: readonly ReviewMemoryDocument[];
  let affectedInvariantIds: readonly string[];
  let noMemoryReason: string | null = null;

  if (input.mode === "release") {
    if (input.memory_decision.kind !== "release_all") {
      fail("release_review_requires_all_memory");
    }
    if (documents.length === 0) fail("review_memory_documents_required");
    memoryFiles = documents;
    affectedInvariantIds = documents.flatMap(
      (document) => document.invariant_ids,
    );
  } else if (input.memory_decision.kind === "selected") {
    const selected = unique(
      [...input.memory_decision.invariant_ids],
      "duplicate_selected_review_invariant",
    );
    if (selected.length === 0) fail("review_invariant_selection_required");
    for (const invariantId of selected) {
      if (!documentsByInvariant.has(invariantId)) {
        fail(`unknown_review_invariant:${invariantId}`);
      }
    }
    const selectedPaths = new Set(
      selected.map(
        (invariantId) =>
          (documentsByInvariant.get(invariantId) as ReviewMemoryDocument).path,
      ),
    );
    memoryFiles = documents.filter((document) =>
      selectedPaths.has(document.path),
    );
    affectedInvariantIds = selected;
  } else if (input.memory_decision.kind === "none") {
    const reason = input.memory_decision.reason.trim();
    if (reason.length === 0 || reason.length > 240) {
      fail("review_memory_reason_required");
    }
    memoryFiles = [];
    affectedInvariantIds = [];
    noMemoryReason = reason;
  } else {
    fail("delta_review_cannot_select_all_memory");
  }

  return {
    schema_version: "autopilot-review-memory-packet-v1",
    mode: input.mode,
    base_sha: baseSha,
    head_sha: headSha,
    changed_files: changedFiles,
    memory_files: memoryFiles,
    affected_invariant_ids: affectedInvariantIds,
    no_memory_reason: noMemoryReason,
    test_evidence: testEvidence,
    review_requirements:
      input.mode === "delta" ? DELTA_REQUIREMENTS : RELEASE_REQUIREMENTS,
    contains_raw_content: false,
  };
}
