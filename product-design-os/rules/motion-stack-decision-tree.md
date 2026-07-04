# Motion Stack Decision Tree

Use the simplest technology that reliably solves the effect. Every rung up the
ladder must be justified by a capability the lower rung cannot deliver
reliably — never by taste, novelty, or tool enthusiasm. This rule complements
`rules/performance.md` (motion and media budget) and
`rules/design-seo-tradeoff.md` (`page_profile`).

## Escalation Ladder

Climb one rung at a time and record why the lower rung was insufficient.

1. CSS — transitions, keyframes, `perspective`, scroll-driven effects where
   browser support allows. Default for hover, focus, reveal, and small loops.
2. Motion for React (motion.dev) or GSAP + ScrollTrigger — JavaScript
   timelines, orchestration, gestures, scroll scrub/pin. Motion for
   React-owned UI; GSAP for framework-agnostic timeline and scroll work.
3. React Three Fiber / Three.js (+ Drei, postprocessing) — real 3D: camera,
   lighting, models, depth. A premium add-on, never a default hero treatment.
4. Specialist tier — owner approval required: Theatre.js (timeline authoring)
   and Spline (visual 3D editor). See the hypothesis warning below.
5. Custom shader work — explicit owner approval only.

### Canonical QA Debug Hook

Scroll-progress motion implementations must expose
`window.__autopilotSetProgress(p)` for p=0..1 so visual QA can capture the
brief's progress points. `window.__autopilotGetMotionState()` is optional;
per-effect helpers such as `window.__set<X>Progress(p)` may exist, but they do
not replace the canonical QA hook.

## Situation Table

| Situation | Default stack | Constraint |
| --- | --- | --- |
| Hover, focus, reveal micro-interactions | CSS; Motion when JS state owns it | no JS for what CSS does alone |
| Scroll pin/scrub choreography | GSAP + ScrollTrigger | scrub tied to real scroll position |
| React UI, layout transitions, gestures | Motion for React | layout/presence animation, not page effects |
| 2.5D text depth | GSAP/Motion + CSS `perspective`/`translateZ` | TEXT STAYS DOM; never rasterize copy into canvas |
| Real 3D object or camera movement | React Three Fiber (+ Drei) | only when depth explains the product |
| 3D model assets | glTF/GLB | compressed, byte-budgeted, per-file source record |
| Vector state-machine UI | Rive (web runtime) | static fallback required |
| Simple icon/loader animations | Lottie (lottie-web) | prefer CSS/SVG when equivalent |
| DOM/WebGL scroll sync | Lenis, ONLY when native scroll is proven insufficient | never on ordinary sites |

## Source Hierarchy For Motion Research

Consult in this order and record which source informed the decision:

1. Internal catalog: `library/source-catalog.json`, evidence records, project
   work logs.
2. Official documentation of the chosen library.
3. Official repository examples.
4. Maintainer forums (GSAP forums, pmndrs GitHub discussions).
5. Codrops — technique inspiration, rebuilt clean-room, never copied.
6. Reddit / CodePen — last resort, inspiration-only, code never copied.

Everything below official documentation goes through
`rules/clean-room-reference-workflow.md` before implementation.

## Hypothesis Status — No Evidence Records Yet

The tier placements above are HYPOTHESES until each library has a dated
evidence record under `evidence/records/`. None exist yet. Known flags, all
UNVERIFIED (model memory / ADR review inputs, not dated sources):

- GSAP "free including all plugins" (2025, Webflow era) — re-verify the
  current GSAP standard license with dated sources before first use.
- Motion+ / Motion AI Kit is paid — paid tiers are never a default and need
  explicit owner approval.
- Theatre.js maintenance is opaque and `@theatre/studio` is AGPL-3.0 — never
  ship studio in a delivered project; specialist tier only.
- Spline export is paid-tier-gated — owner-approved path only.

Adopting any of these claims from model memory is blocked; the evidence
record requirement follows the stop conditions in
`docs/autopilot/design-intelligence-operating-model.md`.

## page_profile Gating

The motion stack choice is bounded by the page's `page_profile`
(`rules/design-seo-tradeoff.md`); motion_pattern effects are routable only
for profiles that allow them:

- `seo_led` — motion_pattern effects are not routable
  (`recipes/standard-web-fast.json`: motion_level 1, conversion/UX patterns
  only). CSS micro-interactions at most.
- `balanced` — rungs 1–2 with a recorded purpose; no 3D by default.
- `brand_led` — rungs 1–3 when motion quality is a recorded priority in the
  direction lock.
- `experimental_showcase` — full ladder; specialist tier and custom shaders
  still require owner approval plus performance-budget evidence.

Floor in every profile: reduced-motion behavior, primary text stays DOM,
mobile fallback, license/provenance record. The profile matrix
(`qa/profile-check-matrix.json`) keeps these codes blocking in all profiles.

## Stop Conditions

- a higher rung chosen without a recorded lower-rung insufficiency
- a library adopted without a dated evidence record
- paid tier, paid export, or paid kit used without explicit owner approval
- Lenis or any scroll hijacking on an ordinary-site profile
- primary text moved into canvas/WebGL to make an effect easier
- a motion_pattern effect routed into a profile that does not allow it
