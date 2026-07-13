# C1 Filesystem Remediation Report

## Status

DONE

## Commit

- The commit containing this report: `fix: harden readiness state reads`.

## Scope

Remediated C1 review findings 1 and 2 plus the filesystem foundation from minor finding 5 only. Supervisor-task and token-gateway semantic invariant predicates were not changed; later remediation remains responsible for strengthening those schemas.

## Root cause

- Supervisor, token-gateway, and provider-quota state readers used `existsSync` followed by pathname-based `statSync`/`readFileSync`.
- Those reads could follow symlinks, block on FIFOs, race path replacement or growth, and lacked one reusable descriptor-bound byte/encoding contract.
- Readiness did not require normalized canonical private R/W/X directories for both managed state and the project root.
- `existsSync` treated a dangling `projects.json` symlink as missing rather than malformed.

## Implementation

- Added beta-private `readManagedStateTextFile(path, { maxBytes })` with:
  - explicit `missing` versus `present` result;
  - a single read descriptor;
  - POSIX `O_NOFOLLOW | O_NONBLOCK` and a Windows-compatible flags fallback;
  - pre-open `lstat`, descriptor `fstat`, regular-file checks, and hard caps;
  - one `maxBytes + 1` bounded buffer;
  - before/after device, inode, mode, size, mtime, and ctime stability checks;
  - final pathname identity/metadata comparison;
  - fatal UTF-8 decoding and BOM rejection;
  - fixed `invalid_managed_state_file` and `managed_state_file_io_error` errors with no path or OS exception text.
- Adopted the reader in supervisor state, token-gateway state, and provider-quota snapshot loading while preserving their existing missing-file defaults and existing public error codes.
- Readiness now requires normalized configured paths, canonical non-symlink directories, private POSIX permissions, and R/W/X access for managed state and project root.
- A dangling registry symlink is classified as `invalid_project_registry`, never `project_registry_missing`.

## TDD evidence

All Node commands used Node `v24.18.0` through `PATH=/home/radek/.npm/_npx/387698761821791d/node_modules/node/bin:$PATH`.

1. RED:
   - `npm test -- tests/delivery-system/managed-state-file.test.ts tests/delivery-system/readiness.test.ts`
   - The helper suite failed because `managedStateFile.ts` did not exist.
   - Readiness produced four expected failures for safe reader adoption, non-normalized `stateDir`, symlinked roots, and dangling-registry classification.
2. GREEN:
   - The focused helper/readiness suite passed 2 files and 18 tests.
3. Adjacent GREEN:
   - Supervisor queue, token gateway, provider quota store, and project registry were added; 6 files and 66 tests passed with typecheck.

## Final verification

- Affected matrix:
  - `npm test -- tests/delivery-system/managed-state-file.test.ts tests/delivery-system/readiness.test.ts tests/delivery-system/supervisor-queue.test.ts tests/delivery-system/token-gateway.test.ts tests/delivery-system/provider-quota-store.test.ts tests/delivery-system/provider-quota-scheduler.test.ts tests/delivery-system/project-registry.test.ts`
  - PASS: 7 files, 75 tests.
- `npm run typecheck`
  - PASS.
- `npm run beta:vendor-manifest`
  - PASS: 124 canonical entries; `managedStateFile.ts` recorded as beta-authored.
- `npm run beta:vendor-check`
  - PASS: 78 pristine and 46 intentional patched vendored files.
- `npm run mesh:snapshot:regen`
  - PASS: 64 related-file hints hashed.
- `npm run mesh:gate:ci`
  - PASS: 103 verified, 0 stale, 0 unsnapshotted, and 0 new dead pointers.
- Changed-file Decision Mesh audit
  - PASS: every changed delivery-system source is governed by the existing `supervisor_execution_loop`; no ungoverned sensitive source remains.
- `git diff --check`
  - PASS.

## Regression coverage

- missing versus present file;
- hard byte cap and bounded read allocation;
- BOM and invalid UTF-8;
- file symlink and character device;
- POSIX FIFO in a child process with a two-second hard timeout;
- deterministic concurrent growth and pathname replacement during descriptor read;
- all three readiness/load adopters refusing symlinked valid state;
- non-normalized managed-state path;
- read-only/insecure managed state and insecure project-root permissions;
- symlinked state/project roots;
- dangling registry symlink classification.

## Safety and boundaries

- The helper is read-only and performs no creation, mutation, recovery, provider call, or service action.
- Existing supervisor/token semantic invariant functions were not modified.
- Existing provider snapshot schema sanitization was not strengthened or weakened.
- No live provider, API, connector, service, VM, deployment, or remote mutation was performed.

## Governance

- Added the shared reader and provider quota store to the existing `supervisor_execution_loop` related-file ownership. No mesh topology, runtime authority, or source-of-truth boundary changed.
- Vendor and mesh snapshots were regenerated after final source changes.

## Files

- `src/data/delivery-system/managedStateFile.ts`
- `src/data/delivery-system/readiness.ts`
- `src/data/delivery-system/supervisorQueue.ts`
- `src/data/delivery-system/tokenGateway.ts`
- `src/data/delivery-system/providerQuotaStore.ts`
- `tests/delivery-system/managed-state-file.test.ts`
- `tests/delivery-system/readiness.test.ts`
- `vendor-manifest.json`
- `mesh/nodes/supervisor_execution_loop.yaml`
- `mesh/related-files-snapshot.json`
- `.superpowers/sdd/task-c1-filesystem-remediation-report.md`

## Concerns

None.
