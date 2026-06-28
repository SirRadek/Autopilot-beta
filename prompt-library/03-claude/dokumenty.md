---
id: claude-documents
title: Claude Documents
model_family: claude
task_type: document-analysis
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - anthropic-prompting-best-practices
  - anthropic-reduce-hallucinations
risk_level: high
requires:
  - quoted_evidence
  - source_boundaries
  - uncertainty_marking
forbidden:
  - claims_not_in_document
expected_output: Document answer grounded in extracted evidence and uncertainty.
evals:
  - 05-evaluation/good-vs-bad-outputs.md
---

# Claude Documents

For long documents, extract relevant evidence before analysis. If the document
does not contain the answer, state that clearly instead of inferring beyond the
source.
