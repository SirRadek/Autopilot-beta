# Analysis Intelligence Operating Model

Date introduced: 2026-06-19
Status: active control-plane policy
Owner: Autopilot Control Plane

This document defines Autopilot's analysis layer: impact analysis, risk analysis,
tradeoff and decision analysis, data analysis, and root-cause diagnostics. It
extends the Analysis layer in the delivery-system model policy and the
observability ownership boundary. It is not a separate runtime and is not the
source of truth for connector, log, or metric data.

Analysis produces findings, severities, tradeoffs, and recommendations. It never
approves delivery, never mutates remote services, and never replaces local
verification evidence.

## Role Model

Follows the 2026-06-19 role taxonomy: one decision-owner plus opponents from
different angles.

| Model | Analysis role | Angle | Private data |
| --- | --- | --- | --- |
| Opus (Claude) | impact/risk analyst, decision owner | synthesis to a recommendation | real data allowed in bounds |
| Codex (GPT) | technical/logic opponent | feasibility, logic, edge cases | real data allowed in bounds |
| Gemini | independent reviewer | missed risks, alternative readings | redacted context only |
| Qwen local | private data worker | mechanical aggregation and cleanup | fully private (local) |

### Impact / Risk Analyst (Opus)

Runs as the decision-owning analyst.

Responsibilities:

- map affected surfaces, dependencies, and blast radius before a change is approved
- rate risks by severity and likelihood
- compare tradeoffs across options and define mitigations and a rollback path
- synthesize opponent and worker findings into a single recommendation
- state confidence and what must be verified before proceeding

Cannot implement, approve delivery, or treat model output as verified fact.

Output:

```yaml
analysis_packet:
  subject: string
  affected_surfaces: string[]
  dependencies: string[]
  risks:
    - description: string
      severity: low | medium | high
      likelihood: low | medium | high
  tradeoffs: string[]
  mitigations: string[]
  rollback_path: string
  recommendation: string
  confidence: low | medium | high
  must_verify: string[]
```

### Technical / Logic Opponent (Codex)

Runs as the technical opponent. Attacks the analysis for logic gaps, missing
states, unhandled edge cases, and feasibility of the proposed mitigations. Does
not set scope or approve work.

### Independent Reviewer (Gemini)

Runs as redacted advisory only. Surfaces missed risks, weak assumptions, and
alternative interpretations. All claims stay hypotheses until verified. Cannot
receive unredacted data or approve work.

### Private Data Worker (Qwen local)

Runs fully local. Cleans, normalizes, and aggregates real data into bounded
tables for the analyst. Never leaves the machine; never final authority.

## Ownership Boundary

Before reading logs or runtime data, classify the analysis as an Autopilot
control-plane problem or a supervised-project problem, per the observability
ownership boundary. Autopilot may keep redacted summaries and source pointers;
raw project logs, traces, and metrics stay in the affected project.

## Data Privacy Axis

Real figures, logs, and customer data may be processed by Opus and Codex (owner
subscriptions, within their boundaries) or by Qwen locally. Gemini and other
free-cloud models receive a redacted abstraction only. Routing real private data
to a free-cloud model is a stop condition.

## Rubric

| Criterion | Question | Blocker examples |
| --- | --- | --- |
| Completeness | Are all affected surfaces and dependencies covered? | missed downstream consumer |
| Evidence | Are claims backed by files, tests, or data? | severity asserted with no basis |
| Severity calibration | Are severity and likelihood realistic? | every risk marked high |
| Blast radius | Is the worst-case scope understood? | "small change" that touches auth |
| Reversibility | Is there a rollback path? | one-way change with no undo |
| Measurability | Is there a check to confirm the outcome? | no signal defined |

## Stop Conditions

- missing subject or affected surfaces
- ambiguous ownership between control plane and supervised project
- raw project logs copied into Autopilot or containing secrets
- real private data routed to a free-cloud model
- claim adopted without source or test verification
- model output used as source of truth
- implementation or approval requested from this layer

## Handoff Order

```text
Owner intent or change
  -> Impact/Risk Analyst (Opus)        [map + first analysis]
  -> Technical/Logic Opponent (Codex)  [logic + feasibility attack]
  -> Independent Reviewer (Gemini)     [missed risks, redacted]
  -> Private Data Worker (Qwen local)  [real-data aggregation, as needed]
  -> Impact/Risk Analyst (Opus)        [synthesis -> recommendation]
  -> Owner                              [decision + delivery approval]
```

## Decision Ledger Entry

```yaml
decision_id: 2026-06-19-analysis-intelligence-operating-model
type: architecture
context: Autopilot's analysis work needed a first-class operating model alongside the business and design layers as the focus expands beyond development.
decision: Add an Analysis Intelligence layer with an Opus-led impact/risk analyst, a Codex technical opponent, a redacted Gemini independent reviewer, and a local Qwen data worker, plus an ownership boundary and the data-privacy routing axis.
reasoning: Impact and risk analysis needs governed routing, an ownership boundary for logs, and a privacy axis so real data stays with owner-subscription or local models.
alternatives:
  - keep analysis ad hoc per request
  - route all analysis to a single model
  - allow free-cloud models to process raw logs and private data
impact: Autopilot can route analysis through typed governance while preserving the control-plane vs project boundary and subscription-only spend.
approved_by: owner decision on 2026-06-19 to continue formalizing the expanded domains
related_tasks:
  - prompt-library/10-analysis/impact-risk.md
  - prompt-library/10-analysis/independent-review.md
```
