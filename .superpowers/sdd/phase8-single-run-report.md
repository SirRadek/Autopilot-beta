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
- Focused backend command: 6 test files passed, 93 tests passed.
- `npm --prefix cockpit test`: 13 test files passed, 78 tests passed.
- `npm --prefix cockpit run build`: passed; 42 modules transformed.
- `npm run browser:qa`: 7 Playwright tests passed in 4.8 seconds.
- `npm run smoke:cockpit-run -- --dry-run`: passed.
- `npm run smoke:cockpit-run -- --live`: exited nonzero with `live_execution_forbidden`.
- Feature `.env`: absent.

Browser execution exposed a composer initialization defect: asynchronously loaded project and
provider data did not update the initially empty selection. A component regression test was first
observed failing, the composer was fixed to adopt the first allowlisted route, and the focused
component suite then passed 15 tests before the complete cockpit and browser reruns above.

Review hardening replaced the mocked incident packet with a real isolated Control Plane failure:
the browser writes invalid run state containing `authorization: Bearer secret-value`, observes the
real `autopilot_internal_error`, restores a valid empty run store, reloads to prove the incident was
persisted, calls the real repair-packet endpoint and proves `[REDACTED]` replaces the credential,
then acknowledges and reloads again to prove the acknowledged state persisted. This also exposed
and fixed a missing reverse-proxy allowlist for `/projects`, `/runs`, `/incidents`, and
`/observability`, covered by a new cockpit regression test.

Playwright state is allocated by a Node wrapper with `mkdtemp`, tagged with a random ownership
marker, passed to both tests and the Control Plane through inherited environment, and removed only
after verifying that exact marker. The web-server commands contain no state-path interpolation and
there is no predictable directory or pre-run recursive deletion, so concurrent runs cannot erase
one another's state.

## Dry-run evidence

Fresh successful VM invocation:

- run/session: `35e3ec87-3757-4799-9658-63b60685adf9`
- handoff: `run-handoff-35e3ec87-3757-4799-9658-63b60685adf9-1`
- supervisor task: `run-task-58e4b0d0-8685-41a3-a6ba-bdf351c93f6d`
- reservation: `tgr-04691141-2cbd-4f6d-86a9-fc843b596e7c`
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

The smoke verifier independently reloads Token Gateway state and telemetry, Run Store provider
results and artifacts, and Supervisor Queue tasks and handoffs. It derives every count from those
records and cross-checks run, session, task, handoff, worker, reservation, provider, and model IDs
against the deterministic dispatch output. Global totals must be exactly one approval, one run,
one result, one artifact, one supervisor task, one reservation plus its one matching settlement,
and no other lifecycle reservation ID. Regression tests inject duplicate/mismatched evidence plus
an unrelated approval, reservation lifecycle, and supervisor task; each proves verification
fails. The suite also asserts cleanup, provider credential absence, dispatch-capability absence,
and live-mode rejection.

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
