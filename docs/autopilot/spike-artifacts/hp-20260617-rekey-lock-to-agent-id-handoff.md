# Agent Handoff Packet

## Handoff ID

hp-20260617-rekey-lock-to-agent-id

## Source Agent

claude-opus-supervisor (Claude Code, subscription-interactive)

## Target Agent

codex-bounded-worker (OpenAI Codex, subscription-interactive)

## Project

autopilot-control-plane

## Mode

WRITE_ALLOWED

## Goal

Rekey `worker.lock` from `handoff_id` to the native `agent_id` field in the Codex
SubagentStart payload. After this change:

- `createWorkerLock` reads `agent_id` (or `agentId`) from the hook input to identify
  the lock owner. If `agent_id` is absent, the lock is not created and the hook
  reports `missing_agent_id`.
- `releaseWorkerLock` matches `lock.lockedBy` against `agent_id`.
- `handoff_id` remains an optional audit field: if present in the input as a
  structured JSON field, it is logged alongside `agent_id` in the event ledger. It
  does NOT gate lock creation.
- The `getHandoffId` helper is retained unchanged for any callers that still use it
  for audit logging; it is no longer called by `createWorkerLock` or
  `releaseWorkerLock`.

**Failing-test-first order:** Write or update the tests in `tests/codex-hooks.test.ts`
first. Run `npm.cmd test -- tests/codex-hooks.test.ts` to confirm they fail (because
the implementation still uses `handoff_id`). Then update the implementation.

## Scope

Two files only:

1. `tests/codex-hooks.test.ts` — update four existing lock tests; add two new tests
2. `.codex/hooks/autopilot-hook.mjs` — add `getAgentId`, update `createWorkerLock` and
   `releaseWorkerLock`, update `handleSubagentStart` message for `missing_agent_id`

No other files.

## Allowed Files Or Surfaces

- `tests/codex-hooks.test.ts`
- `.codex/hooks/autopilot-hook.mjs`

Reading the following is allowed for orientation but must not be edited:

- `docs/autopilot/adoption-records/2026-0617-lock-keyed-on-agent-id.md` (decision)
- `docs/autopilot/adoption-records/2026-0617-s1-r1-hook-verification.md` (evidence)

## Forbidden Actions

- Do not edit `worker-output.schema.json`, `reviewer-output.schema.json`, or any other
  schema file.
- Do not edit `docs/autopilot/adoption-record.schema.json`.
- Do not edit the handoff packet template or any other governance document.
- Do not add product runtime code, remote mutation, or multi-provider gateway logic.
- Do not print, log, or store raw prompt text, credentials, or raw `task`/`prompt`
  string content from the hook input.
- Do not delete or rename `getHandoffId` — it may be used by other callers.
- Do not touch any file outside the allowed list above.

## Verified Facts

- `getHandoffId(input)` is at `.codex/hooks/autopilot-hook.mjs:401–411`. It reads
  `input.handoff_id` (snake_case) then `input.handoffId` (camelCase). Unchanged.
- `createWorkerLock(input)` is at lines 586–627. Currently calls `getHandoffId(input)`
  on line 588, returns `"missing_handoff"` if undefined, stores `lockedBy: handoffId`.
- `releaseWorkerLock(input)` is at lines 629–643. Currently calls `getHandoffId(input)`
  on line 631, matches `lock.lockedBy === handoffId`.
- `handleSubagentStart(input)` is at lines 733–751. Calls `record(input)` then
  `createWorkerLock(input)`. Message for `missing_handoff` is on line 746.
- Four existing lock tests in `tests/codex-hooks.test.ts` start at lines 340, 370, 396,
  411. All reference `handoff_id` for lock lifecycle semantics.
- `npm.cmd run verify` baseline: 254 tests / 38 files / 4 Playwright (all pass).

## Assumptions

- The Codex SubagentStart payload delivers `agent_id` as a top-level string field.
  Tests use `agent_id: "agent-test-<suffix>"` to simulate this.
- `agent_id` has no format constraint imposed by this hook (it is treated as an opaque
  string, unlike `handoff_id` which has a `hp-YYYYMMDD-slug` convention for governance
  purposes).
- `handoff_id`, when present as a structured field (not text), may be logged as an
  audit annotation in the ledger alongside `agent_id`. The logging mechanism is
  `record(input)` which already receives the full input object.

## Decisions Already Made

- Design decision: adopt-2026-0617-lock-keyed-on-agent-id (owner-approved).
- `getHandoffId` is NOT removed — it is retained for audit logging and any future use.
- `missing_agent_id` replaces `missing_handoff` as the lock-absent status for the
  handler message string. The return value string from `createWorkerLock` also changes
  from `"missing_handoff"` to `"missing_agent_id"`.

## Open Questions

None blocking implementation.

## Risks

- **Stale existing tests will fail** until the implementation is updated. This is
  intentional (failing-test-first). Do not skip tests; do not use `it.skip`.
- **`lockedBy` in existing `worker.lock` files** will now be an `agent_id` value, not
  a `handoff_id`. Any manual or test fixtures that pre-populate `worker.lock` with a
  `handoff_id` value need to be updated to use an `agent_id`-shaped value.
- **`getHandoffId` is retained** but no longer called from lock functions. A future
  clean-up task may remove it if no other callers remain; do not remove it in this task.

## Stop Conditions

Stop immediately and return a blocked output if any of the following occur:

- `npm.cmd run verify` exit non-zero after implementation (any test suite, not just
  codex-hooks).
- Any edit target outside the allowed files list above.
- Uncertainty about whether a change would affect `worker-output.schema.json`,
  `reviewer-output.schema.json`, or any schema validation path.
- A test requires mocking `fsPromises` in a way that was not already present in the
  test file.

## Required Checks

Run in this exact order:

1. `npm.cmd run typecheck` — must pass (exit 0) before touching implementation.
2. `npm.cmd test -- tests/codex-hooks.test.ts` — run after writing/updating tests,
   **before** touching implementation; confirm updated lock tests fail.
3. `npm.cmd test -- tests/codex-hooks.test.ts` — run after implementation; all tests
   must pass.
4. `npm.cmd run verify` — run last; 254+ tests must pass, 0 failures.

## Expected Output

A worker output JSON at
`docs/autopilot/spike-artifacts/hp-20260617-rekey-lock-to-agent-id-worker.json`
validated against `worker-output.schema.json` (AJV strict: true, exit 0).

### Tests to update (exact locations)

**Line 340 — `"creates and releases worker.lock for matching subagent handoff ids"`**

Rename to: `"creates and releases worker.lock for matching subagent agent ids"`

Change SubagentStart payload: add `agent_id: "agent-test-lock-001"`, remove or
keep `handoff_id` as optional audit field. Change assertion: `lock.lockedBy` must equal
`"agent-test-lock-001"` (the `agent_id` value, not the `handoff_id` value).

Change SubagentStop payload: add `agent_id: "agent-test-lock-001"`.

**Line 370 — `"does not silently acquire worker.lock when another handoff is active"`**

Rename to: `"does not silently acquire worker.lock when another agent holds it"`

Pre-existing lock: change `lockedBy` to an `agent_id`-shaped value
(`"agent-existing-001"`). Second SubagentStart: add `agent_id: "agent-new-001"` to
payload. Assertion: `lock.lockedBy` remains `"agent-existing-001"`.

**Line 396 — `"reports missing handoff ids instead of silently skipping worker.lock"`**

Rename to: `"reports missing agent ids instead of silently skipping worker.lock"`

Remove `handoff_id` from payload if present. Assertion: `additionalContext` contains
`"agent_id is missing"` (not `"handoff_id is missing"`).

**Line 411 — `"replaces stale worker.lock files left by abandoned worker sessions"`**

Update pre-existing stale lock: `lockedBy` to an `agent_id`-shaped value
(`"agent-abandoned-001"`). SubagentStart payload: add `agent_id: "agent-new-stale-001"`.
Assertion: new lock has `lockedBy: "agent-new-stale-001"`.

### New tests to add

**New test A — lock created without `handoff_id`**

SubagentStart payload: only `agent_id: "agent-audit-001"`, no `handoff_id`.
Assert: `worker.lock` created with `lockedBy: "agent-audit-001"`. No error in output.
Confirms: `handoff_id` is not required for lock creation.

**New test B — `handoff_id` present as structured field does not break lock**

SubagentStart payload: `agent_id: "agent-audit-002"`, `handoff_id: "hp-20260617-audit"`.
Assert: `worker.lock` created with `lockedBy: "agent-audit-002"` (agent_id, not
handoff_id). Confirms: `handoff_id` is silently accepted as audit data without
affecting lock semantics.

### Implementation changes

**Add `getAgentId` after `getHandoffId` (around line 411):**

```javascript
function getAgentId(input) {
  if (typeof input.agent_id === "string") {
    return input.agent_id;
  }

  if (typeof input.agentId === "string") {
    return input.agentId;
  }

  return undefined;
}
```

**`createWorkerLock` (line 586):**

- Line 588: `getHandoffId(input)` → `getAgentId(input)`; variable name `handoffId` →
  `agentId`
- Line 589: `if (!handoffId)` → `if (!agentId)`, return `"missing_agent_id"` (was
  `"missing_handoff"`)
- Line 599: `lockedBy: handoffId` → `lockedBy: agentId`
- Line 606: stale replacement recursive call — no change needed (calls `createWorkerLock`
  which will use `getAgentId` after the rename)

**`releaseWorkerLock` (line 629):**

- Line 631: `getHandoffId(input)` → `getAgentId(input)`; variable name `handoffId` →
  `agentId`
- Line 632: `if (!handoffId)` → `if (!agentId)`
- Line 637: `lock?.lockedBy === handoffId` → `lock?.lockedBy === agentId`

**`handleSubagentStart` (line 733):**

- Line 745–746: change `lockStatus === "missing_handoff"` → `lockStatus === "missing_agent_id"`
  and update message: `"worker.lock was not created because agent_id is missing; do not
  claim serial worker enforcement."`

## Reuse Check

- Searched: `getAgentId`, `agent_id.*lock`, `lockedBy.*agent`
- Existing matches: none in `.codex/hooks/autopilot-hook.mjs`
- Decision: implement_new (`getAgentId` function) + extend_existing (lock functions)
- Token saving estimate: low

## Context Budget

- Profile: standard_compact
- Max files: 2 (`.codex/hooks/autopilot-hook.mjs`, `tests/codex-hooks.test.ts`)
- Max context lines: 200 lines around each change site

## Learning Signal

- Based on LOOP-2 finding from `2026-0617-r3-new1-supervisor-loop.md`: prior worker
  edited a test file outside stated `allowed_files`. Test file is explicitly included
  in `allowed_files` for this task to prevent a repeat.
- Recommended delta: no_change (bounded scope already tighter than last task)
- Confidence: single_observation

## Evidence And Source Pointers

- Decision: `docs/autopilot/adoption-records/2026-0617-lock-keyed-on-agent-id.md`
- Prior deferred S1: `docs/autopilot/adoption-records/2026-0617-s1-r1-hook-verification.md`
- Lock implementation: `.codex/hooks/autopilot-hook.mjs:586–643`
- Current lock tests: `tests/codex-hooks.test.ts:340–435`
- Baseline verify: 254 tests / 38 files / 4 Playwright

## Progress Impact

Closes S1 risk (serial worker enforcement not proven live). After this task, the lock
mechanism works with the Codex-native `agent_id` that is always present in the
SubagentStart payload, eliminating the need for structured `handoff_id` propagation
through the Codex CLI invocation path.

## Next Action

Supervisor: after worker output is received, validate against `worker-output.schema.json`,
review diffs for scope, run `npm.cmd run verify`, and write adoption record. Update
`output/s1-hook-verification-plan-for-gpt.md` acceptance criteria if not already done.
