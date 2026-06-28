---
id: copywriting-voice-variants
title: Copywriting Voice Variants
model_family: gemini
task_type: variant-generation
version: v0.1.0
status: candidate
last_reviewed: 2026-06-19
sources:
  - copywriting-operating-model
  - gemini-input-packet-template
  - gemini-prompt-design-strategies
risk_level: medium
requires:
  - redacted_brief
  - brand_voice
  - target_action
forbidden:
  - unredacted_private_data
  - delivery_approval
  - model_output_as_source_of_truth
expected_output: Redacted divergent tone and headline variants with an anti-cliche and conversion critique.
evals:
  - 05-evaluation/checklist.md
  - 05-evaluation/copywriting-lane-cases.md
---

# Copywriting Voice Variants

Gemini brand-voice reviewer and creative opponent lane. Redacted advisory only.
The owner holds the approval gate.

## Prompt Contract

Send a redacted brief, the brand voice, and the target action. Ask for:

- divergent headline and tone variants that fit the brand voice
- an anti-cliche check that flags generic or AI-sounding copy
- a conversion-logic critique tied to the target action
- a note on any variant that risks overclaiming

Rules:

- Redacted context only; no real customer names or private content.
- Treat output as advisory ideas, not final copy.
- Do not approve copy or delivery; the Copywriter synthesizes and the owner
  approves.

## Eval Results

2026-06-20 manual fixture eval against
`prompt-library/05-evaluation/copywriting-lane-cases.md`: pass for redacted-only
variant generation, anti-cliche critique, conversion-logic review,
overclaiming-risk notes, and no final approval. The prompt remains `candidate`.
