# Implementation plan — GPU/WebGL mode for point-cloud-background

**Status:** PLAN (not yet implemented). **Date:** 2026-06-26.
**Source:** 3-source brainstorm (codex GPT-5 + agy Gemini-3.1-pro-high + Opus 4-angle
workflow), all real vendors. **Owner sign-off required before Phase D.**

## Verdict (consolidated)

**SHIP-AS-UPGRADE, gate-before-engine.** Extend the existing `point-cloud-background`
pattern with a runtime-selected, config-declared WebGL2 backend gated on tier-keyed
budgets. **No Three.js, no GSAP** — hand-rolled zero-dep inline WebGL2 only. Build the
GATE before the engine. The WebGL backend itself is **premature** until a falsifiable
trigger is met; until then, extend presets and ship nothing new in dependencies.

### The decomposition (the key reframe)
The request "4K + many morphing points + GPU motion + scrollytelling" is two separable
decisions:
1. **WebGL2 rendering backend** (more points / GPU morph) → an *upgrade* to
   `point-cloud-background`: a runtime-selected backend consuming the SAME
   `EncodedPointCloud` + the same four knobs + the same gates, with a Canvas2D fallback.
   A *new* pattern would duplicate the entire gate/asset/dataRef surface for one axis
   (the renderer backend); the reverted `structural-gravity-grid` (`015ac0e→f0ffe17`,
   ~3500 lines of churn) is the priced proof.
2. **400vh pinned scrollytelling** → architecturally INCOMPATIBLE with the decorative
   contract (`role:decorative`, `aria_hidden`, `text_payload:[]`, single viewport).
   It flips the canvas into PRIMARY CONTENT (collides with `no_primary_content_in_canvas`
   / `canvas_text_dom_twin`). If ever wanted, it is a SEPARATE `experimental_showcase`
   pattern with its own gates and per-step DOM-twin captions — not this id.

### Why no Three.js / GSAP
~150KB (30–75× the shipped ~5KB inline engine) breaks the 384KB payload framing, the
self-contained single-inline-`<script>` CSP, and the byte-identical vendor-provenance
model; GSAP/ScrollTrigger additionally imports a per-shipped-site commercial-license
question into every fan-out artifact. Net aesthetic gain over the owned engine for a
decorative depth field: ~zero (topology × physics already carry ~80% of the look).

### Falsifiable trigger for Phase D (the WebGL backend)
Do NOT build the WebGL2 backend until at least ONE is measured and recorded in the
pattern's `performance_notes`:
- a concrete need for **> 24,000 points within the 384 KB inline budget**, OR
- **GPU-morph at 60 fps on a named mid-tier mobile device** that Canvas2D can't hold, OR
- **additive blending / a shader effect** Canvas2D cannot do.
Absent the trigger, the recommended action is: extend the preset enum, ship nothing new.

## Order of operations (gate before engine)

### Phase A — Close the two live bugs (no WebGL) — DONE (2026-06-26)
On the shipped Canvas2D path, found in code audit:
1. **pause-on-hidden asymmetry** — `visibilitychange` handler only resumes, never
   cancels the loop on hide (a latent GPU-burn bug under any continuous loop).
2. **provenance bypass** — `assertSceneGate` hardcodes `provenance:"internal"`, so the
   source-catalog/license check never runs on the live render path; gate it at the
   composition layer (where pdosRoot + catalog live).
Acceptance: `npm run verify` green; a test proves a source-recorded, unapproved
point_cloud asset throws `cloud_source_unlicensed`.

### Phase B — Scene-config + tier-keyed budgets (gate, no engine yet)

**Partially DONE (2026-06-26): the non-speculative half — measure-not-trust guards for
the CURRENT pattern.** `validatePointCloudScene` now runs at generation (renderer
self-check), gated on the `[data-point-cloud]` marker, and fail-closes if the rendered
engine is missing the DPR clamp (`cloud_dpr_unclamped`) or, when animated, the
pause-on-hidden cancel (`cloud_pause_on_hidden_missing`). This locks in the Phase-A
pause fix as a gate (break it again → generation throws). Tests prove each fires when
stripped and passes on the real engine. The remaining tier/scene-config machinery below
is **deferred to land alongside Phase D** — it is WebGL-coupled and building it now would
be speculative gate code for an engine behind the falsifiable trigger.

Make the gate MEASURE, not trust. Today every safety guarantee (DPR clamp, pause,
reduced-motion) lives in a `<script>` the contract checker strips before parsing, so the
only proof is a forgeable substring regex.
- Introduce a serialized **scene-config** the gate validates as DATA:
  `{ engine, tier, dprMax, morphTargetCount, payload:{mode,inlineBytes,fetchedBytes}, lifecycle:{pauseOnHidden, reducedMotionStatic, webglFallback} }`.
- Make budgets **tier-keyed** and DERIVE the tier from measured payload; assert
  `declared == derived` (`cloud_tier_mismatch`). Bound **effective payload =
  pointCount × bytesPerVertex × (1 + morphTargetCount)**, not pointCount alone.
  Starting table: low ≤24k / ≤384KB inline / dprMax≤1.5 / 0 morph; mid ≤60k / ≤1MB /
  dprMax≤2 / ≤2 morph; high ≤150k / ≤4MB **fetched-only** (inline forbidden >1MB,
  per-`.bin` license record) / dprMax≤2 / ≤4 morph.
- Add `cloud_dpr_unclamped` (parse the literal bound out of
  `Math.min(<n>,…devicePixelRatio…)`, assert `== dprMax ≤ tier ceiling`),
  `cloud_pause_on_hidden_missing` (assert the hide-branch reaches a loop-stop, not just
  that `visibilitychange` appears), `cloud_webgl_fallback_missing`,
  `cloud_morph_over_budget`, `cloud_fetched_payload_over_budget`.
- **Register every cloud error code as a `severity:"error"` output_invariant** on the
  contract (they currently survive only on a fallback severity, invisible to tooling).
Acceptance: red fixtures per code; config is the numeric source of truth, the engine-
script regex is only an anti-divergence cross-check.

### Phase C — Runtime probes (upgrade the existing Playwright visual-qa lane)
Static checkers bound the blast radius; a runtime probe is the only behavioral proof.
The repo already has `@playwright/test` + `renderer/visual-qa-playwright.ts` +
`pdos:visual-qa` — today it reads author-declared probe fields. Upgrade it to INSTRUMENT:
- emulate `prefers-reduced-motion: reduce` → assert no scroll listeners registered and
  one static frame paints;
- dispatch `visibilitychange` (hidden) → assert no frames advance;
- stub `getContext('webgl2')` → null → assert a non-blank Canvas2D paint + the declared
  `static_fallback` label;
- mock DPR=3 → assert backing-store size ≤ `clientSize × dprMax`;
- monkey-patch `bufferData`/`drawArrays`/`requestAnimationFrame` to measure uploaded
  bytes, drawn point count, and frame behavior; fail if measured > manifest.
Acceptance: probes wired into the buildability floor; high-tier is NOT allowed to fan
out until the reduced-motion + visibility + webgl-context-loss probes pass.

### Phase D — WebGL2 backend (ONLY if the trigger is met)
A runtime-selected backend INSIDE the one component (same `EncodedPointCloud`, same knob
attributes):
- **Morph by derivation, not shipping buffers:** ship ONE base position buffer (the
  brand formation-target from `build-point-cloud-asset`); generate scatter/gather/flow
  endpoints in the vertex shader from `aPosition` + a 1-byte per-vertex seed;
  `pos = mix(a, b, smoothstep(uProgress))`. Cap at 3 states, default 2. (Shipping a 2nd+
  position buffer adds 288 KB each and the existing 384 KB gate rejects it — derivation
  is the only path that passes.)
- **Paint-first, probe-second:** the first synchronous paint is the Canvas2D static
  home-pose frame into the SAME canvas; THEN `try{ getContext('webgl2', {failIfMajorPerformanceCaveat:true, powerPreference:'low-power'}) }`;
  only on context + shader-compile + first `drawArrays` success does the GL loop start.
  Add a `webglcontextlost → preventDefault() + repaint-static` handler (the single most
  likely real-world blank-screen bug).
- **Adaptive quality:** DPR `min(dpr,1.25)` desktop / `1.0` mobile (tighter than Canvas2D
  because fill-rate, not vertex count, is the 4K bottleneck); clamp `gl_PointSize ≤ 32`;
  pause via `visibilitychange` AND `IntersectionObserver`; one-way auto-demote after 8
  consecutive >32 ms frames; re-read `devicePixelRatio` in resize/visibility handlers.
- **Degradation ladder:** WebGL-high → WebGL-low (DPR 1.0, decimate ~10k via the existing
  density stride, drop size attr) → Canvas2D (existing engine) → static frame.
Acceptance: an F3/F6 test asserting the no-blank invariant (stub WebGL null → canvas
still painted); all Phase-B/C gates green.

### Phase E — Scrollytelling (SEPARATE, deferred)
Out of scope for `point-cloud-background`. Codify `min-height ≤ 100svh` and
`text_payload:[]` as HARD invariants of this pattern. Any genuine scroll-narrative
request → a new `experimental_showcase` pattern with per-step DOM-twin captions and its
own gates. Not planned now.

## Strategy / governance (premium tier, not house style)
- Ship GPU-mode as a named premium tier ("Living Hero"), default-OFF; owner opt-in +
  `tradeoff_profile = brand_led` to unlock.
- ALLOW only: `creative-motion` (brand_led), `experimental_showcase`. **NEVER** (make the
  manifest block non-overridable): public_sector, ecommerce checkout/payment, dashboard/
  data-tool/admin, internal_system/crm, client_portal.
- The moat is the governance (stop-conditions, mandatory DOM twin, reduced-motion frame,
  SEO floor, brand-image→formation-target pipeline — the cloud is the CLIENT's mark),
  not the shader (a weekend three.js copy).
- Fight sameness: track preset reuse across generated sites; flag any single preset
  >30% of brand_led output; keep the agy "mason-test" creative veto (it correctly killed
  the dot-stage particle hero for the zednik craftsman brand).
- The static DOM twin + reduced-motion home-pose frame are non-negotiable invariants, not
  reason-around-able stop-conditions. Gate LCP on the DOM content, never the canvas.

## Single highest risk
**Static gate-invisibility of the adaptive quality manager.** Every safety guarantee
lives in a stripped `<script>`, so the gate's proof reduces to forgeable substring
regexes (and pause-on-hidden was already broken in-tree while a regex passed it). Until
config-as-source-of-truth + numeric assertions + runtime probes (Phases B–C) replace
regex-presence trust, a generator can self-declare `tier="low"` and ship a 150k-point,
unclamped-DPR, never-pausing GPU blob the gate rubber-stamps. **Fix this before any
fan-out, or the budget system is theater.**

## Phase D — gate-safety redesign (2026-06-27, post adversarial review)

A 4-area design workflow (engine / gate / asset-build / WebGL-plan readers → 3
blueprints, each adversarially verified) returned **`revise`** on the WebGL backend.
Stages A (homePose + topo-relief + lowpoly-facet) and B (capped line primitive)
shipped from that same review with all must-fixes applied and `npm run verify` green.
The WebGL backend did **not** ship — the review found it not yet gate-safe. Recorded
here so the next attempt starts from the corrected design, not the flawed one.

### What the review killed (must-fix, not nitpicks)
1. **FATAL — the "JSON config twin survives stripping" thesis is false.** The proposed
   `<script type="application/json" data-cloud-config>{…}</script>` was meant to be a
   non-stripped DATA parse path the gate could read numerically. It is not: the contract
   parser strips/ignores it exactly like any other `<script>`, so the three webgl gate
   checks degrade to substring scans over the *same strippable bodies they protect* —
   trivially satisfiable by a decoy substring, trivially removable by stripping.
2. **The falsifiable trigger is not enforced anywhere in-part.** Constraint: WebGL is
   permitted ONLY when the trigger is met (>24k pts / 60fps-mobile-need / additive
   blend). The blueprint admitted "trigger enforcement is upstream" — i.e. nothing forces
   it. A runtime FPS trigger is unmeasurable by a static gate.
3. **Additive `neon-bloom` can violate anti-slop even at rest (uProgress=0).** If per-point
   alpha is not held low, dense brand regions blow out to white and destroy the silhouette
   — the resting pose stops being the brand cloud. `additiveBudget` as a self-declared
   number has no cross-check to what the engine actually draws (forgeable).

### The gate-safe redesign (do THIS, not the config-twin)
- **WebGL is a progressive enhancement layered on the already-gated Canvas2D engine —
  never a parallel data path.** The emitted HTML ALWAYS contains the gated Canvas2D path
  (dpr clamp + pause-on-hidden, which `checkEngineGuards` already requires whenever
  `data-point-cloud` is present). The webgl code lives in the SAME `<script>` as those
  guards. Therefore stripping that script removes the dpr clamp → `cloud_dpr_unclamped`
  already fires. The webgl guards inherit strip-safety by *co-location*, not by a
  second parse path. No config twin.
- **Extend `checkEngineGuards` (not a new strippable surface).** When the engine declares
  webgl (a `data-cloud-engine="webgl"` ATTRIBUTE on the canvas — HTML, survives stripping,
  validated as a bounded enum like `data-relief`), additionally require in the same HTML:
  (a) `cloud_webgl_fallback_missing` — a synchronous `getContext('2d')` + `frame(1)` static
  paint path is present (paint-first, probe-second); (b) `cloud_webgl_context_loss_unhandled`
  — a `webglcontextlost` handler that `preventDefault()`s and repaints the static frame;
  (c) the existing dpr clamp. All three are presence-proofs co-located with the dpr clamp,
  so they share its strip-fate. They prove the guard EXISTS; runtime behaviour stays the
  job of the Phase-C Playwright probe (a `getContext('webgl2')`-returns-null stub must
  still leave the canvas painted — the no-blank invariant).
- **Enforce the trigger at COMPOSITION-VALIDATION time, statically.** A webgl preset is
  admissible only when the asset/preset meets the trigger conditions checkable from data
  (pointCount > a webgl floor; `tradeoff_profile = brand_led`; recipe ∈ {creative-motion,
  experimental_showcase}). Runtime FPS is NOT a gate input — the trigger is a static
  admissibility policy, not a runtime switch.
- **Additive is alpha-clamped at the shader, and the clamp is asserted.** `neon-bloom`
  caps per-point alpha low enough that dense regions cannot white-out; the gate asserts
  the additive preset declares a bounded (enum, not free-float) intensity. If that cannot
  be proven from the artifact, additive does not ship — fresnel-only WebGL ships first.
- **No webgl preset ships until the rails above exist + a real >24k-point asset needs it.**
  Today every asset is ≤4k–4.6k points → the trigger is unmet → Canvas2D (Stages A+B) is
  the correct and only backend. The redesign is the spec for when a genuine 4K/100k-point
  brand asset arrives; landing the gate rails (extended `checkEngineGuards` + the
  composition-time trigger) is the gate-before-engine prerequisite, and is itself a clean
  shippable increment independent of writing any GLSL.

**Bottom line:** the WebGL backend is *designed and de-risked*, not shipped. Shipping it
under the original config-twin design would have reproduced exactly the "Single highest
risk" above (a forgeable-substring gate). The path to ship is the progressive-enhancement
+ co-located-guards + static-trigger redesign — gate rails first, GLSL second.
