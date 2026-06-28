# Subagent Evidence Operating Model

Date: 2026-06-17  
Status: design-approved — pending implementation (tasks T2, T3)  
Owner: Autopilot Control Plane

---

## 1. Purpose

Track every bounded subagent invocation — its runtime identity, governance identity,
timing, artifact pointers, and parent→child linkage — so that the supervisor can:

1. Verify that each worker output belongs to the correct handoff (audit correlation).
2. Reconstruct the subagent tree: who spawned whom, when, and with what outcome.
3. Enforce serial execution: only one worker holds `worker.lock` at a time.
4. Satisfy governance requirements without storing raw prompts, responses, credentials,
   or project runtime data.

---

## 2. Identity Model

Two orthogonal identities exist for every subagent invocation:

| Identity | Field | Source | Purpose |
|---|---|---|---|
| **`agent_id`** | `input.agent_id` / `input.agentId` | Codex runtime — always present | Lock key; runtime deduplication |
| **`handoff_id`** | structured or in-text (governance construct) | Supervisor — governance construct | Audit trail; artifact correlation |

Rule (owner-approved 2026-06-17): **lock runs on `agent_id`; audit runs on `handoff_id`.**

`handoff_id` is NOT a native Codex SubagentStart field and must not be assumed present
in the hook payload. The supervisor always knows it (having written the handoff packet);
the hook may not. The worker receives it in the task text and MUST echo it in its
structured output; the supervisor verifies the echo.

---

## 3. SubagentStart / SubagentStop Payload — Confirmed Fields

Source: `codex-hooks-operating-model.md` (Runner Findings 2026-06-17) and
`eventRecord()` in `.codex/hooks/autopilot-hook.mjs`.

**Confirmed present in SubagentStart payload:**

| Field | How confirmed | Notes |
|---|---|---|
| `hook_event_name` | Code (`input.hook_event_name`) | `"SubagentStart"` |
| `session_id` | Code (`hash(input.session_id)` in eventRecord) | Used as supervisor session proxy (see §4) |
| `turn_id` | Code (`hash(input.turn_id)` in eventRecord) | Turn when subagent was spawned |
| `agent_id` | Operating model docs | Native Codex runtime identifier |
| `agent_type` | Operating model docs | Subagent type (e.g. `"codex"`) |
| `permission_mode` | Operating model docs | E.g. `"default"` |
| `cwd` | Code (`classifyScope(input.cwd)`) | Working directory |
| `model` | Test default injected by runHook | May be absent in some runtimes |

**NOT present as native field:**

- `handoff_id` — not documented; confirmed absent in live runs
- `parent_agent_id` — no native parent identifier in payload
- `parent_session_id` — no explicit parent reference

SubagentStop carries the same fields; the hook uses `agent_id` to match the lock.

---

## 4. Parent Linkage — Design and Limitations

### Mechanism (approved approach)

The Codex SubagentStart payload contains no explicit `parent_agent_id`. Parent linkage
is inferred as follows:

1. **At `SessionStart`**: The hook stores `hash(input.session_id)` in `session.json`
   as `supervisorSessionHash`. This is definitively the supervisor's own session hash,
   because `SessionStart` fires exactly once when the supervisor session begins.

2. **At `SubagentStart`**: The hook reads `supervisorSessionHash` from `session.json`
   and writes it as `parent_session_hash` in the `agent-registry.jsonl` entry. This
   links the child (subagent, identified by `agent_id`) to the parent (supervisor,
   identified by `supervisorSessionHash`).

3. **`parent_turn_hash`**: `hash(input.turn_id)` from the SubagentStart payload. Since
   the hook fires in the supervisor's process, this is assumed to be the supervisor's
   turn in which the subagent was spawned. This is the best available proxy for
   turn-level linkage.

### Limitations — document clearly, do not over-promise

**L1 — session_id semantics are inferred, not guaranteed.**  
The Codex docs do not explicitly state whether `session_id` in SubagentStart refers to
the parent (supervisor) session or the child (subagent) session. The inference that it
is the supervisor's session is based on: (a) the hook fires in the supervisor's process,
(b) all other lifecycle events (`UserPromptSubmit`, `PreToolUse`, etc.) appear to carry
the current (supervisor) session_id. If Codex changes this behavior, `parent_session_hash`
derived from `input.session_id` at SubagentStart would be wrong.

**Safer mitigation**: Use `supervisorSessionHash` from `session.json` (set at SessionStart)
as the parent reference — not the SubagentStart's `session_id`. This is the approved
approach; it is immune to `session_id` semantics ambiguity.

**L2 — Only 1 level of parent linkage.**  
If a subagent itself spawns sub-subagents, those sub-subagents' `parent_session_hash`
would refer to the subagent's session, not the top-level supervisor's. Full recursive
tree reconstruction across more than 1 level requires each worker to also maintain a
`supervisorSessionHash` in its session state. This is out of scope for current
implementation.

**L3 — No `parent_agent_id` field.**  
There is no native Codex hook field that directly names "the agent that spawned this
subagent." The parent→child link goes through session hashes only, not agent IDs.
A future Codex platform version might provide this natively.

**L4 — `handoff_id` is supervisor-side only at hook time.**  
The hook does not know `handoff_id` at SubagentStart (it's in task text). The
`agent_id ↔ handoff_id` correlation is written by the supervisor AFTER reading
`worker.lock` to discover which `agent_id` is active. This creates a small window
(SubagentStart to supervisor reading the lock) where the registry has `agent_id`
without a corresponding `handoff_id`.

---

## 5. Evidence Files

All files live in `docs/autopilot/session-state/` (gitignored via `.gitignore`).
None store raw prompts, commands, tool responses, credentials, or customer data.

### 5.1 `agent-registry.jsonl` (hook-maintained)

One JSONL line per SubagentStart or SubagentStop event.

**SubagentStart line:**
```json
{
  "schema_version": "v1",
  "event": "subagent_start",
  "agent_id": "codex-agent-<runtime-id>",
  "agent_type": "codex",
  "parent_session_hash": "<sha256-hex-prefix-16>",
  "parent_turn_hash": "<sha256-hex-prefix-16>",
  "started_at": "2026-06-17T15:00:00.000Z"
}
```

**SubagentStop line:**
```json
{
  "schema_version": "v1",
  "event": "subagent_stop",
  "agent_id": "codex-agent-<runtime-id>",
  "stopped_at": "2026-06-17T15:01:30.000Z"
}
```

- `parent_session_hash`: read from `session.json.supervisorSessionHash` (set at SessionStart)
- `parent_turn_hash`: `hash(input.turn_id)` from SubagentStart payload
- `agent_id` stored as-is (not hashed) — required for cross-file correlation
- Max entries: trimmed to keep last 200 lines (same policy as `events.jsonl`)

### 5.2 `agent-handoff-index.jsonl` (supervisor-maintained)

Maps `agent_id` to `handoff_id`. Written by supervisor after SubagentStart fires and
the supervisor reads `worker.lock` to discover the active `agent_id`.

```json
{
  "schema_version": "v1",
  "agent_id": "codex-agent-<runtime-id>",
  "handoff_id": "hp-20260617-slug",
  "correlated_at": "2026-06-17T15:00:05.000Z",
  "source": "supervisor_assignment"
}
```

- `source`: `"supervisor_assignment"` (supervisor writes it) or `"worker_echo"` (if
  worker output explicitly names `agent_id` and supervisor cross-references)

### 5.3 `subagent-evidence.jsonl` (supervisor-maintained)

One JSONL entry per completed handoff. Supervisor writes this after SubagentStop,
joining data from `agent-registry.jsonl` (timing), `worker.lock` (agent_id),
and the structured worker/reviewer output files.

```json
{
  "schema_version": "v1",
  "handoff_id": "hp-20260617-slug",
  "agent_id": "codex-agent-<runtime-id>",
  "agent_type": "codex",
  "parent_session_hash": "<sha256-hex-prefix-16>",
  "started_at": "2026-06-17T15:00:00.000Z",
  "stopped_at": "2026-06-17T15:01:30.000Z",
  "duration_seconds": 90,
  "artifacts": {
    "handoff_packet": "docs/autopilot/spike-artifacts/hp-20260617-slug-handoff.md",
    "worker_output": "docs/autopilot/spike-artifacts/hp-20260617-slug-worker.json",
    "reviewer_output": "docs/autopilot/spike-artifacts/hp-20260617-slug-reviewer.json"
  },
  "lock_status": "acquired",
  "verified": false,
  "recorded_at": "2026-06-17T15:02:00.000Z"
}
```

- `reviewer_output` may be `null` if no reviewer pass has run yet
- `verified`: set to `true` by supervisor after reviewer PASS
- `lock_status`: value from `createWorkerLock` return

### 5.4 `session.json` — new field (T2)

The existing `SessionStateManifest` gains one new optional field:

```typescript
supervisorSessionHash: string | null   // hash of supervisorSessionId, set at SessionStart
```

The hook's `normalizeSessionManifest` must pass it through. `createInitialSessionManifest`
initializes it to `null`.

---

## 6. Data Flow

```
SessionStart fires
  └─ hook: hash(session_id) → session.json.supervisorSessionHash

SubagentStart fires
  ├─ hook: getAgentId(input) → createWorkerLock (T1)
  └─ hook: write agent-registry.jsonl SubagentStart entry
           { agent_id, agent_type, parent_session_hash (from session.json), parent_turn_hash }

Supervisor: reads worker.lock → discovers agent_id
  └─ supervisor: write agent-handoff-index.jsonl
                 { agent_id, handoff_id, source: "supervisor_assignment" }

Worker runs, returns structured output (contains handoff_id)

SubagentStop fires
  ├─ hook: getAgentId(input) → releaseWorkerLock (T1)
  └─ hook: write agent-registry.jsonl SubagentStop entry
           { agent_id, stopped_at }

Supervisor: verifies worker output handoff_id matches
  └─ supervisor: write subagent-evidence.jsonl
                 { handoff_id, agent_id, parent_session_hash, timing, artifacts, lock_status }
```

---

## 7. Parent→Child Tree Reconstruction

Given all three files, a supervisor or TypeScript function can reconstruct:

```
supervisorSessionHash (known by supervisor)
  └─ agent-registry.jsonl entries where parent_session_hash == supervisorSessionHash
       → agent_id values (children of this supervisor session)
           └─ agent-handoff-index.jsonl entries where agent_id matches
                → handoff_id for each child
                    └─ subagent-evidence.jsonl entries where handoff_id matches
                         → artifacts, timing, lock_status, verified
```

Reconstruction function `buildSubagentTree(supervisorSessionHash)` is part of T3.

---

## 8. Governance Boundaries

The evidence files must NOT contain:

- Raw prompt text, task description text, or any free-form string content
- Model completions, tool call arguments, tool responses, or transcripts
- Credentials, tokens, or secret-like strings
- Customer data or private account identifiers
- Copies of project runtime logs

What IS allowed:
- Identifiers (`agent_id`, `handoff_id`, hashed `session_id`/`turn_id`)
- Timestamps and durations
- File paths (relative, within the repo)
- Enumerated status values (`lock_status`, `verified`, `agent_type`)
- Hash fingerprints (not reversible)

---

## 9. Task Dependency Map

```
T1: Rekey lock to agent_id
  hp-20260617-rekey-lock-to-agent-id
  Files: autopilot-hook.mjs, codex-hooks.test.ts
  Status: task card created

  ↓ depends-on T1

T2: Agent registry + supervisor session tracking
  hp-20260617-agent-registry
  Files: autopilot-hook.mjs, tests/codex-hooks.test.ts, src/data/delivery-system/sessionState.ts
  Adds: agent-registry.jsonl writes, supervisorSessionHash in session.json

  ↓ depends-on T1 (getAgentId must exist)
  ↓ T2 and T3 can run in parallel after T1

T3: TypeScript evidence schema + supervisor write/read functions
  hp-20260617-subagent-evidence-schema
  Files: src/data/delivery-system/subagentEvidence.ts (new),
         tests/delivery-system/subagent-evidence.test.ts (new)
  Adds: SubagentEvidenceRecord, AgentHandoffIndexEntry types;
        writeCorrelationEntry, writeSubagentEvidence, readAgentRegistry,
        buildSubagentTree functions
```

---

## 10. Verification

After T1 + T2 + T3 are complete:

```powershell
npm.cmd test -- codex-hooks          # T1 + T2 tests
npm.cmd test -- subagent-evidence    # T3 tests
npm.cmd run typecheck                # no regressions
npm.cmd run verify                   # full suite pass
```
