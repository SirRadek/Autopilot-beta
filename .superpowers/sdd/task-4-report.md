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

## Review-fix TDD cycle

Review RED was established before implementation changes:

```text
npm test -- tests/operations/cockpit-proxy-config.test.ts \
  tests/operations/cockpit-proxy-scripts.test.ts \
  -t 'production proxy boundary|retains the firewall|no-final-newline|non-single-false|runtime mask'
Test Files 2 failed (2)
Tests 7 failed | 2 passed | 107 skipped
```

The failures proved the reviewed gaps: the firewall was stopped after failed/uncertain Caddy shutdown,
the unit still contained unconditional nft deletion, no-final-newline environment bytes changed, an
already-true secure-cookie assignment was accepted, and Caddy metadata/runtime mask location were not
restored exactly. GREEN evidence is appended below after the complete fix.

Review-fix GREEN:

```text
AUTOPILOT_NODE_BIN=/tmp/autopilot-node24-test npm test -- \
  tests/operations/cockpit-proxy-config.test.ts \
  tests/operations/cockpit-proxy-scripts.test.ts
Test Files 2 passed (2)
Tests 132 passed (132)
Duration 134.39s

npm test -- tests/operations/cockpit-proxy-scripts.test.ts -t cutover
Test Files 1 passed (1)
Tests 44 passed | 87 skipped
Duration 74.51s

npm test -- tests/operations/cockpit-proxy-config.test.ts
Test Files 1 passed (1)
Tests 1 passed (1)

npm run typecheck
PASS
bash -n ops/cockpit-proxy/live-cutover.sh ops/cockpit-proxy/autopilot-cockpit-firewall.sh
PASS
git diff --check
PASS
```

Review findings closed:

- Caddy stop success, transaction-owned Caddy identity, inactive state, and empty `80/443` listeners
  are all mandatory before the firewall can stop. Uncertainty retains the firewall and emits
  `ROLLBACK_FAILED`.
- The unconditional nft deletion unit was replaced by a nonce-bound helper/template. Preflight refuses
  an existing table; both the cutover and helper validate the exact transaction comment, single table,
  chain, and rule before deletion. Foreign replacement is preserved.
- File installations, created directories, daemon reloads, unmask/enable/start attempts, `current`, and
  environment mutations are individually ledgered before atomic mutation and failure-injected in tests.
- Package Caddyfile bytes and metadata, runtime versus persistent mask location, and prior enablement
  links are preserved exactly. Only transaction-created empty directories are removed.
- `current` and environment rollback occurs only when the live object still matches the transaction
  target/hash; race and SIGTERM replacement tests prove foreign objects are retained.
- Secure-cookie mutation accepts exactly one `CONTROL_PLANE_SECURE_COOKIES=false` line and performs a
  byte-preserving replacement for both final-newline variants; true, missing, and duplicate forms refuse
  before live mutation.

## Second review-fix TDD cycle

Second-review RED:

```text
npm test -- tests/operations/cockpit-proxy-scripts.test.ts \
  -t 'fails closed|offline nft|partial files|Caddy dropin identity|Caddy unit identity|EnvironmentFile ambiguity|invalid UTF-8|registered transaction temporary|recovers an uncompleted'
Test Files 1 failed (1)
Tests 8 failed | 16 passed | 124 skipped
```

The RED cases specifically demonstrated fail-open command-result handling, missing offline nft syntax
validation, unsafe partial-start classification, incomplete Caddy identity, and the absence of durable
post-process recovery. Environment ambiguity, invalid UTF-8, and the initial temporary cleanup cases
were already rejected by conservative existing checks and remain explicit regression coverage.

Second-review GREEN:

```text
AUTOPILOT_NODE_BIN=/tmp/autopilot-node24-test npm test -- \
  tests/operations/cockpit-proxy-config.test.ts \
  tests/operations/cockpit-proxy-scripts.test.ts
Test Files 2 passed (2)
Tests 150 passed (150)
Duration 179.84s

npm run typecheck
PASS

bash -n ops/cockpit-proxy/live-cutover.sh \
  ops/cockpit-proxy/autopilot-cockpit-firewall.sh \
  ops/cockpit-proxy/install-cutover-recovery-watchdog.sh
PASS

git diff --check
PASS
```

Second-review findings closed:

- External inspections preserve and validate command status separately from stdout. Caddy uses the
  exact inactive/failed contract; `dpkg -V`, listener, nftables, and post-start checks fail closed.
- The EnvironmentFile uses fatal UTF-8 decoding and accepts one byte-exact, unquoted physical false
  assignment. Whitespace, quoting, continuations, duplicates, NUL, and invalid UTF-8 refuse early.
- The authoritative atomic ledger/backups are root-only under
  `/var/lib/autopilot-cockpit/transactions/active`; `/run` is only an ACK/compatibility mirror.
  Locked `--recover` validates every persisted field and is idempotent after successful rollback.
- A root-installed recovery program, boot-persistent 30-second timer, and 180-second oneshot service
  provide bounded process-loss/reboot recovery. Production refuses without byte-exact active recovery.
- Normal-path temporaries are registered before creation with exact path, type, and SHA-256 identity;
  recovery removes only a matching object and retains foreign replacements.
- The nonce-rendered nft program passes bounded offline `nft --check --file` before live mutation.
  Partial firewall start is reversible only with exact file identity and proven table absence.
- Caddy stop authorization covers the transaction Caddyfile/drop-in and original package unit hash and
  metadata, with identity rechecked immediately after start/state inspection.
