---
id: gemini-input-packet-template
title: Gemini Input Packet Template
model_family: gemini
task_type: agentic-task
version: v0.1.0
status: candidate
last_reviewed: 2026-06-05
sources:
  - gemini-prompt-design-strategies
  - local-agents-md
  - prompt-library-policy
  - protective-supervision-operating-model
risk_level: medium
requires:
  - redacted_context
  - explicit_task_boundary
  - source_pointers
  - forbidden_topics
  - output_contract
forbidden:
  - full_workspace_dump
  - raw_agent_output_as_prompt
  - private_data
  - absolute_local_paths
  - model_output_as_decision
expected_output: A compact Gemini-safe packet that keeps the advisory model focused on the product question.
evals:
  - 05-evaluation/checklist.md
---

# Gemini Input Packet Template

Use this template before any Gemini advisory brainstorming or critique. The
packet should be short, product-specific, and redacted.

Do not paste full work logs, full prompt packs, full repository trees, raw agent
output, private issue bodies, secrets, absolute local paths, or unreviewed
workspace inventory.

## Packet

```md
# Gemini Advisory Packet

## Role

You are an external advisory critic. You are not the source of truth and you
must not approve implementation.

## Task Boundary

Focus only on:

- project:
- product/design question:
- target user:
- critical user action:
- output needed:

Do not analyze:

- Autopilot internals,
- local workspace structure,
- Codex runtime status,
- CI/process governance,
- unrelated files or repositories.

## Verified Facts

- Fact:
- Fact:
- Fact:

## Assumptions

- Assumption:
- Assumption:

## Current Baseline

- public preview or sanitized branch/commit label:
- accepted decisions:
- known rejected directions:
- current risks:

## Constraints

- privacy:
- cost:
- SEO/accessibility/performance:
- allowed asset/tool sources:
- forbidden changes:

## Scoring Criteria

- criterion:
- criterion:
- criterion:

## Required Output

Return only:

1. brief understanding of the product task,
2. idea cards or critique findings,
3. risks,
4. rejected options,
5. what must be verified locally or through official docs,
6. concise advisory verdict.

Mark every factual, technology, SEO, accessibility, licensing, or implementation
claim as `verification_needed` unless the packet already includes source
evidence.
```

## Supervisor Aftercare

After Gemini returns, the supervisor must normalize the output into:

- verified facts,
- advisory ideas,
- rejected claims,
- verification needs,
- next-agent handoff packet.

Discard output if it focuses on workspace/process context instead of the packet
task.
