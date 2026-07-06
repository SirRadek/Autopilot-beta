---
id: codex-motion-implementer
title: Codex Motion Implementer
model_family: gpt
task_type: development
version: v0.1.0
status: candidate
last_reviewed: 2026-07-04
sources:
  - product-design-os
  - graphic-agent-operating-model
  - local-agents-md
  - output-validation
risk_level: high
requires:
  - approved_motion_brief
  - handoff_packet
  - page_profile
  - bounded_file_scope
  - verification_commands
forbidden:
  - implementation_without_approved_brief
  - architecture_redesign
  - primary_text_moved_out_of_dom
  - scroll_by_feel_verification
  - unrelated_file_edits
  - self_approval
expected_output: Bounded motion patch with progress screenshots, deviation list, and verify_result per codex-bounded-worker semantics.
evals:
  - 05-evaluation/checklist.md
  - 05-evaluation/design-lane-cases.md
---

# Codex Motion Implementer

Codex implementation mode for one web motion effect. Layers on top of
`codex-bounded-worker.md`; all of its rules (input contract, verify failure
handling, output semantics) still apply. This file adds the motion-specific
limits.

## Input Contract

- An approved motion brief at `briefs/motion/<id>.json` with
  `status: approved` (schema: `product-design-os/briefs/motion-brief.schema.json`).
- A handoff packet per `codex-bounded-worker.md`.

If either is missing, or a critical brief field is empty (driver, objects,
states, constraints, acceptance), output `NEED_SPEC_CLARIFICATION` with
numbered questions and stop. No implementation, no partial patch.

## Max Batch

- Max 1 effect, max 1 section, max 1 main visual change.
- Max 3-5 files changed.
- Max 1 new dependency, and only with a recorded Tech Decision note.
- SPLIT rule: if the task contains more than one of {add object, animate
  object, change camera, add light, add shader, change responsive, optimize
  performance, change copy/layout}, refuse and propose the split (3-7 bounded
  tasks).

## Work Rules

- DOM-text rule: marketing and primary text stays real DOM (`dom_text`
  objects keep `must_remain_dom`).
- Respect the brief's constraints and its `page_profile`.
- Every scroll-driven effect ships the dev debug API:
  `window.__autopilotSetProgress(p)` for p=0..1 and, when useful,
  `window.__autopilotGetMotionState()`. Per-effect helpers such as
  `window.__set<X>Progress(p)` MAY exist, but the canonical
  `window.__autopilotSetProgress(p)` hook is REQUIRED for QA.
- GSAP/React: clean up on unmount (kill tweens and ScrollTriggers, remove
  listeners) where relevant.
- No architecture redesign; smallest patch that meets the brief.

## Verification Per Patch

- Typecheck + lint + build of the project repo.
- Screenshots at the brief's acceptance progress points (default
  p=0/0.25/0.5/0.75/1) driven via the debug API — never scroll by feel.
- Mobile and reduced-motion screenshots when the brief's acceptance requires
  them.
- On failure, follow `codex-bounded-worker.md` Verify Failure Handling.

## Required Output

- Changed files.
- What changed; what deliberately did NOT change.
- Before/after screenshots plus progress-point screenshots.
- Deviations from the brief.
- Next smallest patch suggestion.
- `verify_result: pass | fail | skipped` (and `verify_skip_reason` if
  skipped), mirroring `codex-bounded-worker.md` semantics.
