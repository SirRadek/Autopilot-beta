# Delivery System Execution Engine Options

Date introduced: 2026-05-13
Status: phase-0 decision record
Owner: Autopilot Control Plane

Decision: do not select or implement an execution runtime yet.

The Multi-Agent Autonomous Delivery System has documentation, typed governance contracts, and a static read-only command center. Execution-runtime implementation remains deferred until the gates in this record are satisfied. Connector snapshots are documented and have a local/GitHub dry run, but Linear, Vercel, Cloudflare, and Docket snapshots remain unexercised.

## Sources Checked

Official or primary sources checked on 2026-05-13:

- Vercel Workflow docs: https://vercel.com/docs/workflow
- Workflow DevKit docs: https://useworkflow.dev/docs/getting-started
- Cloudflare Workflows docs: https://developers.cloudflare.com/workflows/
- Cloudflare Durable Objects docs: https://developers.cloudflare.com/durable-objects/
- Cloudflare Queues docs: https://developers.cloudflare.com/queues/
- Cloudflare Agents docs: https://developers.cloudflare.com/agents/
- GitHub Actions workflows docs: https://docs.github.com/en/actions/using-workflows/about-workflows
- OpenAI Codex Automations overview: https://openai.com/academy/codex-automations/

No pricing commitment is recorded here. Pricing, availability, limits, and API details must be rechecked before any implementation decision.

## Evaluation Criteria

Scores:

- `5`: strong fit
- `4`: good fit with manageable tradeoffs
- `3`: usable but needs design work
- `2`: weak fit or high operational burden
- `1`: not suitable for this criterion

Criteria: durability, human approval, retries, logs and observability, local development, security and isolation, cost predictability, vendor lock-in, fit with the Autopilot governance-first control plane, and fit with future Astro or Cloudflare product surfaces.

## Option Matrix

| Option | Durability | Human Approval | Retries | Logs | Local Dev | Security | Cost Predictability | Vendor Lock-In | Autopilot Fit | Astro/Cloudflare Fit | Summary |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Vercel Workflow / WDK | 5 | 4 | 5 | 5 | 4 | 4 | 3 | 3 | 3 | 3 | Strong durable JS/TS workflow candidate, but Vercel Workflow is beta and Autopilot has no execution runtime or deployment architecture yet. |
| Cloudflare Workflows | 5 | 5 | 5 | 4 | 3 | 4 | 3 | 3 | 3 | 5 | Strong fit if the execution MVP is Worker-based; still requires Worker architecture and account-bound resources. |
| Cloudflare Durable Objects | 4 | 3 | 3 | 4 | 3 | 4 | 3 | 3 | 3 | 5 | Good for stateful coordination, not a full workflow engine by itself. |
| Cloudflare Queues | 3 | 2 | 5 | 3 | 3 | 4 | 4 | 3 | 2 | 5 | Useful async transport and retries, but needs orchestration and approval logic elsewhere. |
| Cloudflare Agents | 4 | 3 | 3 | 4 | 3 | 4 | 3 | 3 | 3 | 5 | Useful future stateful agent runtime, but too early before governance and connector snapshots are stable. |
| GitHub Actions | 3 | 4 | 3 | 5 | 4 | 4 | 4 | 4 | 3 | 3 | Good for repo-bound CI and scheduled checks, weak as a product-level long-running workflow engine. |
| Codex Automations | 3 | 5 | 2 | 3 | 4 | 4 | 4 | 3 | 5 | 2 | Strong fit for scheduled review/check/report workflows in Codex, not a durable production execution engine. |
| Local queue/state machine | 2 | 5 | 3 | 2 | 5 | 3 | 5 | 5 | 4 | 2 | Useful for prototyping contracts locally, but weak durability and observability unless backed by storage. |

## Option Notes

### Vercel Workflow / Workflow DevKit

Vercel describes Workflow as a managed platform on top of Workflow DevKit for workflows that can pause, resume, and maintain state. The docs describe durable, resumable, observable async workflows.

Fit:

- good candidate for future JS/TS durable orchestration
- useful if Autopilot later gains a Vercel runtime
- not appropriate for the current static read-only control plane

Deferral reasons:

- Vercel Workflow is documented as beta
- Autopilot has no execution runtime or deployment architecture
- governance ledgers and read-only views exist, but full connector evidence, rollback, and secrets handling are not implemented yet

### Cloudflare Workflows

Cloudflare describes Workflows as durable multi-step applications on Workers with persisted state, retries, pause/resume behavior, and external-event support.

Fit:

- strong candidate if the execution MVP is Worker-based
- strong alignment with Cloudflare product projects such as Radeq
- human-in-the-loop approval patterns appear relevant but need a concrete architecture

Deferral reasons:

- requires Cloudflare account resources and Worker deployment architecture
- Autopilot has typed contracts, but only local/GitHub connector snapshots have been exercised
- secrets, bindings, and account identifiers are not modeled for runtime use

### Cloudflare Durable Objects

Durable Objects provide stateful coordination with persistent storage and globally unique object identity.

Fit:

- useful for run coordination, locks, per-project state, and websocket state
- complements Workflows or Agents

Deferral reasons:

- not a full delivery workflow engine by itself
- requires careful state and migration design

### Cloudflare Queues

Cloudflare Queues provide asynchronous message delivery, batching, retries, delays, and dead-letter queue patterns.

Fit:

- useful for background tasks and retryable work items
- good companion for Workers or Workflows

Deferral reasons:

- queue transport does not provide governance, approvals, or workflow state by itself
- needs idempotency and dead-letter handling decisions

### Cloudflare Agents

Cloudflare Agents are TypeScript classes running on Durable Objects, with state, scheduling, tools, and realtime connections.

Fit:

- future candidate for stateful supervised agents
- relevant after model policy and tool boundary contracts are enforced

Deferral reasons:

- too close to autonomous execution for phase 0
- requires strong privacy, tool-call, and approval controls first

### GitHub Actions

GitHub Actions workflows are YAML-defined automated processes triggered by repository events, manual triggers, or schedules.

Fit:

- good for CI, docs checks, scheduled audits, repository hygiene, and post-merge verification
- strong audit trail inside repositories

Deferral reasons:

- repository-scoped, not a full multi-project workflow engine
- long-running human-in-the-loop orchestration would be awkward
- remote mutation rules must be explicit before adding workflows

### Codex Automations

OpenAI documents Codex Automations as scheduled recurring tasks that can return results for review and may continue an existing conversation context.

Fit:

- strong fit for recurring architecture-review reminders, missing-work-log checks, status summaries, and stale-risk scans
- works naturally with human review

Deferral reasons:

- not a production workflow runtime
- local automations depend on Codex environment availability
- should be used as monitoring and review support, not delivery approval

### Local Queue / State Machine

A local queue or state-machine prototype could model workflow states without cloud resources.

Fit:

- useful for validating contracts
- low vendor lock-in
- easy to test locally after package/runtime decision

Deferral reasons:

- no durability without storage
- no centralized observability without more infrastructure
- still requires an execution MVP, storage decision, and observability design first

## Recommendation

Do not implement an execution engine now. The phase-1 runtime/package decision only approves a local TypeScript/Vitest package for typed governance contracts and pure validators.

Next safe order:

1. Keep phase-0 documentation and governance contracts current.
2. Keep connector snapshots read-only and expand dry-run coverage before external integrations.
3. Keep the TypeScript/Vitest package limited to pure governance contracts.
4. Keep the Astro command center limited to static read-only reporting.
5. Expand connector snapshot dry runs and architecture review automation before re-evaluating execution runtime.
6. Re-evaluate execution runtime with current official docs and a concrete bounded execution MVP.

## Phase-5 Trigger Criteria

Bounded execution MVP may start only when all conditions are true:

- Autopilot architecture record explicitly approves an execution runtime/package beyond the current typed-contract package.
- Decision ledger records selected runtime and rejected alternatives.
- Role, gate, ledger, and workflow contracts are typed and tested.
- Connector snapshot procedure is implemented and used in at least one dry run.
- Repository-boundary checks are automated or manually repeatable.
- Human approval gate exists before remote mutation.
- Incident and rollback flow is documented.
- Secrets and environment handling are defined.
- At least one product project has a current architecture record and work log.

## Current Decision Ledger Entry

```yaml
decision_id: 2026-05-13-execution-engine-defer
type: architecture
context: Autopilot is now a governance-first control-plane repository with typed contracts and a static read-only command center, but no execution runtime.
decision: Do not select or implement an execution runtime in phase 0.
reasoning: Typed contracts and read-only visibility now exist, but full connector snapshots, human approval mechanics, rollback flow, secrets handling, and execution observability must exist before durable execution is safe.
alternatives:
  - Vercel Workflow / WDK
  - Cloudflare Workflows
  - Cloudflare Durable Objects
  - Cloudflare Queues
  - Cloudflare Agents
  - GitHub Actions
  - Codex Automations
  - Local queue/state machine
impact: Keeps Autopilot safe and auditable while preserving runtime optionality.
approved_by: supervisor policy pending user acceptance
related_tasks:
  - docs/autopilot/delivery-system-governance.md
  - docs/autopilot/delivery-system-ledgers.md
  - docs/autopilot/delivery-system-connector-snapshots.md
  - docs/projects/multi-agent-autonomous-delivery-system/work-log.md
```
