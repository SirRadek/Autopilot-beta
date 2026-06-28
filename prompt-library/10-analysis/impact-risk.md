---
id: analysis-impact-risk
title: Impact And Risk Analysis
model_family: claude
task_type: analysis
version: v0.1.0
status: candidate
last_reviewed: 2026-06-19
sources:
  - analysis-intelligence-operating-model
  - local-agents-md
  - anthropic-prompting-best-practices
  - sources-and-citations
risk_level: high
requires:
  - change_or_decision
  - affected_surfaces
  - constraints
  - source_evidence
forbidden:
  - implementation_without_approval
  - model_output_as_source_of_truth
  - hidden_scope_change
expected_output: Impact and risk analysis with affected areas, severity, tradeoffs, mitigations, and a recommendation.
evals:
  - 05-evaluation/checklist.md
  - 05-evaluation/analysis-lane-cases.md
---

# Impact And Risk Analysis

Opus decision-analyst lane for impact, risk, and tradeoff discovery before a
change is approved. This is the Analysis layer in the delivery-system model
policy.

## Prompt Contract

Given a proposed change or decision, return:

- affected surfaces and dependencies
- risks with severity and likelihood
- tradeoffs across the available options
- mitigations and a rollback path
- a recommendation and what must be verified before proceeding

Rules:

- Back load-bearing claims with sources; mark unverified ones as assumptions.
- Keep internal reasoning private; return the decision-ready result.
- Do not implement or approve; route bounded execution to Codex after approval.

## Eval Results

2026-06-20 manual fixture eval against
`prompt-library/05-evaluation/analysis-lane-cases.md`: pass for affected-surface
mapping, ownership classification, severity/likelihood calibration, rollback
path, must-verify list, and no implementation or approval. The prompt remains
`candidate`.
