---
id: gpt-development
title: GPT Development
model_family: gpt
task_type: development
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - openai-prompt-engineering
  - openai-structured-outputs
risk_level: medium
requires:
  - file_scope
  - repo_patterns
  - tests
forbidden:
  - unrelated_refactor
  - destructive_git_operation
expected_output: Scoped implementation with tests and verification evidence.
evals:
  - 05-evaluation/test-inputs.md
---

# GPT Development

Use existing repo patterns. Read only necessary files. Implement the requested
change, avoid unrelated refactors, and verify with targeted tests before broad
checks.
