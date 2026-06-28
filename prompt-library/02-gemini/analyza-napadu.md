---
id: gemini-idea-analysis
title: Gemini Idea Analysis
model_family: gemini
task_type: analysis
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - gemini-prompt-design-strategies
risk_level: medium
requires:
  - redacted_context
  - scoring_criteria
  - verification_followup
forbidden:
  - model_output_as_decision
expected_output: Ranked ideas with assumptions, risks, and verification plan.
evals:
  - 05-evaluation/checklist.md
---

# Gemini Idea Analysis

Ask Gemini to compare ideas against explicit criteria. Require assumptions,
risks, rejected options, and what must be verified before adoption.
