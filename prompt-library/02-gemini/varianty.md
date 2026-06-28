---
id: gemini-variants
title: Gemini Variants
model_family: gemini
task_type: variant-generation
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - gemini-prompt-design-strategies
  - gemini-multimodal-prompt-design
risk_level: medium
requires:
  - distinct_axes
  - constraints
  - verification_followup
forbidden:
  - palette_only_variants
  - ungrounded_best_practice_claims
expected_output: Distinct variants with tradeoffs and evaluation criteria.
evals:
  - 05-evaluation/good-vs-bad-outputs.md
---

# Gemini Variants

Generate variants that differ by strategy, structure, workflow, motion concept,
proof strategy, and risk profile. Color-only variants fail this prompt.
