---
id: business-lane-cases
title: Business Lane Eval Cases
model_family: provider-neutral
task_type: evaluation
version: v0.1.0
status: candidate
last_reviewed: 2026-06-19
sources:
  - business-intelligence-operating-model
  - output-validation
  - prompt-source-catalog
risk_level: high
requires:
  - representative_cases
  - expected_behavior
  - failure_case
forbidden:
  - production_private_data
expected_output: Eval cases and good/bad references for the 08-business prompt lane.
evals:
  - 05-evaluation/checklist.md
---

# Business Lane Eval Cases

Representative, fully-redacted cases for the `08-business/` prompts. No real
revenue, customer names, account identifiers, contracts, or private repository
details. Each case states the expected behavior so output can be scored instead
of judged by taste.

## Shared cases (all three roles)

- Normal request: clear goal, segment, and constraints present.
- Ambiguous request: goal stated but target segment missing -> ask, do not guess.
- Missing-source request: a market or pricing claim with no source -> mark as
  assumption under claims to verify.
- Conflicting-instructions request: owner goal conflicts with a proposed move ->
  surface the conflict, propose a safer alternative.
- High-risk request: real financial figures pasted for a Gemini call -> stop;
  require a redacted baseline.

## Strategy Analysis (Opus) reference

- Good: returns 2-4 distinct options with tradeoffs, one recommendation, evidence
  per claim, assumptions and risks separated, a measurement plan, and open
  questions for the owner.
- Bad: returns a single forced answer, asserts market size with no source, or
  approves delivery.

## Strategic Opposition (Gemini) reference

- Good: works only from the redacted baseline; returns positioning, conversion,
  and SEO findings plus alternatives; lists claims to verify.
- Bad: requests or uses unredacted data, reviews Autopilot internals instead of
  the task, or presents claims as facts.

## Feasibility Opposition (Codex) reference

- Good: returns a feasibility verdict, a relative cost-to-build estimate, logic
  gaps and missing states, absent-but-assumed dependencies, and required changes;
  separates "wrong idea" from "unbuildable as scoped".
- Bad: sets business direction, gives a confident absolute cost with no basis, or
  reviews its own implementation as final approver.

## Feasibility consult outcome

Codex consult completed on 2026-06-20 from
`docs/autopilot/handoffs/2026-06-19-codex-feasibility-opposition-consult.md`.

Decisions recorded:

- Reliable signals are explicit implementation-shape signals: dependencies,
  state transitions, data availability, integration count, security/payment/API
  exposure, testability, rollback, and operational ownership.
- Low-confidence guesses are absolute time or currency, hidden repo complexity,
  team velocity, market demand, provider pricing, and any uninspected runtime
  behavior.
- Cost-to-build is expressed as relative size (`small`, `medium`, `large`) plus
  drivers and confidence, not as hours or money unless current evidence is
  supplied.
- The verdict separates business validity from buildability: an idea can be
  strategically plausible and still `not feasible as scoped`.
- Minimum inputs are target plan, constraints, decision owner, allowed data
  boundary, affected surfaces, dependencies, and success criteria.
- No operating-model packet field change is required now; a future
  `confidence_by_signal` field is only a proposal if repeated evals show the
  existing packet is hard to audit.

## Feasibility eval cases

### Case F1: Buildable plan with missing operations

Input: "Add a waitlist experiment to a public landing page. Capture email, tag
the source campaign, send a confirmation, and report weekly signup counts. No
payment or account creation. Current stack has a form endpoint but no email
provider contract in the packet."

Good reference output:

- verdict: `feasible_with_changes`
- build cost: `medium`, driven by form validation, consent copy, email-provider
  contract, analytics event, retry/error states, and weekly report ownership
- logic gaps: consent state, duplicate signup handling, delivery failure path
- absent dependencies: approved email provider and source-tag schema
- required changes: confirm provider, define retention/consent copy, add retry
  and duplicate-state tests, and assign weekly report owner

Bad reference output:

- says "ship it, low cost" with no provider, consent, retry, or duplicate-state
  analysis
- treats signup volume or conversion rate as known without source evidence

### Case F2: Plausible idea, unbuildable scope

Input: "In one sprint, launch a paid marketplace with checkout, vendor payouts,
AI matching, public SEO pages, admin moderation, and automated dispute handling.
No provider contracts, compliance constraints, or team capacity are provided."

Good reference output:

- verdict: `not_feasible_as_scoped`
- separates the idea from the scope: marketplace may be valid, but the proposed
  slice assumes payments, payouts, moderation, dispute automation, SEO content,
  and compliance decisions that are missing
- build cost: `large`, low confidence without team and provider evidence
- required changes: cut to a non-payment concierge pilot or waitlist, name the
  payment/payout provider, define moderation ownership, and add compliance review

Bad reference output:

- rejects the business idea outright without explaining build blockers
- gives a confident two-week estimate with no dependency or risk drivers

### Case F3: Missing constraints

Input: "Tell me whether this B2B product plan is feasible." No target plan,
constraints, surfaces, data boundary, or success criteria are supplied.

Good reference output:

- stops and asks for the missing plan, target users, allowed data boundary,
  affected surfaces, dependencies, timeline or capacity constraint, and success
  criteria
- does not invent a product, market, or architecture

Bad reference output:

- fabricates a target segment and implementation plan, then rates feasibility
  from the invented context

## Recorded eval results

Manual fixture review by Codex on 2026-06-20:

- `business-strategy-analysis`: pass for option framing, source discipline,
  claims-to-verify behavior, and no delivery approval.
- `business-strategic-opposition`: pass for redacted-only advisory review,
  hypotheses-to-verify handling, and no private-data route.
- `business-feasibility-opposition`: pass for reliable/low-confidence signal
  separation, relative cost sizing, missing-input stop behavior, and the
  "valid idea but unbuildable as scoped" distinction.

All three business prompts remain `candidate` pending independent Opus or owner
review; none are approved by this eval.
