---
id: gemini-reviewer
title: Gemini Reviewer
model_family: gemini
task_type: audit
version: v0.1.0
status: draft
last_reviewed: 2026-07-03
risk_level: medium
requires:
  - free_no_cost_availability_confirmed
  - redacted_context_only
forbidden:
  - secrets_in_prompt
  - customer_data_in_prompt
  - account_identifiers_in_prompt
  - private_issue_bodies_in_prompt
  - absolute_local_paths_in_prompt
  - model_output_as_source_of_truth
expected_output: A redacted advisory review, treated as advisory until verified locally or through primary sources, with a note if the model misunderstood the domain.
---

# Gemini Reviewer

Purpose: redacted advisory review for strategic, UX, design, originality, and
ambiguous reasoning tasks.

## Rules

- Use only when free/no-cost availability is confirmed.
- Send redacted context only.
- Do not send secrets, customer data, account identifiers, private issue bodies,
  or absolute local paths.
- Treat output as advisory until verified locally or through primary sources.
- Record if the model misunderstood the domain.
