# ADR - Phase 1 branch consolidation reconciliation

**Status:** Accepted, 2026-07-05.

## Context

`main` is not the most complete state. It lags three superset branches that each carry real, partially overlapping control-plane work: `claude/agitated-robinson-9e114f`, `claude/rebuild-2026-07-03`, and `claude/eloquent-chatterjee-0b6e41`.

The consolidation-first plan is the highest-leverage move because most missing fixes already exist on one of those branches. The risky conflicts are semantic, not just textual: ACK semantics, related-file coverage, project-mesh slug resolution, packet shape, verify-chain behavior, generated artifacts, and vendor-lane routing all have competing variants.

This ADR records the Phase 1 winners so Phase 2 merges resolve toward decided outcomes, not merge-time improvisation.

## Decision

1. **ACK mechanism: eloquent `Mesh-Ack:` commit-message trailer wins.** Use the node-grammar trailer as an auditable consent journal reviewed by the owner in history. It is not an enforcement gate: a committer can self-ack, so a present ACK is evidence of declared consent, not proof of prevention. Drop the `a1bee39`/`ed35865` env-var/rule-id ACK path and any `AUTOPILOT_ACK_BLOCKERS` bypass.

2. **`hintCovers`: eloquent shared normalizer wins.** Use `normalizeRelatedFileHint` from `related-file-hints.ts` in both the related-files ratchet and the changed-files gate so the two bind-points share coverage semantics. Phase 3 will extend normalization for separators, case, `./`, `..`, trailing dots, and canonical snapshot keys.

3. **`load.ts` project-mesh slug semantics are a union.** Keep main's `5a5f048` slug-specific precedence and agitated's `585726c` sibling project-root binding. Slug-specific repo-local mesh wins first; sibling project roots remain supported.

4. **`query.ts` return shape is a union.** Eloquent's compact public subgraph nodes, `{ id, name, score }`, are acceptable for MCP/read-only consumers. Packet builders must also keep agitated's ceiling-based blocker retention so token-budget truncation cannot hide a relevant blocker. Update MCP schemas and tests with the shape change.

5. **`verify` includes both validators, but not mutating mesh generation.** Keep rebuild's `model-output:validate` and eloquent's `promptlib:validate` in the verify chain. Keep `mesh:generate` manual, or add a non-mutating `--check` mode before putting it in verify. Never run a mutating generated-artifact step inside `npm run verify`.

6. **OpenRouter lane and vendor-routing v2 catalogs merge inert.** Keep the OpenRouter free-worker lane and tier catalogs as explicit, guarded, non-default surfaces. No automatic provider routing, fallback, paid spillover, or OpenRouter-as-default behavior activates until separately approved after tiered evals.

**Drop list:** env-var/rule-id ACKs; `AUTOPILOT_ACK_BLOCKERS`; mutating `mesh:generate` inside `verify`; OpenRouter or vendor-routing as an automatic default/fallback.

## Merge plan

Create one integration branch off `main`. Merge exactly one branch per step, and require `npm run verify` green between steps:

1. Merge `claude/agitated-robinson-9e114f`.
2. Merge `claude/rebuild-2026-07-03`.
3. Merge `claude/eloquent-chatterjee-0b6e41`.

Generated files are derived state. Never hand-merge `mesh/generated/decision-mesh.json`, `mesh/*-snapshot.json`, or `vendor-manifest.json`; regenerate them from source after each step.

**Landmine: `cliWorker.ts` and `cliWorkerCapture.ts`.** These files are triple-touched by behavioral concerns: agitated's attempts telemetry and agy sandboxing, eloquent's `codexMode`/`taskPacketRef`, and eloquent's OpenRouter config. A clean-looking conflict resolve can silently drop agitated's `attempt_count` telemetry and agy `--sandbox` default while preserving newer modes. After resolving either file, re-verify:

- `attempt_count` telemetry is present.
- agy defaults to `--sandbox`.
- `codex_implement` requires `taskPacketRef`.
- OpenRouter requires `openrouterMode` and `taskPacketRef`.
- OpenRouter access-tier rejects `cwd`, `addDirs`, and `images`.
- codex retry predicate and its test remain present.

| File or surface | Conflict type | Decided winner |
|---|---|---|
| `scripts/git-hooks/commit-msg`, `scripts/git-hooks/pre-commit`, `scripts/git-hooks/install.mjs`, `src/lib/mesh-tools/changed-files-capabilities-cli.ts` | SEMANTIC | Eloquent `Mesh-Ack:` trailer consent journal. Drop env-var/rule-id ACKs and `AUTOPILOT_ACK_BLOCKERS`. |
| `src/lib/mesh-tools/related-file-hints.ts`, `related-files-status.ts`, `changed-files-capabilities.ts` | SEMANTIC | Eloquent shared `normalizeRelatedFileHint`, used by both ratchet and changed-files gate. |
| `src/lib/decision-mesh/load.ts` | SEMANTIC | Union: main slug precedence plus agitated sibling project-root binding. |
| `src/lib/decision-mesh/query.ts`, `mcp/server.ts`, `tests/decision-mesh/query.test.ts` | SEMANTIC | Union: compact `{ id, name, score }` public subgraph plus ceiling-based blocker retention for packets; schemas and tests move together. |
| `package.json`, `scripts/validate-model-output-evals.ts`, `scripts/validate-prompt-library.ts`, `scripts/generate-decision-mesh.ts` | TEXTUAL + SEMANTIC | `verify` includes `model-output:validate` and `promptlib:validate`; `mesh:generate` stays manual or becomes check-only before verify use. |
| `.github/workflows/verify.yml`, `scripts/git-hooks/pre-push` | TEXTUAL | Take agitated CI and pre-push test-suite coverage; branch protection remains an owner/out-of-repo requirement. |
| `src/data/delivery-system/cliWorker.ts`, `src/data/delivery-system/cliWorkerCapture.ts` | SEMANTIC | Union all guarded behavior: attempts telemetry, agy `--sandbox`, codex task-packet guard, OpenRouter mode/task-packet guard, access-tier rejects, retry predicate/test. |
| `src/data/delivery-system/modelPolicy.ts`, `src/data/delivery-system/routingGuards.ts`, OpenRouter policy/client tests | SEMANTIC | Merge v2/OpenRouter catalogs as inert policy and guarded worker surfaces; no auto-routing or fallback activation. |
| `mesh/generated/decision-mesh.json`, `mesh/*-snapshot.json`, `vendor-manifest.json` | TEXTUAL generated state | Do not hand-merge. Regenerate from source after each merge step. |

## Consequences

The Phase 2 merge sequence becomes reviewable: each conflict has a declared target, and generated hashes stop masquerading as hand-authored decisions.

The hard part remains verification discipline. The ACK trailer improves auditability but does not prevent self-approval. `cliWorker*` resolution must be checked behaviorally, not just by a clean diff. Generated files must be regenerated from current source after each merge.

Deferred work stays deferred: deeper path normalization, directory-hint STALE coverage, governed-core hardening, attempts aggregation, validator teeth/tests, raw-prompt TTL, routing-mode activation, and any automatic provider routing require later phases and separate approval where called out by the plan.
