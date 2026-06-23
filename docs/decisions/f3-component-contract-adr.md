# F3 ADR — Component/renderer contract + renderability harness (design, pre-implementation)

**Status:** ✅ DESIGN ACCEPTED 2026-06-23 (Opus architect). Implementation next.
**Design author:** real `codex_cli` tech-opponent (hp-20260623-beta-f3-design, exit 0, 394 s),
**reviewed + decided by Opus**. agy MISSING. This ADR is the implementation spec (plan F3 mandates
"ADR + skeleton FIRST, else the contract is designed blind").

## Why F3 exists
`asset.schema`/`pattern.schema` are metadata catalogs, not renderer contracts. F3 makes the doctrine
"model emits spec, deterministic builder makes code" real by defining the **component contract** and a
**read-only renderability harness** — WITHOUT shipping a real render engine (default OFF).

## Accepted design
1. **`contracts/component-contract.schema.json`** + **`contracts/component-contract-manifest.json`**
   (beta-authored). Contract entries keyed by `{ target_kind: asset|pattern, target_id }` (NOT by the
   coarse asset `type`). Entry fields: `id, schema_version, target_kind, target_id, props[], slots[],
   output_invariants[], notes?`.
   - `props[]`: `{ name, value_type, required, min_length?, min_items?, allowed_values?, description?,
     expected_source? }`; `value_type` ∈ {string,url,boolean,integer,number,text,data_ref,asset_ref,
     pattern_ref,list_ref,object_ref}.
   - `slots[]`: `{ name, required, min_items?, max_items?, accepts_target_kinds?, accepts_asset_types?,
     accepts_pattern_types?, allowed_asset_ids?, allowed_pattern_ids?, description? }`.
   - `output_invariants[]`: `{ code, required, severity, description?, source_floors[],
     visual_qa_issue_codes? }`. **`source_floors`** = actual registry strings the invariant binds to
     (e.g. `pattern.requires` "DOM-text CTA"/"reduced-motion fallback", `asset.avoid_with_tags`
     "primary-content-inside-canvas"); the harness verifies those strings STILL EXIST → contract is a
     binding on real floors, not a parallel re-declaration. No framework/component/render fields.
2. **`composition/composition-target.schema.json`** (beta-authored) — the model-emitted build intent:
   `{ id, schema_version, recipe_id, pattern_ids, asset_ids, required_sections, sections[], nodes[],
   visual_qa_probe }`. References the registries only. `nodes[]`: `{ node_id, target_kind, target_id,
   section_id, pattern_ids?, props[], slot_fills[], declared_invariants[] }`. Prop values carry exactly
   one typed value field (string_value/number_value/integer_value/boolean_value/ref_value), enforced by
   the harness.
3. **`scripts/check-renderability-product-design-os.ts`** — exports `analyzeProductDesignRenderability(
   input, repoRoot)`; READ-ONLY. Checks: schema-validate contracts+targets (repo `validateJsonSchema`,
   no $ref/anyOf/oneOf); reject duplicate `{target_kind,target_id}`; recipe/pattern/asset ids exist;
   selected patterns ∈ recipe `allowed_pattern_ids`; every referenced asset/pattern has a contract;
   required props present + typed; required slots filled with accepted kinds/types/ids;
   `required_sections` represented by `sections`; required invariant codes declared; `source_floors`
   still present in the registry; **reuse `analyzeProductDesignVisualQa`** for `visual_qa_probe` (no
   duplication). Output `{ ok, checked_files, compositions:[{id, buildable, non_buildable[], warnings,
   visual_qa}], summary }`. **Report-only**: exit 0 for ordinary non-buildable reports; non-zero only
   on unreadable files / internal failure. Vitest IS the F3 gate. NOT wired into `pdos:validate`.
4. **Fixtures** under `product-design-os/qa/renderability/fixtures/`: a fixture contract manifest +
   `buildable-marketing.json` (all props/slots/sections/invariants/visual-qa satisfied) +
   `nonbuildable-motion.json` (missing `motion-background` contract, unsatisfied `hero_content` slot on
   `animated-hero`, missing reduced-motion invariant, failing visual-qa probe → expected reason codes
   `CONTRACT_MISSING`, `SLOT_MISSING`, `INVARIANT_UNDECLARED`, `VISUAL_QA_ERROR`).

## Opus decisions on the 6 open questions
- **Q1/Q4 (contracts for patterns; pattern-only nodes):** YES, both — patterns carry many real floors;
  pattern-only nodes are first-class so e.g. `outcome-cta` is buildability-checked before an asset
  exists. Report-only.
- **Q2 (composition-target vs F4 composition.schema):** F3's `composition-target.schema` is the
  NARROWER buildability target; F4's `specs/composition.schema.json` (a new layer per plan) EXTENDS/
  promotes it. Do not conflate — keeps F3 scoped.
- **Q3 (invariant-code vocabulary owner):** F3 ADR SEEDS a small controlled vocab (e.g. `visible_h1`,
  `dom_text_cta`, `no_primary_content_in_canvas`, `reduced_motion_fallback`, `performance_budget`,
  `proof_adjacency`); F4/F6 extend it. Encode as an `enum` on invariant `code`.
- **Q5 (initial real coverage):** ship the real `component-contract-manifest.json` as a **SEED**
  (a small honest set — the marketing/motion fixture ids as real contracts is enough); the harness
  REPORTS uncovered asset/pattern ids (plan gate = "report-only list of non-buildable"). No pretense
  of full coverage.
- **Q6 (`--strict` non-zero exit):** NO in F3 — preserve report-only. F4/F6 may add enforcement.

## Hard boundary (anti-scope-creep)
F3 = declarative contracts + composition-target shape + fixtures + read-only static report harness +
visual-qa reuse on declared/probe input. F3 ships NO HTML/DOM, framework components, CSS, routes, data
loaders, canvas/WebGL, screenshots, browser checks, or build artifacts. The render engine begins where
a system maps contracts to framework components, renders DOM, proves invariants from real output, and
promotes report entries to hard gates — all OUT of F3.

## Baseline impact
F3 is a NEW report-only layer: it does NOT modify validate/score/visual-qa behavior, so `pdos:validate`
stays 0 errors / 6 warnings and the score fixtures stay byte-identical. New files are **beta-authored**
(added to `vendor-manifest.beta_authored`; live under `product-design-os/`). Gate = typecheck +
vendor-check + new vitest renderability test, existing 7 tests unchanged.

## Risks carried forward (from Codex, accepted)
Partial coverage must read as "reported gaps", not failure. `pattern.requires`/`avoid_with_tags` are
free text → `source_floors` mitigates drift but owner taxonomy (plan F6 `pattern.requires` taxonomy)
still pending. Visual-qa reuse proves the contract is DECLARABLE, not that real DOM satisfies it (that
needs the future renderer). Fixture coverage is a SEED, not the full registry contract set.

```
buildSubagentTree:
└─ cli-codex-hp-20260623-beta-f3-design  agent_type: codex_cli-external  exit: 0  394 s
```
