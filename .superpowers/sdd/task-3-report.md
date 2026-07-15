# Task 3 report: isolated acceptance and trusted host tests

## Status

Implementation complete for the bounded Task 3 repository slice. No VM, live service, production state, provider, cutover, or progress-ledger mutation was performed.

## Implemented

- Added `ops/cockpit-proxy/isolated-acceptance.sh` with exact-candidate release topology/checksum validation, free-port/named-unit/named-table preflight, failure/signal cleanup registered before mutation, private isolated state/projects/environment, secure cookies, transient Control Plane and Caddy units, host-only nftables restriction, bounded readiness waits, strict parse-and-re-emit single-certificate CA export/fingerprint, retained success lifecycle, ownership-marked idempotent `--cleanup`, and post-cleanup listener/table verification.
- Added `ops/cockpit-proxy/host-acceptance.sh` with approved HTTPS origins only, normal TLS chain verification plus `autopilot.local` SAN verification, curl config/proxy/CA override isolation, complete security/cache header checks, static asset and SPA checks, every approved API route family plus lookalikes, exact static unsupported-method behavior, private token capture, `0600` cookie jar, exactly one same-line Secure/HttpOnly/SameSite session cookie, same-origin acceptance, evil-origin and Referer-only rejection, logout verification, and artifact-free Playwright execution.
- Added `playwright.proxy.config.ts` with an externally supplied HTTPS base URL, `ignoreHTTPSErrors: false`, trace/video/screenshots disabled, and no web server.
- Added `tests/browser-proxy/cockpit-proxy.spec.ts` with real login, same-origin resource verification, and explicit logout.
- Added lifecycle/cleanup/refusal/secret-output/public-CA/trusted-host behavioral coverage and package scripts.

## RED evidence

Closure-review RED: targeted readiness/health/token-runner regressions produced one explicit boundary failure (missing token-command/Playwright timeouts), with negative readiness, health, and raw-token cases installed before production changes.

```text
Test Files  1 failed (1)
Tests       1 failed | 10 passed | 69 skipped (80)
```

Third full-review regression RED was captured before production changes. The focused host boundary test failed because curl had no connect/total timeout and OpenSSL had no timeout wrapper; new isolated regressions additionally exercised inspection errors, foreign unit/nft replacement, invalid `/ready` states, and invalid-length/encoding session tokens.

```text
npx vitest run tests/operations/cockpit-proxy-scripts.test.ts -t 'keeps token' --reporter=verbose
Test Files  1 failed (1)
Tests       1 failed | 67 skipped (68)
```

Second full-review regression RED (before the second production-script fix):

```text
npm test -- tests/operations/cockpit-proxy-scripts.test.ts -t 'isolated|trusted host'
Test Files  1 failed (1)
Tests       11 failed | 22 passed | 25 skipped (58)
```

The failures reproduced runtime symlink-race acceptance, cleanup of untrusted or missing ownership evidence, evidence deletion before failed cleanup verification, and permissive cookie parsing of empty/malformed/duplicated/comma-joined session cookies.

Independent-review regression RED (before production-script changes):

```text
npm test -- tests/operations/cockpit-proxy-scripts.test.ts -t 'isolated|trusted host'
Test Files  1 failed (1)
Tests       6 failed | 17 passed | 25 skipped (48)
```

The failures proved the reviewed gaps: appended DER, arbitrary trailing data, and a second PEM object were exported successfully; both fixed transient-unit collisions were ignored; and the trusted-host path invoked curl without the mandatory config/proxy boundary (stub exit `90`). The negative cookie/CSP/static-method cases were also present but could not yet reach their response assertions because the common curl boundary failed first.

Command:

```text
npm test -- tests/operations/cockpit-proxy-scripts.test.ts -t isolated
```

Observed after writing the tests and before creating the implementation:

```text
Test Files  1 failed (1)
Tests       6 failed | 26 skipped (32)
```

The success lifecycle failed with status `127` because `ops/cockpit-proxy/isolated-acceptance.sh` was absent; the browser-policy test failed with `ENOENT` for `playwright.proxy.config.ts`. The failure was the expected missing-feature RED, not a passing test or production/network mutation.

## GREEN evidence

Closure-review focused GREEN (Node 24 wrapper seam):

```text
AUTOPILOT_NODE_BIN=/tmp/autopilot-node24-test npx vitest run tests/operations/cockpit-proxy-scripts.test.ts \
  -t 'does not announce READY|keeps token|extra blank token line|NUL byte in token stdout'
Test Files  1 passed (1)
Tests       11 passed | 69 skipped (80)
```

Closure-review full operations GREEN:

```text
AUTOPILOT_NODE_BIN=/tmp/autopilot-node24-test npx vitest run tests/operations/cockpit-proxy-scripts.test.ts
Test Files  1 passed (1)
Tests       80 passed (80)
```

The closure tests mirror the real Control Plane contract: exact `{"ok":true}` liveness and nested
`components` readiness with `ready === true` plus all five core status/code pairs. Token-command
stdout is captured in a private file, checked bytewise before login, and multiple lines or NUL bytes
are rejected before any login request. Both the token command and Playwright runner are bounded;
Playwright is invoked through the already installed dependency with `npx --no-install`.

Third full-review regression GREEN:

```text
npm test -- tests/operations/cockpit-proxy-scripts.test.ts -t 'isolated|trusted host'
Test Files  1 passed (1)
Tests       49 passed | 25 skipped (74)
```

The ownership marker is now a mode-`0600` nonce ledger created before external resource mutation. One nft batch atomically creates the table, chain, and rule with matching nonce comments; both transient units expose the same nonce in `Description`. Cleanup performs a complete identity preflight and rechecks identity immediately before each mutation, refusing create races or later replacements. Socket/systemd/nft inspection errors fail closed. `/ready` must return HTTP 200 and valid JSON with all five core components ready. Every curl has explicit connect/total bounds, every OpenSSL call has a process timeout, and session tokens must match the server's `randomBytes(32).toString("base64url")` contract: exactly 43 base64url characters.

Second full-review regression GREEN:

```text
npm test -- tests/operations/cockpit-proxy-scripts.test.ts -t 'isolated|trusted host'
Test Files  1 passed (1)
Tests       33 passed | 25 skipped (58)
```

The runtime is now created atomically with `mkdir` beneath a canonical, non-symlinked, safely owned parent (sticky protection required when writable). Cleanup requires exact directory/marker ownership evidence unless acting on resources tracked by the same process, mutates only observed/started fixed resources, verifies their absence before deleting the runtime, and preserves evidence on incomplete cleanup. The session-cookie parser now validates an exact non-empty cookie pair and exactly one bare `Secure`, bare `HttpOnly`, and exact `SameSite=Lax` attribute.

Independent-review regression GREEN:

```text
npm test -- tests/operations/cockpit-proxy-scripts.test.ts -t 'isolated|trusted host'
Test Files  1 passed (1)
Tests       23 passed | 25 skipped (48)
```

The added regressions now cover strict single-certificate PEM input (including appended DER/arbitrary bytes and multiple-PEM rejection), both fixed transient-unit collisions before mutation, hostile curlrc/proxy/CA environment isolation, exactly one fully attributed session cookie, the complete CSP, static 405 lookalike behavior, and Referer-only CSRF rejection.

Focused isolated cycle after implementation:

```text
npm test -- tests/operations/cockpit-proxy-scripts.test.ts -t isolated
Test Files  1 passed (1)
Tests       13 passed | 27 skipped (40)
```

Final complete operations file after review hardening:

```text
AUTOPILOT_NODE_BIN=/tmp/autopilot-node24-test npm test -- tests/operations/cockpit-proxy-scripts.test.ts
Test Files  1 passed (1)
Tests       74 passed (74)
```

The temporary `AUTOPILOT_NODE_BIN` wrapper reports Node 24 for the pre-existing staging guard and delegates execution to the installed Node binary. The workstation has Node 18 only; no production runtime claim is made from that wrapper.

External browser test discovery:

```text
AUTOPILOT_PROXY_BASE_URL=https://autopilot.local:8443 \
AUTOPILOT_PROXY_TEST_TOKEN=isolated-test-token \
npx --no-install playwright test --config playwright.proxy.config.ts --list

Total: 1 test in 1 file
```

Additional verification:

```text
npm run typecheck
bash -n ops/cockpit-proxy/isolated-acceptance.sh ops/cockpit-proxy/host-acceptance.sh
git diff --check
```

All exited `0`.

## Latest closure review: content, identity, and hard timeouts

RED evidence was captured independently for each finding before its production change:

```text
candidate content: 1 failed | 80 skipped (same topology incorrectly reached READY)
post-start identity: 2 failed | 81 skipped (foreign unit and nft incorrectly reached READY)
hard timeout flags: 1 failed | 84 skipped (kill-after contract absent)
```

GREEN evidence after the bounded fixes:

```text
focused closure regressions: 7 passed | 80 skipped
Tests 7 passed (candidate mapping, early/late unit+nft identity, hard timeout behavior)
full operations after late-checkpoint expansion: 87 passed
Tests 87 passed (87)
```

Candidate files are compared to the staged manifest with the same sorted, NUL-safe `sha256sum`
mapping used by staging. Resource identity is checked after startup and immediately before READY,
including active units and exact nft chain/rule semantics. All timeout wrappers use TERM plus a
bounded KILL escalation; TERM-ignoring token and Playwright children are exercised behaviorally.

Final verification commands all exited `0`:

```text
AUTOPILOT_NODE_BIN=/tmp/autopilot-node24-test npx vitest run tests/operations/cockpit-proxy-scripts.test.ts
Test Files  1 passed (1)
Tests       87 passed (87)

npm run typecheck
bash -n ops/cockpit-proxy/isolated-acceptance.sh ops/cockpit-proxy/host-acceptance.sh
AUTOPILOT_PROXY_BASE_URL=https://autopilot.local:8443 AUTOPILOT_PROXY_TEST_TOKEN=isolated-test-token \
  npx --no-install playwright test --config playwright.proxy.config.ts --list
Total: 1 test in 1 file

git diff --check
```

The Node wrapper is the already documented local staging-test seam: it reports Node 24 only for
the staging runtime guard and delegates actual execution to the installed Node binary. No runtime,
VM, service, nftables, provider, or production state was touched.

## Self-review

- Cleanup is installed before the first runtime mutation, exercised after Caddy validation failure, Control Plane startup failure, proxy startup failure, CA contamination, and `TERM`, and disabled only after complete success evidence. `INT`/`TERM` handlers clean and terminate with nonzero signal status.
- Success intentionally leaves both transient units, the isolated table, and runtime available until explicit cleanup. Cleanup stops only the two named transient units that were started or are observed under valid ownership evidence, deletes only `inet autopilot_cockpit_isolated`, verifies units/listeners/table are absent, and removes the runtime only after complete verification. Missing or malicious ownership evidence never authorizes mutation; incomplete cleanup preserves the runtime and marker for recovery.
- The runtime directory is atomically created with fail-on-existence `mkdir`; its canonical parent must be non-symlinked, correctly owned, and either non-writable by peers or sticky-protected. Directory and marker owner/mode are verified before any contained setup, closing the former `/tmp` check/install race.
- Pre-existing `8443`, `8877`, or the named table fail before mutation. An unowned cleanup path is refused.
- The fixed token is written only to a `0600` environment file. Behavioral tests prove it is absent from stdout/stderr and command logs. The host token command is bounded to 30 seconds; stderr and raw stdout are captured privately, stdout must be exactly one non-empty line (with an optional final newline), and invalid raw output is refused before login. The token is not placed in curl arguments.
- Caddy's private PKI remains under its `0700` data directory. The public export requires a regular, non-symlink file containing exactly one certificate PEM object and whitespace only outside it; OpenSSL parses and re-emits that certificate instead of copying source bytes. Only the public path and SHA-256 fingerprint are printed.
- Neither acceptance script uses an insecure TLS flag; the browser explicitly refuses HTTP errors and captures no trace, video, or screenshot. Its process is bounded to 120 seconds and `npx --no-install` prevents dependency installation during acceptance.
- Isolated routing matches the review-approved Task 1 exact API roots; liveness/readiness remain loopback checks rather than accidentally becoming public proxy roots.
- A supplemental read-only self-review initially found signal continuation, cleanup status propagation, and private-key-contaminated export gaps. All three were fixed with regressions; the scoped re-review reported no remaining issue. The parent will still perform the independent root-level review.

## Deferred evidence / concerns

- Real privileged systemd/nftables/Caddy lifecycle, trusted Victus CA installation, and a real browser run require the isolated VM/host workflow in Task 6. This task used temporary roots and boundary stubs only, as required.
- The current workstation provides Node 18 although the repository requires Node 24. TypeScript, Vitest, and Playwright discovery passed locally; exact Node 24 runtime verification remains part of the VM gate.
- Repository Decision Mesh MCP routing tools were not exposed in this sub-agent session. Work stayed within the parent-provided bounded brief and directly necessary files; no mesh or work-log mutation was made.
