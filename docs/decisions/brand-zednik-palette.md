# Brand palette decision — zedník (mason) first-trial landing

**Date:** 2026-06-24. **Process:** brand-color intake → agy creative/strategic brainstorm → 4 differentiated
options → owner pick (the [[Brand-color intake]] process, task #8). This is the durable record the trial
(#6) reads to build the composition `token_overrides`.

## Process
1. Owner gave the starting direction: **"materiálová zemitá"** (concrete/brick/terracotta/sand) and noted it
   is COMMON in the trade → must be differentiated.
2. **agy** (Gemini, creative lane, real `runCliWorker`) brainstormed 4 palettes spanning safe→bold, each with
   a distinct differentiation move + full token values + style direction, WCAG-AA self-checked.
3. Owner chose **Option 3 — "Pískovec & Šalvěj" (Sandstone & Sage)** (agy's recommendation).

## Why this one (differentiation)
Every competitor trades-site uses safety-orange / blue / brick-red. **Sage green (#2C5E43) on warm sandstone
stucco** stands out of that crowd while still reading as honest, eco-minded, family-scale craft — trustworthy
to homeowners, not "every other web". Burnt-clay (#A34C32) keeps the earthy material tie as a secondary.

## Chosen tokens (the live `token_overrides` for the zedník trial)
```yaml
color:
  background:       "#FAF6F0"   # light stucco / render
  surface:          "#F2EAE1"   # sandstone block
  text:             "#2C2B29"   # raw umber (brown-black)
  muted_text:       "#6E6962"   # joint mortar
  border:           "#DDD3C7"   # clay grey-beige
  accent:           "#2C5E43"   # craft sage green
  accent_secondary: "#A34C32"   # burnt clay
  accent_soft:      "#E6F0EA"   # soft sage tint
  accent_text:      "#FFFFFF"
  focus_ring:       "#2C5E43"
style:
  decoration_intensity: subtle
  accent_angle_deg:     -2deg
  corner_style:         rounded
  heading_case:         none
  surface_treatment:    flat
```

## Verification (real renderer, not the model's claim)
`renderComposition` with these overrides → **0 contract errors**, and the renderer's WCAG-AA gate passed:
`background/text 13.14:1 · accent/accent_text 7.53:1 · accent_secondary/accent_text 5.77:1` (all ≥ 4.5:1).
The palette cannot enter the tokens without passing this gate — so the brand is differentiated AND accessible.

## Next
Task #6 (first-trial pipeline) builds the full zedník composition spec with these `token_overrides`. The
other 3 palettes (Lom & Křída, Břidlice & Jíl, Pálená Hlína) are kept in `output/brand-zednik/agy.md` as
runners-up if the owner wants to revisit.
