---
id: claude-xml-analysis
title: Claude XML Analysis
model_family: claude
task_type: analysis
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - anthropic-prompting-best-practices
risk_level: medium
requires:
  - structured_context
  - output_tags
  - examples_when_needed
forbidden:
  - ambiguous_tag_scope
expected_output: Structured analysis with clear sections and explicit uncertainty.
evals:
  - 05-evaluation/test-inputs.md
---

# Claude XML Analysis

Use XML-style sections when structure improves parsing. Keep tags semantic and
simple, for example `<context>`, `<task>`, `<constraints>`, and `<output>`.
