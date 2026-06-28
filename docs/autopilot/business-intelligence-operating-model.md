# Business Intelligence Operating Model

Date introduced: 2026-06-19
Status: active control-plane policy
Owner: Autopilot Control Plane

This document defines Autopilot's business-reasoning layer: strategy,
prioritization, market and competitive analysis, pricing and unit-economics
framing, and go-to-market reasoning. It extends the existing Decision Mesh,
delivery-system model policy, and Product & Design OS. It is not a separate
runtime, an accounting or finance system, or a source of truth for connector,
billing, or customer data.

Business reasoning produces analysis, options, and recommendations. It never
approves delivery, never mutates remote services, and never becomes the source
of truth for real financial or customer data.

## Role Model

The role-to-model split follows the owner decision of 2026-06-19. Autopilot now
expands from a development-only focus to also cover design, analysis, research,
and business, using subscription models only (no API billing, no paid generation
provider).

| Model | Business role | Angle | Private data |
| --- | --- | --- | --- |
| Opus (Claude) | architect, supervisor, decision-owning analyst | synthesis to a recommendation | owner subscription, real data allowed in bounds |
| Codex (GPT) | worker, logic analyst, technical opponent | feasibility and logic attack | owner subscription, real data allowed in bounds |
| Gemini | creative analyst, strategic opponent, SEO optimizer | market, positioning, discoverability attack | redacted context only |
| Qwen local | bounded private worker | mechanical crunching and cleanup | fully private (local) |

Three roles can act as analyst. They must attack from different angles so they do
not collide:

- Opus is the **decision analyst**: it owns the analysis and the recommendation.
- Codex is the **technical opponent**: it attacks feasibility, logic, and edge cases.
- Gemini is the **strategic/creative opponent**: it attacks direction, positioning,
  conversion, and SEO, on redacted context only.

One decision-owner plus two opponents from different directions. This maps onto
the existing P0-P4 risk routing in
`product-design-os/rules/multi-agent-routing.md`.

### Business Strategist (Opus)

Runs as the decision-owning analyst.

Responsibilities:

- frame the business question: goal, target segment, critical decision,
  constraints, and time horizon
- produce structured strategy and prioritization analysis backed by evidence
- synthesize opponent findings into a single recommendation the owner can act on
- write the business brief, decision record, and acceptance criteria
- classify the business/design and business/SEO tradeoff profile

The Strategist cannot approve delivery, cannot be its own opponent, and cannot
treat model output as verified fact.

Output:

```yaml
business_analysis_packet:
  question: string
  target_segment: string
  goal: string
  options: string[]
  recommendation: string
  evidence: string[]
  assumptions: string[]
  risks: string[]
  unit_economics_notes: string
  measurement: string[]
  decision_owner: owner
```

### Logic / Feasibility Opponent (Codex)

Status: draft pending deep Codex consult (see Handoff). Per the owner rule that
Codex worker logic must be designed with Codex, not specified superficially in
isolation, this role's prompt contract stays `draft` until a handoff packet is
reviewed with Codex.

Runs as the technical opponent and logic analyst.

Responsibilities:

- attack the plan for build feasibility, data and logic consistency, missing
  states, and edge cases
- estimate realistic cost-to-build and operational complexity
- flag where a strategy assumes data, integrations, or automation that do not exist
- separate "the idea is wrong" from "the idea is fine but unbuildable as scoped"

Cannot set business direction, approve delivery, or review its own implementation.

Output:

```yaml
feasibility_opposition_packet:
  target_plan: string
  feasibility_verdict: feasible | feasible_with_changes | not_feasible_as_scoped
  build_cost_estimate: string
  logic_gaps: string[]
  missing_states: string[]
  dependencies_assumed_but_absent: string[]
  required_changes: string[]
```

### Strategic / Creative Opponent + SEO (Gemini)

Runs as redacted advisory only. Free/no-cost use must be confirmed first.

Responsibilities:

- attack market positioning, differentiation, and conversion logic
- generate divergent strategic options the owner has not considered
- review discoverability and SEO angle for public-facing business moves
- separate ideas from facts; technology, market-size, and best-practice claims
  stay hypotheses until verified

Cannot receive unredacted private data, approve work, or become source of truth.

Output:

```yaml
strategic_opposition_packet:
  redacted_baseline: string
  positioning_risks: string[]
  differentiation_findings: string[]
  conversion_findings: string[]
  seo_findings: string[]
  alternative_directions: string[]
  claims_to_verify: string[]
```

### Private Data Worker (Qwen local)

Runs fully local for real numbers and customer data.

Responsibilities:

- clean, normalize, and summarize real financial or customer data locally
- generate bounded tables and first-pass aggregates for the Strategist
- never leave the local machine; never act as final analysis authority

## Data Privacy Axis

Business and analysis work routes on two axes, not one: capability **and** who may
see unredacted data.

- Real figures and customer data may be processed by Opus and Codex (owner
  subscriptions, within their boundaries) or by Qwen locally.
- Gemini and any other free-cloud model receive a **redacted abstraction only**:
  no real revenue, names, account identifiers, contracts, private repo details,
  or absolute local paths.
- A redacted baseline is mandatory before any free-cloud business call.

Routing real business numbers to a free-cloud model is a stop condition.

## Rubric

| Criterion | Question | Blocker examples |
| --- | --- | --- |
| Goal fit | Does the option serve the stated goal and segment? | strategy aimed at the wrong buyer |
| Evidence | Are claims backed by data or sources, not vibes? | confident market claim with no source |
| Feasibility | Can it be built and operated with current resources? | plan assumes integrations that do not exist |
| Differentiation | Is the positioning distinct, not me-too? | generic "AI for X" with no edge |
| Unit economics | Do cost and value plausibly balance? | acquisition cost above lifetime value |
| Risk | Are legal, market, execution, and dependency risks surfaced? | single-provider or single-customer dependency |
| Measurability | Is there a metric and a check to know it worked? | no success signal defined |
| Reversibility | Can a wrong bet be unwound cheaply? | one-way door with no rollback |

## Research And Verification Policy

Market, competitor, pricing, technology, and best-practice claims follow the same
docs-verification lane as the rest of Autopilot:

1. Context7 for current framework, library, SDK, API, browser, cloud, SEO, and
   accessibility claims when connected.
2. Official documentation, primary market sources, or controlled browser evidence
   as fallback.
3. Local files, tests, and recorded decisions for Autopilot behavior.

Gemini may expand options and critique direction, but its market-size, pricing,
competitor, technology, and SEO claims stay hypotheses until verified through a
primary source. Model output is never the source of truth.

## Stop Conditions

- missing business question or goal
- missing target segment
- real private data routed to a free-cloud model
- missing redacted baseline for a free-cloud business call
- market, pricing, or technology claim adopted without primary-source verification
- model output used as source of truth
- the same model acting as both proposer and approver
- delivery, payment, or remote mutation requested from this layer
- paid provider or paid credit required without an owner exception

## Handoff Order

```text
Owner intent
  -> Business Strategist (Opus)            [frame + first analysis]
  -> Logic/Feasibility Opponent (Codex)    [feasibility + logic attack]   (draft: consult Codex)
  -> Strategic/Creative Opponent (Gemini)  [direction + SEO attack, redacted]
  -> Private Data Worker (Qwen local)      [real-number crunching, as needed]
  -> Business Strategist (Opus)            [synthesis -> recommendation]
  -> Owner                                  [decision + delivery approval]
```

The Strategist normalizes every opponent and worker output into facts,
assumptions, decisions, risks, and open questions before it enters the
recommendation. Raw model output is never passed forward as the next prompt.

## Decision Ledger Entry

```yaml
decision_id: 2026-06-19-business-intelligence-operating-model
type: architecture
context: Autopilot expands from a development-only focus to also cover design, analysis, research, and business using subscription models only.
decision: Add a Business Intelligence layer with an Opus-led decision analyst, a Codex feasibility opponent (draft pending consult), a redacted Gemini strategic/SEO opponent, and a local Qwen private-data worker, plus a data-privacy routing axis and a 08-business prompt lane.
reasoning: Business reasoning needs governed routing and a privacy axis so real data stays with owner-subscription or local models while free-cloud models stay advisory and redacted.
alternatives:
  - keep business reasoning ad hoc per request
  - route business analysis to a single model
  - allow free-cloud models to process real financial data
  - build a separate business analytics runtime now
impact: Autopilot can route business strategy, opposition, and analysis through typed governance while preserving control-plane boundaries, subscription-only spend, and redaction rules.
approved_by: owner decision on 2026-06-19 to formalize the business lane and operating model
related_tasks:
  - prompt-library/08-business/strategy-analysis.md
  - prompt-library/08-business/strategic-opposition.md
  - prompt-library/08-business/feasibility-opposition.md
```
