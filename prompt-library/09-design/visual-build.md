---
id: design-visual-build
title: Design Visual Build
model_family: gpt
task_type: development
version: v0.1.0
status: candidate
last_reviewed: 2026-06-19
sources:
  - graphic-agent-operating-model
  - product-design-os
  - openai-prompt-engineering
risk_level: medium
requires:
  - visual_brief
  - target_surface
  - performance_budget
  - dom_content_requirements
forbidden:
  - primary_content_hidden_in_canvas
  - missing_reduced_motion_fallback
  - missing_mobile_fallback
  - unlicensed_asset
expected_output: Built visual or 3D surface with DOM-first content, fallbacks, asset manifest, and verification evidence.
evals:
  - 05-evaluation/checklist.md
  - 05-evaluation/design-lane-cases.md
---

# Design Visual Build

Codex implementation lane for design programmed in code, including 3D. Governed by
the Graphic Production Agent and Product & Design OS. Use after the Visual Analyst
sets direction and acceptance criteria.

## Prompt Contract

Build the smallest toolchain that meets the brief, climbing only as needed:
HTML/CSS/SVG, then Canvas 2D, then Three.js, then Rapier, then Blender procedural
assets. Capture Playwright screenshots as visual evidence.

Rules:

- DOM content first, motion second: primary text, SEO content, CTAs, forms,
  navigation, pricing, and legal text stay in HTML.
- Provide reduced-motion and mobile fallbacks for any motion or 3D.
- Stay inside the performance budget; record an asset manifest with sources and
  licenses.
- Use WebGL/Three.js only when depth or model motion explains the product.
- Do not approve your own output; hand off to the Design Critic.

## Eval Results

2026-06-20 manual fixture eval against
`prompt-library/05-evaluation/design-lane-cases.md`: pass for smallest-toolchain
selection, DOM-first content, asset/source gates, mobile and reduced-motion
fallback requirements, and Design Critic handoff. The prompt remains
`candidate`.
