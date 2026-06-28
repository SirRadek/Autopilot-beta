# Autopilot — Mobile Responsive Rules (R1–R10)

**Date:** 2026-06-28 · **Scope:** every page autopilot renders/ships must satisfy
these on real phones, not just desktop-narrowed. Each rule = **Evidence** (the
failure mode it prevents) + **Application** (where autopilot enforces it).

Enforcement points referenced below:
- `pdos:fit-safety-lint` — static source-level preconditions (no browser).
- `pdos:visual-qa-browser` — real Chromium render at named viewports.
- renderer / component contracts — generation-time guards.
- `docs/decisions/text-fit-autoscale-plan.md` — the fit/autoscale decisions.

---

## R1 — A ≤480px breakpoint is mandatory
**Evidence:** layouts tuned only at desktop + a tablet breakpoint (~768) leave
360–414px phones in an untested gap; multi-column grids and hero type overflow
there. The largest real-world cohort is 360–414, below any 768 breakpoint.
**Application:** `fit-safety-lint` flags any component whose responsive CSS has
no rule at `max-width: 480px` (or narrower). Grids must collapse to a single
column at ≤480.

## R2 — No fixed `min-width` larger than the viewport
**Evidence:** a `min-width: 600px` (cards, tables, nav) forces horizontal scroll
on every phone; the page can never fit 360px wide. This is the #1 silent
overflow source.
**Application:** lint rejects `min-width` literals `> 320px` on content
containers; tables/wide media must use `overflow-x:auto` on a wrapper, never a
fixed min-width on the page body.

## R3 — Never size content with `100vw`
**Evidence:** `100vw` includes the scrollbar gutter, so `width:100vw` is a few px
wider than the visible area → a horizontal scrollbar and a 1–17px right-edge
jiggle. Full-bleed sections are the usual offender.
**Application:** lint rejects `100vw` on content/section widths; use `width:100%`
(+ a controlled full-bleed technique like `margin-inline: calc(50% - 50vw)` only
on aria-hidden decorative layers).

## R4 — Fluid type via `clamp()` with a phone-legible minimum
**Evidence:** `font-size: Xvw` (or a `clamp` whose `min` is below ~14–16px body /
~24px h1) renders unreadable or overflowing text at 320–360px. Hero headlines are
the worst case.
**Application:** `fit-safety-lint` already requires every text `clamp()` to have
`min ≥` a legible floor (body ≥16px, key headings ≥ their legible min). Compose
`clamp()` only in trusted renderer code from structured fluid tokens
(`min`/`preferred`/`max`) — never loosen the token sanitizer (injection surface).

## R5 — Touch targets ≥ 44×44px
**Evidence:** links/buttons/icons under 44px fail Apple HIG / WCAG 2.5.5 target
size; mis-taps on nav, CTAs, and form controls. Inline text links in dense
footers are common misses.
**Application:** lint flags interactive elements whose computed min hit area is
`< 44px` (height/padding); `visual-qa-browser` measures tap-target boxes at
mobile viewports.

## R6 — Primary CTA above the fold on mobile
**Evidence:** on a 360×640 phone the hero CTA often falls below the fold behind a
tall headline + image, tanking conversion. "Above the fold" must be measured at
the phone height, not desktop.
**Application:** `visual-qa-browser` asserts the primary CTA's bounding box top is
within the initial viewport height at `390×844` and `360×640`. Composition
contracts mark the CTA slot as `above_fold_mobile`.

## R7 — Sticky/fixed elements need an opaque background fallback
**Evidence:** a sticky header with a transparent/blur background renders content
bleeding through on browsers without `backdrop-filter`, or shows a transparent
band over scrolling text → unreadable. iOS Safari + reduced-transparency are the
trigger.
**Application:** lint requires any `position:sticky|fixed` bar to declare a solid
`background-color` fallback before/with any `backdrop-filter`. `visual-qa-browser`
screenshots the sticky state mid-scroll.

## R8 — Heights driven by content, not fixed floors
**Evidence:** `height: 600px` / `min-height: 100vh` on sections clips content or
leaves dead space when copy wraps to more lines on narrow screens; Czech copy
(longer words, `lang="cs"` hyphenation off) wraps more than English.
**Application:** lint flags fixed pixel/`vh` heights on content sections (allow
`min-height` only with internal scroll or on decorative layers). Let intrinsic
content height drive the box.

## R9 — Watch cumulative padding/margin stacking
**Evidence:** nested wrappers each adding `padding: 24px` leave ~<260px of usable
width inside a 320px screen; text then wraps awkwardly or a CTA overflows. The
failure is invisible per-element and only shows in the stack.
**Application:** `visual-qa-browser` measures the innermost content box width at
`320px` and fails if usable width drops below a floor (e.g. < 280px). Prefer
fluid/`clamp()` padding that shrinks on small screens.

## R10 — Verify with a REAL render at 320/360/390/414 — never by estimation
**Evidence:** source-level lint (R1–R9) proves preconditions only; it cannot
prove actual fit, font-metrics, container-query behavior, or occlusion. Bugs in
all of the above survive a "looks fine in my head / at desktop-narrow" check.
**Application:** `visual-qa-browser` runs a Chromium render + screenshot +
overflow/occlusion checks at **320, 360, 390, 414** (today the lane checks 390 —
**add 320/360/414**). No page is "done" on lint alone; the browser probe owns the
real `fits_viewport_range` / `no_text_overflow_at_breakpoints` / `min_legible_text`
verdicts and is blocking for GA patterns.

---

## "Before done" checklist (pre-ship gate)
Run before marking any page/pattern complete:

- [ ] **R1** A `≤480px` breakpoint exists; multi-column grids collapse to 1 col.
- [ ] **R2** No `min-width > 320px` on content; wide tables/media use a scroll wrapper.
- [ ] **R3** No `100vw` on content widths.
- [ ] **R4** All text `clamp()` have a legible `min` (body ≥16px); no raw `vw` type.
- [ ] **R5** Every interactive target ≥ 44×44px.
- [ ] **R6** Primary CTA inside the initial viewport at 390×844 and 360×640.
- [ ] **R7** Sticky/fixed bars have a solid background fallback (no transparent bleed).
- [ ] **R8** No fixed `height`/`vh` floors on content sections; height follows content.
- [ ] **R9** Innermost content box ≥ ~280px usable width at 320px (cumulative padding OK).
- [ ] **R10** Real Chromium render passes at **320 / 360 / 390 / 414** — not estimated.
- [ ] `pdos:fit-safety-lint` green · `pdos:visual-qa-browser` green at all four widths.
