---
id: design-critique-from-render
title: Design Critique From Render
model_family: gemini
task_type: ux-logic
version: v0.1.0
status: candidate
last_reviewed: 2026-06-19
sources:
  - design-intelligence-operating-model
  - graphic-agent-operating-model
  - gemini-multimodal-prompt-design
risk_level: medium
requires:
  - rendered_screenshot
  - visual_brief
  - acceptance_criteria
forbidden:
  - reviewing_own_production
  - delivery_approval
  - unredacted_private_data
  - model_output_as_source_of_truth
expected_output: Evidence-based visual critique with verdict, scored criteria, findings, and required rework.
evals:
  - 05-evaluation/checklist.md
  - 05-evaluation/design-lane-cases.md
---

# Design Critique From Render

Gemini multimodal critique lane. Gemini can see the rendered screenshot, so it
runs as the Design Critic against the brief. Opus normalizes the output into
evidence and rework. The critic is never the producer.

## Prompt Contract

Send the rendered screenshot plus the redacted visual brief and acceptance
criteria. Ask for:

- a verdict: pass, pass with notes, rework, or reject
- scores for hierarchy, clarity, brand fit, motion value, accessibility,
  performance, and maintainability
- specific findings tied to what is visible, not taste-only feedback
- required rework

Rules:

- Critique only what is visible plus the stated brief; do not invent context.
- Treat output as advisory; verify accessibility and performance claims with
  deterministic checks (contrast, Playwright, budgets).
- Do not approve delivery and do not critique your own production.

## Eval Results

2026-06-20 manual fixture eval against
`prompt-library/05-evaluation/design-lane-cases.md`: pass for evidence-tied
render critique, scored criteria, missing-brief restraint, required rework, and
no delivery approval. The prompt remains `candidate`.
