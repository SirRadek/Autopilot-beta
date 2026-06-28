---
id: research-corpus-scan
title: Research Corpus Scan
model_family: gemini
task_type: brainstorming
version: v0.1.0
status: candidate
last_reviewed: 2026-06-19
sources:
  - research-intelligence-operating-model
  - gemini-input-packet-template
  - gemini-prompt-design-strategies
  - sources-and-citations
risk_level: medium
requires:
  - redacted_question
  - corpus_or_scope
forbidden:
  - unredacted_private_data
  - model_output_as_source_of_truth
  - unverified_claims_as_facts
expected_output: Redacted option expansion over a large corpus with candidate findings and claims to verify.
evals:
  - 05-evaluation/checklist.md
  - 05-evaluation/research-lane-cases.md
---

# Research Corpus Scan

Gemini large-context lane for expanding options over a big redacted corpus.
Advisory only.

## Prompt Contract

Send the redacted question and the corpus or scope. Ask for:

- candidate findings, patterns, and options across the corpus
- contradictions and outliers worth a closer look
- a separated list of claims to verify with a primary source

Rules:

- Redacted context only; no secrets, customer data, or private repository details.
- Every finding is a hypothesis until verified through Context7, official docs,
  local files, or tests.
- Do not present scanned text as authoritative fact.

## Eval Results

2026-06-20 manual fixture eval against
`prompt-library/05-evaluation/research-lane-cases.md`: pass for redacted corpus
expansion, candidate pattern discovery, contradiction/outlier surfacing,
claims-to-verify separation, and no source-of-truth claims. The prompt remains
`candidate`.
