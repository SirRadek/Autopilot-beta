# ADR: `page_profile` dual-track governance + Motion Brief contract

**Date:** 2026-07-03 · **Status:** ACCEPTED (owner decisions 2026-07-03) · **Author:** Claude (Fable 5),
independent opposition review by GPT-5.5 xhigh (codex, read-only + web search): **GO-WITH-CHANGES**.

## Context

The owner supplied a "motion effect production system" design (pipeline Idea → Motion Brief → Tech
Choice → Small Patch → Visual Proof → Review → Effect Catalog). A full pairing audit found ~60–70 %
already exists in `product-design-os/` (PDOS) + mesh + vendor routing; the remainder is additive.
Separately, the owner requires two governed delivery tracks: **normal web pages** (simple fast
Astro-like sites; strict speed/SEO/accessibility) vs **design showcases** (different rules; not
chasing perfect scores).

Verified pre-change state:

- `rules/design-seo-tradeoff.md` already defined 4 profiles (`seo_led | balanced | brand_led |
  experimental_showcase`) with a mandatory floor and tradeable/non-tradeable lists — but **no
  enforcement consumed the profile** (zero hits in `src/`; free-string field `design_seo_tradeoff`
  present in only 2 of 7 recipes; project brief had no profile field; naming split between
  `design_seo_tradeoff` (recipes) and `tradeoff_profile` (rule text)).
- `pdos:visual-qa-browser` is **not** part of `npm run verify` — visual proof was and remains a
  task-level gate, not aggregate-CI (explicit decision below).
- Reduced-motion emulation already exists in visual-qa-browser; scroll-progress capture does not.

## Decisions

1. **Canonical field: `page_profile`** — enum `seo_led | balanced | brand_led |
   experimental_showcase`; required in `recipes/recipe.schema.json` and
   `briefs/project-brief.schema.json`; replaces `design_seo_tradeoff` and the `tradeoff_profile`
   wording. Rationale: it names the classified thing (the page), not one of its tradeoffs — the
   profile governs SEO **and** performance **and** accessibility strictness **and** motion budget.
   The rule file `rules/design-seo-tradeoff.md` keeps its name and declares the canonical field.
2. **One deterministic severity matrix, not per-script profile logic** —
   `qa/profile-check-matrix.json` (+ schema + loader `qa/profile-check-matrix.ts`) maps each QA
   check/issue code → `blocking | advisory | skipped` per profile. Fail-closed: unknown code or
   missing profile entry resolves to `blocking`. Consumed by `fit-safety` and `visual-qa-browser`
   via `--profile` (default `balanced` = pre-change behavior). Floor codes (overflow, H1, DOM CTA,
   touch targets, contrast/axe serious+critical, reduced-motion, legibility, license/provenance)
   stay `blocking` in **all** profiles; downgrades are limited to the rule doc's "What Can Be
   Traded Away" list and are reported, never hidden.
3. **`recipes/standard-web-fast.json`** — the normal-pages track becomes routable at intake
   (`seo_led`, motion_level 1, conversion/UX patterns only), so simple sites and showcases separate
   from the first classification step.
4. **Motion Brief contract** — `briefs/motion-brief.schema.json` + `briefs/motion-brief-template.md`
   (driver / objects / states(p) / interpolation / constraints / acceptance; inherits
   `page_profile`; critical-vs-default intake questions; `NEED_SPEC_CLARIFICATION` protocol).
   Authored briefs will live in `briefs/motion/*.json`, validated by `pdos:validate`.
5. **visual-qa-browser stays out of `npm run verify`** — it remains a required *per-task* gate for
   motion/design-bearing changes (task packets + motion brief acceptance), not aggregate CI:
   browser runs in the aggregate gate would be slow/flaky and the aggregate must stay deterministic.
6. **Placement** — motion-lab / live effect demos / preset implementation code belong to a
   supervised project repo under `C:\Programování\Projects\` as part of the beta bootstrap (first
   supervised project candidate). The control plane keeps schemas, rules, catalog metadata, gates.

## Deferred (measured-pain ordering)

- P3: `rules/motion-stack-decision-tree.md` + `candidate_source` catalog entries + dated evidence
  records for gsap/motion/r3f/drei/theatre/spline/rive/lottie/lenis. Review inputs to record at
  that time: GSAP free incl. plugins (2025, Webflow era) with official MIT `greensock/gsap-skills`;
  Motion+ AI Kit paid (not a default); Theatre.js maintenance opaque + studio AGPL-3.0 (specialist
  tier); Spline export tier-gated (owner-approved path only). All must be re-verified with dated
  sources at implementation time — not adopted from model memory.
- P4: preset layer (`library/preset.schema.json`, presets as pointers to supervised-project demo
  routes, curator rule success→preset / failure→anti-pattern in taste).
- P5: visual-qa-browser scroll-progress states (p=0…1) + `window.__set<X>Progress` debug-API
  convention as a motion_pattern contract requirement.
- P6: platform-skills adoption via `skill_registry_policy` (first candidate: `greensock/gsap-skills`)
  — only with the first real motion project.

## Consequences

- Every recipe and project brief must now declare `page_profile`; validation fails without it.
- Default gate behavior is unchanged (`balanced`, all codes blocking) — no ratchet/baseline impact.
- Showcase work gets an honest, recorded relaxation path instead of ad-hoc exceptions; fast-track
  sites get a routable recipe with the strictest defaults.
