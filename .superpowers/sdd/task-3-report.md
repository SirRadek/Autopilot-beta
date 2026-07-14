# Task 3 report: isolated acceptance and trusted host tests

## Status

Implementation complete for the bounded Task 3 repository slice. No VM, live service, production state, provider, cutover, or progress-ledger mutation was performed.

## Implemented

- Added `ops/cockpit-proxy/isolated-acceptance.sh` with exact-candidate release topology/checksum validation, free-port and named-table preflight, failure/signal cleanup registered before mutation, private isolated state/projects/environment, secure cookies, transient Control Plane and Caddy units, host-only nftables restriction, bounded readiness waits, public-only CA export/fingerprint, retained success lifecycle, ownership-marked idempotent `--cleanup`, and post-cleanup listener/table verification.
- Added `ops/cockpit-proxy/host-acceptance.sh` with approved HTTPS origins only, normal TLS chain verification plus `autopilot.local` SAN verification, security/cache header checks, static asset and SPA checks, every approved API route family plus lookalikes, unsupported-method refusal, private token capture, `0600` cookie jar, Secure/HttpOnly/SameSite cookie checks, same-origin acceptance, evil-origin rejection, logout verification, and artifact-free Playwright execution.
- Added `playwright.proxy.config.ts` with an externally supplied HTTPS base URL, `ignoreHTTPSErrors: false`, trace/video/screenshots disabled, and no web server.
- Added `tests/browser-proxy/cockpit-proxy.spec.ts` with real login, same-origin resource verification, and explicit logout.
- Added lifecycle/cleanup/refusal/secret-output/public-CA/trusted-host behavioral coverage and package scripts.

## RED evidence

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
Tests       40 passed (40)
```

The temporary `AUTOPILOT_NODE_BIN` wrapper reports Node 24 for the pre-existing staging guard and delegates execution to the installed Node binary. The workstation has Node 18 only; no production runtime claim is made from that wrapper.

External browser test discovery:

```text
AUTOPILOT_PROXY_BASE_URL=https://autopilot.local:8443 \
AUTOPILOT_PROXY_TEST_TOKEN=isolated-test-token \
npx playwright test --config playwright.proxy.config.ts --list

Total: 1 test in 1 file
```

Additional verification:

```text
npm run typecheck
bash -n ops/cockpit-proxy/isolated-acceptance.sh ops/cockpit-proxy/host-acceptance.sh
git diff --check
```

All exited `0`.

## Self-review

- Cleanup is installed before the first runtime mutation, exercised after Caddy validation failure, Control Plane startup failure, proxy startup failure, CA contamination, and `TERM`, and disabled only after complete success evidence. `INT`/`TERM` handlers clean and terminate with nonzero signal status.
- Success intentionally leaves both transient units, the isolated table, and runtime available until explicit cleanup. Cleanup stops only the two named transient units, deletes only `inet autopilot_cockpit_isolated`, removes only a marker-owned runtime, verifies `8443/8877` and the table are absent, and propagates verification failure.
- Pre-existing `8443`, `8877`, or the named table fail before mutation. An unowned cleanup path is refused.
- The fixed token is written only to a `0600` environment file. Behavioral tests prove it is absent from stdout/stderr and command logs. The host token command's stderr is captured privately, its stdout must be one non-empty line, and the token is not placed in curl arguments.
- Caddy's private PKI remains under its `0700` data directory. The public export requires a regular, non-symlink certificate file and rejects private-key PEM markers before and after the copy. Only the public path and SHA-256 fingerprint are printed.
- Neither acceptance script uses an insecure TLS flag; the browser explicitly refuses HTTP errors and captures no trace, video, or screenshot.
- Isolated routing matches the review-approved Task 1 exact API roots; liveness/readiness remain loopback checks rather than accidentally becoming public proxy roots.
- A supplemental read-only self-review initially found signal continuation, cleanup status propagation, and private-key-contaminated export gaps. All three were fixed with regressions; the scoped re-review reported no remaining issue. The parent will still perform the independent root-level review.

## Deferred evidence / concerns

- Real privileged systemd/nftables/Caddy lifecycle, trusted Victus CA installation, and a real browser run require the isolated VM/host workflow in Task 6. This task used temporary roots and boundary stubs only, as required.
- The current workstation provides Node 18 although the repository requires Node 24. TypeScript, Vitest, and Playwright discovery passed locally; exact Node 24 runtime verification remains part of the VM gate.
- Repository Decision Mesh MCP routing tools were not exposed in this sub-agent session. Work stayed within the parent-provided bounded brief and directly necessary files; no mesh or work-log mutation was made.
