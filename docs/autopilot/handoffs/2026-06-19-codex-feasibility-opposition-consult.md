# Agent Handoff Packet

## Handoff ID

2026-06-19-codex-feasibility-opposition-consult

## Source Agent

Opus (architect, supervisor, decision analyst)

## Target Agent

Codex (implementation worker, logic analyst, technical opponent)

## Project

Autopilot control plane — Business Intelligence layer

## Mode

INSPECT_ONLY for this consult. No repository write is requested from Codex in
this step. The owner promotes the prompt after the consult, and any later worker
contract runs under WRITE_ALLOWED with a separate bounded packet.

## Goal

Co-design the Codex feasibility-opposition role so it can be promoted from
`draft` to `candidate`. This packet exists because Codex worker logic must be
designed with Codex, not specified superficially in isolation. Opus frames the
questions; Codex supplies the worker logic.

## Scope

Refine only `prompt-library/08-business/feasibility-opposition.md` and its eval
fixtures. Do not change the Opus strategy prompt, the Gemini opposition prompt,
or the operating model role split.

## Allowed Files Or Surfaces

- `prompt-library/08-business/feasibility-opposition.md`
- `prompt-library/05-evaluation/business-lane-cases.md`
- `docs/autopilot/business-intelligence-operating-model.md` (read for context)

## Forbidden Actions

- setting business direction or scope
- approving delivery
- reviewing Codex's own future implementation as final approver
- treating model output as source of truth
- routing real private business data to a free-cloud model

## Verified Facts

- Owner decision 2026-06-19: Opus = architect/supervisor/decision analyst; Codex
  = worker/logic/technical opponent; Gemini = creative/strategic/SEO opponent
  (redacted); Qwen = local private worker.
- Routing has two axes: capability and data-privacy.
- The prompt currently declares: model_family `gpt`, task_type `audit`,
  risk_level `high`, status `draft`.
- The operating model defines the `feasibility_opposition_packet` output shape.

## Assumptions

- Codex can estimate cost-to-build and operational complexity in relative terms
  (small / medium / large) more reliably than in absolute hours or currency.
- Feasibility opposition runs on plans and architecture, before implementation,
  so the implementer is never its own final approver.

## Decisions Already Made

- The role is opposition and logic analysis, not direction-setting.
- The prompt stays `draft` until this consult and real eval results land.
- Output follows `feasibility_opposition_packet`.

## Open Questions (for Codex)

1. Which feasibility signals can Codex produce reliably, and which are guesses
   that should be flagged as low-confidence?
2. What is the most honest cost-to-build estimate method given no live repo
   context — relative sizing, dependency counting, or risk tiers?
3. How should Codex separate "the idea is wrong" from "the idea is fine but
   unbuildable as scoped" so the verdict stays actionable?
4. What are the minimum inputs Codex needs before it can oppose feasibility
   without guessing (and which missing inputs are stop conditions)?
5. Does the `feasibility_opposition_packet` schema need fields added or removed?
6. Which eval cases in `business-lane-cases.md` are realistic, and what good and
   bad reference outputs should be recorded?

## Risks

- A superficial role design produces confident but unfounded feasibility claims.
- Without bounded inputs, Codex may infer business direction it should not own.

## Stop Conditions

- missing target plan or constraints
- request to set business direction
- real private data routed to a free-cloud model
- promotion to `candidate` without recorded eval results

## Required Checks

- consult outcome recorded in the Autopilot control-plane work log
- eval fixtures completed in `prompt-library/05-evaluation/business-lane-cases.md`
- `npm run prompt:validate` passes after changes
- independent review before promotion (Opus or owner)

## Expected Output

- a refined `feasibility-opposition.md` contract (still owner-promoted)
- answers to the open questions, recorded as decisions
- completed good/bad reference outputs for the feasibility eval cases

## Evidence And Source Pointers

- `docs/autopilot/business-intelligence-operating-model.md`
- `product-design-os/rules/multi-agent-routing.md`
- `docs/autopilot/delivery-system-model-policy.md` (Qwen/Codex worker policy)

## Progress Impact

When complete, the feasibility prompt moves `draft -> candidate` and the business
lane has three working contracts plus an eval fixture.

## Next Action

Owner runs this packet with Codex (codex_cli), records the consult outcome in the
work log, completes the eval fixture, then promotes the prompt to `candidate`.
