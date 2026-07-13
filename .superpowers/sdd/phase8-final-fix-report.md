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

## Fresh VM verification

- VM: `autopilot-phase0` (`192.168.122.99`), isolated path
  `/home/radek/autopilot-beta-phase8-final`, Node `v24.18.0`.
- The tree was synced without `.git`, `node_modules`, `.env`, or `test-results`; dependencies were
  installed with `npm ci` and `npm --prefix cockpit ci`.
- `npm run typecheck`: passed.
- Full backend: 85 files, 703 tests passed.
- Full cockpit: 13 files, 78 tests passed.
- Cockpit production build: passed, 42 modules transformed.
- VM browser QA: 7 tests passed in 5.0 seconds, including prepare → approve → terminal evidence.
- Deterministic production-loop smoke: passed with one approval, reservation, supervisor task,
  worker result, artifact, and exactly one `settled` terminal event.
- Fresh VM smoke IDs: run `616d3fc5-1285-4f38-8c39-6210ced58923`, task
  `run-task-8a0380ba-ec44-49e9-b462-9d30b63ab026`, reservation
  `tgr-fd92c179-a968-4786-aef1-593ca5d37a02`.
- Smoke output explicitly reported `provider_invoked: false`; the isolated tree had no `.env`.
- `npm run smoke:cockpit-run -- --live` was rejected with `live_execution_forbidden`, exit 1.
- `git diff --check`: passed.

## Isolation and concerns

The live checkout `/home/radek/autopilot-beta`, its service, and persistent state were never read,
modified, or restarted during this verification. All VM writes were confined to the isolated
feature path and temporary smoke/browser state. No provider credentials were present or loaded.

One prior host-only all-in-one browser run had a transient stale-provider fixture timing miss; its
immediate host rerun passed 7/7, and the authoritative isolated VM run also passed 7/7. No remaining
implementation or verification concern is known.
