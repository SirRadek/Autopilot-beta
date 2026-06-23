# F5 shadow-diff brainstorm — finding (3-source: Opus + Codex + Gemini)

**Date:** 2026-06-23. **Lanes:** Opus + real `codex_cli` (gpt-5.5) + real `agy`/Gemini-3.1-pro-high
(agy recovered after owner re-auth — see [[project_radeq_multivendor_loop_validated]]). All three
independent; strong convergence.

## The data (`--shadow-allowed-patterns`, 7 baseline inputs)
5/7 inputs would change selection if `PDOS_ENFORCE_ALLOWED_PATTERNS` were ON. Biggest divergence:
**creative-motion** (inputs "marketing bold motion" & "creative portfolio") FULLY swaps from generic
conversion patterns (`outcome-cta`/`sharp-positioning-hero`/`trust-summary`) to the recipe's intended
creative patterns (`theme-crossed-direction`/`animated-hero`/`demo-world-hub`). ecommerce + public-sector
= no change (scorer already agrees with curation).

## Consensus diagnosis
The divergence is a **scorer blind spot**, not curation narrowness. `scorePattern` scores
`purpose_fit*3 + logic_fit*3 + usability*3 + mobile_quality*2 − complexity` and **never reads the recipe's
`design_priority`/`motion_level`/`visual_energy`**. So it applies a flat "SaaS usability" utility to every
project and always prefers safe/simple/high-usability conversion patterns — it **penalizes creative
patterns for being creative** (Gemini's phrasing). Codex's reframe: `allowed_pattern_ids` behaves like a
**taste/positioning PRIOR, not a safety allowlist**; the diffs prove the curated list is neither complete
nor authoritative (internal/client-portal would lose plausibly-good non-curated patterns).

## Consensus recommendation
1. **Do NOT default the hard gate ON.** Keep `PDOS_ENFORCE_ALLOWED_PATTERNS` opt-in; keep the shadow diff
   as the diagnostic + a scorer-quality regression metric (the diff should shrink as the scorer improves).
2. **Fix the scorer with a soft prior, not exclusion** (candidate phase "scorer intent-prior"):
   - **Allowed-list membership bonus**: `+B` to patterns ∈ top recipe `allowed_pattern_ids` (Opus `+B`,
     Codex `+0.12`, Gemini `+15` — tune on the score scale; keep non-allowed patterns eligible).
   - **Intent-aware term**: stop punishing creative patterns under creative recipes — e.g.
     `motionFit = pattern.type==="motion_pattern" ? route.motion_level * k : 0` (Gemini) and/or
     down-weight `complexity` when `route.design_priority >= 7` (Opus).
   - Optionally rename internal semantics "allowed" → "preferred"; add a per-recipe `strict` flag for the
     rare case where hard gating is genuinely wanted (Codex).
3. **Goal:** make the hard gate REDUNDANT (scorer and curation agree) rather than enabling it — enabling
   now would "pass the test" while hiding that the scorer can't read a creative brief.

## Status
Recorded as a finding, NOT yet implemented. The scorer change is a deliberate behavior change (would move
the score fixtures) → owner-gated rebaseline when scheduled. F5's opt-in gate + shadow diff stand as-is.
Lane outputs archived under `output/f5-brainstorm/` (gitignored).

---

# IMPLEMENTED — "scorer intent-prior" (2026-06-23, owner-approved)

Implemented the consensus soft-prior in `scorePattern` (real codex_cli write-mode; Opus tuned + rebaselined).
Constants: `ALLOWED_PATTERN_BONUS=18`, `MOTION_INTENT_WEIGHT=1.5`, `HIGH_DESIGN_PRIORITY=7`,
`COMPLEXITY_RELIEF_HIGH_DESIGN=0.5`. The top recipe's `allowed_pattern_ids` set is resolved in
`scoreProductDesignOs` + `computeAllowedPatternShadowDiff` + the F5 enforced branch and passed to
`scorePattern`, which adds: allowed-membership bonus + a motion-intent term for `motion_pattern` scaled by
`route.motion_level` + complexity relief when `design_priority >= 7`. F5 hard gate + shadow diff unchanged.

**Result (owner-approved score rebaseline):** the `--shadow-allowed-patterns` divergence shrank **5/7 → 0/7**
— the ungated selection now matches recipe intent for every baseline input. Notably creative-motion flips
from generic conversion patterns (outcome-cta/sharp-positioning-hero/trust-summary) to creative ones
(**animated-hero/scroll-linked-proof/mascot-progressive-guide**). The prior is genuinely SOFT: the displaced
generic patterns still score ~89 (vs ~107 for the chosen creative patterns) — outranked, not excluded; a
much-stronger non-allowed pattern could still clear the margin. The hard gate (F5c) is now redundant for
real inputs but remains an opt-in safety/diagnostic. 7 score fixtures regenerated; 31/31 tests pass;
validate still 0/0. `score.ts patched_by += intent-prior`.
