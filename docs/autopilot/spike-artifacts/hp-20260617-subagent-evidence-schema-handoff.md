# Agent Handoff Packet

## Handoff ID

hp-20260617-subagent-evidence-schema

## Source Agent

claude-opus-supervisor (Claude Code, subscription-interactive)

## Target Agent

codex-bounded-worker (OpenAI Codex, subscription-interactive)

## Project

autopilot-control-plane

## Mode

WRITE_ALLOWED

## Goal

Implement the TypeScript evidence schema and supervisor-side read/write/tree functions
for the subagent evidence model. After this task:

1. **TypeScript types** for all three evidence files are exported from a new module
   `src/data/delivery-system/subagentEvidence.ts`.

2. **Write functions** (used by supervisor) are exported:
   - `writeCorrelationEntry(record, basePath?)` — appends to `agent-handoff-index.jsonl`
   - `writeSubagentEvidence(record, basePath?)` — appends to `subagent-evidence.jsonl`

3. **Read functions** (used by supervisor for audit/tree queries) are exported:
   - `readAgentRegistry(basePath?)` — reads `agent-registry.jsonl`, returns typed entries
   - `readCorrelationIndex(basePath?)` — reads `agent-handoff-index.jsonl`
   - `readSubagentEvidence(basePath?)` — reads `subagent-evidence.jsonl`

4. **Tree builder** is exported:
   - `buildSubagentTree(supervisorSessionHash, basePath?)` — joins all three files and
     returns a structured tree: supervisor → children with their handoffs and artifacts

5. **Path constants** for the two new files are exported from `sessionState.ts`:
   `AGENT_HANDOFF_INDEX_PATH` and `SUBAGENT_EVIDENCE_PATH`.

6. **`SessionStateManifest`** in `sessionState.ts` gains `supervisorSessionHash?: string | null`
   if not already added by T2. This task must be idempotent with T2 on that field.

**Failing-test-first order:**
Write tests in `tests/delivery-system/subagent-evidence.test.ts` first. Confirm they
fail before writing the implementation.

## Scope

Three files:

1. `src/data/delivery-system/subagentEvidence.ts` — new module (types + functions)
2. `tests/delivery-system/subagent-evidence.test.ts` — new test file
3. `src/data/delivery-system/sessionState.ts` — add 2 path constants + 1 type field

## Allowed Files Or Surfaces

- `src/data/delivery-system/subagentEvidence.ts` (new)
- `tests/delivery-system/subagent-evidence.test.ts` (new)
- `src/data/delivery-system/sessionState.ts`

Reading for orientation (do not edit):

- `docs/autopilot/subagent-evidence-operating-model.md` — full design and schemas
- `src/data/delivery-system/modelOutputEvaluation.ts` — existing pattern for pure
  functions + type exports (follow this style)
- `src/data/delivery-system/toolInventory.ts` — existing pattern for record types

## Forbidden Actions

- Do not edit `worker-output.schema.json`, `reviewer-output.schema.json`, or other
  AJV schema files.
- Do not write to `docs/autopilot/session-state/*.jsonl` directly from TypeScript source
  code (write functions receive a `basePath` param for the state directory; default
  to `SESSION_STATE_DIRECTORY` constant from `sessionState.ts`).
- Do not add any runtime dependencies — use only Node.js `fs` (already used in codebase)
  and TypeScript built-ins.
- Do not add product runtime code, API clients, external HTTP calls.
- Do not store raw prompt text, model completions, credentials, or customer data.
- Do not edit any file outside the allowed list above.
- Do not edit `.codex/hooks/autopilot-hook.mjs` — that is T1 and T2's scope.

## Verified Facts

- `src/data/delivery-system/sessionState.ts` exports `SessionStateManifest` (line 5),
  `SESSION_STATE_PATH`, `SESSION_HISTORY_PATH`, `SESSION_LOCK_PATH` (lines 33–35).
- `src/data/delivery-system/modelOutputEvaluation.ts` — follow its pattern for pure
  function exports (it is a working example of the code style used in this module).
- `HandoffId` is a branded type from `checkCompletionMatrix.ts`:
  `type HandoffId = string & { readonly [__handoffIdBrand]: "HandoffId" }`.
  Use `HandoffId` for `handoff_id` fields in types.
- `AGENT_REGISTRY_PATH` constant — may or may not be in `sessionState.ts` depending on
  whether T2 has been merged. Check with `grep AGENT_REGISTRY_PATH src/data/delivery-system/sessionState.ts`.
  If absent, add it in this task.
- Baseline: 254 tests / 38 files / 4 Playwright.

## Assumptions

- `agent_id` is an opaque string (no branded type needed — unlike `HandoffId`, `agent_id`
  is a Codex runtime concept with no format contract in this codebase).
- `agent-registry.jsonl`, `agent-handoff-index.jsonl`, `subagent-evidence.jsonl` are all
  append-only JSONL. Read functions parse all lines; tree builder joins them in memory.
- `basePath` defaults to `join(process.cwd(), "docs/autopilot/session-state")` for
  production paths. Tests pass a temp directory via `basePath` to avoid touching the
  real state directory.
- Write functions are append-only (no in-place update); they trim file to 200 lines
  using the same policy as the hook ledger.
- The `buildSubagentTree` function is pure given inputs from the three read functions.

## Decisions Already Made

- `writeCorrelationEntry` and `writeSubagentEvidence` use `appendFileSync` (sync,
  consistent with how the hook writes `agent-registry.jsonl`). The supervisor runs
  these functions interactively — sync I/O is acceptable.
- `buildSubagentTree` returns a tree structure keyed by `parent_session_hash`, containing
  an array of children, each with their matched `handoff_id` and evidence record.
- TypeScript `strict: true` — all fields must have explicit types; no implicit `any`.
- Follow the `readonly` pattern from `SessionStateManifest` for all record types.

## Open Questions

None blocking implementation.

## Risks

- **T2 race condition on `supervisorSessionHash` field**: If T2 and T3 both add
  `supervisorSessionHash` to `SessionStateManifest`, one will fail due to duplicate
  field. Check `grep supervisorSessionHash src/data/delivery-system/sessionState.ts`
  before adding. Add only if absent.
- **AGENT_REGISTRY_PATH constant**: similarly, T2 may have added it already. Check
  before adding.
- **Empty registry / missing files**: all read functions must return `[]` (not throw)
  if the file is absent or empty.

## Stop Conditions

Stop immediately and return a blocked output if any of the following occur:

- `npm.cmd run typecheck` or `npm.cmd run verify` exit non-zero after implementation.
- Any edit outside allowed files list.
- A write function would store raw text content from prompts, completions, or logs.
- A type field cannot be typed without `any` — escalate to supervisor instead.

## Required Checks

Run in this exact order:

1. `npm.cmd run typecheck` — must pass before writing new tests.
2. `npm.cmd test -- tests/delivery-system/subagent-evidence.test.ts` — after writing
   tests, before implementation; tests must fail (file-not-found or type error).
3. `npm.cmd test -- tests/delivery-system/subagent-evidence.test.ts` — after
   implementation; all tests pass.
4. `npm.cmd run verify` — 254+ tests pass, 0 failures.

## Expected Output

Worker output JSON at
`docs/autopilot/spike-artifacts/hp-20260617-subagent-evidence-schema-worker.json`
validated against `worker-output.schema.json` (AJV strict: true, exit 0).

### Type definitions to implement

```typescript
// src/data/delivery-system/subagentEvidence.ts

import type { HandoffId } from "./checkCompletionMatrix";

export type AgentRegistryEventType = "subagent_start" | "subagent_stop";

export interface AgentRegistryStartEntry {
  readonly schema_version: "v1";
  readonly event: "subagent_start";
  readonly agent_id: string | null;
  readonly agent_type: string | null;
  readonly parent_session_hash: string | null;
  readonly parent_turn_hash: string;
  readonly started_at: string;
}

export interface AgentRegistryStopEntry {
  readonly schema_version: "v1";
  readonly event: "subagent_stop";
  readonly agent_id: string | null;
  readonly stopped_at: string;
}

export type AgentRegistryEntry = AgentRegistryStartEntry | AgentRegistryStopEntry;

export interface AgentHandoffIndexEntry {
  readonly schema_version: "v1";
  readonly agent_id: string;
  readonly handoff_id: HandoffId;
  readonly correlated_at: string;
  readonly source: "supervisor_assignment" | "worker_echo";
}

export interface SubagentEvidenceArtifacts {
  readonly handoff_packet: string;
  readonly worker_output: string;
  readonly reviewer_output: string | null;
}

export type LockStatus =
  | "acquired"
  | "already_locked"
  | "stale_replaced"
  | "missing_agent_id"
  | "failed";

export interface SubagentEvidenceRecord {
  readonly schema_version: "v1";
  readonly handoff_id: HandoffId;
  readonly agent_id: string;
  readonly agent_type: string | null;
  readonly parent_session_hash: string | null;
  readonly started_at: string;
  readonly stopped_at: string | null;
  readonly duration_seconds: number | null;
  readonly artifacts: SubagentEvidenceArtifacts;
  readonly lock_status: LockStatus;
  readonly verified: boolean;
  readonly recorded_at: string;
}

export interface SubagentTreeChild {
  readonly agent_id: string;
  readonly handoff_id: HandoffId | null;   // null if correlation not yet written
  readonly evidence: SubagentEvidenceRecord | null;
  readonly started_at: string;
  readonly stopped_at: string | null;
}

export interface SubagentTree {
  readonly parent_session_hash: string;
  readonly children: readonly SubagentTreeChild[];
}
```

### Function signatures to implement

```typescript
// All path params default to SESSION_STATE_DIRECTORY from sessionState.ts

export function writeCorrelationEntry(
  entry: Omit<AgentHandoffIndexEntry, "schema_version">,
  stateDir?: string
): void;

export function writeSubagentEvidence(
  record: Omit<SubagentEvidenceRecord, "schema_version">,
  stateDir?: string
): void;

export function readAgentRegistry(stateDir?: string): AgentRegistryEntry[];

export function readCorrelationIndex(stateDir?: string): AgentHandoffIndexEntry[];

export function readSubagentEvidence(stateDir?: string): SubagentEvidenceRecord[];

export function buildSubagentTree(
  parentSessionHash: string,
  stateDir?: string
): SubagentTree;
```

### Tests to add (coverage requirements)

**1 — `writeCorrelationEntry` appends valid JSON to `agent-handoff-index.jsonl`**

Pass a temp `stateDir`. Assert file exists after call. Parse line — all fields present,
`schema_version: "v1"`.

**2 — `writeSubagentEvidence` appends valid JSON to `subagent-evidence.jsonl`**

Pass a temp `stateDir`. Assert file exists. Parse line — all fields present.

**3 — `readAgentRegistry` returns `[]` when file absent**

Assert no throw, returns `[]`.

**4 — `readAgentRegistry` parses start and stop entries**

Write two entries to a temp file. Assert two entries returned with correct types.

**5 — `readCorrelationIndex` returns `[]` when file absent**

Assert no throw, returns `[]`.

**6 — `readSubagentEvidence` returns `[]` when file absent**

Assert no throw, returns `[]`.

**7 — `buildSubagentTree` returns correct tree for known session hash**

Write:
- `agent-registry.jsonl`: one `subagent_start` entry with `parent_session_hash: "abc123"`,
  `agent_id: "agent-001"`, and one `subagent_stop` entry for `agent_id: "agent-001"`.
- `agent-handoff-index.jsonl`: one entry with `agent_id: "agent-001"`, `handoff_id: "hp-20260617-test"`.
- `subagent-evidence.jsonl`: one entry with `handoff_id: "hp-20260617-test"`, `agent_id: "agent-001"`.

Call `buildSubagentTree("abc123", tempDir)`.
Assert: `tree.parent_session_hash === "abc123"`, `tree.children.length === 1`,
`tree.children[0].agent_id === "agent-001"`,
`tree.children[0].handoff_id === "hp-20260617-test"`,
`tree.children[0].evidence` is not null.

**8 — `buildSubagentTree` returns empty children for unknown session hash**

Use same files. Call with `buildSubagentTree("unknown-hash", tempDir)`.
Assert `tree.children.length === 0`.

**9 — `buildSubagentTree` child without correlation has `handoff_id: null`**

Write registry entry without corresponding correlation index entry.
Assert `tree.children[0].handoff_id === null`, `tree.children[0].evidence === null`.

### `sessionState.ts` additions

```typescript
// After existing path constants:
export const AGENT_REGISTRY_PATH = "docs/autopilot/session-state/agent-registry.jsonl";
export const AGENT_HANDOFF_INDEX_PATH = "docs/autopilot/session-state/agent-handoff-index.jsonl";
export const SUBAGENT_EVIDENCE_PATH = "docs/autopilot/session-state/subagent-evidence.jsonl";

// In SessionStateManifest (if not added by T2):
readonly supervisorSessionHash?: string | null;

// In createInitialSessionState() (if not added by T2):
supervisorSessionHash: null,
```

## Reuse Check

- Searched: `subagentEvidence`, `SubagentEvidenceRecord`, `AgentHandoffIndex`,
  `buildSubagentTree`, `AGENT_HANDOFF_INDEX_PATH`, `SUBAGENT_EVIDENCE_PATH`
- Existing matches: none
- Decision: implement_new
- Token saving estimate: none

## Context Budget

- Profile: standard_compact
- Max files: 3 (new `subagentEvidence.ts`, new test file, `sessionState.ts`)
- Max context lines: read `modelOutputEvaluation.ts` in full for style reference;
  read `sessionState.ts` in full; read `subagent-evidence-operating-model.md` §5 for schemas
- Included sections: types, function bodies, test assertions

## Learning Signal

- `deriveLearningSignal` in `modelOutputEvaluation.ts` is a good style reference:
  pure function, typed inputs, no FS side effects in the pure function.
- Write functions (FS side effects) follow the pattern of hook's `record()` / `appendFileSync`.
- Confidence: single_observation (from Wave 4 work)
- Recommended delta: no_change

## Evidence And Source Pointers

- Design: `docs/autopilot/subagent-evidence-operating-model.md` §5.2, §5.3, §7
- Decision: `docs/autopilot/adoption-records/2026-0617-lock-keyed-on-agent-id.md`
- T1 (rekey): `hp-20260617-rekey-lock-to-agent-id-handoff.md`
- T2 (registry): `hp-20260617-agent-registry-handoff.md`
- Style reference: `src/data/delivery-system/modelOutputEvaluation.ts`
- Baseline: 254 tests / 38 files / 4 Playwright

## Progress Impact

T3 completes the supervisor-side evidence model. The supervisor can now:
- Write the `agent_id ↔ handoff_id` correlation entry after reading `worker.lock`
- Write the per-handoff evidence record after SubagentStop
- Reconstruct the parent→child subagent tree for any supervisor session

This closes the full evidence model for 1-level supervisor→worker hierarchies.

## Next Action

After T2 and T3 are both merged:
- Supervisor can run `buildSubagentTree(supervisorSessionHash)` at any point to inspect
  the current session's subagent hierarchy.
- Write adoption record combining T2 + T3 outcomes.
- Update S1 verification plan: the B-test acceptance criteria now requires observing
  an `agent-registry.jsonl` entry with non-null `agent_id` and `parent_session_hash`.
