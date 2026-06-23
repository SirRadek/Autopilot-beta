# F7 ADR — variant-count knob + sample_select behind the buildability floor (final plan phase)

**Status:** ✅ DESIGN ACCEPTED 2026-06-23 (Opus architect). Implementation next.
**Design author:** real `codex_cli` tech-opponent (hp-20260623-beta-f7-design, exit 0), reviewed + decided
by Opus. F7 is the minimal creative axis — the LAST plan phase.

## Accepted design (deterministic, default-OFF, report-only; no scorer/F6 change)

### Variant definition
A variant = a deterministic pattern-level selection bundle derived from ONE `scoreProductDesignOs` report
(NOT a new score model, no randomness). `variant-001` = today's top-`limit` `selected.patterns` (same
recipe/assets). Additional candidates keep recipe+assets fixed and swap the lowest-ranked selected pattern
for the next-ranked not-yet-used pattern (stable `rankItems` score-desc/id-asc order). Smallest meaningful
creative axis = one structural pattern swap; no palette/token-only variation.

### Knob + sampler
Do NOT add the knob to `scoreProductDesignOs` (preserve byte identity). NEW beta-authored
`qa/variants/sample-product-design-variants.ts` exporting `sampleProductDesignVariants(input,
{ variant_count }, repoRoot)` + report-only CLI `pdos:variants -- --text "…" --variants N`. `variant_count`
default 1 = today's single selection (delegates to the score path; `--variants 1` prints the old score
JSON for strict identity). Sample-select active only for N>1. Build ranked pools from
`scoreProductDesignOs` (selected+rejected, de-duped), enumerate candidate bundles deterministically, stop
when candidates exhausted or N floor-passing variants returned.

### Floor integration (reuse F6, F6/F3 FROZEN)
Each candidate bundle → a temp F4 composition spec → existing F6 `analyzeBuildabilityFloor({specPaths})`
(reuse F6's F4→F3 adapter). The synthesized spec = candidate pattern nodes + deterministic
contract-required slot closure + stable structural prop placeholders + required invariants copied from
component contracts. A candidate is kept only when `build_floor_passed === true` (structural + taxonomy
floor both clean). **If fewer than N pass, return the pass set + a shortfall — never fabricate.** Returned
variant ids preserve pre-filter ordinals (`variant-001`, `variant-004`) so ids don't shift on failure.

### Output + gate
Report-only JSON `{ requested, returned, limit, route, warnings, variants: [{ id, candidate_index,
selected_patterns, build_floor_passed:true, floor_report(compact) }] }` (`--include-floor-report` for full
detail). Vitest gate: the 7 score fixtures stay identical (variant axis absent); N=1 = today's top
selection; N>1 returns ≤N DISTINCT floor-passing variants; EVERY returned variant `build_floor_passed ===
true`; fewer-than-N pass → reported shortfall. NOT wired into `pdos:validate`.

### OFF by default (plan §3)
NO CreativityProfile vector, band-judge, LLM creative-director, provider switching, random sampling, or
score reweighting. The only new axis is the count knob over deterministic bundles; the floor is a FILTER,
not a scorer. `PDOS_ENFORCE_ALLOWED_PATTERNS` stays the only scorer behaviour flag.

## Opus decisions on open items
- `--variants 1` → prints the old score JSON (default identity); variant reports are for N>1 only.
- `floor_report` = compact summary by default; `--include-floor-report` debug flag for full detail.
- NO asset-swap axis in F7 (pattern substitution only — the minimal structural axis).

## Honest limitation (accepted)
The contract manifest is a SEED (marketing/motion patterns). So N>1 produces floor-passing variants only
for routes whose candidate patterns have contracts; other routes return **0 variants + a reported
shortfall** until contracts expand. This is CORRECT (don't fabricate buildability), not a bug. `build_floor_
passed` proves structural buildability only — visual-qa stays a separate axis (F6).

## Baseline impact (preserved)
Default `scoreProductDesignOs`/`pdos:score` byte-identical; 7 fixtures unchanged; `validate` 0/0 (no
generated variant specs committed under `specs/`; the sampler lives under `qa/`). New beta-authored sampler
in `beta_authored`; new F7 test under tests/; `pdos:variants` added (report-only, not in `verify` beyond
normal tests).

```
buildSubagentTree:
└─ cli-codex-hp-20260623-beta-f7-design  agent_type: codex_cli-external  exit: 0
```
