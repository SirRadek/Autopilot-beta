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
- Confirmed the implementation remains within the plan's review-size ceiling (677 inserted lines across implementation, tests, and governance; 304-line migration module).
- No self-approval is claimed; independent review remains the parent/governance agent's responsibility.

## Concerns

- The atomic publication strategy intentionally depends on hard-link support in the managed state filesystem. This is appropriate for the frozen Ubuntu runtime and guarantees no overwrite; a future non-POSIX runtime would need an equivalent atomic no-replace primitive.
- Legacy archival remains deliberately out of scope. Operators must keep legacy files until a separately approved archival procedure exists.
- The repository-wide test suite was not run; this task ran the exact focused, adjacent observability/mesh, typecheck, vendor, mesh, and diff gates required by the Task 4 brief.
