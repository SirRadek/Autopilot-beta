---
id: gpt-reasoning-analysis
title: GPT Reasoning Analysis
model_family: gpt
task_type: analysis
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - openai-prompt-engineering
  - openai-reasoning-best-practices
risk_level: medium
requires:
  - goal
  - constraints
  - source_evidence
forbidden:
  - exposed_chain_of_thought
  - unsupported_current_claims
expected_output: Concise analysis with facts, assumptions, risks, and recommendation.
evals:
  - 05-evaluation/test-inputs.md
---

# GPT Reasoning Analysis

Use for complex analysis where the model should reason internally and return a
decision-ready summary.

## Prompt Contract

Analyze the task from the stated goal, available evidence, constraints, and
risks. Keep internal reasoning private. Return facts, assumptions, conflicts,
risks, and a recommended next step. Use sources for unstable claims.
