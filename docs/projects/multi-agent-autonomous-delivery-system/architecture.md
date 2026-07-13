# Multi-Agent Autonomous Delivery System Architecture

Last updated: 2026-07-13
Next review: 2026-06-07
Status: phase-3 read-only Decision Mesh context router
Slug: `multi-agent-autonomous-delivery-system`
Canonical remote repository: `SirRadek/autopilot`
Local workspace: `C:\Programování\Codex`
Separation status: `autopilot_subsystem`
Visibility: Autopilot control-plane subsystem; external/private project details must be redacted

## Purpose And Scope

This project defines a governed autonomous software delivery system. It turns product requests into auditable delivery runs with business review, architecture control, bounded execution, testing, code/security/UX review, governance gates, monitoring, and memory.

The system is not currently an execution runtime. It is a planned architecture and implementation roadmap that begins with documentation, typed contracts, ledgers, Decision Mesh context routing, and read-only supervision.

This project is an Autopilot subsystem. It belongs inside the dedicated Autopilot control-plane repository, not inside any product repository.

Out of scope for the current phase:

- autonomous code execution
- remote mutation through GitHub, Linear, Vercel, Cloudflare, Docket, or databases
- stored credentials
- production deployment of a workflow engine
- unreviewed use of private inventory or customer data
- model-specific dependency on Qwen, Gemini, OpenAI, or any single provider

## System Boundary

In this project:

- architecture record and work log
- design spec and implementation plan
- delivery-system governance, ledgers, and model-policy docs
- connector snapshot procedure for reviewed external evidence
- execution-engine options decision record
- runtime/package decision for typed governance contracts
- governance contracts
- typed registries for roles, gates, workflows, ledgers, and model policy
- pure validators for gate results, role permissions, and ledger completeness
- Decision Mesh YAML/JSON source of truth, schemas, generated graph artifact, and pure query library
- local read-only stdio MCP server for relevant subgraph and agent-packet lookup
- capability routing, context economy, and model spend policies
- seeded project-specific Decision Mesh under `docs/projects/multi-agent-autonomous-delivery-system/decision-mesh/`
- project-specific delivery observability boundary for worker, governance, model-routing, and verification symptoms
- bounded OpenRouter attempt and spend ledgers under the managed state directory, with fail-closed migration from retained parent-directory legacy files
- static read-only command-center view at `/autopilot`
- local browser/e2e smoke tests for the command center

Provider ledger persistence uses `stateDir/openrouter-api-attempts.jsonl` and
`stateDir/openrouter-api-spend.jsonl`. Before an OpenRouter worker can account
an attempt, check spend, or call the provider, legacy files directly under
`dirname(stateDir)` are validated and copied without overwrite. Migration is
bounded to 4 MiB and 20,000 non-empty v1 JSONL records per ledger, verifies
bytes and SHA-256 after fsync, and never deletes the legacy source.

External to this project:

- GitHub repositories, PRs, issues, and Actions logs
- Linear issues, cycles, projects, and team data
- Vercel projects, deployments, logs, and workflow runtime
- Cloudflare Pages, Workers, D1, Workflows, Agents, Queues, and Durable Objects
- Docket product/sales knowledge
- Gemini CLI advisory critique
- local or remote model runtimes such as Qwen candidates
- remote MCP transports and mutating MCP tools
- product repositories created or supervised by Autopilot

## Repository Boundary

The multi-agent delivery system is part of Autopilot itself. Its target home is:

```text
C:\Programování\Codex
SirRadek/autopilot
```

Projects created by this system must be separate repositories under their own local roots:

```text
C:\Users\sirok\Documents\Projects\<project-slug>
SirRadek/<project-slug>
```

The delivery system may create project scaffolds, architecture templates, and governance records, but product implementation belongs in the created project's repository.

## Layered Architecture

```text
User / Product Request
  -> Business Layer
  -> Orchestrator Layer
  -> Analysis + Architecture Layer
  -> Execution Layer
  -> Testing Layer
  -> Review Layer
  -> Copywriting + UX Validation
  -> Governance Gates
  -> Merge / Delivery
  -> Autopilot Supervisor
  -> Memory + Optimization + Lessons
```

## Core Responsibilities

Business Layer:

- business goals
- product priorities
- ROI and user value
- scope management
- roadmap alignment

Orchestrator Layer:

- dependency graph
- routing
- parallelization
- merge and rework flow
- cannot approve its own outputs

Architecture Layer:

- boundaries
- modularity
- integration flow
- scalability and maintainability
- security and performance patterns

Analysis Layer:

- impact analysis
- risk analysis
- dependencies
- unknowns
- edge cases

Execution Layer:

- bounded implementation
- isolated workers
- no business or architecture decisions
- no self-approval

Testing Layer:

- unit, integration, regression, E2E, acceptance, performance, and security-impact verification

Review Layer:

- code quality
- security
- architecture compliance
- UX consistency
- scope validation

Copywriting + Content Layer:

- UI text
- technical documentation
- brand voice
- localization
- accessibility language

Governance Layer:

- acceptance criteria
- plan alignment
- architecture compliance
- testing status
- security review
- scope validation

Autopilot Supervisor:

- monitoring
- failure detection
- timeout detection
- investigation
- recovery proposal
- incident evidence
- lessons learned

Memory Layer:

- project memory
- decision memory
- issue memory
- architecture memory
- workflow memory
- lessons memory

## Data Contracts

Detailed contracts are now split into:

- `docs/autopilot/delivery-system-governance.md`
- `docs/autopilot/delivery-system-ledgers.md`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/autopilot/decision-mesh-mcp-decision.md`
- `mesh/`
- `src/data/delivery-system/*.ts`
- `src/lib/delivery-system/*.ts`
- `src/lib/decision-mesh/*.ts`

Markdown governance remains the human-readable policy source. TypeScript contracts are the executable mirror. If they disagree, work must stop until a decision ledger entry resolves the mismatch.

Decision ledger entries must include:

- `decision_id`
- `type`
- `context`
- `decision`
- `reasoning`
- `alternatives`
- `impact`
- `approved_by`
- `related_tasks`

Issue ledger entries must include:

- `issue_id`
- `severity`
- `found_by`
- `related_agent`
- `description`
- `expected`
- `actual`
- `decision`
- `fix_owner`
- `status`
- `lesson_learned`

Gate results must include:

- `status`
- `checked_against`
- `issues`
- `decision_reason`
- `next_action`

Analysis output must include:

- `risks`
- `assumptions`
- `dependencies`
- `edge_cases`
- `unknowns`
- `recommendations`

## Integrations

GitHub:

- read repository and PR/issue/CI context
- future write operations require explicit remote mutation approval

Linear:

- future planning and issue tracking source
- requires workspace/team/project identifiers before tool use

Vercel:

- candidate durable workflow runtime
- all Workflow DevKit facts must be rechecked in official/current docs before implementation

Cloudflare:

- candidate runtime for Workers, Workflows, Agents, Durable Objects, Queues, Pages, and D1
- all product facts must be rechecked in current docs before implementation

Docket:

- future product knowledge and sales context source when callable tools are available

Superpowers:

- required process skills for brainstorming, planning, verification, debugging, review, and controlled agent execution

Gemini CLI:

- redacted advisory critique only
- cannot approve work or replace local evidence

Decision Mesh MCP:

- local stdio context router only
- root `mesh/` is Autopilot's operational mesh only
- every supervised project must create its own project-specific mesh during architecture onboarding if missing
- project meshes must be updated after every meaningful completed work slice
- returns relevant subgraphs, compact agent packets, project mesh packets, node explanations, required agents, and risks
- selects capabilities before planning through `select_capabilities`
- routes frontier reasoning only as strategic review, audit, planning, architecture, or edge-case escalation
- keeps routine coding, embeddings, RAG, indexing, automation, and summaries local by default
- cannot approve delivery, mutate files, call connectors, or read product repositories
- keeps a later parallel AI Production Studio possible only through explicit architecture decision, not as the current implementation path

## Security And Governance Controls

- Nobody approves their own work.
- Orchestrator cannot bypass governance gates.
- Testers cannot change business scope.
- Autopilot cannot approve delivery.
- Workers cannot silently change architecture.
- Scope drift triggers merge stop, valid-change separation, out-of-scope reversal, incident logging, and feedback.
- Architecture drift triggers issue logging, delta recording, rework, impact check, and re-review.
- Failed tests trigger failure summary, investigation, fix assignment, rerun, and governance approval.
- Inline fixes require small scope, no architecture change, no business logic change, no redesign, and evidence.

## Verification Gates

Required before implementation:

- project registry row exists
- architecture record is current
- work log is current
- project-specific Decision Mesh exists or is created by the first architecture task
- Decision Mesh packet reviewed when task touches auth, payments, database, uploads, public API, frontend UX, security, or release behavior
- project mesh impact recorded after completed work
- capability routing reviewed for web, optimization, data, SEO, automation, recovery, document, bot/RAG, or 3D tasks
- reasoning escalation reviewed when a task proposes non-local workers or frontier models
- design spec exists
- implementation plan exists
- connector and provider facts are verified when unstable
- no remote mutation is requested without explicit approval

Required before delivery:

- architecture impact recorded
- decision ledger updated when decisions changed
- issue ledger updated when issues were found
- tests and review evidence recorded
- governance gate result recorded
- final handoff references work-log evidence

## Known Gaps And Risks

- Initial typed registries and pure validators exist for governance contracts.
- Initial Decision Mesh and local read-only MCP server exist for compact context routing.
- Capability routing, context economy, model spend policy, and seeded project mesh records now exist as incremental improvements to the read-only context router.
- Runtime/package approval is limited to TypeScript/Vitest contract validation and a static Astro read-only command center; no connector client or execution runtime is approved.
- No execution engine has been selected; the phase-0 execution-engine decision record currently defers selection.
- Connector snapshot procedure exists and has been exercised for local repository plus GitHub metadata; Linear, Vercel, Cloudflare, and Docket snapshots remain unexercised.
- No recurring review automation exists yet.
- Docket callable tooling is not available in this session.
- Linear tooling requires workspace identifiers and OAuth connectivity before use.
- Model policy must not assume Qwen availability without local/runtime verification.

## Architecture Change Triggers

Update this file when any of these change:

- layer responsibilities
- role permissions
- gate definitions
- ledger schema
- plugin integration behavior
- execution engine decision
- monitoring/recovery flow
- memory strategy
- Decision Mesh routing or MCP tool behavior
- model policy
- privacy or remote mutation policy
