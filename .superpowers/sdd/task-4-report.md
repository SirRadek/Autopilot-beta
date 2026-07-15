# Task 4 implementation report

Status: DONE_WITH_CONCERNS

Base: `f035beb`

## Scope implemented

- Added `ops/cockpit-proxy/live-cutover.sh` with a three-argument production interface and a separate `--accept ACK_ID` invocation.
- Added a root-owned mode-0600 atomic transaction ledger and mode-0700 acknowledgement runtime.
- Added complete preflight before live mutation: exact clean SHA, immutable release topology and manifest, Node 24, protected environment, live loopback health/nested readiness/listener, active timers, Caddy package/mask/inactivity/package verification, free proxy/acceptance ports, reviewed source artifacts, fresh exact isolated evidence, and ownership/refusal checks.
- Added fresh backup and recovery validation before cutover.
- Added named mutation tracking and rollback for firewall artifacts/service, `current`, exact environment bytes/ownership, Control Plane, Caddy artifacts, enable/mask state, and service attempt.
- Added firewall-before-Caddy ordering, exactly one secure-cookie replacement, VM-local service/listener checks, random acknowledgement ID, 300-second production acknowledgement bound, and automatic rollback on error/signal/timeout.
- Rollback verifies loopback health, nested readiness, configured boundary paths, and deterministic smoke with `provider_invoked=false`; it never restores canonical state.
- Added package script `ops:cockpit-proxy:cutover`.
- Added fake-root/stub tests for success, six named failure-injection points, partial privileged-command failures, exact environment/link/Caddyfile restoration, real preflight refusals, valid second-invocation acknowledgement, timeout rollback, ordering, and secret non-disclosure.

No VM, live systemd/nftables/Caddy state, provider, network, or paid-call mutation was performed.

## TDD evidence

RED:

```text
npm test -- tests/operations/cockpit-proxy-scripts.test.ts -t 'starts the owned firewall'
Test Files 1 failed
Tests 1 failed | 100 skipped
bash: .../ops/cockpit-proxy/live-cutover.sh: No such file or directory
```

Final focused/relevant GREEN (Node-24 version test wrapper delegates execution to the local Node binary and is used only because the host has Node 18):

```text
AUTOPILOT_NODE_BIN=/tmp/autopilot-node24-test npm test -- \
  tests/operations/cockpit-proxy-config.test.ts \
  tests/operations/cockpit-proxy-scripts.test.ts
Test Files 2 passed (2)
Tests 108 passed (108)
Duration 75.26s
```

Additional final checks:

```text
npm run typecheck
PASS

bash -n ops/cockpit-proxy/live-cutover.sh
PASS

git diff --check
PASS
```

## Full verify concern

`npm run verify` was attempted. Vendor check and typecheck passed, then the complete Vitest run failed on the current host's Node `v18.19.1`:

- 13 Product Design OS suites failed during import because CommonJS `node-html-parser` attempted to require the ESM `entities` package.
- 13 existing immutable staging tests correctly refused the non-Node-24 runtime.
- 88 suites / 849 tests passed before the gate stopped; the failures are outside the Task 4 diff and are consistent with the repository's explicit Node 24 requirement.

The required Task 4 configuration/scripts suite is fully green under the Node-24 version gate as shown above. A real Node 24 full `npm run verify` remains required in Task 6/CI.

## Self-review notes

- Test-only root redirection is accepted only under `/tmp`; production fixes `PATH`, requires EUID 0, `/srv/autopilot-cockpit`, root-owned staged artifacts/evidence/ledger, and the `radek`-owned protected environment.
- Rollback refuses to stop or remove proxy resources whose installed identity no longer matches the reviewed source, preventing deletion of foreign replacements.
- Caddy unmask/enable and both service-start attempts are marked before invocation so partial failures remain rollback-owned.
- The canonical state backup is retained only as a recovery point and is never automatically restored.
