# Phase 8 final whole-branch fix report

Date: 2026-07-13 (Europe/Prague)

## Result

The final governed single-run findings were integrated as one scoped repair wave. Production
Control Plane runtime now owns the persistent supervisor polling loop and uses the real governed
dispatcher. The deterministic smoke uses that same runtime and loop, injecting only its provider
boundary. Governed dispatch accepts caller-owned reservation settlement for this path, leaving one
reservation owner and preserving the existing standalone-dispatch behavior.

Worker exit code, error reason, and lock status are persisted. Nonzero, error-bearing, or failed-lock
results settle actual usage and finalize failed. Provider output is strongly redacted before result
or artifact persistence. Running cancellation remains durable while dispatch is in flight, then
settles actual usage and finalizes cancelled.

Route eligibility is centralized and requires a fresh, available provider and selected model at
prepare, revision, and immediately before approval/reservation. Prompts retain the 32,000-character
storage bound, are conservatively capped below 8,000 estimated model-visible tokens, and require an
explicit cockpit review acknowledgement above 1,000 tokens. The governed packet task is a bounded
run reference instead of a second copy of the full prompt.

## TDD evidence

The initial focused RED run had four expected failures: production runtime did not dispatch,
stale routes prepared successfully, nonzero worker exits completed, and running cancellation
released early. After implementation, the focused Node 24 run passed 67 tests across the run
orchestrator, Control Plane, and deterministic smoke files. Regression fixtures cover deferred
dispatch cancellation, restart-safe persisted results, password/Bearer/API-key redaction, stale
prepare/approve rejection, prompt review/hard caps, production runtime terminal execution, and
single reservation settlement.

## Fresh verification

- Node: ephemeral isolated Node `v24.18.0`; no `.env` or live provider invocation.
- `npm run typecheck`: passed.
- Full backend: 85 files, 703 tests passed.
- Full cockpit: 13 files, 78 tests passed.
- Cockpit production build: passed, 42 modules transformed.
- Browser QA clean rerun: 7 tests passed in 5.1 seconds. One immediately preceding all-in-one run
  had a single stale-provider fixture timing miss (6/7); the isolated rerun passed all seven.
- Deterministic production-loop smoke: passed with one approval, reservation, supervisor task,
  worker result, artifact, and exactly one `settled` terminal event.
- Fresh smoke IDs: run `7496e7d2-024c-49a2-a778-f271c3600eae`, task
  `run-task-f3ffc36c-6ffd-4cd0-a6c2-1dfe3441b93f`, reservation
  `tgr-fdd1302a-bc78-4b6f-80e5-0038ba33fa8b`.
- `git diff --check`: passed.

## Environment concern

The existing VM at `192.168.122.99` was reachable, but this session had no accepted SSH key
(`Permission denied (publickey)`), so the live checkout and VM state were not touched. The exact
matrix was instead run in this isolated worktree with an ephemeral Node 24.18.0 runtime and a newly
installed Playwright Chromium. Host Node 18 was also confirmed inadequate for the full backend and
browser matrix; those host failures were environmental and the Node 24 matrix passed as recorded.

No provider credentials were loaded, no live checkout was modified, and no live provider was
invoked.
