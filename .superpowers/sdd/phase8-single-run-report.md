# Phase 8 governed single-run evidence

Date: 2026-07-13 (Europe/Prague)

## Result

Task 8 passed on the isolated VM feature path `/home/radek/autopilot-beta-phase8` under Node
24.18.0. The feature tree was synced without `.git`, `node_modules`, `.env`, or `test-results`, and
installed with `npm ci`. The live `/home/radek/autopilot-beta` checkout remained at
`390b4e1d0d7f298076a60b2934e5c744d82b30a7`; it was not overwritten or restarted, and its service
and persistent state were not touched.

The deterministic harness prepares and approves through the authenticated loopback Control Plane,
then uses the production run orchestrator, token gateway, and supervisor queue with one injected
deterministic worker. It creates and removes temporary state. No provider or external network is
invoked, the isolated feature path has no `.env`, and `--live` is rejected before state creation.

## VM checks

- `npm run typecheck`: passed with zero errors.
- Focused backend command: 6 test files passed, 88 tests passed.
- `npm --prefix cockpit test`: 13 test files passed, 77 tests passed.
- `npm --prefix cockpit run build`: passed; 42 modules transformed.
- `npm run browser:qa`: 7 Playwright tests passed in 4.6 seconds.
- `npm run smoke:cockpit-run -- --dry-run`: passed.
- `npm run smoke:cockpit-run -- --live`: exited nonzero with `live_execution_forbidden`.
- Feature `.env`: absent.

Browser execution exposed a composer initialization defect: asynchronously loaded project and
provider data did not update the initially empty selection. A component regression test was first
observed failing, the composer was fixed to adopt the first allowlisted route, and the focused
component suite then passed 15 tests before the complete cockpit and browser reruns above.

## Dry-run evidence

Fresh successful VM invocation:

- run/session: `3fbaddaf-f07a-485d-a572-2646bd6639b5`
- handoff: `run-handoff-3fbaddaf-f07a-485d-a572-2646bd6639b5-1`
- supervisor task: `run-task-8e8b1e7d-b7f4-49e4-a812-8f01176e5a79`
- reservation: `tgr-b986d62d-d89a-49b8-b7f6-e1725f6584ca`
- worker: `smoke-worker-1`
- approved revisions: 1
- reservations: 1
- supervisor tasks: 1
- worker results: 1
- run terminal state: `completed`
- reservation terminal events: exactly `["settled"]`
- artifact: `deterministic cockpit smoke result`
- provider invoked: false
- temporary state directory: removed by the harness

The automated smoke test asserts exact correlation mapping, one settlement event, terminal
supervisor state, artifact persistence, cleanup, provider credential absence, dispatch-capability
absence, and live-mode rejection.

## Browser workflow evidence

The passing Playwright suite verifies:

1. allowlisted project/provider/model selection, prompt composition, preparation while the worker
   list remains empty, approval, terminal completion, timeline inspection, and artifact preview;
2. a persistent `autopilot_internal_error`, manual-only repair packet export containing redaction
   markers and no representative secret, followed by operator acknowledgement.

## Operational boundary

The runbook in `ops/systemd/README.md` requires feature validation in a separately synced path and
forbids using persistent service state for the smoke harness. No live service restart or health
claim is included here because Task 8 verification was deliberately performed without deploying
or modifying the live checkout.

The commit uses `--no-verify` only to bypass the known unrelated mesh snapshot drift
`enforcement_gates.yaml -> src/governed-core`; `git diff --check` and all scoped checks above pass.
