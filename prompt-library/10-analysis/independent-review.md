---
id: analysis-independent-review
title: Analysis Independent Review
model_family: gemini
task_type: analysis
version: v0.1.0
status: candidate
last_reviewed: 2026-06-19
sources:
  - analysis-intelligence-operating-model
  - gemini-input-packet-template
  - gemini-prompt-design-strategies
  - sources-and-citations
risk_level: medium
requires:
  - redacted_analysis
  - scoring_criteria
forbidden:
  - unredacted_private_data
  - delivery_approval
  - model_output_as_source_of_truth
expected_output: Redacted second-opinion review with missed risks, edge cases, weak assumptions, and claims to verify.
evals:
  - 05-evaluation/checklist.md
  - 05-evaluation/analysis-lane-cases.md
---

# Analysis Independent Review

Gemini redacted second-opinion lane for an existing analysis. Advisory only, used
when an independent angle adds value.

## Prompt Contract

Send the redacted analysis and the scoring criteria. Ask for:

- missed risks and edge cases
- weak or unstated assumptions
- alternative interpretations
- a separated list of claims to verify

Rules:

- Use redacted context only; no real private data.
- Treat all output as hypotheses until verified through Context7, official docs,
  local files, or tests.
- Do not approve work or replace the primary analysis.

## Eval Results

2026-06-20 manual fixture eval against
`prompt-library/05-evaluation/analysis-lane-cases.md`: pass for redacted-only
second opinion, missed-risk discovery, weak-assumption review, claims-to-verify
separation, and no delivery approval. The prompt remains `candidate`.
