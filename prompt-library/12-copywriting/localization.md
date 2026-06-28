---
id: copywriting-localization
title: Copywriting Localization
model_family: qwen-local
task_type: copywriting
version: v0.1.0
status: candidate
last_reviewed: 2026-06-19
sources:
  - copywriting-operating-model
  - qwen-chat-template
  - output-validation
risk_level: medium
requires:
  - source_copy
  - target_locales
  - terminology_glossary
forbidden:
  - approve_translation_quality
  - invent_claims
  - send_private_content_to_free_cloud
expected_output: Local translation drafts with consistent terminology and accessibility-language notes, marked for review.
evals:
  - 05-evaluation/checklist.md
  - 05-evaluation/copywriting-lane-cases.md
---

# Copywriting Localization

Qwen local lane for translation drafts. Runs fully local for private or bulk
content. Drafts only; the Localization Reviewer gate stays with the owner or
Opus.

## Prompt Contract

Given source copy, target locales, and a terminology glossary, produce:

- translation drafts per locale
- terminology kept consistent with the glossary
- accessibility-language notes (reading level, idioms to avoid)
- a list of segments that need human or Opus review

Rules:

- Stay local; do not send private content to a free-cloud model.
- Do not invent claims or change meaning during translation.
- Mark drafts as needing review; localization quality is approved by the owner or
  the Localization Reviewer, not by this lane.

## Eval Results

2026-06-20 manual fixture eval against
`prompt-library/05-evaluation/copywriting-lane-cases.md`: pass for local-only
private handling, terminology consistency, meaning preservation,
accessibility-language notes, and review-required marking. The prompt remains
`candidate`.
