# F6 ADR — pattern.requires taxonomy + buildability output-floor

**Status:** ✅ DESIGN ACCEPTED 2026-06-23 (Opus architect). Implementation next.
**Design author:** real `codex_cli` tech-opponent (hp-20260623-beta-f6-design, exit 0), reviewed + decided
by Opus. agy available but not used for this consult (Codex sufficient for the integrity design).

## Accepted design (additive; baseline-preserving)

### 1. `pattern.requires` taxonomy — ADD optional `requires_codes` (do NOT retype `requires`)
F3 `source_floors` bind to the EXACT free `requires` strings (via `validateSourceFloorDrift`); retyping
would break them. So:
- `pattern.schema.json` (vendored +F6): add OPTIONAL `requires_codes` = `array` of an INLINE `enum`
  (`uniqueItems`), no $ref/anyOf/oneOf. Leave `requires` byte-identical.
- `pattern-manifest.json` (vendored +F6): populate `requires_codes` on ALL ~42 patterns (subset of codes
  per pattern), mapping the ~178 free `requires` strings to a NORMALIZED controlled vocabulary (synonyms
  collapse: "specific headline"/"visible H1"/"content-first hero" → `visible_h1`; "visible CTA"/"CTA"/
  "DOM-text CTA"/"CTA continuation" → `dom_text_cta`; "reduced-motion fallback"/"static fallback"/
  "non-motion fallback" → `reduced_motion_fallback`; etc.). Leave `requires` intact.
- The first 6 codes ARE the F3 invariant `code` enum (`visible_h1, dom_text_cta,
  no_primary_content_in_canvas, reduced_motion_fallback, performance_budget, proof_adjacency`) = the
  HARD-buildability codes. The rest are advisory/future-contract codes (`semantic_headings`,
  `seo_readable_content`, `accessible_copy`, `mobile_fallback`, `state_taxonomy`, `error_state`, … ).
  Do NOT extend the F3 contract invariant enum (that's a deliberate contract change, not F6).
- A NEW beta-authored TS module `scripts/pattern-requirement-taxonomy.ts` owns the canonical code list +
  legacy phrase→code aliases + helpers (NOT a JSON file — a JSON under product-design-os would change the
  validate checked-file count). A test asserts the schema enum and the module code list agree.
- The floor checks CODES, not strings → no longer text-matching. `requires` strings stay as F3 provenance.

### 2. Buildability output-floor in `qa/`
- NEW beta-authored `qa/buildability-floor/check-buildability-floor-product-design-os.ts` + package alias
  `pdos:buildability-floor`. Inputs: F4 composition specs (primary, `--spec`) + F3 targets (fixture compat,
  `--target`).
- **F4→F3 normalization on F6's side** (F3 frozen): F4 `composition.schema` is a strict superset
  (`spec_kind`/`evidence`/`token_overrides`/`evidence_ids`) and F3's target schema is
  `additionalProperties:false`, so F6 strips the F4-only fields to an F3 target (temp) before calling the
  (unchanged) `analyzeProductDesignRenderability`. **Do NOT modify `check-renderability-…ts`** — keeps F3
  tests/behavior byte-frozen.
- **Floor verdict:** `build_floor_passed = true` iff (F3 structural errors EXCLUDING `VISUAL_QA_ERROR`)
  are empty AND taxonomy-floor errors are empty. Taxonomy-floor errors = a used pattern missing
  `requires_codes`, an unknown code, or a contract invariant `code` not backed by the target pattern's
  `requires_codes`. F6 FILTERS `VISUAL_QA_ERROR` out of the F3 report for the verdict (on its own side).
- **Visual-QA stays an independent sibling axis:** F6 separately surfaces `analyzeProductDesignVisualQa`
  (`visual_qa.ok`, issues) in the report but does NOT merge it into `build_floor_passed`.
- **Gate:** standalone CLI + vitest. The committed F4 `buildable-marketing` spec PASSES the floor; the
  existing `nonbuildable-motion` F3 fixture FAILS. NOT wired into `pdos:validate` in F6.

### 3. F6 vs F3 delta (no duplication)
F3 = the renderability engine + legacy exact-string drift guard. F6 ADDS: the `requires_codes` taxonomy
as the floor vocabulary (not free text), an explicit `build_floor_passed` verdict, the F4-spec→F3-target
adapter, and buildability + visual-qa as SIBLING axes.

## Opus decisions on open items
- `requires_codes` on EVERY pattern (completeness); HARD floor only for contract/spec-referenced patterns;
  other codes advisory. (Codex concurs.)
- `pdos:validate` does NOT enforce taxonomy completeness in F6 (standalone/test-gated first).
- Visual-qa release-blocking flag: OUT of F6 (separate concern).
- **F3 harness frozen** (Opus refinement): no `check-renderability` edit; F6 normalizes + filters itself.

## Baseline impact (preserved)
`pdos:validate` stays **0 errors / 0 warnings** (optional `requires_codes` populated valid; checked-file
count unchanged — no new JSON, the taxonomy is a TS module). **Score fixtures byte-identical** (scorer
ignores `requires_codes`). F3/F4/F5 tests unchanged (F3 frozen). New beta-authored files in
`beta_authored`; pattern.schema+manifest `patched_by += F6`; new F6 test under tests/. New tests change the
test count only.

## Risks (from Codex, accepted)
`requires`/`requires_codes` drift → F6 test derives expected codes from aliases + fails on unknown/missing.
Some `requires` are domain reqs, not machine-checkable → only invariant-backed codes are HARD floor
failures, others advisory. F4 specs can't pass directly to F3 (`additionalProperties:false`) → adapter
required. Asset `avoid_with_tags` stay on the F3 legacy string path (no asset taxonomy in F6).

```
buildSubagentTree:
└─ cli-codex-hp-20260623-beta-f6-design  agent_type: codex_cli-external  exit: 0
```

---

# F6 IMPLEMENTED — record (2026-06-23)

Built per this ADR by real `codex_cli` (write-mode, 2 passes); Opus reviewed + verified independently.
**Pass A (taxonomy):** `pattern.schema.json` +optional `requires_codes` (inline enum, 91 codes; first 6 =
F3 invariant codes) + `pattern-manifest.json` `requires_codes` on ALL 42 patterns + new beta-authored
`scripts/pattern-requirement-taxonomy.ts` (`PATTERN_REQUIREMENT_CODES`, `HARD_BUILDABILITY_CODES`, aliases,
`mapRequiresToCodes`). Verified: `requires` strings + all existing fields **byte-identical** (F3
`source_floors` safe), 42/42 populated, schema enum == module (91), validate 0/0, score 7/7 identical.
**Pass B (floor):** new beta-authored `qa/buildability-floor/check-buildability-floor-product-design-os.ts`
(`analyzeBuildabilityFloor` + CLI `pdos:buildability-floor`): F4→F3 adapter on F6's side (F3 FROZEN —
`check-renderability` untouched), `build_floor_passed = (F3 structural errors minus VISUAL_QA_ERROR) empty
AND taxonomy-floor empty`; taxonomy codes `TAXONOMY_CODES_MISSING`/`TAXONOMY_UNKNOWN_CODE`/
`TAXONOMY_INVARIANT_UNGROUNDED`; visual-qa a SEPARATE reported axis (not in the verdict). New F6 test +
`tests/`. No `requires_codes` reconciliation needed (buildable spec passed as-is).

**Verified (Opus-run):** buildable-marketing spec → `build_floor_passed: true` (0 structural / 0
taxonomy); nonbuildable-motion fixture → `false` (CONTRACT_MISSING + SLOT_MISSING). report-only exit 0.
**Baseline preserved:** validate 0/0, score 7/7 byte-identical, F3/F4/F5 tests unchanged.
**Gates:** typecheck ✅ · vendor-check ✅ (100 pristine + 20 patched; floor+taxonomy beta-authored) ·
vitest **31/31** (27 + 4 F6). pattern.schema+manifest `patched_by += F6`.

```
buildSubagentTree:
└─ cli-codex-hp-20260623-beta-f6-design + f6a + f6b  agent_type: codex_cli-external
```
**Next:** F7 (single "počet variant" knob + sample_select N>1 behind the floor; CreativityProfile
vector / band-judge OFF until held-out eval).
