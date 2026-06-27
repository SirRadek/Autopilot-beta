# Zednik V5 hero — complete design critique (agy + codex + opus)

Date: 2026-06-27
Subject: live page https://sirradek.github.io/autopilot-beta-preview/ rendered from
`product-design-os/specs/examples/zednik.composition.json` (hero =
`tactile-shadow-hero`, picked as variant V5).
Method: three independent lenses reviewed the **live** page (not the spec), then
cross-brainstormed. Screenshots `output/v5-desktop.png`, `output/v5-mobile.png`.

> Meta-lesson this critique re-confirms: **green gates ≠ visual reality.** V5 passes
> every deterministic gate (validate 0/0, renderability, buildability-floor,
> fit-safety lint) yet looks broken — the photo is invisible and text is hyphenated
> mid-word. Visual QA has to be a separate, browser-real axis.

## Lens 1 — Opus (pixel critique of the live render)
1. **CRITICAL — sandstone photo invisible.** Hero reads as sage-on-near-black; the
   "Patinovaný stín" atmospheric intent is lost. The warm craftsman identity is gone.
2. Aggressive mid-word hyphenation everywhere ("rekon-struujeme", "ci-hel").
3. Hero H1 is a long run-on sentence, rendered huge and hyphenated.
4. Proof / CTA blocks read plain and card-like.
5. Overall the page reads dark/tech, not warm/craftsman.

## Lens 2 — codex (technical / root-cause)
1. **Near-black = opacity compounding, not a missing asset.** `.tactile-shadow-hero__photo-scrim`
   stacks `color-background` at 76–94% over the photo → photo contributes ~1% in the
   centre. Page bg is already warm `#FAF6F0`; sage `#2C5E43` has AA on it, so a
   near-opaque scrim is unnecessary. Fix: lighten scrim to 0.10–0.28 + add a photo
   `filter: saturate/contrast/brightness`.
2. **Hyphenation = global F1 text-fit rules.** `.pdos-page` + sections + headings all
   set `overflow-wrap:anywhere` + `hyphens:auto`; with `lang="cs"` Czech hyphenation
   kicks in hard. Fix: `hyphens:manual` + `text-wrap:balance` on headings; opt-in
   `[data-auto-hyphenate]` for long prose only.
3. **H1 = poster wordmark forcing a sentence into giant lines** (`max-width:13ch`,
   `clamp(2.8rem,10cqi,7.4rem)`). Fix: render as a 24ch sentence
   (`clamp(2.35rem,6.2cqi,5.2rem)`) OR split first claim into H1 + supporting paragraph.
4. H1 3-layer dark shadow too heavy → small contrast lift. Proof/CTA too card-like →
   bigger material photo + warm full-width closing band.

## Lens 3 — agy (brand / design strategy)
- **Brand verdict:** "reads like a moody tech portfolio, trading the warm grit of
  honest masonry for cold, dark-mode startup aesthetics."
- Brighten the canvas (warm sandstone `#F5EFEB`, deep charcoal / dark sage text).
- `word-break:normal; hyphens:none`.
- Shorten H1 copy + reduce size.
- **SAY:** H1 "Stavíme z cihel a kamene. S úctou k řemeslu." / sub "Poctivá zedničina
  a citlivé rekonstrukce chalup."
- **SHOW:** bright warm action photo of hands laying sandstone in daylight, blending
  into a warm textured bg instead of a dark overlay.
- **CTA:** Before/After slider of a reconstructed stone cottage → grounded CTA
  "Poraďte se o své stavbě" with a phone icon.

## Convergence (3/3 agreement)
| Finding | Opus | codex | agy |
|---|---|---|---|
| Photo invisible / near-black hero | ✓ #1 | ✓ #1 | ✓ #1 |
| Mid-word hyphenation | ✓ | ✓ | ✓ |
| H1 too long / too big | ✓ | ✓ | ✓ |
| Proof / CTA generic | ✓ | ✓ | ✓ |

## The one real divergence (→ cross-brainstorm)
codex frames V5 as a **warm concept with a CSS over-opacity bug** (fixable in
`tactile-shadow-hero.ts`, keep sage-on-warm). agy frames it as a **dark concept
fighting the warm-craftsman brand** (needs a brighter canvas + warm action photo as
the hero, plus a before/after slider). Cross-brainstorm resolves whether this pass is
a CSS fix or a direction change, and classifies each proposal as CSS-now /
spec-content / new-component / defer.

## Cross-brainstorm result (codex converging on agy + opus)
codex defended **"warm concept hidden by CSS over-opacity"**, not a dark rewrite, with
contrast numbers: sage `#2C5E43` ≈ **7.0:1** on `#FAF6F0` (≈6.6:1 on agy's `#F5EFEB`),
deep charcoal ≈ **13.5:1** — all safely AA. So the near-black read is the scrim
compounding opacity over the photo, not an incompatible pattern. Classification:

| Proposal | CSS now | Spec/content | New component | Defer |
|---|:-:|:-:|:-:|:-:|
| Scrim opacity | ✓ | | | |
| Photo filter | ✓ | | | |
| Word-breaks / hyphens | ✓ | | | |
| H1 copy shorten | | ✓ | | |
| H1 split vs resize | resize ✓ | split = content | | |
| Before/after slider | | assets | ✓ | ✓ |
| Full-width closing band | maybe | page intent | maybe | ✓ |
| CTA copy / phone icon | copy ✓ | phone target | | |

## Opus synthesis — prioritized fix plan (THIS pass)
Architect call: apply the converged CSS fixes + one editorial copy change; defer the
new-component / asset work. **Architectural guard:** codex's quick-critique scrim used
hardcoded `rgb(250 246 240)` — that would break brand portability (token_overrides
recolor via `var(--color-background)`). Keep `color-mix(... var(--color-*) …)`, only
lower the percentages.

**Apply now (codex write-mode handoff, then Opus review + gate + redeploy):**
1. `tactile-shadow-hero.ts` scrim → warm low-opacity (bg 18–28%, text 12–18% via
   color-mix, keep tokens) so the sandstone photo shows.
2. `tactile-shadow-hero.ts` `__wall-image` → restrained `filter: saturate/contrast/brightness`.
3. `tactile-shadow-hero.ts` `__stone::after` vignette → lighten.
4. `tactile-shadow-hero.ts` H1 → sentence-width (~24ch), `clamp(2.35rem,6.2cqi,5.2rem)`,
   `hyphens:manual; word-break:normal; overflow-wrap:normal; text-wrap:balance`,
   simplify the 3-layer shadow → small contrast lift; mobile variants to match
   (clamp mins kept ≥ legible floor so F2 lint passes).
5. `render-composition.ts` global default → `hyphens:auto` becomes `hyphens:manual`
   page-wide (keep `overflow-wrap:break-word`); `hyphens:auto` opt-in via
   `[data-auto-hyphenate]` — fixes hyphenation in proof/CTA sections too.
6. `zednik.composition.json` headline → **"Stavíme z cihel a kamene. Citlivě
   rekonstruujeme staré chalupy."** (synthesis of agy's shorter copy while preserving
   the rekonstrukce service — the one editorial/owner-reviewable change, reversible).

**Follow-ups (NOT this pass):** before/after slider = new reusable component; bright
daylight hands-laying-sandstone action photo = asset sourcing (current asset is a
sandstone *texture*, not an action shot); consultative CTA + phone icon; full-width
closing band. Kept as `output/critique/` notes for the next motion/asset pass.
Plus one observed-this-pass note: the proof/CTA section headings render large and
wrap into many narrow lines (component-level heading sizing, not hyphenation) — worth
a text-fit pass on `proof-led-section` / `outcome-cta`, separate from the hero.

## Applied + verified (2026-06-27)
Implementation via **codex write-mode handoff** (`output/critique/apply-handoff.md`),
Opus reviewed the diff (token-driven `color-mix` preserved — no hardcoded rgb; global
`hyphens` change kept `overflow-wrap` overflow-safety; all clamp mins ≥ legible floor),
then gated and landed. Three source files + the fit-safety baseline hash changed.

- **Visual (the point):** sandstone photo now clearly visible (warm), hero reads
  sage-on-sandstone craftsman, H1 is a legible sentence, zero mid-word hyphenation —
  desktop + mobile (`output/v5fix-*.png`).
- **Deterministic gates:** `npm run verify` EXIT 0 — vendor-check, typecheck,
  153/153 tests, validate, renderability, buildability-floor, fit-safety 5/5 pass 0/0.
- **Browser fit-probe (VOR):** 9 breakpoints **3840→360** all clean — no overflow, no
  overlap, no clipping, `min_font_px` 12.8, line length 46–76ch, all invariants 0 fails.

Meta-lesson holds: the deterministic gates were already green on the broken V5; it
took the **browser-real** visual + fit-probe axes (and three independent design lenses)
to see and fix the actual problem.

