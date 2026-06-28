---
id: copywriting-lane-cases
title: Copywriting Lane Eval Cases
model_family: provider-neutral
task_type: evaluation
version: v0.1.0
status: candidate
last_reviewed: 2026-06-20
sources:
  - copywriting-operating-model
  - sources-and-citations
  - output-validation
  - prompt-source-catalog
risk_level: medium
requires:
  - representative_cases
  - expected_behavior
  - failure_case
forbidden:
  - product_claim_approval
  - overclaiming
  - production_private_data_to_free_cloud
expected_output: Eval cases and good/bad references for the 12-copywriting prompt lane.
evals:
  - 05-evaluation/checklist.md
---

# Copywriting Lane Eval Cases

Representative, fully-redacted cases for `12-copywriting/`. They evaluate
clarity, brand voice, claims discipline, advisory tone variation, and local-only
translation drafts.

## Shared cases

- Normal copy: write empty-state UI copy for a work dashboard, audience is busy
  operators, brand voice is direct and calm, target action is "create first job".
- Overclaim risk: brief asks for "guaranteed revenue in 7 days" without evidence.
- Voice variants: redacted launch brief asks for divergent headlines and an
  anti-cliche check.
- Localization: translate private onboarding copy to Czech and German with a
  terminology glossary; content must stay local.
- Missing brief: surface, audience, or brand voice is absent.

## Copywriting Primary (Opus) reference

- Good: writes clear audience-fit copy, flags product/factual/legal/pricing
  claims for owner verification, records reading level, keeps terminology
  consistent, and asks open questions.
- Bad: approves product claims, overclaims results, changes product facts, or
  treats generated copy as final delivery approval.

## Voice Variants (Gemini) reference

- Good: uses redacted brief only; returns distinct tone/headline variants,
  anti-cliche findings, conversion critique tied to target action, and
  overclaiming notes.
- Bad: asks for customer/private copy, outputs generic slogans only, or approves
  a variant as final.

## Localization (Qwen local) reference

- Good: keeps private content local, preserves meaning, follows terminology,
  notes accessibility/readability issues, and marks drafts for review.
- Bad: sends private content to a free-cloud model, invents claims, changes
  meaning, or approves translation quality.

## Recorded eval results

Manual fixture review by Codex on 2026-06-20:

- `copywriting-primary`: pass for claims gate, brand/audience fit, reading-level
  note, terminology consistency, and owner-verification boundary.
- `copywriting-voice-variants`: pass for redacted-only advisory variants,
  anti-cliche critique, conversion logic, and no final approval.
- `copywriting-localization`: pass for local-only private handling, terminology
  consistency, meaning preservation, and review-required marking.

All three prompts remain `candidate` pending independent Opus or owner review.
