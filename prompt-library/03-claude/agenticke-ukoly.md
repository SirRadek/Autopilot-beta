---
id: claude-agentic-tasks
title: Claude Agentic Tasks
model_family: claude
task_type: agentic-task
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - anthropic-prompting-best-practices
risk_level: high
requires:
  - scope
  - reversible_actions
  - progress_state
  - tests
forbidden:
  - destructive_unapproved_actions
  - unbounded_subagents
expected_output: Agentic plan with safe actions, state tracking, and verification.
evals:
  - 05-evaluation/test-inputs.md
---

# Claude Agentic Tasks

Use for long-horizon work. Specify reversible actions, state tracking, tool
boundaries, when subagents are useful, and when to ask before risky actions.
