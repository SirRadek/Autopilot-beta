---
id: qwen-tests
title: Qwen Tests
model_family: qwen-local
task_type: test-generation
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - qwen-chat-template
  - output-validation
risk_level: medium
requires:
  - behavior_contract
  - existing_test_style
  - deterministic_runner
forbidden:
  - deleting_tests
  - hardcoded_pass
expected_output: Focused test draft matching existing style.
evals:
  - 05-evaluation/test-inputs.md
---

# Qwen Tests

Ask for focused tests that match existing style. Include the behavior contract
and runner command. Never accept deleted or weakened tests without review.
