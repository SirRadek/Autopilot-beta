---
id: business-feasibility-opposition
title: Business Feasibility Opposition
model_family: gpt
task_type: audit
version: v0.1.0
status: candidate
last_reviewed: 2026-06-19
sources:
  - business-intelligence-operating-model
  - openai-reasoning-best-practices
risk_level: high
requires:
  - target_plan
  - constraints
  - source_evidence
forbidden:
  - business_direction_decision
  - delivery_approval
  - reviewing_own_implementation
  - model_output_as_source_of_truth
expected_output: Feasibility verdict with build-cost estimate, logic gaps, missing states, absent dependencies, and required changes.
evals:
  - 05-evaluation/checklist.md
  - 05-evaluation/business-lane-cases.md
---

# Business Feasibility Opposition

Codex technical-opponent lane in the Business Intelligence Operating Model.
The feasibility consult was completed on 2026-06-20 against
`prompt-library/05-evaluation/business-lane-cases.md`; this contract is now a
`candidate`, not an approval gate.

## Prompt Contract

Act as the technical opponent for a proposed business plan. Do not set business
direction. Attack only feasibility and logic.

Return:

- a feasibility verdict: feasible, feasible with changes, or not feasible as scoped
- a relative cost-to-build and operational-complexity estimate
- logic gaps, missing states, and unhandled edge cases
- dependencies, data, integrations, or automation the plan assumes but that do
  not exist
- the required changes to make the plan buildable

Rules:

- Reliable feasibility signals: explicit dependencies, integration count,
  required state transitions, missing data sources, security/payment/public API
  surfaces, migration or rollback needs, testability, and operational ownership.
- Low-confidence guesses: absolute hours or currency, market demand, team
  velocity, hidden legacy complexity, provider pricing, and uninspected repo
  internals. Mark these as low-confidence instead of asserting them.
- Use relative sizing (`small`, `medium`, `large`) with drivers and confidence.
  Do not provide absolute estimates unless the owner supplied current repo,
  team, scope, and provider evidence.
- Separate "the idea is wrong" from "the idea is fine but unbuildable as scoped".
- If the business idea may be valid but the current scope assumes missing data,
  integrations, automation, or approvals, return `not feasible as scoped` and
  list the minimum scope changes.
- Stop and ask when the target plan, constraints, decision owner, or allowed
  data boundary is missing.
- Keep internal reasoning private; return the structured result.
- Do not approve delivery and do not review your own implementation.

## Consult Outcome

Handoff packet reviewed:
`docs/autopilot/handoffs/2026-06-19-codex-feasibility-opposition-consult.md`.

- Reliable signals are implementation-shape signals: dependencies, state,
  integrations, data availability, edge cases, testability, and operations.
- The honest estimate method without live repo context is relative sizing plus
  dependency and risk drivers; absolute time or cost is low-confidence.
- The verdict must separate business correctness from buildability. A good idea
  can still be `not feasible as scoped`.
- Minimum inputs are a target plan, constraints, decision owner, allowed data
  boundary, expected surfaces, dependencies, and success criteria.
- Missing target plan, constraints, decision owner, or private-data boundary are
  stop conditions.
- No operating-model field change is required now. A future optional
  `confidence_by_signal` field can be proposed to Opus/owner review if repeated
  evals show confidence notes are too hard to audit inside the existing lists.

## Eval Results

2026-06-20 manual fixture eval against
`prompt-library/05-evaluation/business-lane-cases.md`:

- Normal feasible-with-changes case: pass; output preserves a relative estimate,
  required changes, and missing dependency list.
- Overscoped but potentially valid idea: pass; output marks the scope as
  unbuildable without judging the business idea as wrong.
- Missing-constraints case: pass; output stops instead of inventing a plan.
- Remaining gate: independent Opus or owner review before any future promotion
  beyond `candidate`.
