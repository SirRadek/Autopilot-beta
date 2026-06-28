---
id: gpt-audit
title: GPT Audit
model_family: gpt
task_type: audit
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - openai-prompt-engineering
  - openai-reasoning-best-practices
risk_level: high
requires:
  - evidence
  - severity
  - file_refs
forbidden:
  - vague_findings
  - self_approval
expected_output: Findings first, ordered by severity, with evidence and tests.
evals:
  - 05-evaluation/good-vs-bad-outputs.md
---

# GPT Audit

Review for bugs, regressions, missing tests, security issues, and operational
risk. Findings come first. Each finding needs evidence and a concrete impact.
