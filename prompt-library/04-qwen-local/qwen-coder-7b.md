---
id: qwen-coder-7b
title: Qwen Coder 7B Local Worker
model_family: qwen-local
task_type: minimal-patch
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - qwen-chat-template
  - local-worker-operating-model
risk_level: medium
requires:
  - bounded_file_scope
  - exact_task
  - reviewer
forbidden:
  - architecture_decision
  - broad_refactor
expected_output: Small draft patch or explanation for supervisor review.
evals:
  - 05-evaluation/checklist.md
---

# Qwen Coder 7B Local Worker

Use for small local drafts only. Keep context tight, provide exact file scope,
and ask for a patch or summary that Codex reviews before applying.
