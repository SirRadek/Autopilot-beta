# F1a — Typové rozdělení jako dual-read migrace (implementace)

**Status:** ✅ DONE 2026-06-22. **Base:** autopilot@599785fb · beta HEAD před F1a `338f8b8`.
**Orchestrátor:** Opus (architekt + review + land). **Implementační worker:** real `codex_cli`
přes `runCliWorker()` (read-only v repu, emit strukturovaného patche). `agy_cli` = **MISSING**
(WORKER-CLI-001) — NEnahrazeno převlekem.

## Co F1a přidalo (additive, dual-read — žádná data-migrace)

1. **Dual-read `validate` + `score`** (rozhodnutí D1 = COLLAPSE → BEZ `direction_ids`):
   - `recipe.schema.json` rozpoznává volitelná pole `allowed_pattern_ids` + `required_sections`
     (+ `schema_version`). Stará `allowed_patterns` zůstávají autoritativní a povinná.
   - `validateRecipes`: volitelná kontrola nových polí (`validateOptionalStringArray`) + validace
     receptů proti `recipe.schema.json` (chyby). `validateGhostPatterns`: ghost-sken čte sjednocení
     `allowed_patterns ⧺ allowed_pattern_ids` (konkatenace, NE Set → baseline 13 zachován).
   - `score`: `PdosRecipeCandidate` má volitelná nová pole; `isRecipeCandidate` je dual-read
     (`allowed_patterns` NEBO `allowed_pattern_ids`). Exportovaný `resolveAllowedPatternIds()`
     (union/dedup) — **nezapojený do scoringu** (to je F5). Scoring math beze změny.

2. **Asset ref/tag split** (`asset.schema.json`, D2 = SPLIT): přidána volitelná typovaná pole
   `dependency_ids` / `works_with_ids` / `avoid_with_ids` (asset-id reference, pattern
   `^[a-z0-9][a-z0-9-]*$`) a `dependency_tags` / `works_with_tags` / `avoid_with_tags` (volné tagy).
   Stará netypovaná pole `dependencies` / `works_with` / `avoid_with` zůstávají (dual-read; deprecate
   až F1c). Proto F0 warning `PDOS_ASSET_REF_TAG_MIX` zůstává 3 (typová díra je vidět dál).

3. **Formální `recipe.schema.json` + schema-versioning** (nová beta-authored vrstva): self-contained
   JSON Schema (bez `$ref`/`anyOf`/`oneOf` — limit zdejšího validátoru), `x_schema_version: 1.0.0`,
   volitelné per-recept `schema_version`. Required = 9 polí dnes vynucených `validateRecipes`.

4. **`beta:vendor-check` rozšířen** o `beta_authored` soubory pod vendor-roots (aby nový
   `recipe.schema.json` v `product-design-os/` nespadl jako UNTRACKED). `content_hash` vendorovaných
   souborů zůstává pinned canonical baseline; nově patchnuté soubory dostaly `patched_by` ručně
   (NE přes `--generate`, který by re-baselinoval merge-back kotvu).

## Gates (všechny zelené)

- `typecheck` ✅ · `beta:vendor-check` ✅ (117 pristine + 3 patched; `recipe.schema.json` AUTHORED)
- `vitest` ✅ 7/7 (F0 baseline test + 6 F1a testů) · `npm run verify` ✅

## Důkaz baseline = 0

- **Score:** 7 vstupů (matice v `tests/fixtures/score-baseline/inputs.json`) skórováno před F1a
  (HEAD 338f8b8) a po F1a → **všech 7 JSON reportů byte-identických** (CLI diff i committed
  fixture-test `keeps score output identical to the committed F1a baseline fixtures`).
- **Validate:** výsledek beze změny (passed, 0 errors, warnings `{PDOS_ASSET_REF_TAG_MIX:3,
  PDOS_EMPTY_TOKENS:6, PDOS_GHOST_PATTERN:13}`). Jediný rozdíl ve výpisu: `Checked files 65→66`
  (nový `recipe.schema.json` v read-inventáři) — žádná změna chování.

## Důkaz reálného Codexu (buildSubagentTree)

```
parent_session_hash: autopilot-beta-f1a-20260622
└─ cli-codex-hp-20260622-beta-f1a-impl-20260622T181224
   agent_type: codex_cli-external   handoff_id: hp-20260622-beta-f1a-impl
   worker exit: 0 (strukturovaný JSON patch, 24.5 kB do -o capture)
   role: mechanická implementace; Opus review proti repu + land
```
Codexův výstup ověřen proti repu (model není source-of-truth): 1 reálná vada nalezena a opravena
reviewerem — partial-object cast v testu (`as PdosRecipeCandidate` → `as unknown as`). agy_cli
lane MISSING — konzultace 2-zdrojová (Opus + real Codex).

## Navazuje

F1b = migrace dat do nových polí (po doménách dle F2). F1c = deprecate stará pole až po
baseline `score`/`validate` beze změny (splněno zde). Pak zmizí i `PDOS_ASSET_REF_TAG_MIX`.
