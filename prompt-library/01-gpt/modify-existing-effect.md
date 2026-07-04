---
id: codex-modify-existing-effect
title: Codex Modify Existing Effect (parameters only)
model_family: gpt
task_type: minimal-patch
version: v0.1.0
status: candidate
last_reviewed: 2026-07-04
sources:
  - product-design-os
  - graphic-agent-operating-model
  - local-agents-md
risk_level: medium
requires:
  - named_effect_scope
  - current_behavior
  - requested_change
  - do_not_change_block
forbidden:
  - re_architecture
  - dependency_changes
  - edits_outside_named_component
  - touching_other_effects
expected_output: Parameter-level patch on one named effect with before/after progress screenshots and identity assertions on untouched behavior.
evals:
  - 05-evaluation/checklist.md
  - 05-evaluation/design-lane-cases.md
---

# Codex Modify Existing Effect (parameters only)

MODE contract: tune parameters of one existing effect. Never re-architect.
`codex-bounded-worker.md` rules still apply.

## Scope

One named effect, component, or route. No edits outside the named component.
No dependency changes. No other effects touched.

## Required Inputs

- Current behavior (verified description or screenshots).
- Requested change, stated at parameter level.
- Forbidden changes — an explicit "Do not change" block.

If any input is missing, output `NEED_SPEC_CLARIFICATION` with numbered
questions and stop.

## Acceptance

- Same screenshot progress states before and after (the effect's acceptance
  points; default p=0/0.25/0.5/0.75/1), captured via the debug API.
- Explicit assertions on what stayed identical (e.g. untouched keyframes,
  unchanged selectors, no layout shift).

## Required Output

Mirrors `motion-implementer.md` required output: changed files; what changed;
what deliberately did NOT change; before/after plus progress screenshots;
deviations from the request; next smallest patch suggestion;
`verify_result: pass | fail | skipped` per `codex-bounded-worker.md`
semantics.
