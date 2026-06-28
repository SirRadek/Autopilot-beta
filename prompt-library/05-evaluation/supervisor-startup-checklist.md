---
id: supervisor-startup-checklist
title: Supervisor Startup Prompt Checklist
model_family: provider-neutral
task_type: evaluation
version: v0.1.0
status: candidate
last_reviewed: 2026-06-04
sources:
  - autopilot-supervisor-base
  - prompt-library-policy
  - protective-supervision-operating-model
  - product-design-os
risk_level: high
requires:
  - runtime_bridge_gate
  - source_inventory
  - scope_lock
  - handoff_normalization
  - qa_plan
forbidden:
  - implementation_before_startup_gate
  - raw_agent_output_as_prompt
  - missing_progress_state
expected_output: Pass/fail checklist for supervisor prompt readiness.
evals:
  - 05-evaluation/checklist.md
---

# Supervisor Startup Prompt Checklist

Use this before treating a supervisor prompt as ready.

## Runtime

- Active workspace is verified.
- `codex_app.read_thread_terminal` is tested when the prompt depends on Codex
  App runtime behavior.
- Missing `codex_app.read_thread_terminal` exposure is recorded separately from
  `No handler registered`.
- Missing exposure or missing handler blocks automation/runtime verification
  claims, but may allow degraded local/GitHub planning when the task does not
  depend on Codex App runtime tools.
- Context7 availability or official-doc fallback is recorded.
- Decision Mesh and project mesh packets are required before planning.

## Source Control

- Source of truth is explicit.
- GitHub inputs are normalized before use.
- Live site, screenshots, advisory model output, and raw logs are not treated as
  primary source unless the project prompt explicitly allows it.

## Scope

- Project type, primary goal, target users, critical action, risk, and motion
  level are requested.
- Non-goals and forbidden actions are explicit.
- Stop conditions are preserved.

## Agent Handoff

- Raw agent output is blocked as next-agent input.
- Handoff packet fields are listed.
- Progress states and blocker ownership are required.

## Product And Design

- Product & Design OS gates are required before implementation.
- Palette-only variants are rejected.
- Distinct direction criteria are concrete.
- Motion must support the user goal.
- Accessibility, mobile, performance, and reduced-motion checks are required.

## Assets And Motion

- Asset source/license checks are required.
- Mascot/canvas/WebGL work has fallback and nonblank visual QA.
- Primary SEO content is not hidden in canvas.
- Paid or unknown-cost tools are blocked without owner exception.

## Verification

- Build, tests, responsive, accessibility, SEO, performance, and visual QA are
  named where relevant.
- Work-log and architecture impact decision is required.
- Rollback path is through Git and scoped changes.
