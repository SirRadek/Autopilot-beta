---
id: codex-research-before-implementation
title: Codex Research Before Implementation
model_family: gpt
task_type: analysis
version: v0.1.0
status: candidate
last_reviewed: 2026-07-04
sources:
  - prompt-source-catalog
  - sources-and-citations
  - openai-prompt-engineering
risk_level: medium
requires:
  - research_question
  - web_search_lane
  - source_hierarchy
forbidden:
  - implementation_in_this_mode
  - model_memory_as_source
  - undated_claims
  - private_data
expected_output: Recommended solution with dated sources, risks, prototype verification list, and dependency/license note for an evidence record.
evals:
  - 05-evaluation/checklist.md
  - 05-evaluation/research-lane-cases.md
---

# Codex Research Before Implementation

MODE contract for codex research runs on the web-search-enabled lane. No
implementation in this mode — no code edits, no patches, research output only.

## Question

State the research question up front, in one or two sentences, before any
searching. If the question is ambiguous, output `NEED_SPEC_CLARIFICATION`
with numbered questions and stop.

## Source Order

1. Internal catalogs and presets (source catalog, PDOS library, effect
   catalog).
2. Official documentation.
3. Official repository and examples.
4. Maintainer forums.
5. Community sources — inspiration only, never authority.

Every claim needs a dated source (document version or publication date plus
retrieval date). Model memory is not a source; anything recalled without a
dated source is UNPROVEN and must be verified or dropped.

## Required Output

- Recommended solution.
- Sources with dates.
- Risks.
- What to verify in a small prototype before adoption.
- Whether a new dependency is needed — with a license note feeding an
  evidence record.
