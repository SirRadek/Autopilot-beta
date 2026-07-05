# Motion Brief

Fill this in BEFORE implementing any web motion effect. One brief per effect.

## Id

kebab-case:

## Status

`draft | approved | implemented | rejected`

## Intent

Description (what happens):

Feeling (what it should evoke):

## Page Profile

`seo_led | balanced | brand_led | experimental_showcase`

## Driver

Type: `scroll | hover | time | cursor | route_transition`

Range (optional, e.g. section scroll 0-100%):

Section (where on the page the driver applies):

## Objects

One entry per animated object. Each: `id` (kebab-case), `type`
(`dom_text | dom_element | css_overlay | svg | canvas_2d | webgl`),
`selector` (optional), `layer` (optional), `must_remain_dom`
(default `true` for `dom_text` — real text stays real DOM).

## States

At least 2 keyframe states. Each: `p` (progress 0-1) plus a per-object map of
property values, e.g. `{ "p": 0, "hero-title": { "opacity": 1, "y": 0 } }`.

## Interpolation

Optional property-to-easing map, e.g. `opacity: ease-out`.

## Constraints

At least one hard rule the implementation must not break (forbidden changes,
performance budgets, layout that must not shift).

## Acceptance

Screenshot progress points: `[0, 0.25, 0.5, 0.75, 1]` (default)

Reduced motion behavior:

Mobile behavior:

## Reference

## Assumptions

Non-critical defaults chosen by the agent are recorded here.

## Open Questions

## Critical Missing Info (stop and ask)

- Where the effect applies (page, route, section)
- Main object of the effect
- Driver type (`scroll | hover | time | cursor | route_transition`)
- Forbidden changes
- DOM / SVG / canvas / WebGL decision
- Prototype vs production

## Non-Critical (choose default, record as assumption)

- Easing
- Exact shades and intensities
- Helper naming
- Debug route
- First keyframe draft

Convention: if any critical info is missing, reply `NEED_SPEC_CLARIFICATION`
plus the numbered questions and produce only a brief skeleton — no
implementation.
