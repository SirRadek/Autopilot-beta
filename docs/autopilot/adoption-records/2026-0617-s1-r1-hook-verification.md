# Adoption Record

## Decision ID

verify-2026-0617-s1-r1-hook-verification

## Date

2026-06-17

## What Was Proposed

Verify the S1/R1 hook path for bounded Codex worker serial execution:
SubagentStart should read a structured top-level `handoff_id`, create
`docs/autopilot/session-state/worker.lock`, preserve an existing lock for a
second worker, and SubagentStop should release the lock only for the matching
handoff. Also attempt a live subagent run to see whether the current Codex App
subagent payload triggers `.codex/hooks/autopilot-hook.mjs` and supplies the
handoff id as structured JSON.

## Decision: deferred

## Who Decided

SirRadek requested the verification; Codex recorded the evidence. Final S1
closure remains pending a Codex App subagent path that actually fires the local
hook in this workspace.

## Reason

The mechanical hook path passed with explicit UTF-8 JSON on stdin and a
top-level `handoff_id`: the lock was created, matched the handoff id, was
released by a matching SubagentStop, and an existing lock was not overwritten by
a second worker. However, the live attempt through the available
`multi_agent_v1.spawn_agent` tool did not create a lock and did not append a new
SubagentStart/SubagentStop event to `.codex/state/events.jsonl` in the parent
workspace. That means the direct hook logic is verified, but the live Codex App
payload propagation risk is not closed by this run.

## What Was Changed (file paths)

- `docs/autopilot/adoption-records/2026-0617-s1-r1-hook-verification.md`

## Tests Or Evidence

- A1 first attempt with a plain PowerShell pipeline returned
  `Autopilot hook received invalid JSON input; hook evidence is unavailable.`
  This appears to be a Windows stdin encoding/pipeline issue for the manual
  test command, not a handoff-id parsing result.
- A1 repeated through Node `spawnSync(..., { input: JSON.stringify(payload),
  encoding: "utf8" })` passed. Hook output returned `SubagentStart` additional
  context, `docs/autopilot/session-state/worker.lock` existed, and its content
  was `{"lockedBy":"hp-20260617-live-hook-test","lockedAt":"..."}`.
- A2 passed. A matching SubagentStop for `hp-20260617-live-hook-test` returned
  `{"continue":true}` and `docs/autopilot/session-state/worker.lock` no longer
  existed.
- A3 passed against the implementation's actual ledger path:
  `.codex/state/events.jsonl`. The file contained `SubagentStart` and
  `SubagentStop` records for the manual hook run. The plan's
  `.codex/hooks/state/ledger.jsonl` path was stale for the current hook code.
- A-BONUS passed. With a pre-existing lock for
  `hp-20260617-live-hook-test`, a second SubagentStart for
  `hp-20260617-second-worker` returned `worker.lock already present; previous
  worker session may still be active.` The lock still pointed to
  `hp-20260617-live-hook-test`, then was cleaned up.
- B attempted through `multi_agent_v1.spawn_agent` with prompt text containing
  `handoff_id: hp-20260617-live-app-subagent`. The read-only subagent completed,
  but `worker.lock` was never created and `.codex/state/events.jsonl` stayed at
  5 lines with no new live SubagentStart/SubagentStop entries. Therefore this
  available multi-agent path does not prove live Codex App hook firing in the
  parent workspace.
