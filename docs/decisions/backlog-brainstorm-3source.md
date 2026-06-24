# Backlog brainstorm — what's left, what it relates to, what's substitutable (3-source)

**Date:** 2026-06-24. **Sources:** Opus (synthesis) + **Claude fan-out Workflow** (9 agents read the WHOLE
beta repo → per-area maps + synthesis + adversarial critique) + real **agy/Gemini-3.1-pro-high** (read the
whole repo, full review). Real **codex_cli** lane returned `empty_output` this run (reported, not faked) —
3 effective sources. This is analysis/recommendation only; nothing implemented.

## 0. Ground truth FIRST (the adversarial lane surfaced it)
The Workflow's critique agent verified against the **session cwd `C:\Programování\Codex`** and found an
empty old floor (35 patterns, no `requires_codes`, no harness, empty tokens, no vendor-manifest) → it
wrongly concluded "the synthesis analyzes the wrong repo / nothing exists." **That conclusion is the
critique's OWN repo-confusion** — but it's the most valuable accident of the brainstorm, because it proves
the #1 problem is real:
- `C:\Programování\autopilot-beta` = the F0–F7 spine (verified: **42/42 `requires_codes`, F6 floor present,
  HEAD `fde726a`, 36/36 tests**). ✅ This is where all the work correctly lives.
- `C:\Programování\Codex` (this session's cwd) = a **retired duplicate** (old/empty floor). MEMORY flags it
  retired; canonical = `C:\Programování\autopilot`.
- `SirRadek/autopilot` main has **pivoted to ClientOps** (Next.js/Payload); old control plane frozen under
  `archive/`.
→ **Three repos, no named merge-back target.** The vendor-manifest's byte-identical merge-back discipline
currently points at nothing. **This blocks the address of everything else** and is owner decision #1.

## End goal (3-source convergence)
A client-delivery engine: a locked brief → routed recipe → deterministic score/select of patterns+assets →
a `composition.spec.json` → **a deterministic builder compiles it into real, on-brand, buildable HTML/CSS/JS**
that passes a11y/perf/visual-QA and is previewable (GitHub Pages) for WANT↔SHOULD↔IS. Model output stays
advisory until tests+contracts+tokens+owner verify. **Everything built so far (F0–F7) is the verification
SPINE; the builder it points at does not exist.**

## THE central insight (all 3 lanes agree)
**The floor is over-built relative to the missing builder.** agy: *"a governance engine that is a digital
twin of an assembly line that does not exist yet."* Seven phases hardened schemas/scorer/3 harnesses/
taxonomy/variants/36 tests to validate buildability of specs **nothing builds**, score patterns **nothing
renders**, and gate creative axes that **can't turn on (no eval)**. The investment pays off only when a few
cheap-but-undone things land + a builder exists.

## Per-theme: have / want / gap / substitution / effort

### (a) Component / asset / token COVERAGE — the binding constraint
- **have:** 8 seed component contracts (marketing/motion only); 42 patterns with `requires_codes` (91-code
  taxonomy); 38 assets; neutral token floor (32 keys across 6 files).
- **gap:** **~34/42 pattern contracts + ~all asset-type contracts unwritten (≈80% gap).** Result: F7 N>1
  returns **0 variants (shortfall)** for almost every real route (agy + Claude both flagged this as the
  practical-unusability bottleneck). No asset-side taxonomy.
- **substitution:** Tokens — adopt an OPEN set (open-props / Radix Colors / Tailwind defaults / IBM Carbon)
  via **context7/library-docs lookup**, map to the 6 files, verify WCAG-AA with **axe-core**; follow the
  **W3C Design Tokens format + Style Dictionary** so override semantics aren't invented. Assets — align
  provenance to **SPDX + CC DEED** so CC0 sets (Phosphor, Heroicons, Open-Doodles, Kenney) drop in with audit.
- **effort:** Token fill = **low / half-day, mechanical**. Contracts = **medium, and contested** (see tension).

### (b) HELD-OUT EVAL — the universal gate
- **gap:** Doesn't exist. Gates intent-prior tuning, hard-enforcement, CreativityProfile, band-judge,
  creative-director, provider-switch. Without it "default-OFF pending eval" is an **indefinite hold**, not a
  plan. No agreed **"on-brand"** metric — the one axis no open ruleset supplies.
- **substitution:** Don't build bespoke. Reuse the 7 score fixtures + F7 sampler as substrate; score IS
  artifacts on (a) buildability-floor pass-rate (objective), (b) **axe-core + Lighthouse CI** (objective),
  (c) an owner/Opus **on-brand rubric** (subjective, logged). Borrow LLM-judge eval conventions (via
  context7) but keep the judge **advisory, never source-of-truth** (CLAUDE.md). The radeq preview loop is the
  natural live eval bed.
- **effort:** Medium / **highest leverage**. Caveat (critique): "on-brand" is owner-subjective → the eval
  **informs** an owner decision, it cannot **objectively license** the creative axes.

### (c) default-OFF CREATIVE AXES
- **gap:** CreativityProfile vector, band-judge, LLM creative-director, provider-switch, hard-enforcement —
  all OFF, all downstream of the (absent) eval. The **F5 hard gate is now REDUNDANT** (soft intent-prior
  superseded it) — opt-in but doing nothing. Latent contradiction: an LLM creative-director vs "scoring is
  deterministic and frozen" + "model output never source-of-truth."
- **substitution:** None needed — these are **policy/eval decisions, not missing tech**. If a creative-director
  is ever wanted, route it through the real `codex_cli` worker as **advisory spec-input**, never into the
  frozen scorer. Provider-switch = the existing model-role taxonomy, not a new gateway.
- **effort:** Cheap to DECIDE, expensive to validate. Real risk = **sunk-cost dark scaffolding** (5+ OFF axes
  carrying maintenance + fixture-rebaseline cost). Cheapest correct move: **quarantine the redundant F5 hard
  gate**, freeze the rest until the eval exists.

### (d) the real RENDERER / BUILDER — the whole product
- **gap:** The single largest missing piece. Also missing: a pattern→component registry (`animated-hero` →
  which file), a `mapTokens(base, overrides)` resolver, and a **real** (not mock) visual-QA probe.
  `analyzeProductDesignVisualQa` is a static probe today.
- **substitution (build vs adopt — both non-Opus lanes say ADOPT):** Bind `target_ids` to a **headless
  catalog** — **Astro + Tailwind + Radix/shadcn** (agy's pick; "render static zero-JS HTML, map spec nodes to
  components, write 0% compiler parsing logic"). Token-to-class mapping is direct. Real QA: **Playwright**
  multi-viewport + **axe-core** (a11y) + **Lighthouse CI** (perf), **BackstopJS/Percy** for snapshot diff.
- **effort:** **High / high — and the only theme that produces the product.** Hard-depends on token fill +
  some contract coverage (else garbage-in). **Per doctrine: Opus must NOT author the builder solo — it goes
  through the `codex_cli` worker, Opus architect→review→land.**

### (e) MERGE-BACK to canonical — blocked on topology (§0)
- **gap:** Target ambiguous-to-contradictory (3 repos, ClientOps pivot, retired Codex clone). Promoting beta
  files onto a ClientOps main could conflict with its Payload/Next runtime.
- **substitution:** None — it's a **repo-topology owner call**. The `patched_by` model is the right mechanism
  IF a target is named.
- **effort:** Low mechanical once fixed; **high risk of wasted work** if merged into the wrong/pivoted repo.

### (f) multi-vendor / harness ops
- **gap:** agy lane fragile (auth-timeout + silent Flash fallback; heartbeat fix authored on
  `codex/agy-heartbeat-capture-20260622` but NOT applied here = beta-F8). No qwen lane wired. Evidence has
  no SOURCE resolution. Harness reliability is folklore; failure mode is **silent** (empty/MISSING
  masquerading as completion — dangerous for an autopilot; e.g. codex returned empty THIS run).
- **substitution:** Evidence store = flat markdown/YAML `docs/evidence/` + `evidence.schema.json` or
  Decision-Mesh packet URIs (don't invent a source-record schema). Vendor reliability = apply the existing
  agy heartbeat fix; **codify the ≥480s codex floor + kill silent fallbacks** (already half-captured in
  [[project_multivendor_runner_ops]]).
- **effort:** Medium / medium; **high-value because the harness is the DELIVERY mechanism for the builder**.

## ⚖️ The one real DISAGREEMENT (owner must resolve) — "auto-ingest contracts" vs "free design"
- **agy + Claude-synthesis:** *Hand-authoring 34 contracts is a fallacy — parse TS props from shadcn/Radix/
  React Aria/Storybook and auto-generate the contract layer.* (Fast, mechanical.)
- **Claude-critique (sharp, correct):** This **imports the library's aesthetic + component vocabulary** into a
  system whose entire value is **"process rules, not design rules — design output stays FREE/creative"**
  ([[feedback_process_rules_not_design_rules]]). A **pattern (design semantics) ≠ a component (impl props)**;
  the mapping is **lossy and per-pattern** — the hard part (semantic→prop) doesn't automate, so the "auto-stub
  37" saving is mostly illusory. And **context7 fetches token VALUES/docs, it does NOT generate a contract
  layer** — the lanes blur "look up tokens" (true, cheap) with "ingest a contract layer" (not what it does).
- **Opus verdict:** The critique is right that this is a **strategic owner decision, not a mechanical
  shortcut**. Adopt open libraries for the **substrate** (tokens, a11y, perf, renderer runtime, CC0 assets) —
  there the convergence is correct and cheap. But **keep the contract/recipe/taste layer project-authored**
  (or library-assisted-then-reviewed per pattern), because that layer IS the "free, non-templated design" the
  product sells. Ingest contracts **lazily, only for the patterns the first renderer slice instantiates** —
  not 37 upfront.

## Recommended priority order (reconciled across lanes)
0. **Resolve repo topology** (owner; ~0 code): which repo is canonical for the Design-OS; confirm the live
   clone. Blocks the *address* of all else. (§0)
1. **Fill the token floor from an open set** (low/half-day): open-props/Radix/Tailwind via context7 → 6 files
   → W3C-tokens format → axe-AA verified. Unblocks `token_overrides` + gives the builder a real substrate.
2. **Minimal renderer SLICE** (Astro + headless, the few already-contracted patterns) via `codex_cli` worker,
   Opus architect → first real **IS artifacts**. (Owner: renderer framework + the design-tension above.)
3. **Scope + run the held-out eval** on those IS artifacts (buildability + axe/Lighthouse objective + owner
   on-brand rubric). The hinge from floor → product.
4. **Expand contracts LAZILY** per renderer slice (not bulk; only after the design-tension is resolved).
5. **Harden the multi-vendor harness** in parallel (agy heartbeat fix, codify timeouts, kill silent
   fallbacks, evidence store). It gates the builder in practice.
6. **Prune/decide creative axes last** (quarantine the redundant F5 hard gate; freeze the rest until eval).

## Owner decisions (consolidated — none of these are "just implement")
1. **Canonical repo / merge-back target** for the Design-OS (ClientOps main vs frozen control-plane vs
   standalone beta) + confirm the live clone. **Nothing promotes until this is fixed.**
2. **Renderer framework** (Astro + Tailwind + Radix/shadcn?) AND the **"adopt library contracts vs protect
   free-creative design"** tension — the central strategic call.
3. **Define "on-brand"** as a measurable criterion, or accept it as owner/Opus subjective (logged). The eval
   can't gate creative axes without it.
4. **Does visual-QA / axe / Lighthouse BLOCK deployment** or stay advisory (F6 left it pending).
5. **Approve `token_overrides` enablement** (post-floor) + the W3C-tokens/Style-Dictionary override semantics.
6. **Prune the dark OFF scaffolding** (F5 hard gate is superseded by intent-prior; 5+ OFF axes carry cost).

## Substitution cheat-sheet (the explicit ask)
| Gap | context7 / library-docs | Free / CC0 / open catalog | Build bespoke |
|---|---|---|---|
| Token values | ✅ fetch Tailwind/Radix/Carbon/open-props + W3C format | ✅ open-props, Radix Colors | mapTokens resolver (thin) |
| a11y / contrast | ✅ WCAG rules | ✅ **axe-core** | — |
| Perf | ✅ Lighthouse conventions | ✅ **Lighthouse CI** | — |
| Visual snapshot | — | ✅ **Playwright / BackstopJS / Percy** | wire to viewports |
| Renderer runtime | ✅ framework docs | ✅ **Astro + Radix/shadcn/Tailwind** | spec→component mapping only |
| Component contracts | ⚠️ fetch prop docs only (NOT generate the layer) | ⚠️ shadcn/Radix/USWDS props — **aesthetic-leak risk** | ✅ pattern semantics → contract (project-authored / reviewed) |
| CC0 assets | — | ✅ Phosphor, Heroicons, Open-Doodles, Kenney (+ SPDX/CC DEED) | provenance records |
| Eval harness | ✅ LLM-judge conventions | ✅ axe/Lighthouse as objective axes | on-brand rubric + brief set |
| Recipes / taste / intent-prior / governance | — | — | ✅ **project-authored — this is the product's IP** |

## Vendor evidence (3-source, honest)
```
Workflow (Claude fan-out): 9 agents, 580k tok, 245 tool-uses, read autopilot-beta → synthesis + critique
agy/Gemini-3.1-pro-high:   exit 0, 259s, 14.2 kB — full independent review (read beta correctly)
codex_cli:                 empty_output this run (reported, not faked) — retry candidate
```
agy recovered after owner re-auth; codex empty this run is exactly the "silent failure" harness risk theme
(f) names. Opus reconciled + corrected the critique's repo-confusion against verified ground truth (§0).
