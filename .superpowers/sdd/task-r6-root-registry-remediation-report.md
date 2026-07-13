# R6 root and registry remediation report

## Result

- Commit: the commit containing this report (`fix: secure project registry execution`).
- Every exported project resolution/execution path now resolves the configured canonical root when callers omit options; omission no longer disables containment.
- The orchestrator captures one validated root at construction, and direct no-option orchestrator plus HTTP fallback regressions prove out-of-root entries cannot create or dispatch runs.
- Registry reads use one descriptor, `O_NOFOLLOW` on supported non-Windows hosts, regular-file validation, a 128 KiB + 1 bounded read, before/after descriptor metadata checks, final path identity checks, fatal UTF-8 decoding, and explicit BOM rejection.
- Existing initialization directories are validated as private on POSIX, and replacement registry files are created explicitly as `0600` before atomic rename.

## TDD evidence

- RED: focused regressions initially produced 9 expected failures for omitted-root execution, server fallback, unsafe file types, concurrent growth/replacement, private permissions, and replacement-file mode. Two fixture setup errors were corrected before implementation.
- GREEN: `npm test -- tests/delivery-system/project-registry.test.ts tests/delivery-system/run-store.test.ts tests/delivery-system/run-orchestrator.test.ts tests/scripts/control-plane-server.test.ts tests/scripts/project-registry-init.test.ts tests/scripts/smoke-cockpit-run.test.ts` passed 6 files and 133/133 tests.
- `npm run typecheck`, `npm run beta:vendor-check`, and `git diff --check` passed with the required Node 24 PATH.

## Security and portability coverage

- Symlink and concurrent path-replacement tests are POSIX-gated; `O_NOFOLLOW` is used on the frozen Ubuntu path and omitted on Windows.
- Non-regular-file rejection and bounded growth tests do not block or depend on FIFOs.
- Stable errors distinguish invalid registries, insecure managed-directory permissions, missing/out-of-root projects, invalid roots, and unexpected registry I/O without exposing filesystem details.

## Governance and coordination

- Used the local read-only Decision Mesh routing sequence and the `autopilot-control-plane` project packet; no task-specific stop condition was active.
- `supervisor_execution_loop` was activated for the changed registry/orchestrator files. `mesh/related-files-snapshot.json` was regenerated and `npm run mesh:gate:ci` passed with zero stale or unsnapshotted pointers.
- No mesh topology or architecture decision changed; the snapshot records content drift for the already-governed execution boundary.
- Per coordination, `vendor-manifest.json` was neither regenerated nor committed. OpenRouter migration files were not edited by this task.
- No live service, provider, connector, or remote mutation was performed.

## Files

- `src/data/delivery-system/projectRegistry.ts`
- `src/data/delivery-system/runOrchestrator.ts`
- `tests/delivery-system/project-registry.test.ts`
- `tests/delivery-system/run-store.test.ts`
- `tests/delivery-system/run-orchestrator.test.ts`
- `tests/scripts/control-plane-server.test.ts`
- `tests/scripts/project-registry-init.test.ts`
- `mesh/related-files-snapshot.json`
