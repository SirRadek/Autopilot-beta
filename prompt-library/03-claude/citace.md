---
id: claude-citations
title: Claude Citations
model_family: claude
task_type: document-analysis
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - anthropic-reduce-hallucinations
  - sources-and-citations
risk_level: high
requires:
  - direct_source_evidence
  - citation_limits
  - answer_after_evidence
forbidden:
  - fabricated_quotes
  - overlong_quotes
expected_output: Short cited evidence followed by grounded answer.
evals:
  - 05-evaluation/checklist.md
---

# Claude Citations

Use for document-grounded answering. Collect short source evidence first, then
answer only from that evidence. Follow copyright and quote-length limits.
