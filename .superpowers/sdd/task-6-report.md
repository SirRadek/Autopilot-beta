# Task 6 Report: Runtime-path Plan Review Gate

## Status

DONE for the deterministic R6 gate after all three review-remediation commits. The independent spec-compliance and code-quality reviews both passed with no remaining Critical or Important findings.

## Passing Commit

- `891e4bc176c840d787275f41fdc3aecad6f1338d` — `fix: prevent FIFO registry hangs`
- Commit date: `2026-07-13 15:26:27 +0200`
- The implementation worktree was clean at this commit before this uncommitted report replacement.

## Review Remediation Commits Included

- `ac83d74bbd5196bd591b8b7c3f095c49985ea3d8` — `fix: revalidate retained OpenRouter ledgers`. This adds post-publication source revalidation before attempt accounting or provider dispatch and extends the OpenRouter migration regressions.
- `2b1a8a08204d90b2e5235008249e492f97e1eee5` — `fix: secure project registry execution`. This hardens root containment and bounded registry I/O and extends registry, run-store, orchestrator, server, and initialization regressions.
- `891e4bc176c840d787275f41fdc3aecad6f1338d` — `fix: prevent FIFO registry hangs`. This validates registry files through nonblocking file-descriptor reads and adds the FIFO regression without changing systemd units.

## Runtime

Every Node/npm command used:

```bash
PATH=/home/radek/.npm/_npx/387698761821791d/node_modules/node/bin:$PATH
```

- Node: `v24.18.0`
- npm: `9.2.0`

## Complete Targeted Vitest Gate

One command covered every unique test file named by runtime-path Tasks 1–5:

```bash
npm test -- tests/decision-mesh/project-root.test.ts tests/delivery-system/routing-modes.test.ts tests/delivery-system/project-registry.test.ts tests/delivery-system/run-store.test.ts tests/delivery-system/run-orchestrator.test.ts tests/scripts/control-plane-server.test.ts tests/scripts/smoke-cockpit-run.test.ts tests/scripts/project-registry-init.test.ts tests/delivery-system/openrouter-ledger-migration.test.ts tests/delivery-system/openrouter-stage0.test.ts tests/delivery-system/openrouter-stage1.test.ts tests/delivery-system/openrouter-spend-cap.test.ts tests/operations/systemd-units.test.ts
```

Result: PASS, exit `0`; 13/13 files and 208/208 tests passed. Duration: 1.92 seconds. This includes all newly added remediation tests within the named files, including the FIFO regression.

The OpenRouter tests used injected Vitest fetch mocks. No live OpenRouter or other provider API was called.

## Type, Provenance, Governance, and Diff Gates

Commands:

```bash
npm run typecheck
npm run beta:vendor-check
npm run mesh:gate:ci
git diff --check
```

Results:

- `npm run typecheck`: PASS, exit `0` (`tsc -p tsconfig.json --noEmit`).
- `npm run beta:vendor-check`: PASS, exit `0`; 78 pristine and 46 intentional patched vendored files at base `599785fb710c`.
- `npm run mesh:gate:ci`: PASS, exit `0`; 128 total hints, 99 verified, 0 stale, 0 unsnapshotted, 0 new dead pointers, and 1 resolved pointer.
- `git diff --check`: PASS, exit `0` with the report as the only worktree modification.
- Decision Mesh MCP routing tools were not exposed in this session. The local mesh ratchet, approved plan, task reports, and progress ledger were used as bounded fallback evidence.

## Static systemd Verification

The FIFO remediation changed no systemd unit or operations README file (`git diff --name-only 2b1a8a0..891e4bc`). Per the final gate instruction, the isolated substitution was not repeated; the prior static evidence and deployment limitation below remain applicable.

Exact repository command:

```bash
systemd-analyze --user verify ops/systemd/*.service ops/systemd/*.timer
```

Result: exit `1` with only these host/deployment-path diagnostics:

```text
autopilot-control-plane-health.service: Command /home/radek/.local/bin/npm is not executable: No such file or directory
autopilot-control-plane.service: Command /home/radek/.local/bin/npm is not executable: No such file or directory
autopilot-state-maintenance.service: Command /home/radek/.local/bin/npm is not executable: No such file or directory
```

No syntax or dependency diagnostic was emitted. To separate unit validity from this host-only executable absence, an isolated temporary copy of all service/timer files replaced only `/home/radek/.local/bin/npm` with the host's `/usr/bin/npm`, then ran the same static verifier over that copy. Result: PASS, exit `0`, no diagnostics. The temporary directory was deleted. No live unit was installed, loaded, enabled, restarted, or changed.

## Review and Scope Assessment

- The approved runtime-path plan, Task 6 brief, Task 1–5 reports, and progress ledger were reviewed before execution.
- The existing Task 6 report described an unrelated cockpit-client task; it was replaced with this runtime-path gate report.
- No Critical deterministic gate failure was found, so no implementation file was edited.
- The independent spec-compliance review passed after remediation.
- The independent code-quality re-review passed after the FIFO remediation; no Critical or Important quality finding remains for R6.

## Limitations and Concerns

- Deployment npm proof remains outstanding: the target VM must provide executable `/home/radek/.local/bin/npm` (or the deployment unit contract must be intentionally revised in a later approved task). This host cannot make the exact static command exit `0` without substituting that deployment-only path.
- D3 isolated Ubuntu VM acceptance remains outstanding. It must prove positive writes beneath the configured project root and negative writes to the Autopilot installation and an unlisted home path after installing the reviewed units. Static verification is not a substitute.
- The progress ledger records a minor R5 test concern: the path-agreement helper inspects the first active `Environment=` assignment, while effective custom-root agreement also depends on `EnvironmentFile=` and the reviewed `ReadWritePaths` drop-in. The documentation covers that operator contract; D3 must verify the resolved runtime values.
- Legacy OpenRouter ledgers remain intentionally retained until a separately approved archival procedure exists.
- Hard-link no-replace publication targets the frozen Ubuntu/local-filesystem runtime. Unsupported filesystems fail closed.
- No deployment, live service mutation, provider call, or ignored progress-artifact edit occurred.
