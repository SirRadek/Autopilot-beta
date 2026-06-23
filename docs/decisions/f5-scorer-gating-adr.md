# F5 ADR — integrity→error + scorer gating (default-OFF behavior change)

**Status:** ✅ DESIGN ACCEPTED 2026-06-23 (Opus architect). Implementation next.
**Design author:** real `codex_cli` tech-opponent (hp-20260623-beta-f5-design, exit 0, 342 s), reviewed +
decided by Opus. agy MISSING. F5 is core scorer/worker logic — designed WITH Codex per doctrine.

## NON-NEGOTIABLE: default path byte-identical
With `PDOS_ENFORCE_ALLOWED_PATTERNS` unset (or ≠ `1`/`true`), `scoreProductDesignOs` output is IDENTICAL
to today — the 7 `tests/fixtures/score-baseline/` fixtures stay byte-for-byte. The behavior change exists
ONLY behind the flag. This is a CONSCIOUS owner-gated change, NOT "nulová změna".

## Accepted design

### F5a — registry integrity → ERROR (validate.ts, +F5)
Promote ONLY `validateGhostPatterns` from warning to error: pass `errors`, push a message prefixed
`PDOS_GHOST_PATTERN:` with no `code` (matching the `PDOS_SPEC_*` error convention). 0 ghosts today →
**0 errors** (baseline 0/0 preserved; the `PDOS_GHOST_PATTERN` warning code simply disappears). Do NOT
promote `validateEmptyTokens`/`validateAssetRefTagMix` (separate concerns) — F5 enforcement depends
specifically on `allowed_pattern_ids` being a sound pattern-eligibility registry.

### F5b — shadow diff (score.ts, +F5; separate, report-only)
Add exported `computeAllowedPatternShadowDiff(input, repoRoot)` → `{ recipe_id, allowed_pattern_ids,
current_selected, gated_selected, added, removed }` (all pattern-id arrays; `gated_selected` = ranked
patterns filtered by the top recipe's allowed ids, sliced to `limit`). Computed with enforcement forced
OFF. **NOT** added to `PdosScoreReport`/`formatPdosScoreReport` (else fixtures break). Surfaced via a new
`--shadow-allowed-patterns` CLI mode that prints only this diff JSON. No package script (minimal surface).

### F5c — flagged enforcement (score.ts, +F5; default-OFF)
Shared internal gate (`applyAllowedPatternGate`) used by BOTH the shadow diff and enforcement (no dup).
`scoreProductDesignOs` reads `process.env.PDOS_ENFORCE_ALLOWED_PATTERNS` **at call time** (NOT module
load — so tests toggle/restore per test); truthy = trimmed case-insensitive `"1"`/`"true"`. Flag unset →
return existing slices EXACTLY. Flag set → ONLY `selected.patterns`/`rejected.patterns` change:
`selected.patterns` = top allowed ranked patterns up to `limit`; `rejected.patterns` = every non-selected
ranked pattern in score/id order; pattern `selected` booleans recomputed (only the first gated selected =
true, all rejected = false). Recipes, assets, route, scores, reasons, penalties, formula, warnings,
markdown unchanged.

## Gating semantics (decided)
**Exclusion, not penalty** — `allowed_pattern_ids` is an eligibility contract, not another score factor.
Gating recipe = **top-scored** `scoredRecipes[0]` (matches how `scorePattern` already references the top
recipe), NOT `route.selected_recipe`. Edge cases: no scored recipe → do NOT gate (`gated_selected =
current_selected`); empty allowed list → selects no patterns (committed recipes can't hit this —
`validateRecipes` requires non-empty `allowed_pattern_ids`); `input.patterns` supplied → gate only that
candidate set; apply `limit` AFTER filtering; preserve `rankItems` score/id order.

## Opus decisions on open items
- Shadow surface: `--shadow-allowed-patterns` CLI only (no `pdos:score-shadow` package script).
- `recipe.schema` `minItems:1` on `allowed_pattern_ids`: DEFER (validateRecipes already enforces non-empty).
- Excluded-pattern annotation under the flag: NONE — bucket-only behavior change.

## Baseline impact
`pdos:validate` stays **0 errors / 0 warnings** (F5a: 0 ghosts). `scoreProductDesignOs` default output
**byte-identical** → 7 fixtures unchanged, all existing tests green. Flag-ON changes pattern bucket
membership only (a local sim shows several inputs would change — hence default-OFF is mandatory).
validate.ts + score.ts `patched_by += F5`; new test is under tests/ (not vendored).

## Risks (accepted, from Codex)
Per-call env read (not module-load) to avoid test flakiness. Exclusion can put high-scoring disallowed
patterns in `rejected` with higher scores than `selected` — correct for exclusion; recompute `selected`
booleans so no disallowed pattern stays `selected:true`. Keep the default branch mechanically identical.
`input.recipes`/`input.patterns` bypass validation → empty/stale allowed lists possible under the flag.

```
buildSubagentTree:
└─ cli-codex-hp-20260623-beta-f5-design  agent_type: codex_cli-external  exit: 0  342 s
```

---

# F5 IMPLEMENTED — record (2026-06-23)

Built per this ADR by real `codex_cli` (write-mode); Opus reviewed the `score.ts` diff (default branch
mechanically unchanged) + gated.
- **F5a** `validate.ts`: `validateGhostPatterns` now pushes ERRORS (`PDOS_GHOST_PATTERN:` in message, no
  code). 0 ghosts → 0 errors.
- **F5b** `score.ts`: exported `computeAllowedPatternShadowDiff` + `PdosAllowedPatternShadowDiff`
  (separate; NOT in `PdosScoreReport`) + `--shadow-allowed-patterns` CLI mode.
- **F5c** `score.ts`: `scoreProductDesignOs` reads `PDOS_ENFORCE_ALLOWED_PATTERNS` at call time
  (`isAllowedPatternEnforcementEnabled`, truthy "1"/"true"); flag-unset returns the EXACT original slices
  (else-branch is mechanically identical), flag-on gates `selected.patterns`/`rejected.patterns` via the
  shared `applyAllowedPatternGate` (exclusion vs top recipe `allowed_pattern_ids`, `selected` booleans
  recomputed). Recipes/assets/route/scores/etc unchanged.
- NEW `tests/.../product-design-os-f5-allowed-patterns.test.ts` (env save/restore): default identity,
  shadow-diff shape, flag-ON gating, truthy parsing, F5a ghost error via temp PDOS tree.

**Verified (Opus-run):** validate **0 errors / 0 warnings**; **7/7 score fixtures byte-identical with the
flag unset**; flag-ON (`PDOS_ENFORCE_ALLOWED_PATTERNS=1`) changes the marketing selection (gating active).
**Gates:** typecheck ✅ · vendor-check ✅ (100 pristine + 20 patched) · vitest **27/27** (22 + 5 F5).
validate+score `patched_by += F5`.

```
buildSubagentTree:
└─ cli-codex-hp-20260623-beta-f5-impl  agent_type: codex_cli-external  (write-mode; files on disk)
```
**Default-OFF preserved.** Enabling `PDOS_ENFORCE_ALLOWED_PATTERNS` is a conscious owner-gate (review the
`--shadow-allowed-patterns` diff first). **Next:** F6 (wire F3 renderability harness into a QA floor +
`pattern.requires` taxonomy), F7.
