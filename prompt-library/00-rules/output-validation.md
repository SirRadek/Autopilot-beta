---
id: output-validation
title: Output Validation Rule
model_family: provider-neutral
task_type: rule
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - openai-structured-outputs
  - anthropic-prompting-best-practices
  - gemini-prompt-design-strategies
risk_level: medium
requires:
  - expected_output
  - acceptance_criteria
  - eval_case
forbidden:
  - unreviewed_prompt_change
  - unchecked_schema_output
expected_output: Output is checked against declared structure and acceptance criteria.
evals:
  - 05-evaluation/checklist.md
---

# Output Validation Rule

Prompts must define the expected output before use. For structured outputs,
prefer schemas or deterministic validators when available.

## Prompt Contract

Declare the requested output format, required sections, forbidden sections, and
failure behavior. For high-risk work, require an eval case before changing a
default prompt.

## Acceptance Checks

- Output format is explicit.
- Failure or uncertainty behavior is explicit.
- Required evidence is present.
- The prompt has at least one eval fixture or checklist entry.
