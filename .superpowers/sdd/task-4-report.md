# Task 4 Report: Managed OpenRouter Ledger Migration

Status: complete

## Commit

- `fix: keep OpenRouter ledgers in managed state` (the commit containing this report)

## Delivered

- Active OpenRouter attempt and spend paths now resolve directly under `stateDir`.
- `ensureOpenRouterLedgersMigrated(stateDir)` validates legacy files from exactly `dirname(stateDir)` and managed files before publishing either missing destination.
- Migration enforces 4 MiB and 20,000 non-empty-record bounds per ledger.
- Every non-empty record must be valid ledger-specific v1 JSONL.
- Symlinks, non-regular files, concurrent source changes, malformed records, conflicting bytes, and unsafe publication fail closed.
- Publication uses an exclusive same-directory `0600` temporary file, file and directory fsync, byte-count plus SHA-256 verification, and an atomic hard link that cannot replace an existing destination.
- Legacy source files are retained indefinitely.
- Partial migration is retry-safe, including a destination created concurrently with matching bytes.
- `runCliWorker()` invokes migration before OpenRouter spend checks, attempt accounting, or provider fetch.
- Observability, project architecture, work-log evidence, project Decision Mesh routing, the mesh related-file snapshot, and vendor provenance were updated.

## TDD Evidence

Red:

- `npm test -- tests/delivery-system/openrouter-ledger-migration.test.ts tests/delivery-system/openrouter-stage1.test.ts tests/delivery-system/openrouter-spend-cap.test.ts`
- Result: failed because `../../src/data/delivery-system/openRouterLedgerMigration` did not exist; the 24 pre-existing tests passed.

Green and final verification under Node 24 (`PATH=/home/radek/.npm/_npx/387698761821791d/node_modules/node/bin:$PATH`):

- `npm test -- tests/delivery-system/openrouter-ledger-migration.test.ts tests/delivery-system/openrouter-stage0.test.ts tests/delivery-system/openrouter-stage1.test.ts tests/delivery-system/openrouter-spend-cap.test.ts`
  - PASS: 4 files, 43 tests.
- `npm test -- tests/decision-mesh/query.test.ts tests/delivery-system/observability.test.ts`
  - PASS: 2 files, 38 tests.
- `npm run typecheck`
  - PASS: TypeScript no-emit check exited 0.
- `npm run beta:vendor-manifest`
  - PASS: regenerated 125 entries at base `599785fb710c`.
- `npm run beta:vendor-check`
  - PASS: 79 pristine and 46 intentional patched vendored files.
- `npm run mesh:snapshot:regen`
  - PASS: regenerated 60 related-file hint hashes after adding root-mesh coverage for the new sensitive source file.
- `npm run mesh:gate:ci`
  - PASS: 99 verified, 0 stale, 0 unsnapshotted, and 0 new dead pointers.
- `git diff --cached --check`
  - PASS: no whitespace errors.

No live OpenRouter or other provider API call was made. Provider behavior was exercised only through injected Vitest fetch mocks.

## Self-Review

- Checked every frozen decision against implementation and tests: managed and exact legacy paths, both per-file bounds, strict v1 records, unsafe-file rejection, conflict rejection, no overwrite, fsync/hash/byte checks, source retention, partial retry, and pre-provider ordering are covered.
- Confirmed migration validates all existing inputs before first publication, preventing a malformed second ledger from creating a new partial migration.
- Confirmed the source read itself is capped at 4 MiB plus one byte, including concurrent growth, rather than relying only on an initial file-size check.
- Confirmed final destinations are never replaced: atomic link returns `EEXIST`, after which matching content is accepted and conflicting content fails.
- Confirmed temporary files are created and published in the managed destination directory so atomic same-filesystem publication is guaranteed.
- At the initial R4 commit, before review remediation, the change remained within the plan's review-size ceiling (677 inserted lines across implementation, tests, and governance; 304-line migration module). These are pre-remediation figures, not final cumulative values.
- No self-approval is claimed; independent review remains the parent/governance agent's responsibility.

## Concerns

- The atomic publication strategy intentionally depends on hard-link support in the managed state filesystem. This is appropriate for the frozen Ubuntu runtime and guarantees no overwrite; a future non-POSIX runtime would need an equivalent atomic no-replace primitive.
- Legacy archival remains deliberately out of scope. Operators must keep legacy files until a separately approved archival procedure exists.
- The repository-wide test suite was not run; this task ran the exact focused, adjacent observability/mesh, typecheck, vendor, mesh, and diff gates required by the Task 4 brief.

## 2026-07-13 Review Fixes

Status: complete

Resolved findings:

- Ledger bytes now pass through `TextDecoder("utf-8", { fatal: true })` before line splitting or JSON parsing. Any invalid UTF-8 fails closed as `openrouter_ledger_migration_malformed`.
- Added a raw-buffer regression with invalid UTF-8 inside the required `model` string. The test verifies no managed ledger is published and the OpenRouter fetch mock is never called.
- Moved `src/data/delivery-system/openRouterLedgerMigration.ts` from the false canonical `files` entry to `beta_authored`; regenerated provenance now contains 124 canonical entries.
- Added a provenance regression asserting the source is present in `beta_authored` and absent from canonical `files`.
- Kept architecture `Last updated: 2026-07-13` and corrected `Next review` to `2026-07-20`.

TDD red evidence under Node 24:

- `npm test -- tests/delivery-system/openrouter-ledger-migration.test.ts`
  - FAIL as expected: 2 failed, 15 passed.
  - Invalid UTF-8 reached the fetch mock and produced `TypeError: Cannot read properties of undefined (reading 'ok')` instead of the bounded migration error.
  - Provenance did not contain the migration source in `beta_authored`.

Final verification under Node 24 (`PATH=/home/radek/.npm/_npx/387698761821791d/node_modules/node/bin:$PATH`):

- `npm run beta:vendor-manifest`
  - PASS: regenerated 124 canonical entries at base `599785fb710c`.
- `npm test -- tests/delivery-system/openrouter-ledger-migration.test.ts tests/delivery-system/openrouter-stage0.test.ts tests/delivery-system/openrouter-stage1.test.ts tests/delivery-system/openrouter-spend-cap.test.ts`
  - PASS: 4 files, 45 tests.
- `npm test -- tests/decision-mesh/query.test.ts tests/delivery-system/observability.test.ts`
  - PASS: 2 files, 38 tests.
- `npm run typecheck`
  - PASS: TypeScript no-emit check exited 0.
- `npm run beta:vendor-check`
  - PASS: migration source reported `AUTHORED`; 78 pristine and 46 intentional patched canonical files.
- `npm run mesh:snapshot:regen`
  - PASS: regenerated 60 related-file hint hashes after the migration source changed.
- `npm run mesh:gate:ci`
  - PASS: 99 verified, 0 stale, 0 unsnapshotted, and 0 new dead pointers.
- `git diff --check`
  - PASS: no whitespace errors.

No live provider API call was made. All provider-path assertions used injected Vitest fetch mocks.

Review-fix self-review:

- Fatal decoding happens before line counting and JSON parsing, so replacement characters can no longer normalize invalid ledger bytes into accepted required strings.
- Invalid bytes retain the existing bounded fail-closed error contract and are rejected before any publication or provider activity.
- Regeneration, the provenance regression, and vendor-check output independently confirm the new source is beta-authored rather than falsely attributed to the pinned canonical revision.

Remaining concerns are unchanged: hard-link publication targets the frozen Ubuntu runtime, legacy archival is intentionally out of scope, and independent governance review remains required.

## 2026-07-13 Final BOM Review Fix

Status: complete

Resolution:

- Added an explicit raw-byte rejection for a leading UTF-8 BOM (`EF BB BF`) before `TextDecoder` or JSON parsing.
- Added raw-buffer regressions for both attempt and spend ledgers; each requires `openrouter_ledger_migration_malformed` and no managed publication.
- Added an OpenRouter worker regression proving a BOM-prefixed attempt ledger prevents both attempt append and provider fetch.
- Final source sizes after review remediation are 316 lines for `openRouterLedgerMigration.ts` and 317 lines for `openrouter-ledger-migration.test.ts`.
- The initial 677-line aggregate statement above is explicitly labeled pre-remediation and is not presented as a final cumulative diff.

TDD red evidence under Node 24:

- `npm test -- tests/delivery-system/openrouter-ledger-migration.test.ts`
  - FAIL as expected: 3 failed, 17 passed.
  - Both attempt and spend BOM buffers migrated instead of throwing.
  - The worker reached the fetch mock and returned the mock-shape `TypeError` instead of the bounded migration error.

Final verification under Node 24 (`PATH=/home/radek/.npm/_npx/387698761821791d/node_modules/node/bin:$PATH`):

- `npm run beta:vendor-manifest`
  - PASS: regenerated 124 canonical entries at base `599785fb710c`.
- `npm run mesh:snapshot:regen`
  - PASS: regenerated 60 related-file hint hashes after the migration source changed.
- `npm test -- tests/delivery-system/openrouter-ledger-migration.test.ts tests/delivery-system/openrouter-stage0.test.ts tests/delivery-system/openrouter-stage1.test.ts tests/delivery-system/openrouter-spend-cap.test.ts`
  - PASS: 4 files, 48 tests.
- `npm test -- tests/decision-mesh/query.test.ts tests/delivery-system/observability.test.ts`
  - PASS: 2 files, 38 tests.
- `npm run typecheck`
  - PASS: TypeScript no-emit check exited 0.
- `npm run beta:vendor-check`
  - PASS: migration source reported `AUTHORED`; 78 pristine and 46 intentional patched canonical files.
- `npm run mesh:gate:ci`
  - PASS: 99 verified, 0 stale, 0 unsnapshotted, and 0 new dead pointers.
- `git diff --check`
  - PASS: no whitespace errors.

No live provider API call was made. All provider-path assertions used injected Vitest fetch mocks.

Remaining concerns are unchanged: same-directory hard-link publication targets the frozen Ubuntu runtime, legacy archival is intentionally out of scope, and independent governance review remains required.
