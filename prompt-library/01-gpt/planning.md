---
id: gpt-planning
title: GPT Planning
model_family: gpt
task_type: planning
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - openai-prompt-engineering
  - openai-reasoning-best-practices
risk_level: medium
requires:
  - scope
  - acceptance_criteria
  - verification
forbidden:
  - implementation_before_scope
  - unbounded_plan
expected_output: Ordered plan with dependencies, stop conditions, and verification.
evals:
  - 05-evaluation/checklist.md
---

# GPT Planning

Create a bounded plan. Identify dependencies, exact non-goals, stop conditions,
and verification steps. Prefer the smallest useful work slice.
