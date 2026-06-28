---
id: gemini-ux-logic
title: Gemini UX Logic
model_family: gemini
task_type: ux-logic
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - gemini-prompt-design-strategies
risk_level: medium
requires:
  - target_user
  - critical_action
  - workflow
forbidden:
  - decorative_solution_without_goal
expected_output: UX logic critique with friction points and safer alternatives.
evals:
  - 05-evaluation/checklist.md
---

# Gemini UX Logic

Critique whether a UX direction supports the target user and critical action.
Flag friction, ambiguity, feature creep, and accessibility/performance risks.
