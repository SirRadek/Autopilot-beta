---
id: radeq-novel-design-supervisor
title: RadeQ Novel Design Supervisor Prompt
model_family: provider-neutral
task_type: agentic-task
version: v0.1.1
status: candidate
last_reviewed: 2026-06-05
sources:
  - autopilot-supervisor-base
  - radeq-project-architecture
  - radeq-project-mesh
  - radeq-work-log
  - cat-mascot-asset-provenance
  - product-design-os
  - graphic-agent-operating-model
risk_level: high
requires:
  - github_baseline
  - product_design_os_gates
  - distinct_design_directions
  - theme_crossing_with_seo_compromise
  - mascot_asset_source_check
  - reduced_motion_fallback
  - seo_performance_check
  - lead_capture_guard
forbidden:
  - live_site_as_primary_baseline
  - palette_only_variants
  - core_content_requires_webgl
  - unverified_asset_license
  - paid_tool_without_owner_exception
expected_output: RadeQ supervisor startup and planning packet for four structurally distinct GitHub-baselined design directions.
evals:
  - 05-evaluation/supervisor-startup-checklist.md
---

# RadeQ Novel Design Supervisor Prompt

Use this after `prompt-library/06-supervisor/autopilot-supervisor-base.md`.

## Project

Project slug: `radeq`

Canonical project repository: `SirRadek/radeq`

Default branch according to the control-plane architecture record: `new`

Primary goal: create more professional, playful, conversion-focused, and
non-technical-user-friendly RadeQ.cz website directions.

## Source Of Truth

Do not use the current live `radeq.cz` site as the primary design baseline.

Primary baseline:

- latest GitHub branches, commits, PRs, previews, and proposal artifacts for
  `SirRadek/radeq`
- local RadeQ project architecture, work log, and decision mesh
- existing GitHub preview/history for the latest A/B/C/D work

Secondary reference only:

- current public `radeq.cz` content and SEO/indexability sanity check

If GitHub access is unavailable, stop and report the missing source instead of
falling back to the live site as primary baseline.

## Degraded Startup Mode

If these are verified:

- Decision Mesh
- RadeQ project mesh
- Context7 or official-doc fallback
- GitHub/RadeQ baseline

but `codex_app.read_thread_terminal` is not exposed or has no handler, do not
claim full Codex App runtime verification. Record:

```txt
codex_app_bridge: not_exposed
progress_state: waiting_external
blocked_surfaces: automation creation, heartbeat scheduling, thread-terminal verification
allowed_surfaces: local/GitHub planning, Product & Design OS analysis, design directions, QA plan
```

Continue with degraded supervisor planning if the next step does not require
Codex App runtime tools. Stop only for automation setup, heartbeat scheduling,
thread-terminal evidence, or implementation steps that explicitly depend on the
missing `codex_app` bridge.

## RadeQ Product Constraints

Preserve:

- static readable content
- SEO metadata, headings, canonical, robots, sitemap, and indexability
- fast mobile loading
- light/dark mode
- service/demo links outside the main page
- lead capture validation, privacy minimization, D1 binding assumptions, and
  controlled error responses
- reduced-motion behavior
- WebGL/canvas fallback when any mascot or motion enhancement fails

Do not add:

- accounts
- payments
- hidden autonomous agent runtime
- paid tools or unknown-cost cloud dependencies
- primary SEO content inside canvas
- 3D as a default requirement

## Required Design Direction Difference

Prepare four directions. They must be structurally different, not recolored
variants of the same layout.

Each direction must differ in at least these areas:

- first viewport composition
- navigation rhythm
- service explanation model
- proof/trust strategy
- CTA placement and wording logic
- demo-link presentation
- motion concept
- mascot/avatar behavior
- typography scale and density
- light/dark mode feel
- mobile layout behavior

Reject a direction if its only meaningful differences are palette, spacing,
icons, or background gradient.

Accepted RadeQ direction baseline from PR `https://github.com/SirRadek/radeq/pull/2`
and commit `a649c4a`:

- A: `Guided Offer Map` remains the conversion-safe explanation path.
- B: `Cat Concierge` uses the mascot as a playful guide, not as decoration or
  primary content.
- C: `Studio Proof` uses bold agency/editorial principles, proof artifacts,
  demos, handoff evidence, and confident CTA rhythm.
- D: `Demo Worlds` makes demos feel like separate miniature product worlds.

Future RadeQ explorations should preserve this principle: share data and
guardrails, but do not share the same layout skeleton across named directions.

Each direction may cross expressive themes, but must name the crossing and its
counterweight. Useful axes include lightness, freedom, novelty, standing out,
modern retro, art, futurism, pixel vibe, chill/calm, calculated minimalism,
focus, dopamine color, artistic 3D/modeling, animation, written/editorial craft,
and colorful visual language. Do not use all axes at once. For each direction,
choose one primary personality axis, one contrast axis, and one proof/product
axis, then state the SEO, mobile, accessibility, performance, and conversion
compromise.

Each demo example should feel like a different miniature product world, not the
same page shell with a different accent color. Use different compositions for
blog/docs, request page, team overview, shop/offer, dashboard, automation, and
AI/chatbot demos when relevant.

## Cat Avatar And Playful Motion

The cat avatar is a brand/playfulness asset, not the core content.

Known local asset evidence:

- current selected model is a small CC0 Quaternius cat GLB
- it is stylized low-poly, not a realistic fur simulation
- available clips include idle/headbutt/walk/run/jump variants
- private original cat photos remain local reference only and must not be
  published or sent to cloud tools

Improve perceived realism through behavior and staging before chasing heavier
assets:

- subtle head/gaze following pointer with natural delay
- tail idle motion, weight shift, small body turns, and idle breathing
- occasional headbutt or curious step near a CTA when it supports conversion
- section-aware poses, but no constant attention-stealing movement
- mobile simplification and static fallback
- reduced-motion fallback that disables non-essential movement
- WebGL failure fallback with equivalent brand cue in HTML/CSS/image

If a new cat asset, generated image, texture, rig, animation, or model is
proposed, the supervisor must require:

- source and license or usage-rights check
- performance budget impact
- mobile and reduced-motion fallback
- visual QA screenshots
- canvas nonblank check if WebGL is used
- no primary SEO content hidden inside the mascot/canvas

## Supervisor Watchpoints For RadeQ

Watch specifically for:

- returning to the official live site as the hidden baseline
- four variants becoming the same page with different colors
- over-dark technical look without a friendly light mode
- motion that makes the site less clear for non-technical customers
- mascot covering copy, CTA, form fields, or mobile content
- demo links becoming decorative instead of useful proof
- copy that explains technology to developers rather than outcomes to buyers
- SEO metadata or static content being removed
- performance regressions from media, canvas, animations, or libraries
- lead form validation, privacy minimization, D1 assumptions, or error handling
  being changed accidentally
- GitHub Pages vs Cloudflare Pages deployment target confusion
- Gemini or other advisory output being adopted without local/source
  verification

## Required First RadeQ Output

Before implementation, output:

1. Runtime and tool status.
2. GitHub baseline inventory with source pointers.
3. Summary of latest relevant GitHub versions/proposals.
4. Why prior variants were too similar.
5. Product & Design OS classification and scope.
6. Strict Product Opposition.
7. Four distinct directions with different layout, motion, mascot, proof, CTA,
   light/dark, mobile, and demo strategies.
8. Rejected ideas and reasons.
9. Implementation plan by preview slice.
10. QA plan: build, responsive, accessibility, SEO, performance, visual QA,
    reduced motion, WebGL/cat fallback, and lead-capture guard.
11. Progress state and next handoff packet.

Do not implement until the plan locks exact files, non-work, and verification.
