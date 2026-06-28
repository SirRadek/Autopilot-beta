---
id: anti-hallucination
title: Anti-Hallucination Rule
model_family: provider-neutral
task_type: rule
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - openai-prompt-engineering
  - anthropic-reduce-hallucinations
  - gemini-prompt-design-strategies
risk_level: high
requires:
  - source_authority
  - uncertainty_marking
  - verification_plan
forbidden:
  - invented_sources
  - hidden_assumptions
  - model_output_as_source_of_truth
expected_output: Claims include evidence, uncertainty, and verification status.
evals:
  - 05-evaluation/checklist.md
---

# Anti-Hallucination Rule

Use this rule for factual, technical, legal, medical, financial, project, or
provider-current claims.

## Prompt Contract

State what is known from sources, what is inferred, and what is unknown. If the
answer cannot be established from available evidence, say that it cannot be
determined yet and identify the missing source or test.

Do not invent citations, versions, pricing, APIs, file contents, project state,
or user decisions. Advisory model output is an idea until verified against
official docs, local files, tests, controlled browser evidence, or the relevant
Decision Mesh.

## Acceptance Checks

- Every unstable claim has a source or verification command.
- Uncertain values are marked as uncertain.
- No unsupported provider/version/pricing claim is adopted.
- The final answer separates verified facts from recommendations.
