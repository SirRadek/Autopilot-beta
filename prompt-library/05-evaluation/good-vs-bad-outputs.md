---
id: good-vs-bad-outputs
title: Good Vs Bad Outputs
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
  - positive_example
  - negative_example
  - reviewer_notes
forbidden:
  - unreviewed_examples
expected_output: Reviewed examples showing acceptable and rejected behavior.
evals:
  - 05-evaluation/checklist.md
---

# Good Vs Bad Outputs

For each important prompt, store:

- one good output with why it passes
- one bad output with why it fails
- exact rules that decide the difference
- reviewer notes and date

This keeps prompt quality auditable instead of relying on taste or memory.
