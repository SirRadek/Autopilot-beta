# Agent Handoff Packet

## Handoff ID

hp-20260617-fix-trim-tmp-suffix

## Source Agent

claude-opus-supervisor (Claude Code, subscription-interactive)

## Target Agent

codex-bounded-worker (OpenAI Codex, subscription-interactive)

## Project

autopilot-control-plane

## Mode

WRITE_ALLOWED

## Goal

Fix R3: change `trimJsonlIfNeeded` in `.codex/hooks/autopilot-hook.mjs` to use a
unique per-process `.tmp` suffix (matching the pattern already used in `doSessionWrite`),
eliminating the race condition where concurrent Codex sessions could collide on a
shared `${path}.tmp` file.

Also fix the same pattern on the `CONTINUITY_PATH` write on line 383 for consistency.

## Scope

Single file: `.codex/hooks/autopilot-hook.mjs`. Two sites:

1. `trimJsonlIfNeeded` — line 309: `const temporaryPath = \`${path}.tmp\`;`
2. `buildContinuityPayload` area — line 383: `const temporaryPath = \`${CONTINUITY_PATH}.tmp\`;`

Change both to: `` `${path}.${process.pid}.${Date.now()}.${hash(Math.random())}.tmp` ``

## Allowed Files Or Surfaces

- `.codex/hooks/autopilot-hook.mjs` (edit, line 309 and line 383 only)

## Forbidden Actions

- Do not edit any file outside `.codex/hooks/autopilot-hook.mjs`
- Do not change `doSessionWrite` tmp logic (already correct)
- Do not add new imports (all dependencies — `process`, `Date`, `hash` — are already in scope)
- Do not add inline comments or block docstrings
- Do not refactor surrounding code beyond the two-line change
- Do not commit

## Verified Facts

- Line 309: `const temporaryPath = \`${path}.tmp\`;` — confirmed unpatched (rg search 2026-06-17)
- Line 383: `const temporaryPath = \`${CONTINUITY_PATH}.tmp\`;` — confirmed unpatched
- Line 521 in `doSessionWrite` uses `\`${SESSION_STATE_PATH}.${process.pid}.${Date.now()}.${hash(Math.random())}.tmp\``
  as the reference implementation — already correct and should NOT be changed
- `hash()` is a module-level function at line 131, returns 16-char hex; in scope at both call sites
- `process.pid` is available in Node.js without import
- `trimJsonlIfNeeded` is synchronous (`readFileSync`/`writeFileSync`/`renameSync`); a unique suffix
  still reduces collision risk vs two concurrent invocations
- No existing test directly covers `trimJsonlIfNeeded` internals; failing-test-first is not applicable
  (sync FS calls, no mock injection point)
- R3 was classified "Recommended" (not blocking) in the prior code review

## Assumptions

- The Codex worker reads this packet before touching any file.
- `hash(Math.random())` provides sufficient entropy for tmp-suffix uniqueness;
  combining with `process.pid` + `Date.now()` makes collision probability negligible.

## Decisions Already Made

- Pattern to use: `${path}.${process.pid}.${Date.now()}.${hash(Math.random())}.tmp`
  (exact match to `doSessionWrite` line 521 — just with `path` instead of `SESSION_STATE_PATH`)
- Both line 309 and line 383 must be updated for consistency; do not update just one
- No new tests required (noted in evidence), but if worker adds a smoke test it is acceptable

## Open Questions

None.

## Risks

- Stale `.tmp` files accumulate if the process crashes after `writeFileSync` and before
  `renameSync`. Risk is identical to the existing `doSessionWrite` pattern and is
  accepted by the architecture. The 2-hour stale lock mechanism is the recovery path.

## Stop Conditions

- More than 2 lines changed in the file
- Any file other than `.codex/hooks/autopilot-hook.mjs` touched
- Import added to the hook file
- doSessionWrite pattern altered

## Required Checks

- `rg 'temporaryPath.*\.tmp"' .codex/hooks/autopilot-hook.mjs` returns zero matches after fix
- `npm.cmd run verify` passes (251 tests / 38 files / 4 Playwright)
- Worker output JSON validates against `model-output-evals/worker-output.schema.json` with AJV strict:true

## Expected Output

Structured JSON file at `docs/autopilot/spike-artifacts/hp-20260617-fix-trim-tmp-suffix-worker.json`
matching `model-output-evals/worker-output.schema.json`:

- `handoff_id: "hp-20260617-fix-trim-tmp-suffix"`
- `worker_id: "openai_gpt"` (or `"anthropic_claude_subscription"` if Codex App unavailable)
- `verify_result: "pass"`
- `changed_files: [".codex/hooks/autopilot-hook.mjs"]`
- `output_summary`: describes the two-line change and confirms unique suffix pattern

## Reuse Check (required for bounded_coding tasks)

- Searched patterns: `trimJsonlIfNeeded`, `temporaryPath.*\.tmp`, `pid.*Date.*hash.*tmp`
- Existing matches: `doSessionWrite` at line 521 uses the unique suffix — this is the **reference** pattern to reuse
- Installed package matches: none relevant
- Decision: extend_existing (reuse the doSessionWrite unique-suffix pattern)
- Reuse target: `.codex/hooks/autopilot-hook.mjs:521`
- Token saving estimate: low (the fix itself is trivial; no new utilities needed)

## Context Budget (required)

- Profile: caveman
- Max files: 3
- Max context lines: 200
- Included sections: goal, allowed_files, forbidden_actions, expected_output

## Learning Signal (optional)

- Based on eval records: no eval records for `hooks/fix` task type yet
- Recommended delta: no_change
- Confidence: no_data

## Evidence And Source Pointers

- `src/data/delivery-system/checkCompletionMatrix.ts` — `REQUIRED_SECTIONS_ALWAYS`, `makeHandoffId`
- `.codex/hooks/autopilot-hook.mjs:309` — `trimJsonlIfNeeded` fixed suffix (unfixed)
- `.codex/hooks/autopilot-hook.mjs:383` — `CONTINUITY_PATH` fixed suffix (unfixed)
- `.codex/hooks/autopilot-hook.mjs:521` — `doSessionWrite` unique suffix (reference)
- Prior code review R3 finding (session bd3b2e29)

## Progress Impact

Closes R3 (recommended finding). No CX task dependency. Improves consistency.

## Next Action

Worker: apply two-line fix, run `npm.cmd run verify`, write structured output JSON.
Supervisor: validate worker output, score, write reviewer JSON, update session state.
