# F4 ADR — specs/composition.schema + validate spec-integrity + token-floor milestone

**Status:** ✅ DESIGN ACCEPTED 2026-06-23 (Opus architect). Implementation next.
**Design author:** real `codex_cli` tech-opponent (hp-20260623-beta-f4-design, exit 0, 282 s), reviewed +
decided by Opus. agy MISSING.

## Accepted design

### 1. `product-design-os/specs/composition.schema.json` (NEW beta-authored layer)
The canonical model-emitted composition SPEC — a strict **superset/promotion** of F3's
`composition/composition-target.schema.json` (which STAYS as the narrower buildability profile read by
the F3 harness). No $ref/anyOf/oneOf. Required top-level: `spec_kind` (const `"composition_spec"`), `id`,
`schema_version`, `recipe_id`, `pattern_ids`, `asset_ids`, `required_sections`, `sections`, `nodes`,
`evidence`, `visual_qa_probe`, `token_overrides`.
- `recipe_id`/`pattern_ids`/`asset_ids` are ID references into the registries (no duplication).
- `sections`/`nodes` reuse the F3 shape (+ optional additive `evidence_ids`).
- `evidence` = LOCAL spec rationale (not a registry replacement): `items[]` `{ id, kind, summary,
  pattern_ids?, asset_ids?, notes? }` + `required_section_evidence[]` `{ section_id, evidence_ids }`.
- `token_overrides` = `{ enabled, values, reason? }`; examples MUST show the OFF state (`enabled:false`).
  `values[]` = `{ token_file, token_key, value, evidence_id?, reason }`; `enabled:true` is BLOCKED by
  validation until the token floor exists (see §3).

### 2. Spec→registry integrity in `pdos:validate` (validate.ts → patched_by += F4)
Add `validateCompositionSpecs(pdosRoot, repoRoot, errors)` called from `validateProductDesignOs()` after
recipe/catalog loading, before `validateEmptyTokens()`. **No-op if `specs/` absent.** When present: load
`specs/composition.schema.json`, validate every JSON under `specs/` EXCEPT the schema itself (and except
the schema dir). Spec-layer **ERRORS** (distinct from the registry-WARNING layer): `PDOS_SPEC_SCHEMA_INVALID`,
`PDOS_SPEC_UNKNOWN_RECIPE`, `PDOS_SPEC_UNKNOWN_PATTERN`, `PDOS_SPEC_UNKNOWN_ASSET`,
`PDOS_SPEC_PATTERN_NOT_ALLOWED`, `PDOS_SPEC_DUPLICATE_LOCAL_ID`, `PDOS_SPEC_UNKNOWN_SECTION`,
`PDOS_SPEC_UNKNOWN_NODE`, `PDOS_SPEC_REQUIRED_SECTION_MISSING`,
`PDOS_SPEC_REQUIRED_SECTION_EVIDENCE_MISSING`, `PDOS_SPEC_UNKNOWN_EVIDENCE`,
`PDOS_SPEC_TOKEN_OVERRIDES_BEFORE_FLOOR`. **`validateGhostPatterns` stays UNCHANGED** (registry-warning
layer) — spec mistakes must NOT be reported as recipe-ontology drift, and vice-versa. Ship ONE VALID
example (`specs/examples/buildable-marketing.composition.json`, built from the F3 buildable-marketing
fixture + evidence + `token_overrides:{enabled:false,values:[]}`) → **baseline stays 0 errors**.

### 3. Token-floor milestone — DECISION: milestone-doc only, NO seed in F4
Do NOT invent token values now (that would require owner-approved values + a validate rebaseline
6→0 warnings). Ship `product-design-os/tokens/TOKEN_FLOOR.md` (governance) defining the minimal floor +
the fill CONDITION + that `token_overrides` stays OFF until met. **`PDOS_EMPTY_TOKENS:6` REMAINS the
accepted pre-floor state** → baseline unchanged (0 errors / 6 warnings). Filling the floor is a separate
deliberate owner-approved pass (F4b) with its own rebaseline.

## Baseline impact (preserved)
`pdos:validate` stays **0 errors / 6 warnings (`PDOS_EMPTY_TOKENS:6`)** — the example spec is valid, the
new check no-ops on baseline, tokens untouched. `Checked files` count rises (new schema+example scanned)
but error/warning counts are identical. Score fixtures untouched (validate-only change). No test
warning-count change. New beta files added to `vendor-manifest.beta_authored`; validate.ts `patched_by`
gains `F4`.

## Opus decisions on open items
- **Token floor:** milestone-doc only (above). Values + shape need owner approval → F4b.
- **F3/F4 drift risk:** add a small test asserting the shared top-level field names align between
  composition-target.schema and composition.schema.
- **Exclude the schema file** from spec validation (else it self-validates as a spec → false errors).
- **evidence source_ids/reference_ids vs library catalogs:** NOT validated in F4 (defer until examples
  use them).

## Hard boundary
specs/ is a spec + validation layer ONLY. No renderer, no invented token values, `token_overrides`
default-OFF. F4 must not become a buildability/renderer gate (that's F3 harness / F6).

```
buildSubagentTree:
└─ cli-codex-hp-20260623-beta-f4-design  agent_type: codex_cli-external  exit: 0  282 s
```

---

# F4 IMPLEMENTED — record (2026-06-23)

Built per this ADR by real `codex_cli` (write-mode; harness reported false "empty_output" on the summary
capture but the files were written — verified on disk). Opus reviewed the `validate.ts` diff + gated.
- **NEW** `specs/composition.schema.json` (superset of F3 composition-target; +spec_kind/evidence/
  token_overrides; no $ref/anyOf/oneOf) + `specs/examples/buildable-marketing.composition.json` (valid;
  token_overrides OFF) — both beta-authored.
- **EDIT** `validate.ts`: `validateCompositionSpecs()` wired after recipes, before tokens; no-op if
  `specs/` absent; excludes the schema file; emits 12 `PDOS_SPEC_*` error codes (in message text, since
  validate errors carry no `code`); `validateGhostPatterns` untouched. `patched_by += F4`.
- **NEW** `tokens/TOKEN_FLOOR.md` (governance, Opus-authored): minimal floor + fill condition;
  `token_overrides` stays OFF; `PDOS_EMPTY_TOKENS:6` is the accepted pre-floor state. NO token values
  seeded (deferred to owner-gated F4b).
- **NEW** `tests/.../product-design-os-f4-composition-spec.test.ts`: baseline {EMPTY_TOKENS:6}, example
  validates (0 issues), negative cases (UNKNOWN_RECIPE/PATTERN, PATTERN_NOT_ALLOWED,
  TOKEN_OVERRIDES_BEFORE_FLOOR), F3/F4 field-alignment drift guard.

**Baseline preserved (verified):** validate **0 errors / {PDOS_EMPTY_TOKENS:6}**; score fixtures
byte-identical (validate-only change). **Gates:** typecheck ✅ · vendor-check ✅ (106 pristine + 14
patched; 11 beta-authored) · vitest **17/17** (7 + 3 F3 + 7 F4).

```
buildSubagentTree:
└─ cli-codex-hp-20260623-beta-f4-impl  agent_type: codex_cli-external  (write-mode; files on disk)
```
**Next:** F4b (owner-gated token-floor fill → `PDOS_EMPTY_TOKENS` 6→0 rebaseline), F5 (scorer gating
behind `PDOS_ENFORCE_ALLOWED_PATTERNS`, default-OFF), F6 (wire F3 harness into the QA floor +
`pattern.requires` taxonomy), F7.
