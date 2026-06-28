---
id: sources-and-citations
title: Sources And Citations Rule
model_family: provider-neutral
task_type: rule
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - openai-prompt-engineering
  - anthropic-prompting-best-practices
  - prompt-source-catalog
risk_level: medium
requires:
  - source_priority
  - citation_or_local_command
  - official_docs_fallback
forbidden:
  - leaked_prompt_sources
  - uncited_current_claims
expected_output: Current claims include source pointers or local verification evidence.
evals:
  - 05-evaluation/checklist.md
---

# Sources And Citations Rule

Use official provider docs for provider-specific prompting behavior. Use local
repo files and tests for Autopilot behavior. Use DAIR.AI and GitHub catalogs as
inspiration only.

## Prompt Contract

For every current technical claim, provide one of:

- official documentation source
- Context7 source when connected
- local file path and verification command
- controlled browser evidence
- explicit "not verified yet" label

Do not use leaked system prompts or prompt packs as authority.
