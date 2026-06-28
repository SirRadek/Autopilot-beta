---
id: gemini-brainstorming
title: Gemini Brainstorming
model_family: gemini
task_type: brainstorming
version: v0.1.0
status: candidate
last_reviewed: 2026-06-03
sources:
  - gemini-prompt-design-strategies
  - gemini-multimodal-prompt-design
risk_level: medium
requires:
  - redacted_context
  - idea_labels
  - verification_followup
forbidden:
  - private_data
  - adopted_unverified_claims
expected_output: Labeled ideas, risks, and verification needs.
evals:
  - 05-evaluation/good-vs-bad-outputs.md
---

# Gemini Brainstorming

Use Gemini as advisory support for divergent thinking. Provide redacted context,
ask for multiple distinct options, and label all outputs as ideas until local
files, tests, Context7, or official docs verify them.

Use `02-gemini/input-packet-template.md` for the actual packet shape. Do not
send a full workspace dump or raw agent output. If the task is RadeQ design work,
use `02-gemini/radeq-design-brainstorming.md` so Gemini receives the product
brief instead of Autopilot governance context.
