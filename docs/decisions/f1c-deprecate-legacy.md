# F1c — Deprecate legacy fields (asset + recipe)

**Status:** ✅ DONE 2026-06-23. **Base:** beta HEAD `d6281a9` (post-F2 b3). **Worker:** real
`codex_cli` (hp-20260623-beta-f1c, exit 0, 443 s). Opus reviewed every edit + cross-checked the asset
merge against an independent registry computation (6/6 exact) before applying.

## What F1c removed (the dual-read → single-field finish)
1. **asset.schema.json**: removed the 3 legacy untyped properties `dependencies` / `works_with` /
   `avoid_with` → **`PDOS_ASSET_REF_TAG_MIX` 3 → 0** (the typed `*_ids`/`*_tags` remain).
2. **asset-manifest.json**: deleted those 3 legacy fields from every asset (115 lines). Before deletion,
   the F1b-held ghosts in `works_with` (now resolved by F2) were **merged into `works_with_ids`**
   mapped to canonical ids (guided-offer-map/demo-world-hub/studio-proof-ledger→themselves;
   section-aware-mascot & cat-concierge-guide→`mascot-progressive-guide`). No data lost.
3. **recipes (all 7)**: removed legacy `allowed_patterns`; `allowed_pattern_ids` is now the single
   source. `validate` + `recipe.schema` now require `allowed_pattern_ids` (allowed_patterns kept as an
   optional back-compat property). `validateGhostPatterns` stays dual-read (harmless).
4. **score.ts**: repointed `inferImplementationComplexity` from the removed `asset.dependencies.length`
   to `dependency_ids.length + dependency_tags.length`, and cleaned `PdosAssetCandidate`
   (`dependencies/works_with/avoid_with` → `dependency_ids?/dependency_tags?`); `allowed_patterns`
   made optional on `PdosRecipeCandidate`.

## SCORE-NEUTRAL (the F1c invariant — proven)
Unlike F2, F1c adds no registry entries, so the **7 score fixtures stayed byte-identical** (verified
by CLI diff: 7/7). The only scoring read of removed data was the dependency count;
`quaternius-cc0-animated-animal` was the sole asset with a non-empty legacy `dependencies`
(`["three.js-or-static-fallback"]`), and its `dependency_tags` mirror carries the same single value →
`dependencyCount` stays 1. All other assets were 0 → 0.

## cat-concierge-guide mapping (resolved open question)
In an **asset's** `works_with`, `cat-concierge-guide` → `mascot-progressive-guide` (the canonical F2
pattern — the legacy label names guide *behavior*, not the `cat-concierge` asset id; the cat-concierge
asset itself already points at that pattern). Real Codex proposed, Opus concurred.

## Gates
- typecheck ✅ · vendor-check ✅ (107 pristine + 13 patched — the 11 F1c files were already patched by
  earlier phases; `patched_by` appended `,F1c`) · vitest 7/7 ✅ (updated: warning assertions now
  `{PDOS_EMPTY_TOKENS:6}`; the synthetic asset test dropped the now-invalid legacy fields).
- validate ✅ 0 errors · warnings **9 → 6** (`PDOS_EMPTY_TOKENS:6` only).
- **score 7/7 byte-identical** to the post-b3 fixtures.

```
buildSubagentTree:
└─ cli-codex-hp-20260623-beta-f1c-20260623  agent_type: codex_cli-external  exit: 0  443 s
```
agy_cli MISSING. **Remaining:** F2 batch 4 (taste/pattern-scores migration — not dereferenced by
validate/score, low-risk). The only remaining F0 warning class is `PDOS_EMPTY_TOKENS` (the token-floor
milestone — a deliberately later phase per the plan, F4).
