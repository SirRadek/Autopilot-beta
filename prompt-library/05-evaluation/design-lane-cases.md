---
id: design-lane-cases
title: Design Lane Eval Cases
model_family: provider-neutral
task_type: evaluation
version: v0.1.0
status: candidate
last_reviewed: 2026-06-20
sources:
  - design-intelligence-operating-model
  - graphic-agent-operating-model
  - product-design-os
  - output-validation
risk_level: medium
requires:
  - representative_cases
  - expected_behavior
  - failure_case
forbidden:
  - production_private_data
  - unlicensed_asset
  - primary_content_hidden_in_canvas
expected_output: Eval cases and good/bad references for the 09-design prompt lane.
evals:
  - 05-evaluation/checklist.md
---

# Design Lane Eval Cases

Representative, fully-redacted cases for `09-design/`. They evaluate whether
visual production keeps primary content in the DOM, uses the smallest sufficient
toolchain, preserves fallbacks, and hands critique to a separate role.

## Shared cases

- Normal build: marketing hero needs a static product diagram, primary CTA, and
  responsive layout with a 150 KB asset budget.
- 3D request: owner asks for WebGL motion, but the brief does not explain what
  depth or motion clarifies.
- Asset-risk request: a reference screenshot includes an unknown-license image
  and asks for direct reuse.
- Render critique: screenshot, visual brief, and acceptance criteria are present.
- Missing-brief critique: screenshot is present but the target audience and
  acceptance criteria are missing.

## Visual Build (Codex) reference

- Good: chooses HTML/CSS/SVG before Canvas or Three.js when static design is
  enough; keeps text, CTA, forms, and SEO content in HTML; records asset sources
  and licenses; adds mobile and reduced-motion fallbacks; captures deterministic
  visual evidence; hands off to the Design Critic.
- Bad: hides primary text in canvas/WebGL, copies an unknown-license reference,
  skips mobile/reduced-motion fallbacks, or claims delivery approval.

## Critique From Render (Gemini) reference

- Good: returns a verdict, scores the stated criteria, ties findings to visible
  evidence and the brief, lists deterministic checks still needed, and names
  required rework without approving delivery.
- Bad: gives taste-only feedback, invents unseen context, accepts missing
  performance/accessibility evidence, or critiques its own production.

## Recorded eval results

Manual fixture review by Codex on 2026-06-20:

- `design-visual-build`: pass for smallest-toolchain selection, DOM-first
  content, fallback requirements, asset/source gates, and producer/critic split.
- `design-critique-from-render`: pass for evidence-tied critique, scored
  criteria, missing-brief restraint, and no delivery approval.

Both prompts remain `candidate` pending independent design or owner review.
