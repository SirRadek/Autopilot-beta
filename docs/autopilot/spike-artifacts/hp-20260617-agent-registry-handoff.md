# Agent Handoff Packet

## Handoff ID

hp-20260617-agent-registry

## Source Agent

claude-opus-supervisor (Claude Code, subscription-interactive)

## Target Agent

codex-bounded-worker (OpenAI Codex, subscription-interactive)

## Project

autopilot-control-plane

## Mode

WRITE_ALLOWED

## Goal

Implement hook-side subagent lifecycle tracking. After this task:

1. **At `SessionStart`**: hook reads `input.session_id`, computes `hash(session_id)`,
   and stores it as `supervisorSessionHash` in `session.json`. This creates the parent
   anchor for all subagents spawned in this session.

2. **At `SubagentStart`**: hook writes a structured entry to
   `docs/autopilot/session-state/agent-registry.jsonl`:
   ```json
   {
     "schema_version": "v1",
     "event": "subagent_start",
     "agent_id": "<from input.agent_id or input.agentId>",
     "agent_type": "<from input.agent_type or null>",
     "parent_session_hash": "<from session.json.supervisorSessionHash>",
     "parent_turn_hash": "<hash(input.turn_id)>",
     "started_at": "<ISO timestamp>"
   }
   ```
   If `supervisorSessionHash` is not yet set in session.json (SessionStart hasn't fired
   or session.json doesn't exist), write `"parent_session_hash": null`.

3. **At `SubagentStop`**: hook appends a stop entry:
   ```json
   {
     "schema_version": "v1",
     "event": "subagent_stop",
     "agent_id": "<from input.agent_id or input.agentId>",
     "stopped_at": "<ISO timestamp>"
   }
   ```
   If `agent_id` is absent, append `"agent_id": null` (do NOT skip the entry entirely —
   an unmatched stop is valid evidence).

4. **`agent-registry.jsonl` trimming**: apply the same size/count ceiling policy as
   `events.jsonl` (max 200 entries / 256 KB). Use the existing `trimJsonlIfNeeded`
   function on `AGENT_REGISTRY_PATH`.

5. **`SessionStateManifest` TypeScript type** gains `supervisorSessionHash: string | null`
   as an optional field so T2 tests compile without type errors.

**Failing-test-first order:**
Write or update tests in `tests/codex-hooks.test.ts` first. Confirm they fail (either
compilation error or runtime assertion failure) before touching the implementation.

## Scope

Three files only:

1. `.codex/hooks/autopilot-hook.mjs` — SessionStart + SubagentStart + SubagentStop
   handlers; new `AGENT_REGISTRY_PATH` constant; `getAgentType` helper
2. `tests/codex-hooks.test.ts` — new tests for registry writes
3. `src/data/delivery-system/sessionState.ts` — add `supervisorSessionHash?: string | null`
   to `SessionStateManifest`; add `AGENT_REGISTRY_PATH` export constant

## Allowed Files Or Surfaces

- `.codex/hooks/autopilot-hook.mjs`
- `tests/codex-hooks.test.ts`
- `src/data/delivery-system/sessionState.ts`

Reading for orientation (do not edit):

- `docs/autopilot/subagent-evidence-operating-model.md` — full evidence model design
- `docs/autopilot/adoption-records/2026-0617-lock-keyed-on-agent-id.md` — design decisions
- `docs/autopilot/spike-artifacts/hp-20260617-rekey-lock-to-agent-id-handoff.md` — T1 (dependency)

## Forbidden Actions

- Do not edit `worker-output.schema.json`, `reviewer-output.schema.json`, or any AJV
  schema file.
- Do not store raw prompt text, task description text, or model completion text in
  `agent-registry.jsonl`.
- Do not store credentials, raw tool responses, or transcript content.
- Do not delete or rename `getHandoffId` — it may be used elsewhere.
- Do not change the existing `eventRecord()` function or `events.jsonl` format.
- Do not edit any file outside the allowed list above.
- Do not add dependencies outside the Node.js standard library for the hook.

## Verified Facts

- `handleSessionStart(input)` is at `.codex/hooks/autopilot-hook.mjs:708`. Currently
  calls `record(input)` but does NOT read or store `session_id`.
- `normalizeSessionManifest(value)` is at line 438. Uses spread `{...base, ...value}`.
  It will pass through `supervisorSessionHash` automatically once it's in the base shape.
- `createInitialSessionManifest()` is at line 422. Must add `supervisorSessionHash: null`.
- `handleSubagentStart(input)` is at line 733. Currently calls `record(input)` and
  `createWorkerLock(input)`.
- `handleSubagentStop(input)` is at line 901. Currently calls `record(input)` and
  `releaseWorkerLock(input)`.
- `STATE_DIRECTORY` = `.codex/state/`, `SESSION_STATE_DIRECTORY` = `docs/autopilot/session-state/`.
  `agent-registry.jsonl` should go in `SESSION_STATE_DIRECTORY` (governance evidence,
  alongside `session.json`), NOT in `STATE_DIRECTORY` (hook ledger).
- `trimJsonlIfNeeded(path)` is at line 300 — accepts arbitrary path, ready to reuse.
- `hash(x)` is the existing sha256 helper — use for `parent_session_hash` and
  `parent_turn_hash`.
- `SESSION_STATE_PATH` exported from `sessionState.ts` — add `AGENT_REGISTRY_PATH` here.
- `SessionStateManifest` in `sessionState.ts:5` — add `supervisorSessionHash?: string | null`.
- **T1 dependency**: this task assumes `getAgentId(input)` already exists in
  `autopilot-hook.mjs` (added by T1). If T1 is not yet merged, this task is blocked.

## Assumptions

- `input.session_id` at `SessionStart` is the supervisor's own session identifier.
  Storing its hash provides a stable parent reference for all subagents in this session.
- `input.turn_id` at `SubagentStart` is the supervisor's turn in which the subagent
  was spawned. Stored as `parent_turn_hash`.
- `input.agent_type` may be absent (`undefined`); write `null` in that case.
- `agent-registry.jsonl` entries for SubagentStart and SubagentStop are correlated
  by `agent_id` at read time — no in-place update needed (append-only JSONL).

## Decisions Already Made

- `agent-registry.jsonl` lives in `SESSION_STATE_DIRECTORY`, not `STATE_DIRECTORY`.
  Rationale: it's governance evidence (correlated with handoff_id later), not a raw
  redacted ledger. `STATE_DIRECTORY` files are transient and may be purged between
  sessions.
- `agent_id` stored as-is (NOT hashed) — required for cross-file correlation with
  `agent-handoff-index.jsonl` and `subagent-evidence.jsonl`.
- `parent_session_hash` and `parent_turn_hash` ARE hashed — consistent with how
  `session` and `turn` are handled in `events.jsonl`.
- Registry writes are advisory: any failure must be silently swallowed and must not
  block hook execution. Use the same `try/catch` pattern as `record()`.
- Do NOT add `agent_id` or `agent_type` to `eventRecord()` / `events.jsonl` — keep
  those separate.

## Open Questions

None blocking implementation.

## Risks

- **`supervisorSessionHash` may be null** if SessionStart didn't fire or session.json
  is stale/absent. SubagentStart must handle `null` gracefully (write `null` in the
  registry entry; do not throw).
- **T1 must be merged first.** This task uses `getAgentId(input)` which is added by T1.
  If T1 isn't done, SubagentStart and SubagentStop registry writes have no `agent_id`.
- **`agent-registry.jsonl` and `session.json` are in `SESSION_STATE_DIRECTORY`.** Ensure
  `.gitignore` already covers `*.jsonl` (it does — `docs/autopilot/session-state/.gitignore`
  contains `*.jsonl`).

## Stop Conditions

Stop immediately and return a blocked output if any of the following occur:

- T1 (`getAgentId`) is not yet present in `autopilot-hook.mjs`.
- `npm.cmd run verify` exit non-zero after implementation.
- Any edit outside the allowed files list.
- A registry write would store raw prompt text, task text, or model completion text.

## Required Checks

Run in this exact order:

1. Confirm T1 is merged: `grep -n "function getAgentId" .codex/hooks/autopilot-hook.mjs`
   must return a result.
2. `npm.cmd run typecheck` — must pass before writing tests.
3. `npm.cmd test -- tests/codex-hooks.test.ts` — run after writing tests, before
   touching implementation; new tests must fail.
4. `npm.cmd test -- tests/codex-hooks.test.ts` — after implementation; all tests pass.
5. `npm.cmd run verify` — 254+ tests pass, 0 failures.

## Expected Output

Worker output JSON at
`docs/autopilot/spike-artifacts/hp-20260617-agent-registry-worker.json`
validated against `worker-output.schema.json` (AJV strict: true, exit 0).

### New tests to add (exact descriptions)

**Test 1 — `supervisorSessionHash` stored at SessionStart**

```
runHook({ hook_event_name: "SessionStart", session_id: "session-supervisor-001" }, stateDirectory)
const session = JSON.parse(readSessionStateFile(stateDirectory, "session.json"))
expect(session.supervisorSessionHash).toBeTypeOf("string")
expect(session.supervisorSessionHash).toHaveLength(16)  // first 16 hex chars of sha256
// must NOT be the raw session_id
expect(session.supervisorSessionHash).not.toBe("session-supervisor-001")
```

**Test 2 — SubagentStart writes registry entry with agent_id and parent_session_hash**

```
// First fire SessionStart to set supervisorSessionHash
runHook({ hook_event_name: "SessionStart", session_id: "session-supervisor-001" }, stateDirectory)

runHook({
  hook_event_name: "SubagentStart",
  turn_id: "turn-reg-001",
  agent_id: "agent-reg-001",
  agent_type: "codex"
}, stateDirectory)

const lines = readFileSync(join(stateDirectory, "session-state", "agent-registry.jsonl"), "utf8")
  .split("\n").filter(Boolean).map(l => JSON.parse(l))
const startEntry = lines.find(e => e.event === "subagent_start")
expect(startEntry.agent_id).toBe("agent-reg-001")
expect(startEntry.agent_type).toBe("codex")
expect(startEntry.parent_session_hash).toBeTypeOf("string")
expect(startEntry.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
```

**Test 3 — SubagentStop appends stop entry**

```
// After Test 2's SubagentStart...
runHook({
  hook_event_name: "SubagentStop",
  turn_id: "turn-reg-001",
  agent_id: "agent-reg-001"
}, stateDirectory)

const lines = ...  // read registry
const stopEntry = lines.find(e => e.event === "subagent_stop" && e.agent_id === "agent-reg-001")
expect(stopEntry.stopped_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
```

**Test 4 — SubagentStart without prior SessionStart writes parent_session_hash: null**

```
// No SessionStart fired → no supervisorSessionHash in session.json
runHook({ hook_event_name: "SubagentStart", agent_id: "agent-no-parent", turn_id: "t1" }, stateDirectory)
const entry = ...  // read registry
expect(entry.parent_session_hash).toBeNull()
```

**Test 5 — SubagentStop without agent_id writes agent_id: null (unmatched stop)**

```
runHook({ hook_event_name: "SubagentStop", turn_id: "t-unmatched" }, stateDirectory)
const entry = ...  // read registry subagent_stop entry
expect(entry.agent_id).toBeNull()
expect(entry.stopped_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
```

### Implementation summary

**New constant (after existing `SESSION_LOCK_PATH`):**
```javascript
const AGENT_REGISTRY_PATH = join(SESSION_STATE_DIRECTORY, "agent-registry.jsonl");
```

**`createInitialSessionManifest()` — add field:**
```javascript
supervisorSessionHash: null,   // set at SessionStart; used as parent reference for subagents
```

**`handleSessionStart(input)` — add session hash storage:**
After the existing `record(input)` call:
```javascript
await writeSessionJsonSafe((state) => ({
  ...state,
  supervisorSessionHash: state.supervisorSessionHash ?? hash(input.session_id ?? ""),
  lastUpdatedAt: new Date().toISOString(),
  hookEventCount: countJsonlLines(LEDGER_PATH)
}));
```
Only write if not already set (`??`) so a compaction-reset doesn't overwrite.

**New helper to read `supervisorSessionHash` from session.json:**
```javascript
async function readSupervisorSessionHash() {
  try {
    const raw = await fsPromises.readFile(SESSION_STATE_PATH, "utf8");
    const manifest = normalizeSessionManifest(JSON.parse(raw));
    return manifest.supervisorSessionHash ?? null;
  } catch {
    return null;
  }
}
```

**New helper to append to `agent-registry.jsonl`:**
```javascript
function appendAgentRegistry(entry) {
  try {
    ensureSessionStateDirectory();  // sync version: mkdirSync(SESSION_STATE_DIRECTORY, { recursive: true })
    appendFileSync(AGENT_REGISTRY_PATH, `${JSON.stringify(entry)}\n`, "utf8");
    trimJsonlIfNeeded(AGENT_REGISTRY_PATH);
    return true;
  } catch {
    return false;
  }
}
```

**`handleSubagentStart(input)` — add registry write after existing lock call:**
```javascript
const parentSessionHash = await readSupervisorSessionHash();
appendAgentRegistry({
  schema_version: "v1",
  event: "subagent_start",
  agent_id: getAgentId(input) ?? null,
  agent_type: typeof input.agent_type === "string" ? input.agent_type : null,
  parent_session_hash: parentSessionHash,
  parent_turn_hash: hash(input.turn_id ?? ""),
  started_at: new Date().toISOString()
});
```

**`handleSubagentStop(input)` — add registry write after existing lock release:**
```javascript
appendAgentRegistry({
  schema_version: "v1",
  event: "subagent_stop",
  agent_id: getAgentId(input) ?? null,
  stopped_at: new Date().toISOString()
});
```

**`sessionState.ts` — add field to `SessionStateManifest`:**
```typescript
readonly supervisorSessionHash?: string | null;
```

And add to `AGENT_REGISTRY_PATH` export:
```typescript
export const AGENT_REGISTRY_PATH = "docs/autopilot/session-state/agent-registry.jsonl";
```

And to `createInitialSessionState()`:
```typescript
supervisorSessionHash: null,
```

## Reuse Check

- Searched: `AGENT_REGISTRY_PATH`, `agent-registry`, `appendAgentRegistry`, `supervisorSessionHash`
- Existing matches: none in codebase
- Decision: implement_new
- Token saving estimate: none

## Context Budget

- Profile: standard_compact
- Max files: 3 (`.codex/hooks/autopilot-hook.mjs`, `tests/codex-hooks.test.ts`,
  `src/data/delivery-system/sessionState.ts`)
- Max context lines: 150 lines around each change site
- Read `subagent-evidence-operating-model.md` for schema reference

## Learning Signal

- LOOP-2 from `2026-0617-r3-new1-supervisor-loop.md`: worker edited test file outside
  `allowed_files`. Prevented here by explicitly listing test file in allowed files.
- Confidence: single_observation

## Evidence And Source Pointers

- Design: `docs/autopilot/subagent-evidence-operating-model.md` §5.1, §6
- Decision: `docs/autopilot/adoption-records/2026-0617-lock-keyed-on-agent-id.md`
- T1 (dependency): `.codex/hooks/autopilot-hook.mjs` (after rekey task)
- `handleSessionStart`: line 708
- `handleSubagentStart`: line 733
- `handleSubagentStop`: line 901
- `normalizeSessionManifest`: line 438
- `trimJsonlIfNeeded`: line 300
- `SessionStateManifest`: `src/data/delivery-system/sessionState.ts:5`
- Baseline: 254 tests / 38 files / 4 Playwright

## Progress Impact

T2 closes the hook-side gap: the agent-registry becomes the authoritative source for
`agent_id ↔ parent_session_hash` linkage. Enables supervisor (T3) to reconstruct
parent→child hierarchy without relying on the privacy-filtered `events.jsonl`.

## Next Action

After T2 worker output is received and validated:
- Supervisor validates against schema, reviews diff for raw content (forbidden).
- Runs `npm.cmd run verify`.
- Writes adoption record.
- Triggers T3 (parallel with T2 is fine if T1 is merged).
