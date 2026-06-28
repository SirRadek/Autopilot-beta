---
id: gpt-fixes
title: GPT Fixes
model_family: gpt
task_type: fix
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - openai-prompt-engineering
  - openai-reasoning-best-practices
risk_level: medium
requires:
  - reproduction
  - root_cause
  - regression_test
forbidden:
  - symptom_only_patch
  - skipped_verification
expected_output: Root-cause fix with focused regression evidence.
evals:
  - 05-evaluation/test-inputs.md
---

# GPT Fixes

Find the root cause before editing. Fix the narrowest failing behavior and add
or run a regression check that would have caught the failure.
