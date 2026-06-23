# Token Floor — milestone (F4) + FILLED (F4b)

**Status:** ✅ FILLED 2026-06-23 (F4b, owner-approved). All six token files now carry the floor keys
with **neutral, accessible baseline** values (override per project spec). `validateTokenFloor()` enforces
floor-key presence; `isTokenFloorComplete()` gates `token_overrides` (a spec may now set
`token_overrides.enabled: true` because the floor is complete). `PDOS_EMPTY_TOKENS` is now 0 →
`pdos:validate` is 0 errors / 0 warnings. (Defined in F4 below; the F4 text is kept for the audit trail.)

## Why this exists
All six `tokens/*.json` are `{ "version": 1, "tokens": {}, ... }` → `pdos:validate` reports
`PDOS_EMPTY_TOKENS:6`. The plan (§F4) requires an EXPLICIT statement of *when* tokens stop being empty,
so `token_overrides` does not stay OFF forever without a plan. This doc is that statement. The 6
empty-token warnings are the **accepted pre-floor state** — they are not a defect to silence; they are
the visible signal that the floor is not yet filled.

## The minimal token floor
`token_overrides.enabled` may become `true` (and the 6 warnings may drop to 0) only after ALL six token
files carry non-empty, **owner-approved** `tokens` with at least these semantic keys:

| file | required keys (minimum) |
|---|---|
| `color.json` | background, surface, text, muted_text, border, accent, accent_text, focus_ring |
| `typography.json` | font_body, font_heading, size_body, size_heading, line_height_body, weight_regular, weight_bold |
| `spacing.json` | space_1, space_2, space_3, space_4, space_6, space_8 |
| `radius.json` | none, sm, md, lg |
| `shadow.json` | none, sm, md |
| `motion.json` | duration_fast, duration_base, duration_slow, easing_standard, reduced_motion |

## Fill condition (gating)
1. **Owner approval** of the actual token VALUES, units, and the per-file `tokens` object shape (still
   open — values are not invented by a model).
2. A deliberate **F4b token-fill pass**: populate the six files to the floor, then a conscious validate
   **rebaseline** (`PDOS_EMPTY_TOKENS` 6 → 0; token file hashes change; the validation test's expected
   warning set updates). This is an owner-gated behavior change, NOT "nulová změna".
3. Only then may a composition spec set `token_overrides.enabled: true`. Until then,
   `validateCompositionSpecs()` treats `enabled: true` as a spec-layer error
   (`PDOS_SPEC_TOKEN_OVERRIDES_BEFORE_FLOOR`), and every example uses `enabled: false`.

## Until the floor is met
- Tokens stay `{}`; `PDOS_EMPTY_TOKENS:6` stays; `token_overrides` stays OFF everywhere.
- See `docs/decisions/f4-composition-spec-adr.md` for the F4 spec layer that enforces the OFF state.
