---
id: gpt-codex
title: GPT Codex Repo Work
model_family: gpt
task_type: development
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - openai-prompt-engineering
  - openai-reasoning-best-practices
  - local-agents-md
risk_level: high
requires:
  - mesh_packet
  - bounded_file_scope
  - tests
forbidden:
  - full_repo_dump
  - unreviewed_worker_output
expected_output: Repository patch with mesh routing, scoped files, and verification.
evals:
  - 05-evaluation/checklist.md
---

# GPT Codex Repo Work

Use Decision Mesh first when required. Prefer `rg` for discovery, read only
necessary files, use local deterministic checks, and keep the final response
short with verification evidence.
