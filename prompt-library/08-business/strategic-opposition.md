---
id: business-strategic-opposition
title: Business Strategic Opposition
model_family: gemini
task_type: brainstorming
version: v0.1.0
status: candidate
last_reviewed: 2026-06-19
sources:
  - business-intelligence-operating-model
  - gemini-input-packet-template
  - gemini-prompt-design-strategies
risk_level: high
requires:
  - redacted_baseline
  - target_segment
  - scoring_criteria
forbidden:
  - unredacted_private_data
  - delivery_approval
  - model_output_as_source_of_truth
  - workspace_or_process_review_instead_of_task
expected_output: Redacted advisory opposition with positioning, conversion, and SEO findings, alternatives, and claims to verify.
evals:
  - 05-evaluation/checklist.md
  - 05-evaluation/business-lane-cases.md
---

# Business Strategic Opposition

Use as redacted advisory only, after free/no-cost availability is confirmed. This
is the Gemini strategic/creative opponent and SEO lane in the Business
Intelligence Operating Model.

## Prompt Contract

Send a compact redacted baseline only: no real revenue, customer names, account
identifiers, contracts, private repository details, or absolute local paths.

Ask the model to act as a strategic opponent for the redacted business move and
return:

- positioning risks and where the move looks generic or me-too
- differentiation findings and conversion-logic weaknesses
- SEO and discoverability findings for public-facing parts
- alternative directions the owner has not considered
- a separated list of claims to verify (market size, pricing, competitors, tech)

Rules:

- Treat all output as advisory ideas, not facts.
- Every market, pricing, competitor, technology, or SEO claim is a hypothesis
  until verified through Context7 or a primary source.
- If the model reviews Autopilot internals, workspace, or process instead of the
  redacted task, discard the output and record the failure.

## Eval Results

2026-06-20 manual fixture eval against
`prompt-library/05-evaluation/business-lane-cases.md`: pass for redacted-only
strategic opposition, positioning/conversion/SEO findings, claims-to-verify
separation, and refusal to process unredacted private business data. The prompt
remains `candidate`; Gemini output stays advisory until verified.
