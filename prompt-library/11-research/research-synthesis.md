---
id: research-synthesis
title: Research Synthesis
model_family: claude
task_type: analysis
version: v0.1.0
status: candidate
last_reviewed: 2026-06-19
sources:
  - research-intelligence-operating-model
  - sources-and-citations
  - anthropic-prompting-best-practices
  - prompt-source-catalog
risk_level: high
requires:
  - research_question
  - source_set
  - decision_to_inform
forbidden:
  - unsourced_claims
  - model_output_as_source_of_truth
  - leaked_or_unlicensed_sources
expected_output: Sourced synthesis that turns research into a decision with confidence levels and gaps.
evals:
  - 05-evaluation/checklist.md
  - 05-evaluation/research-lane-cases.md
---

# Research Synthesis

Opus lane that turns research into a decision. Technology, library, and
best-practice claims pass the docs-verification lane: Context7 when connected,
official documentation otherwise.

## Prompt Contract

Given a research question and a source set, return:

- the answer with a source for every load-bearing claim
- a confidence level per claim and where evidence conflicts
- gaps that still need primary-source verification
- the decision the research supports and the open questions

Rules:

- Prefer official and primary sources; mark inspiration-only sources as such.
- Verify framework, library, SDK, API, SEO, and accessibility claims through
  Context7 or official docs before they enter a plan.
- Model output is never the source of truth.

## Eval Results

2026-06-20 manual fixture eval against
`prompt-library/05-evaluation/research-lane-cases.md`: pass for primary-source
preference, confidence labels, conflict handling, gaps, decision fit, and
blocking leaked or unknown-license sources. The prompt remains `candidate`.
