---
id: qwen-code-review
title: Qwen Code Review Draft
model_family: qwen-local
task_type: code-review
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - qwen-chat-template
  - local-worker-operating-model
risk_level: medium
requires:
  - diff_context
  - findings_first
  - supervisor_review
forbidden:
  - final_approval
expected_output: Draft findings with file references and uncertainty labels.
evals:
  - 05-evaluation/good-vs-bad-outputs.md
---

# Qwen Code Review Draft

Use as a low-cost second pass for obvious bugs. Require file references and
uncertainty labels. Codex or another reviewer must verify every finding.
