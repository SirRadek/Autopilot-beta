# Adoption Record

## Decision ID

adopt-2026-0617-lock-keyed-on-agent-id

## Date

2026-06-17

## What Was Proposed

Rekey the `worker.lock` serialization mechanism from `handoff_id` to the native
`agent_id` field that the Codex runtime provides in every SubagentStart hook payload.

`handoff_id` is retained as the authoritative audit identifier for work items — it
flows through the handoff packet, worker output, reviewer output, adoption record, and
work-log — but it no longer conditions lock creation or release.

Rule: **lock runs on `agent_id`; audit runs on `handoff_id`.**

## Decision: adopted

## Who Decided

SirRadek (owner)

## Reason

Two concrete blockers surfaced in the S1/R1 live verification run
(`2026-0617-s1-r1-hook-verification.md`, decision: deferred) that made the original
design (lock keyed on `handoff_id`) unworkable in practice:

**Blocker 1 — `codex-cli 0.106.0` has no `--metadata` flag.**
There is no supported mechanism to inject a structured `handoff_id` as a top-level JSON
field in the live Codex SubagentStart hook payload. The only option is to embed it in
the task text string. However, `getHandoffId` intentionally does not parse prompt text —
the hook ledger (`.codex/state/events.jsonl`) is designed to stay free of raw
prompt/payload content, and text-embedded `handoff_id` is correctly invisible to the
hook. This is the desired behavior, not a bug.

**Blocker 2 — Codex natively provides `agent_id` in SubagentStart.**
The Codex runtime assigns a stable runtime identifier (`agent_id`) to each subagent
invocation and delivers it as a top-level JSON field in the SubagentStart hook payload.
No caller-side injection is needed. It is always present when a real Codex subagent
starts.

**Design principle applied:**
- Serial enforcement (preventing concurrent workers) is a runtime concern → use the
  runtime-native `agent_id` that Codex guarantees is present.
- Audit traceability (correlating work outputs back to a handoff decision) is a
  governance concern → use `handoff_id`, which is visible to the worker in its task
  description and which the worker MUST return in its structured output; the supervisor
  verifies the audit chain from there, not from the hook.

**Nuance on hook ledger privacy:**
The hook ledger intentionally omits raw prompt/payload content. If `handoff_id` is
present as a structured top-level field in the SubagentStart input (i.e., after the
implementation described in this decision), it may be logged as a structured audit field
alongside `agent_id`. If it is absent (task carried only in text), that is correct — the
audit chain runs supervisor → worker output → reviewer output, not through the hook.

## What Was Changed (file paths)

This record documents the design decision only. Implementation is tracked in
`docs/autopilot/spike-artifacts/hp-20260617-rekey-lock-to-agent-id-handoff.md`.

Files to be modified by that task:

- `.codex/hooks/autopilot-hook.mjs`
- `tests/codex-hooks.test.ts`

No schema files, governance docs, or handoff packet formats are changed.

## Extended Scope: Full Subagent Evidence Model

Owner subsequently approved (2026-06-17) extending the design from "rekey lock" to a
full subagent evidence model. The rekey decision above is Task T1 in a three-task chain:

| Task | Handoff ID | Scope |
|---|---|---|
| T1 | `hp-20260617-rekey-lock-to-agent-id` | Rekey lock to `agent_id` |
| T2 | `hp-20260617-agent-registry` | Hook writes `agent-registry.jsonl`; session stores `supervisorSessionHash` |
| T3 | `hp-20260617-subagent-evidence-schema` | TypeScript types + supervisor write/read/tree functions |

**Evidence files added by T2 + T3:**

```
docs/autopilot/session-state/
  agent-registry.jsonl          ← hook: subagent lifecycle events (start/stop)
  agent-handoff-index.jsonl     ← supervisor: agent_id ↔ handoff_id correlation
  subagent-evidence.jsonl       ← supervisor: per-handoff evidence records
```

**Key design facts:**
- `agent_id` → lock key (runtime-native, always present in SubagentStart payload)
- `handoff_id` → audit key (governance construct, NOT native to Codex hook payload)
- `parent_session_hash` → derived from `session.json.supervisorSessionHash`, set at
  `SessionStart`; provides 1-level parent→child linkage (see Limitation L2 in design doc)
- No raw prompt/response/credential content in any evidence file

Full design: `docs/autopilot/subagent-evidence-operating-model.md`

## Tests Or Evidence

- S1/R1 verification (`2026-0617-s1-r1-hook-verification.md`): A1–A4 mechanical tests
  passed when `handoff_id` was delivered as a structured JSON field on stdin. Live B test
  via `multi_agent_v1.spawn_agent` with `handoff_id` embedded in prompt text produced no
  `worker.lock` and no new entries in `.codex/state/events.jsonl`, confirming that the
  text-embedding path does not reach the hook.
- Owner decision verbatim: "lock běží podle `agent_id`, audit běží podle `handoff_id`."
- Linkage: this decision closes the deferred S1 risk by changing the design rather than
  patching the propagation path.
