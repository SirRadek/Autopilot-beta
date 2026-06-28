---
id: prompt-evaluation-checklist
title: Prompt Evaluation Checklist
model_family: provider-neutral
task_type: evaluation
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - openai-prompt-engineering
  - anthropic-prompting-best-practices
  - gemini-prompt-design-strategies
  - qwen-chat-template
risk_level: medium
requires:
  - metadata_complete
  - source_check
  - eval_result
forbidden:
  - prompt_without_owner_review
expected_output: Pass/fail checklist for prompt adoption.
evals:
  - 05-evaluation/test-inputs.md
---

# Prompt Evaluation Checklist

Before a prompt becomes a default:

- Metadata is complete.
- Model family is explicit.
- Sources are listed and current enough.
- The prompt does not depend on leaked system prompts.
- It includes uncertainty behavior.
- It includes output validation rules.
- It has at least one normal case and one failure case.
- It has been reviewed after any provider-model change.
- It has a rollback path through Git.
