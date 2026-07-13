# R6 OpenRouter Ledger Race Remediation Report

Status: complete

## Scope

Remediated only the integrated-review finding in managed OpenRouter ledger migration. Project registry and run-orchestrator files were not edited. The unrelated in-progress `.superpowers/sdd/task-6-report.md` change was preserved and excluded from this commit.

## Implementation

- Added a deterministic `afterPublication` migration hook used by the concurrency regression.
- After all atomic no-replace publications, migration reopens and strictly validates every retained legacy source before returning.
- Final source comparison requires unchanged device/inode identity, byte length, SHA-256, and exact bytes.
- A post-publication append now fails closed as `openrouter_ledger_migration_source_changed` before caller continuation can append the current managed attempt or fetch the provider.
- Managed snapshots already published before detection remain intact, legacy sources remain retained, and no destination is replaced or deleted.

## Operational Contract

D3 and live cutover must quiesce every legacy OpenRouter writer generation before enabling the new runtime. Operators must stop old units/processes and verify that none can append to the parent-directory legacy ledgers. The code's final revalidation narrows the race window but is not a shared lock or generation protocol with old writers; it cannot exclude an append after its final check.

This requirement is recorded in:

- `ops/systemd/README.md`
- `docs/projects/multi-agent-autonomous-delivery-system/work-log.md`
- `docs/projects/multi-agent-autonomous-delivery-system/decision-mesh/nodes/managed_provider_ledger_boundary.yaml`

## TDD Evidence

Red under Node 24:

- `npm test -- tests/delivery-system/openrouter-ledger-migration.test.ts`
- Expected result: FAIL, 1 failed and 20 passed.
- The post-publication hook was ignored, migration returned success, and the test's attempt/fetch continuation was reachable.

Green under Node 24:

- `npm test -- tests/delivery-system/openrouter-ledger-migration.test.ts`
- PASS: 1 file, 21 tests.
- `npm run typecheck`
- PASS.

## Final Verification

All commands used `PATH=/home/radek/.npm/_npx/387698761821791d/node_modules/node/bin:$PATH`:

- `npm test -- tests/delivery-system/openrouter-ledger-migration.test.ts tests/delivery-system/openrouter-stage0.test.ts tests/delivery-system/openrouter-stage1.test.ts tests/delivery-system/openrouter-spend-cap.test.ts`
  - PASS: 4 files, 49 tests.
- `npm test -- tests/decision-mesh/query.test.ts tests/delivery-system/observability.test.ts`
  - PASS: 2 files, 38 tests.
- `npm run typecheck`
  - PASS.
- `npm run mesh:snapshot:regen`
  - PASS: regenerated 60 related-file hint hashes.
- `npm run mesh:gate:ci`
  - PASS: 99 verified, 0 stale, 0 unsnapshotted, 0 new dead pointers.
- `git diff --check`
  - PASS.

No live API call was made.

## Vendor Gate Coordination

`npm run beta:vendor-manifest` and `npm run beta:vendor-check` were intentionally not run in this remediation turn because another remediation was editing the shared worktree. Per integration coordination, `vendor-manifest.json` is not changed or staged here; vendor-check is deferred until both commits are integrated.

## Self-Review And Concerns

- The deterministic hook confirms both managed ledgers exist before mutating the retained spend source, so the regression exercises the reviewed after-publication window rather than an earlier validation race.
- The regression verifies published bytes remain the original snapshot, the appended legacy evidence is retained, and attempt/fetch continuation spies remain uncalled.
- Replacing a legacy file with byte-identical content is still detected because source identity is compared in addition to size/hash/bytes.
- An append after final revalidation remains possible without a shared protocol. Cutover quiescence is therefore mandatory and explicitly documented.
- Independent governance review remains required; this report is implementation and verification evidence, not self-approval.
