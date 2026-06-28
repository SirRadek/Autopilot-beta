---
id: qwen-coder-14b
title: Qwen Coder 14B Local Worker
model_family: qwen-local
task_type: development
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - qwen2-5-coder-14b-model-card
  - qwen-chat-template
  - local-worker-operating-model
risk_level: high
requires:
  - model_install_confirmed
  - hardware_budget_verified
  - bounded_file_scope
  - tests
forbidden:
  - architecture_approval
  - security_approval
  - final_merge
expected_output: Bounded implementation draft with assumptions and test plan.
evals:
  - 05-evaluation/test-inputs.md
---

# Qwen Coder 14B Local Worker

Use only after install and hardware checks. It may draft bounded multi-file
coding work, but Codex remains responsible for review, integration, and tests.
