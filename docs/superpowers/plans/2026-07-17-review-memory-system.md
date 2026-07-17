# Review Memory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a privacy-safe, Git-bounded review packet generator that reuses durable Markdown invariant memories for focused delta reviews while retaining one complete branch review before release.

**Architecture:** A pure TypeScript core discovers invariant IDs from project-local `docs/superpowers/review-memory/*.md`, validates the implementer's declared memory decision, and builds a bounded packet containing Git identities, changed paths, selected memory references, and deterministic test evidence references. A thin Node 24 CLI resolves base/head commits and changed paths through argument-safe Git subprocesses; it never embeds diff contents, conversations, raw test logs, provider output, or secrets. Existing model routing and reviewer selection remain unchanged and shadow-only seams remain null.

**Tech Stack:** Node.js 24 ESM, TypeScript 6, Vitest 4, Git CLI with argument arrays, Markdown invariant headings, JSON stdout.

## Global Constraints

- Use Node `>=24 <25`; run `npm run runtime:check` before repository JavaScript.
- Preserve unrelated work and generated cockpit deployment state.
- Do not activate or modify provider, model, reasoning, entitlement, or reviewer routing.
- Delta review uses an explicit base and head commit and contains changed paths, never raw diff content.
- A delta packet selects invariant memory only from explicit affected IDs; an explicit bounded reason is required when no memory applies.
- Release review selects every discovered memory document and requires the complete branch diff.
- Test evidence contains stable check IDs, status, and optional repository-relative source paths; never raw logs.
- Missing memory files, duplicate invariant IDs, unknown affected IDs, invalid Git refs, traversal, or malformed evidence fail closed.
- A confirmed new finding is not closed until a regression test and a new or amended durable invariant are recorded.
- Initial WhiteSur adoption reads the existing documents in place; it does not copy their GNOME-specific contents into Autopilot.
- `estimated_token_range`: `lower_bound=45_000`, `upper_bound=90_000`.
- `phase_breakdown`: core and tests `15_000–30_000`; CLI `10_000–20_000`; runbook/adoption `10_000–20_000`; verification/review `10_000–20_000`.
- `assumptions`: one local Git repository per packet, Markdown memories use `### ID — title`, no automatic reviewer dispatch in v1, and one targeted re-review at most.
- `actual_tokens`: `unavailable` until reliable aggregate telemetry closes the work unit.

---

### Task 1: Parse durable memories and build bounded review packets

**Files:**
- Create: `src/data/delivery-system/reviewMemory.ts`
- Create: `tests/delivery-system/review-memory.test.ts`
- Create: `tests/fixtures/review-memory/managed.md`
- Create: `tests/fixtures/review-memory/ui.md`

**Interfaces:**
- Produces: `extractReviewMemoryDocument(path, markdown): ReviewMemoryDocument`.
- Produces: `buildReviewMemoryPacket(input): ReviewMemoryPacket`.
- Consumes later: Task 2 passes resolved Git SHAs, normalized changed paths, discovered memory documents, a memory decision, and test evidence.

- [ ] **Step 1: Create fixture memories**

Create `tests/fixtures/review-memory/managed.md`:

```markdown
# Managed Review Memory

### MM-01 — WAL precedes mutation

Write and validate the pending record before publication.

Regression coverage: `test_wal_precedes_mutation`.

### MM-02 — Rollback restores identity

Restore the complete before identity before clearing recovery state.

Regression coverage: `test_rollback_restores_identity`.
```

Create `tests/fixtures/review-memory/ui.md`:

```markdown
# UI Review Memory

### UI-01 — Readback is authoritative

Render only the confirmed manager readback after mutation.

Regression coverage: `test_readback_is_authoritative`.
```

- [ ] **Step 2: Write RED parser and packet tests**

Create `tests/delivery-system/review-memory.test.ts` with tests that assert:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildReviewMemoryPacket,
  extractReviewMemoryDocument,
} from "../../src/data/delivery-system/reviewMemory";

const managed = extractReviewMemoryDocument(
  "docs/superpowers/review-memory/managed.md",
  readFileSync("tests/fixtures/review-memory/managed.md", "utf8"),
);
const ui = extractReviewMemoryDocument(
  "docs/superpowers/review-memory/ui.md",
  readFileSync("tests/fixtures/review-memory/ui.md", "utf8"),
);
const base = "a".repeat(40);
const head = "b".repeat(40);

describe("review memory", () => {
  it("extracts ordered unique invariant IDs and a content digest", () => {
    expect(managed.invariant_ids).toEqual(["MM-01", "MM-02"]);
    expect(managed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds a delta packet with only explicitly selected memory", () => {
    const packet = buildReviewMemoryPacket({
      mode: "delta",
      base_sha: base,
      head_sha: head,
      changed_files: ["src/state.ts", "tests/state.test.ts"],
      documents: [managed, ui],
      memory_decision: { kind: "selected", invariant_ids: ["MM-02"] },
      test_evidence: [{ check_id: "focused-state", status: "passed", source_path: "tests/state.test.ts" }],
    });

    expect(packet.memory_files.map((item) => item.path)).toEqual([
      "docs/superpowers/review-memory/managed.md",
    ]);
    expect(packet.affected_invariant_ids).toEqual(["MM-02"]);
    expect(packet.contains_raw_content).toBe(false);
    expect(JSON.stringify(packet)).not.toContain("Write and validate");
  });

  it("requires a bounded reason when no memory applies", () => {
    expect(() => buildReviewMemoryPacket({
      mode: "delta",
      base_sha: base,
      head_sha: head,
      changed_files: ["README.md"],
      documents: [managed, ui],
      memory_decision: { kind: "none", reason: "" },
      test_evidence: [],
    })).toThrow("review_memory_reason_required");
  });

  it("fails closed on unknown or duplicate invariant IDs", () => {
    expect(() => buildReviewMemoryPacket({
      mode: "delta",
      base_sha: base,
      head_sha: head,
      changed_files: ["src/state.ts"],
      documents: [managed, ui],
      memory_decision: { kind: "selected", invariant_ids: ["MM-99"] },
      test_evidence: [],
    })).toThrow("unknown_review_invariant:MM-99");

    expect(() => extractReviewMemoryDocument("duplicate.md", [
      "### MM-01 — One", "", "### MM-01 — Two",
    ].join("\n"))).toThrow("duplicate_review_invariant:MM-01");
  });

  it("selects every document for a release packet", () => {
    const packet = buildReviewMemoryPacket({
      mode: "release",
      base_sha: base,
      head_sha: head,
      changed_files: ["src/state.ts", "src/ui.ts"],
      documents: [managed, ui],
      memory_decision: { kind: "release_all" },
      test_evidence: [{ check_id: "full-suite", status: "passed", source_path: null }],
    });
    expect(packet.memory_files).toHaveLength(2);
    expect(packet.review_requirements).toContain("review_complete_branch_diff");
  });
});
```

- [ ] **Step 3: Run RED**

Run:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run runtime:check
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/delivery-system/review-memory.test.ts
```

Expected: FAIL because `reviewMemory.ts` does not exist.

- [ ] **Step 4: Implement the pure contracts**

Create `src/data/delivery-system/reviewMemory.ts` with these exported contracts and behaviors:

```ts
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
```

Use `/^###\s+([A-Z][A-Z0-9]*-[0-9]{2})\s+—\s+/gm` for invariant headings. Normalize all repository paths to forward-slash relative paths and reject absolute paths, `.`/`..` segments, NUL, CR, or LF. Validate full 40-character lowercase hexadecimal SHAs, require distinct base/head, unique changed paths, unique document paths, globally unique invariant IDs, non-empty bounded check IDs, and known selected IDs. For `release`, require `release_all`; for `delta`, reject `release_all`. A selected delta returns only documents containing selected IDs. A no-memory delta requires a trimmed reason of 1–240 characters. Hash each complete Markdown document with SHA-256 but never return its content.

Set delta requirements to:

```ts
[
  "review_only_declared_delta",
  "use_selected_memory_as_durable_context",
  "do_not_repeat_full_suite_when_evidence_is_complete",
  "new_finding_requires_regression_and_memory_update",
]
```

Set release requirements to:

```ts
[
  "review_complete_branch_diff",
  "use_all_discovered_review_memory",
  "verify_release_gate_evidence",
  "new_finding_requires_regression_and_memory_update",
]
```

- [ ] **Step 5: Run GREEN and typecheck**

Run the Task 1 test command and:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run typecheck
```

Expected: all review-memory tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/data/delivery-system/reviewMemory.ts tests/delivery-system/review-memory.test.ts tests/fixtures/review-memory
git commit -m "feat: add durable review memory packets"
```

---

### Task 2: Add an argument-safe Git packet CLI

**Files:**
- Create: `scripts/review-memory-packet.ts`
- Create: `tests/scripts/review-memory-packet.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `extractReviewMemoryDocument` and `buildReviewMemoryPacket` from Task 1.
- Produces: `npm run --silent review:packet -- --root <project> --base <ref> --head <ref> --mode delta|release ...`.
- Produces: one JSON packet on stdout and diagnostics on stderr; exits nonzero without partial JSON on invalid input.

- [ ] **Step 1: Write RED CLI tests**

Create `tests/scripts/review-memory-packet.test.ts`. Build a temporary Git repository with `spawnSync("git", [...])`, configure a local test identity, commit a base and head, and write two memory Markdown files. Assert:

```ts
const delta = runCli([
  "--root", root,
  "--base", baseSha,
  "--head", headSha,
  "--mode", "delta",
  "--affected", "MM-01",
  "--check", "focused-state:passed:tests/state.test.ts",
]);
expect(delta.status).toBe(0);
expect(JSON.parse(delta.stdout)).toMatchObject({
  schema_version: "autopilot-review-memory-packet-v1",
  mode: "delta",
  affected_invariant_ids: ["MM-01"],
  contains_raw_content: false,
});
```

Also assert release mode selects both documents; `--no-memory-reason` is mutually exclusive with `--affected`; unknown refs, unknown IDs, missing memory directory, symlinked memory files, traversal evidence paths, and Git command failure exit nonzero; packet JSON excludes changed file contents and commit messages.

- [ ] **Step 2: Run RED**

Run:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/scripts/review-memory-packet.test.ts
```

Expected: FAIL because the CLI and package script do not exist.

- [ ] **Step 3: Implement the CLI**

Create `scripts/review-memory-packet.ts` with exported `runReviewMemoryPacketCli(argv, io)` for tests and a direct-execution wrapper. Requirements:

- Parse only `--root`, `--base`, `--head`, `--mode`, repeatable `--affected`, one `--no-memory-reason`, and repeatable `--check`.
- Resolve the root with `realpathSync`; require a directory and a `.git` file or directory.
- Discover regular, non-symlink `*.md` files directly under `docs/superpowers/review-memory`; sort by filename.
- Invoke Git only as `spawnSync("git", ["-C", root, ...args], { encoding: "utf8" })` with no shell.
- Resolve commits using `rev-parse --verify <ref>^{commit}` and obtain changed paths using `diff --name-only --diff-filter=ACMR <base>..<head> --`.
- Parse `--check` as `<check-id>:<passed|failed|not_run>:<relative-path-or-empty>`; reject extra fields and malformed values.
- In delta mode require exactly one of affected IDs or a no-memory reason. In release mode reject both and use `release_all`.
- Write `JSON.stringify(packet, null, 2) + "\n"` only after every validation succeeds.
- Catch errors, write one stable `review_memory_packet_error:<code>` line to stderr, and return exit code 1.

Add to `package.json`:

```json
"review:packet": "tsx scripts/review-memory-packet.ts"
```

- [ ] **Step 4: Run GREEN**

Run the Task 2 test command, Task 1 tests, and `npm run typecheck` under the required Node 24 PATH.

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/review-memory-packet.ts tests/scripts/review-memory-packet.test.ts package.json
git commit -m "feat: generate bounded review memory packets"
```

---

### Task 3: Document the protocol and adopt it in repository guidance

**Files:**
- Create: `docs/operations/review-memory-runbook.md`
- Create: `tests/scripts/review-memory-documentation.test.ts`
- Modify: `AGENTS.md`
- Modify: `mesh/related-files-snapshot.json`

**Interfaces:**
- Consumes: the CLI from Task 2.
- Produces: operator instructions for delta review, no-memory review, release review, and finding closure.
- Preserves: existing one-review/one-rereview budget and full high-risk verification quality.

- [ ] **Step 1: Write RED documentation tests**

Create `tests/scripts/review-memory-documentation.test.ts` that reads `AGENTS.md` and the runbook and requires these exact terms in both where applicable:

```ts
for (const required of [
  "review memory",
  "affected invariant IDs",
  "focused delta",
  "complete branch review",
  "regression test",
  "new or amended invariant",
]) expect(`${guidance}\n${runbook}`).toContain(required);

expect(runbook).toContain("contains_raw_content");
expect(runbook).toContain("does not activate routing");
expect(runbook).toContain("--no-memory-reason");
```

- [ ] **Step 2: Run RED**

Run the documentation test under Node 24.

Expected: FAIL because the runbook and guidance do not yet contain the contract.

- [ ] **Step 3: Write the runbook and compact guidance**

Document this lifecycle in `docs/operations/review-memory-runbook.md`:

1. Implementer records base/head, affected invariant IDs or a bounded no-memory reason, and stable focused check evidence.
2. Delta CLI selects only memory documents containing affected IDs and emits no raw diff, logs, prompts, responses, or secrets.
3. Reviewer reads the emitted packet, selected memory documents, declared design/plan, and the local Git delta; complete test suites are not repeated when deterministic evidence is complete.
4. A targeted re-review uses the last reviewed head as its base and includes only fixed files plus the selected surrounding invariants.
5. A confirmed new finding requires a failing regression test and a new or amended invariant before closure.
6. Release review uses `--mode release`, every memory document, and the complete branch diff.
7. The packet does not activate routing or change model/reasoning selection.

Add a compact `## Review memory` section to `AGENTS.md` with the same authority boundaries and commands pointing to the runbook rather than duplicating its rationale.

- [ ] **Step 4: Run GREEN and refresh mesh snapshot**

Run:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/scripts/review-memory-documentation.test.ts
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run mesh:snapshot:regen
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run mesh:gate:ci
git diff --check
```

Expected: documentation test PASS, zero stale/unsnapshotted mesh entries, and no whitespace errors.

- [ ] **Step 5: Commit Task 3 with required Mesh-Ack trailers**

Review the activated mesh nodes and commit only after adding exact `Mesh-Ack` trailers for every blocker-governed node whose guidance was inspected. The commit subject is:

```text
docs: establish review memory protocol
```

---

### Task 4: Prove the protocol against the existing WhiteSur memories

**Files:**
- Read only: `/home/radek/whitesur-desktop-profile/.worktrees/implement-profile/docs/superpowers/review-memory/managed-mutation-invariants.md`
- Read only: `/home/radek/whitesur-desktop-profile/.worktrees/implement-profile/docs/superpowers/review-memory/ui-control-invariants.md`
- No WhiteSur repository files are modified in this task.

**Interfaces:**
- Consumes: `review:packet` CLI and the existing WhiteSur Git history.
- Produces: privacy-safe delta and release packet evidence in `/tmp`; packet contents are not committed.

- [ ] **Step 1: Generate a focused WhiteSur UI delta packet**

Run:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH \
  npm run --silent review:packet -- \
  --root /home/radek/whitesur-desktop-profile/.worktrees/implement-profile \
  --base 8716f14 \
  --head 13ff889 \
  --mode delta \
  --affected UI-03 \
  --affected UI-04 \
  --check ui-models:passed:control-center/tests/ui/test_window_models.py \
  --check search-index:passed:control-center/tests/unit/test_search_index.py \
  > /tmp/whitesur-review-memory-delta.json
```

Assert with `jq` that only `ui-control-invariants.md` is selected, `contains_raw_content` is false, base/head are full SHAs, changed paths are bounded to the actual Git delta, and no source contents or commit messages occur.

- [ ] **Step 2: Generate a WhiteSur release packet**

Run:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH \
  npm run --silent review:packet -- \
  --root /home/radek/whitesur-desktop-profile/.worktrees/implement-profile \
  --base 9b94f66 \
  --head ee0afcb \
  --mode release \
  --check full-suite:passed:control-center/tests/ui/test_window_models.py \
  > /tmp/whitesur-review-memory-release.json
```

Assert both memory documents are selected and `review_complete_branch_diff` is required.

- [ ] **Step 3: Run the complete Autopilot verification**

Run:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run verify
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run cockpit:test
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run cockpit:build
git diff --check
```

Expected: every gate exits 0. Do not claim token savings from this one pilot; efficiency remains `insufficient_evidence` until the approved 20 ordinary and 5 high-risk sample minimum is met.

- [ ] **Step 4: Request one independent fixed-diff review**

The reviewer receives this plan, the branch base/head, the bounded diff, focused RED/GREEN evidence, both generated WhiteSur packet summaries, and the WhiteSur review memories. Permit one targeted re-review only for actionable findings.

- [ ] **Step 5: Record actual token evidence and commit final fixes**

Record `actual_tokens` only when reliable aggregate telemetry is available; otherwise record `unavailable`. Commit any reviewed fixes with a narrow subject and no packet files from `/tmp`.

### Post-review hardening amendment

The independent fixed-diff review supersedes the earlier low-level CLI details
with these stricter requirements:

- read memory documents from regular blobs in the resolved `head` Git tree,
  never from the mutable worktree;
- parse all changed paths, including deletions, with `git diff --name-only -z`
  and fail closed on path encodings or control characters the packet schema
  cannot represent safely;
- require at least one passed `self_reported` evidence record for selected delta
  and release packets, and verify each non-null source path is a regular file in
  the declared head tree;
- accept only the privacy-safe no-memory reason codes `docs_only`,
  `non_behavioral_metadata`, and `memory_not_applicable`; and
- accept invariant headings at `##` or `###`, retaining inherited WhiteSur
  compatibility.

---

## Plan self-review

- Spec coverage: durable Markdown memory, explicit affected IDs, bounded delta, no-memory path, release full review, finding-to-regression closure, privacy, WhiteSur pilot, Node 24, and routing non-activation each map to a task.
- Placeholder scan: every implementation and validation step is concrete and executable.
- Type consistency: Task 2 consumes exactly the Task 1 exports and emits the `ReviewMemoryPacket` used by Tasks 3–4.
- Scope boundary: automatic reviewer dispatch, provider/model scoring, cockpit visualization, and learned routing are intentionally excluded from v1 and remain later Studio Lab work.
