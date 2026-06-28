---
id: prompt-test-inputs
title: Prompt Test Inputs
model_family: provider-neutral
task_type: evaluation
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - output-validation
  - prompt-source-catalog
risk_level: medium
requires:
  - representative_cases
  - expected_behavior
  - failure_case
forbidden:
  - production_private_data
expected_output: Eval inputs with expected behavior and failure cases.
evals:
  - 05-evaluation/checklist.md
---

# Prompt Test Inputs

Maintain small representative cases for each prompt:

- normal request
- ambiguous request
- missing-source request
- conflicting-instructions request
- high-risk request requiring stop or escalation

Do not use production secrets, customer data, private repository dumps, or raw
project logs in prompt evals.
