# Text-fit / autoscale system — build & verify plan

**Date:** 2026-06-26 · **Authors:** Opus (architecture) + codex (technical) + agy (strategic), real-vendor brainstorm.
**Goal:** client landing-page text + text panels fit every screen 4K→360px mobile, with a deterministic test.

## Resolved decisions (the 4 unclear forks + strategy)

1. **Static lint NOW — honestly labeled.** Ship a `fit_safety_lint` (deterministic, no browser). It guarantees
   SOURCE-LEVEL preconditions only: every text `clamp()` has `min ≥` legible floor; grids use `minmax(0,1fr)`;
   no fixed-px text containers; `overflow-wrap`/`hyphens` present; `lang="cs"` emitted. It CANNOT prove actual
   fit/font-metrics/container-query behavior/occlusion — call it a **linter, not a fit test**. The browser
   probe owns the real `fits_viewport_range` / `no_text_overflow_at_breakpoints` / measured `min_legible_text`.

2. **CSS-only stays pure — no JS fit-text in css-only heroes.** They emit `data-motion-strategy="css-only"`;
   runtime sizing would violate that contract. JS fit-text is allowed ONLY behind a separate explicit contract
   (`data-fit-strategy="js-measured"` + a `runtime_fit_allowed` invariant), never as a hidden fallback. For
   CSS-only lockups: copy budgets, alternate lockups, `clamp()`, `ch` widths, wrapping — and let
   browser-measured failures FORCE a design change rather than shrink text with JS.

3. **Keep `map-tokens.ts` strict.** Do NOT loosen the sanitizer to allow `clamp/min/max/calc/var` (a CSS-grammar
   problem, not a regex tweak — injection surface). Instead use **structured fluid tokens** (`min`/`preferred`/
   `max`/`unit`) and compose `clamp()` inside trusted renderer code.

4. **Gating.** `fit_safety_lint` BLOCKS on new/changed components (high-confidence preconditions only); existing
   patterns start warning-first. Browser invariants stay advisory/default-OFF until Chromium exists, then become
   blocking for GA patterns. Escape hatches for intentional cases: `data-fit-lint="ignore:reason"` + exempt the
   `dot-stage-hero` clipped DOM twin (already governed by its `data-dot-word`/`data-dot-twin` contract).

5. **Auto vs control — the EDITORIAL SPLIT (agy).** Auto-fit for spacing, padding, and repetitive grid CARD/
   panel layouts. HAND-CONTROLLED breakpoints + line-breaks for HERO sections, text line-wrapping, and content
   ordering — pure-auto produces single-word orphans and kills the editorial pacing a craftsman brand needs.
   The system scales fluidly; the designer keeps structural breakpoints and hero line-breaks.

6. **Headline metric — VOR (Viewport Overflow Rate, agy).** % of tested widths (10px steps, 360→3840) that
   produce horizontal scroll OR text truncation. **Pass threshold = 0%.** Binary, objective, per-page.

## Build phases

**F1 — Fluid type foundation (deterministic, NOW).** Expand `typography.json` to role tokens
(caption/kicker/body/body-lg/heading/display) as structured `min`/`preferred`/`max`; renderer composes
`clamp()` (per fork 3). Replace fixed `--pdos-type-*` with fluid vars; keep `container-type` roots + `cqi`.
System rules: `text-wrap: balance` (headings) / `pretty` (body) + `overflow-wrap: anywhere` + `hyphens: auto`
+ **`lang="cs"`** from the composition (fix hardcoded `en`). Auto-fit utility for PANELS only:
`repeat(auto-fit, minmax(min(100%, var(--pdos-panel-min)), 1fr))` (per fork C, not heroes).

**F2 — Fit-safety contract + static lint (deterministic, NOW).** Add invariant enums
`fits_viewport_range` / `no_text_overflow_at_breakpoints` / `min_legible_text`. Extend `visual_qa_probe` schema
with `text_fit`/`clipped_text_count`/`min_font_px`/`max_line_length_ch`/`fit_scale_min`. Build `fit_safety_lint`
(per fork 1) — blocks new/changed, warns existing (per fork 4).

**F3 — Browser VOR probe (chromium-gated, LATER, blocked on #4).** Playwright probe at the 9 breakpoints +
the 10px VOR sweep: set viewport, reduced-motion, `fonts.ready`, measure `[data-contract-prop]`/headings/CTAs →
`scrollWidth`/clipping/font-metrics/overlap/line-length → emit `text_fit` records → invariants → gate at VOR 0%.

## Verify per phase
- **F1:** render zednik + the 5 hero variants; existing gates green; visual snapshots at 360 / 1920 / 3840;
  rebaseline score fixtures if the type-var change moves scoring.
- **F2:** `fit_safety_lint` runs on all components (warn) + new/changed (block); schema validates; gates green.
- **F3:** the VOR probe runs on zednik + variants across the sweep → VOR = 0% → gate (once Chromium).

## Sequence
```
F1 (fluid tokens + lang + auto-fit panels) ─┐ NOW, deterministic, ~80% of value
F2 (invariants + fit_safety_lint)           ─┘ (rules + static gate, no browser)
F3 (browser VOR probe) ───────────────────── blocked on Chromium (#4) = real measurement
```

## Open dependency
F3 needs a local Chromium install (the same infra block as slice-1b visual-QA, task #4). F1+F2 do NOT —
the project ships its first ~80% (real fluid scaling + a deterministic guardrail) without it.
