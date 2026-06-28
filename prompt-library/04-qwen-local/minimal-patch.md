---
id: qwen-minimal-patch
title: Qwen Minimal Patch
model_family: qwen-local
task_type: minimal-patch
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - qwen-chat-template
  - output-validation
risk_level: medium
requires:
  - one_task
  - file_scope
  - diff_only
forbidden:
  - speculative_refactor
expected_output: Minimal patch draft plus test command suggestion.
evals:
  - 05-evaluation/good-vs-bad-outputs.md
---

# Qwen Minimal Patch

Give Qwen one small task and one file scope. Ask for the smallest patch that
solves the issue and a test command. Do not ask it to approve the change.
