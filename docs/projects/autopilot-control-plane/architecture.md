# Autopilot Control Plane Architecture

Last updated: 2026-06-17
Next review: 2026-06-24
Status: active process layer
Release: `v0.2.0`
Slug: `autopilot-control-plane`
Canonical local root: `C:\Programování\autopilot-beta` (the single self-contained source of truth; the former canonical `autopilot` at `C:\Programování\Codex` / `SirRadek/autopilot` is archived/dead)
Canonical remote repository: `SirRadek/Autopilot-beta`
Local workspace: `C:\Programování\autopilot-beta`
Separation status: `separated`
Visibility: dedicated control-plane repository, with private inventory redacted when needed

## Purpose And Scope

The Autopilot control plane defines how project work is received, researched, scoped, delegated, verified, logged, and handed off. It is currently a documentation, typed-governance-contract, static read-only command-center, local Decision Mesh, and supervision layer, not an autonomous execution engine.

Autopilot is its own project. It makes, supervises, and audits other projects, but it must not be treated as the same project as Radeq or any other product runtime.

Out of scope for the current architecture:

- autonomous execution loop
- background task runner
- stored credentials
- real GitHub, Cloudflare, Vercel, Linear, or Docket mutation from UI
- multi-provider LLM gateway
- production dashboard runtime with connector mutation

## System Boundary

In this project:

- `docs/autopilot/v3-prompt-pack.md`
- `docs/autopilot/2026-05-10-autopilot-run-log.md`
- `docs/autopilot/project-architecture-standard.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/autopilot/repository-separation-policy.md`
- `docs/autopilot/graphic-agent-operating-model.md`
- `docs/autopilot/design-intelligence-operating-model.md`
- `docs/autopilot/local-worker-operating-model.md`
- `docs/autopilot/token-efficiency-operating-model.md`
- `docs/autopilot/model-output-evaluation-operating-model.md`
- `docs/autopilot/protective-supervision-operating-model.md`
- `docs/autopilot/agent-handoff-packet-template.md`
- `docs/autopilot/project-progress-ledger-template.md`
- `product-design-os/` phase-1 Product & Design OS governance foundation
- deterministic Product & Design OS foundation validator, intake router, console-only report generator, and scoring engine under `product-design-os/scripts/`
- Product & Design OS local library under `product-design-os/library/` for reusable source reviews, inspiration-only reference records, clean-room reference templates, and generated project indexing
- per-project architecture records under `docs/projects/`
- minimal TypeScript/Vitest governance-contract package
- typed registries under `src/data/delivery-system/`
- typed design intelligence and architecture library policy under `src/data/delivery-system/designIntelligence.ts`
- typed graphic-production policy under `src/data/delivery-system/graphicAgent.ts`
- typed local-worker routing policy under `src/data/delivery-system/localWorkers.ts`
- typed token-efficiency routing policy under `src/data/delivery-system/tokenEfficiency.ts`
- typed model-output evaluation and learning-loop policy under `src/data/delivery-system/modelOutputEvaluation.ts`
- deterministic model-output eval record schema, examples, redacted record area, and validator under `model-output-evals/` and `scripts/validate-model-output-evals.ts`
- typed protective-supervision routing policy under `src/data/delivery-system/protectiveSupervision.ts`
- project-local report-first Codex lifecycle hooks under `.codex/`
- typed capability routing, context economy, and model spend policy under `src/data/delivery-system/`
- Product & Design OS templates, recipes, schemas, taste memory, and reports under `product-design-os/`
- pure validators under `src/lib/delivery-system/`
- Decision Mesh YAML/JSON source under `mesh/`
- pure Decision Mesh query library under `src/lib/decision-mesh/`
- local read-only stdio MCP server under `mcp/server.ts`
- project-specific Decision Mesh seed or mirror graphs under `docs/projects/*/decision-mesh/`
  and repo-local supervised project meshes under `.autopilot/decision-mesh/`
- deterministic mesh artifact generator under `scripts/generate-decision-mesh.ts`
- (planned, not yet built) static read-only command center with 2D Decision Mesh graph and project delivery workflow at `src/pages/autopilot.astro`
- tests under `tests/delivery-system/`
- Decision Mesh tests under `tests/decision-mesh/`
- local Playwright smoke test at `tests/autopilot-delivery-system.spec.ts`

External to this project:

- GitHub connector and `gh` CLI live repository data
- Linear workspace data
- Docket product knowledge data
- Vercel projects, deployments, and workflow APIs
- Cloudflare account resources
- Gemini CLI advisory critique
- Claude Code optional credentialed advisory sessions
- Context7 or official documentation sources
- remote MCP transports or connector-hosted MCP servers
- product runtime source code such as Radeq pages, functions, migrations, and assets

## Repository Boundary

Target local root:

```text
C:\Programování\Codex
```

Target remote repository:

```text
SirRadek/autopilot
```

Autopilot may store registry metadata and sanitized snapshots for product projects, but product code must live in separate repositories such as:

```text
C:\Users\sirok\Documents\Projects\radeq
SirRadek/radeq
```

Current state: the local Autopilot root is separated from the Radeq product checkout and targets the dedicated `SirRadek/autopilot` repository. The previous mixed checkout is preserved as a local backup for recovery and audit.

## Operating Workflow

```text
User request
  -> Supervisor or Intake Triage Bot
  -> intake record
  -> priority and safety classification
  -> local repository inspection
  -> current-fact verification for unstable claims
  -> independent research when implementation risk requires it
  -> synthesis gate
  -> WRITE_ALLOWED decision
  -> scoped worker assignment
  -> verification gates
  -> architecture impact check
  -> work-log update
  -> final handoff
```

Modes:

- `DRY_RUN`: reasoning, planning, and critique only.
- `INSPECT_ONLY`: read local or approved external context, no file edits.
- `WRITE_ALLOWED`: exact files, commands, forbidden actions, and verification are named.
- `REMOTE_MUTATION_APPROVED`: remote mutation is explicitly approved and logged before action.

## Data Model

Current data is Markdown-first with a minimal typed governance mirror:

- prompt pack
- run logs
- project architecture registry
- project architecture records
- project work logs
- plans and specs under `docs/superpowers/`
- typed delivery-system contracts under `src/data/delivery-system/`
- phase-0 evidence and completion JSON contract schemas under `docs/contracts/`
- typed Design Intelligence policy and LLM/ML architecture library candidates under `src/data/delivery-system/designIntelligence.ts`
- typed Graphic Production Agent policy under `src/data/delivery-system/graphicAgent.ts`
- typed Local Worker policy under `src/data/delivery-system/localWorkers.ts`
- typed Token Efficiency policy under `src/data/delivery-system/tokenEfficiency.ts`
- typed Model Output Evaluation policy under `src/data/delivery-system/modelOutputEvaluation.ts`
- model-output eval record contract and validator under `model-output-evals/` and `scripts/validate-model-output-evals.ts`
- typed Plugin/Skill Tool Inventory policy under `src/data/delivery-system/toolInventory.ts`
- typed supervisor execution-loop contracts under `src/data/delivery-system/subscriptionBudget.ts`, `src/data/delivery-system/fallbackChains.ts`, and `src/data/delivery-system/dependencyFreshness.ts`
- pure delivery-system validators under `src/lib/delivery-system/`
- Decision Mesh YAML nodes, edges, rules, schemas, and generated JSON artifact under `mesh/`
- Decision Mesh node records may include `failure_modes[]` for explicit supervision failure patterns.
- pure Decision Mesh query helpers under `src/lib/decision-mesh/`
- local stdio MCP tool server under `mcp/server.ts`
- capability routing, context economy, and model spend policy data under `src/data/delivery-system/`
- (planned, not yet built) deterministic contract validation under `scripts/validate-contracts.ts`
- seeded project-specific Decision Mesh records under `docs/projects/<project-slug>/decision-mesh/`
  and repo-local supervised project meshes under `.autopilot/decision-mesh/`
- Vitest contract tests under `tests/delivery-system/`
- Vitest Decision Mesh tests under `tests/decision-mesh/`
- (planned, not yet built) static `/autopilot` command-center page with deterministic 2D Decision Mesh visualization and ordered project-delivery workflow under `src/pages/`
- Playwright browser smoke test under `tests/`

Planned typed data:

- `src/data/autopilot/projects.ts`
- `src/data/autopilot/skills.ts`
- `src/data/autopilot/agents.ts`
- `src/data/autopilot/verification.ts`
- `src/data/autopilot/providers.ts`
- `src/lib/autopilot/inventory.ts`
- `src/lib/autopilot/prompts.ts`

These planned files do not exist yet.

The current `package.json`, `tsconfig.json`, `vitest.config.ts`, `astro.config.mjs`, and `playwright.config.ts` are approved only for governance-contract validation, local Decision Mesh querying, local read-only MCP serving, and a local static read-only command center. They do not approve connector clients, background jobs, workflow engines, product runtime code, remote mutation, remote MCP transport, or deployment configuration.

Decision Mesh:

- `mesh/` is the human-readable source of truth.
- The root `mesh/` is Autopilot's own operational mesh, not the project mesh for every supervised product.
- Each supervised project must create and maintain its own project-specific Decision Mesh during project architecture onboarding. The local MCP resolver first checks the sibling project repo at `<ProjectsDir>/<project-slug>/.autopilot/decision-mesh/`, where `ProjectsDir` defaults to the control-plane parent's `Projects` directory and may be overridden by `AUTOPILOT_PROJECTS_DIR`; if no sibling mesh exists, it falls back to the control-plane `docs/projects/<project-slug>/decision-mesh/` mirror.
- `mesh/generated/decision-mesh.json` is derived from the YAML source and validated by the decision-mesh test suite (there is no `mesh:check` script); the related_files ratchet gate is `npm run mesh:gate:ci`.
- MCP tools return compact JSON context and never approve work.
- The `/autopilot` page may render a read-only SVG view of `mesh/generated/decision-mesh.json`; the visualization is a control surface only and does not become a new mesh source of truth.
- The `/autopilot` page may also render the owner-to-closeout delivery workflow, including agent handoffs, communication order, mesh checkpoints, outputs, and gates. This workflow view is read-only and does not become an execution engine.
- MCP exposes `select_capabilities` so work can route through web build, optimization, data, SEO, automation, recovery, document, bot/RAG, and 3D add-on capabilities before planning.
- MCP exposes `build_project_mesh_packet` so supervised project work can query that project's own mesh without treating the root Autopilot mesh as product context.
- Strategic reasoning is modeled as an escalation/review/planning layer; routine worker tasks stay local by default.
- Local worker routing is modeled explicitly: deterministic tools run first for search and verification, `qwen2.5-coder:7b` is the available fast local coding worker, and `qwen2.5-coder:14b` is the maximum local coding worker target for this PC after install and hardware checks.
- Token-efficiency routing is modeled explicitly: narrow work uses Caveman Mode with one task, minimal context, `rg` first, deterministic tools first, local/no-cost workers before cloud, and escalation only when risk or repeated failure justifies it.
- Protective supervision is modeled explicitly: currentness sentinel reviews, agent-output handoff compilation, progress ledger deltas, blockers, waiting dependencies, and next action sequence are handled as read-only guardrails until the owner approves a scoped write. Raw agent output must be normalized before it becomes another agent's input.
- Codex lifecycle hooks are modeled explicitly as deterministic report-first guardrails. They add startup, prompt, tool, compaction, subagent, and completion checks; store only redacted hashes and classifications under ignored `.codex/state/`; and remain subordinate to Decision Mesh, architecture records, work logs, tests, and owner decisions.
- Failed tool results also write a redacted investigator handoff under `.codex/state/investigation-queue.jsonl`. The handoff records hashes, failure class, scope, required checks, and forbidden actions only. It helps Protective Supervision assign an `INSPECT_ONLY` investigator, but hooks do not spawn agents, retry tools, call cloud models, stop or restart processes, or create a second runtime queue.
- Failed-process repair is explicitly sequenced: reproduce or record the failure pointer, identify the affected process/session, checkpoint progress, stop or drain the process before the fix, apply the scoped fix, restart or refresh the session, update continuity/progress, and resume from the last verified state.
- Observability routing is modeled explicitly: diagnostic work must first classify whether the symptom belongs to Autopilot control-plane behavior or to a supervised project. Autopilot may store redacted log summaries, source pointers, routing decisions, and verification evidence, but raw project runtime logs remain in the project or source system.
- Product & Design OS is modeled as a phase-1 governance/template layer for classifying product/design work, locking scope, running opposition, selecting recipes, scoring patterns/assets, tracking taste memory, and defining QA before implementation. It extends the mesh and typed governance policies without adding runtime behavior. Its deterministic router and scoring engine are also exposed through the local read-only MCP server as `route_product_design_os` and `score_product_design_os`.
- Product & Design OS library records distinguish commercial-safe source pools from inspiration-only references. External assets require source, license, cost, commercial-use, provenance, fallback, performance, and QA evidence before project adoption. Reference screenshots, OCR, DOM/CSS inspection, and HTML captures are evidence only; implementation must use a clean-room brief and original code/assets unless a license explicitly permits reuse.
- Visual Analyst and Design Critic are governed roles for pre-production visual analysis, post-production critique, research evidence, and architecture-library recommendations. They do not produce final assets, approve their own work, or approve runtime adoption.
- The Graphic Production Agent is a governed execution role and typed policy for routing static graphics, motion backgrounds, physics visuals, model assets, and video storyboards. It defaults to local/free tools, allows cloud tools when the free/no-cost path is confirmed, and blocks paid tools such as Kling AI without a later owner exception.
- Reasoning agent routing is modeled explicitly as task lanes plus provider policies: deterministic tools, local Qwen, GPT/OpenAI, Claude Code subscription, Gemini CLI through Google AI subscription/license entitlement, DeepSeek API/self-hosted, and DeepSeek manual web chat each have separate checks, advisory weights, context scopes, and stop conditions.
- Advisory weight is ordered by source authority and owner preference: local deterministic evidence and project records outrank all models; scoped Claude Code subscription critique has higher advisory weight and broader repo-read scope than Gemini; Gemini has higher advisory weight than Qwen or DeepSeek drafts.
- External advisory reasoning models are allowed as redacted advisory support for brainstorming, critique, validation, and second opinions across agents. Routine worker loops remain local by default, paid credits are blocked, subscription and license tools require entitlement checks, API/self-hosted tools require cost or infrastructure checks, and model output is never source-of-truth evidence without local verification.
- Model-output evaluation is modeled explicitly: outputs that affect prompts, handoffs, routing, governance, architecture, security, or delivery decisions must be scored by dimension before acceptance. During learning, poor outputs trigger prompt/input deltas and reruns until acceptable or blocked; repeated similar failures trigger token-efficiency and reasoning-model route review before changing reasoning or provider; later weekly tuning uses collected eval records and failure patterns.
- Advisory provider execution is modeled separately from model output. Provider runner logs, prompt echoes, CLI syntax errors, trust-flag failures, login failures, and provider availability failures are control-plane diagnostics. If no model output artifact is present, Protective Supervision must set `blocked` or `waiting_owner` and content review must not continue until the owner changes scope or a valid output exists.
- Model-output eval records are deterministic local JSON contracts validated by `scripts/validate-model-output-evals.ts` (the schema, examples, provider source IDs, score dimensions, privacy review, retry deltas, repeated-failure route review, and weekly aggregates). NOTE: there is no `model-output:validate` npm script and this validator is NOT yet wired into `npm run verify` or the test suite — running it is currently manual.
- Plugin, skill, and provider-policy inventory is modeled explicitly. Current-session callable plugins and local skills can be routed through their exposed tools/workflows; cached plugin bundles are only availability leads until `tool_search` or active tools expose them. Model provider records such as DeepSeek are read-only routing metadata until credentialed runtime access, or manual web-login availability for web chat, is separately verified.
- Context7 is the preferred docs-verification lane for reasoning, Gemini brainstorming, design critique, architecture-library review, and technology/best-practice recommendations when it is connected. If Context7 is unavailable or does not cover the topic, the handoff must record the fallback and verify the claim through official documentation, local files, tests, or controlled browser evidence.
- Context7 is configured as a global local Codex MCP server via `npx.cmd -y @upstash/context7-mcp`, but a running thread may need restart or reload before the `mcp__context7` tools appear in the available tool list.
- 3D visualization is deferred until the query/MCP layer is stable, and 3D remains a premium add-on capability rather than a default service path.
- A parallel AI Production Studio remains a possible future architecture, but only after an explicit decision defines source-of-truth ownership, interop or migration, and maintenance cost.

## Integrations

GitHub:

- used for read-only repository context unless mutation is explicitly approved
- Autopilot's target remote repository is `SirRadek/autopilot`
- product projects are referenced as external repositories, not as Autopilot-owned source trees

Superpowers:

- provides process skills for planning, verification, debugging, and development discipline

MCP:

- local stdio MCP server exposes read-only Decision Mesh tools for Codex context routing
- local stdio MCP server exposes `select_graphic_route` as a read-only Graphic Production Agent routing tool
- local stdio MCP server exposes `select_design_review_route` and `search_architecture_library` as read-only design intelligence tools
- local stdio MCP server exposes `select_reasoning_model_route`, `select_tool_inventory_route`, and `select_local_worker_route` as read-only model, plugin/skill, and worker routing tools
- local stdio MCP server exposes `select_model_output_evaluation_route` as a read-only model-output scoring, retry, route-review, and weekly tuning recommendation
- model-output eval records are stored locally under `model-output-evals/records/` only as bounded metadata and source pointers; MCP does not write records or mutate prompts
- local stdio MCP server exposes `select_token_efficiency_route` as a read-only Caveman/compact routing tool
- local stdio MCP server exposes `select_protective_supervision_route` as a read-only protective-supervision route for currentness checks, handoffs, progress, and blocker review
- local stdio MCP server exposes `route_product_design_os` as a read-only Product & Design OS intake/change-request routing tool
- local stdio MCP server exposes `score_product_design_os` as a read-only Product & Design OS recipe/pattern/asset scoring tool
- MCP tool responses include structured content and per-tool output schemas; the schemas are tool contracts only and do not add execution authority
- no remote MCP transport, connector-backed MCP server, or mutating MCP tool is approved

Prompt Library:

- local Git/Markdown prompt contracts live in `prompt-library/`
- prompt source authority uses official provider docs first, then local policy/tests/evals, with DAIR.AI and GitHub catalogs as inspiration only
- prompt work routes through `prompt_library_policy` and the Autopilot project `prompt_library_boundary`
- prompt/input tuning routes through `model_output_evaluation_policy` and the Autopilot project `model_output_evaluation_boundary` before prompt defaults or model routing change
- supervisor startup prompts use a layered stack: shared base prompt, project-specific prompt, then the owner's current task instruction. The base layer owns runtime bridge checks, mesh routing, source authority, handoff normalization, progress states, and QA gates.
- no prompt-management SaaS, runtime selector, paid tool, leaked-prompt source, or duplicate prompt source of truth is approved

Protective Supervision:

- reports currentness gaps for prompt, mesh, model, tool, Context7, GitHub, and architecture guidance
- compiles reviewed agent outputs into bounded handoff packets before another agent receives them
- tracks project state as `not_started`, `ready`, `in_progress`, `needs_review`, `blocked`, `waiting_owner`, `waiting_external`, `done`, or `cancelled`
- stores source pointers, verification gaps, and progress deltas instead of raw logs or full agent transcripts
- for failed-process investigation, requires checkpoint, stop/drain before fix, restart/refreshed session after fix, continuity update, and resume from the last verified state
- remains report-first and read-only unless the owner explicitly approves a scoped write

Codex Hooks:

- project configuration lives in `.codex/hooks.json`
- the dependency-free handler lives in `.codex/hooks/autopilot-hook.mjs`
- runtime evidence is local and ignored under `.codex/state/`
- hook state excludes raw prompts, commands, responses, transcripts, credentials, customer data, and project runtime logs
- failed tool evidence may create redacted investigator handoff rows in `.codex/state/investigation-queue.jsonl`; these rows are progress evidence, not execution authority
- failed tool handoffs include the stop/drain, fix, restart, continuity, and resume checks for affected running processes
- hooks do not stop, drain, restart, retry, or patch running processes automatically
- hooks do not call cloud models, connectors, deployment tools, or remote mutation paths
- exact hook definitions require Codex trust review after changes
- file/test verification does not prove the active Codex App host loaded the hooks; a refreshed trusted session must produce lifecycle evidence

Vercel:

- Vercel Workflow and DurableAgent are phase-2 research topics only
- no Vercel runtime or workflow is implemented

Linear:

- skill is available, but no Linear architecture registry integration exists yet

Docket:

- no Docket-backed project architecture sync exists yet

Cloudflare:

- relevant for Radeq runtime and D1 lead capture
- no Autopilot control-plane runtime runs on Cloudflare yet

Gemini:

- advisory critique only
- standard advisory weight below scoped Claude Code subscription critique and above Qwen or DeepSeek drafts
- receives selected redacted context by default, not broad private repository context
- receives redacted context only
- never approves work or overrides local verification
- owner clarified on 2026-06-11 that Google AI/Gemini access is subscription-based, not Gemini API-budget based; API-key, Vertex/AI Studio paid routing, or API-limit assumptions remain blocked without a separate owner decision
- must have Google AI subscription or Code Assist license entitlement confirmed; paid API credits, account upgrades, or unknown pricing are stop conditions
- can support brainstorming, critique, validation, and second opinions when claims are checked locally or against primary sources
- must label brainstorm ideas separately from verified facts; framework, library, SDK, API, browser, cloud, SEO, accessibility, and best-practice claims require Context7 or official-docs verification before adoption

Claude Code:

- optional subscription-interactive advisory provider only; not an API-credit worker, default worker, gateway, approval authority, or source of truth
- higher-trust advisory reviewer than Gemini for owner-scoped architecture, security, planning, agent validation, and edge-case critique
- may receive broad repository read scope after owner scope, except secrets, credentials, customer data, raw project logs, private account identifiers, and unapproved remote mutation paths
- local setup evidence on 2026-06-11: installed through WinGet package `Anthropic.ClaudeCode`, `claude --version` reported `2.1.172`, and Windows Authenticode signature verified as `Anthropic, PBC`
- authentication completed through an interactive Claude Code login window; do not print, store, or summarize token values
- owner clarified on 2026-06-11 that Claude access is subscription-based, not Anthropic API-budget based; API-credit routing remains blocked without a separate owner decision
- allowed uses are architecture/security/planning critique, agent validation, edge-case review, and bounded repo sessions after owner scope
- forbidden uses are routine local-worker loops, final approval, governance approval, unredacted context, unbounded autonomous execution, and remote mutation without explicit approval
- project `CLAUDE.md` defines the local memory contract and points Claude back to `AGENTS.md`, Decision Mesh routing, local checks, and Autopilot boundaries

DeepSeek:

- API/self-hosted advisory comparison provider only; not a connected runtime, default worker, gateway, approval authority, or source of truth
- manual web-chat advisory through `https://chat.deepseek.com/`; not a CLI, API runtime, connector, stable headless automation contract, default worker, approval authority, or source of truth
- represented in reasoning-model routing, model-output evaluation, prompt-provider guidance, and tool/provider inventory as `provider_policy_only`
- allowed API/self-hosted uses are DeepSeek JSON output comparison, reasoning-model comparison, function-calling guidance review, and cost-aware coding critique after provider availability, cost or self-hosting, redacted-context, official-doc, and local-verification checks
- allowed web-chat uses are free/manual advisory second opinions after browser login, fresh chat, selected `Rychlý`/Quick or `Expert` mode, bounded redacted prompt packet, and controlled browser evidence
- forbidden uses are routine local-worker loops, broad private repository context, unverified hosted-cost assumptions, unsupported tool-mode assumptions, CLI/API claims without key evidence, hidden/headless browser use as a stable runtime, and final approval
- no `DEEPSEEK_*` credential marker was present in the inspected local environment on 2026-06-11; registering the provider in mesh does not create credentials or call the provider
- Browser verification on 2026-06-11 confirmed logged-in web chat, fresh Quick and Expert chats, expected response tokens, and `Přemýšlení po dobu 1 sekundy` evidence for thinking; outputs remain advisory only

## Security And Privacy Controls

- Private repository names, private issue bodies, customer data, secrets, account identifiers, and local credential state must not be sent to external models.
- External critique must use approved aliases.
- Remote service mutation is forbidden unless explicitly approved and logged.
- `WRITE_ALLOWED` is locked by default.
- Every final handoff must state verification evidence and architecture impact.
- Every project must have a current architecture record before implementation starts.
- Decision Mesh stop conditions require owner decision unless the task explicitly resolves the stop condition.
- Missing project-specific mesh is a stop condition for project implementation work.
- Ambiguous diagnostic ownership is a stop condition. Project runtime issues must route into that project's architecture record and decision mesh before implementation planning.
- Raw project logs, CI logs, deployment logs, and runtime traces must not be copied into Autopilot as source-of-truth evidence; use redacted summaries and source pointers.
- Raw agent output must not be used directly as the next prompt; Protective Supervision must normalize it into facts, assumptions, decisions, risks, open questions, allowed surfaces, forbidden actions, required checks, and source pointers.
- Raw model output must not be promoted into prompt authority. Prompt/input changes need a scored output record, source pointers, a delta, and rollback path.
- Blocked or waiting progress states must name an owner, external dependency, source needed, or stop condition.
- A failed running process must be stopped or drained before a repair is applied unless the owner explicitly approves a live-patch exception; after the fix, the session must be restarted/refreshed, continuity updated, and work resumed from the last verified state.
- Lower-weight advisory models may not override scoped Claude Code critique without verified local evidence, tests, Context7, or official documentation.
- Reasoning effort, model, or provider must not change after weak output without repeated failure evidence, provider/source checks, entitlement/cost/privacy checks, and a fresh score on the new output.
- Non-local worker dependency is a stop condition unless the task is strategic reasoning or independent review.
- MCP tools may not read product repositories or credentials.
- Unapproved parallel systems or duplicate sources of truth are stop conditions.

## Verification Gates

Process gates:

- intake triaged
- local context checked
- current docs checked for unstable technical facts
- independent research checked when needed
- synthesis checked
- scope respected
- security reviewed when secrets, remote services, public routes, or execution are involved
- project architecture reviewed or updated
- work log updated
- final handoff checked

Documentation verification:

```powershell
rg -n "Project Architecture" docs
npm run verify        # aggregates: beta:vendor-check, typecheck, test, pdos:validate,
                      # pdos:renderability, pdos:buildability-floor, pdos:fit-safety-lint,
                      # model-output:validate, mesh:gate:ci
npm run mesh:changed -- --since origin/main --fail-on-blocker --fail-on-ungoverned
git diff --check
# NOTE: mesh:check / prompt:validate / contracts:validate / audit:deps were canonical-autopilot
# scripts and do NOT exist in autopilot-beta. The mesh derived-artifact check is
# tests/decision-mesh/generated.test.ts; prompt/contract checks are covered by the test suite.
```

Application verification is delegated to the affected project architecture record.

## Known Gaps And Risks

- `/autopilot` static read-only command center exists; it is not an execution console.
- Decision Mesh and local MCP server exist as read-only context routing; they are not approval, execution, connector, or remote mutation surfaces. MCP server version is sourced from `package.json`, server instructions describe the read-only boundary, and tool results include per-tool `outputSchema` plus `structuredContent`.
- Delivery-system typed governance contracts exist; capability routing, context economy, model spend policy, evidence/completion JSON contracts, deterministic contract validation, and current project mesh seeds now exist.
- Prompt Library phase-0 exists as local Git/Markdown contracts with human and machine-readable source catalogs, source-catalog schema validation, metadata schema, seed prompts for GPT/Gemini/Claude/Qwen, deterministic frontmatter/source/eval validation, model-output eval feedback-loop governance, and a Decision Mesh boundary; agent-packet prompt selection remains planned.
- Protective Supervision phase-0 exists as typed read-only routing policy, root/project Decision Mesh boundaries, handoff/progress templates, and local MCP exposure; it is not a runtime queue and does not mutate remotes.
- Governed-core dispatch must preserve vendor guard metadata when it narrows a governed handoff into `CliWorkerInput`: `codexMode`, `openrouterMode`, `taskPacketRef`, `routingMode`, prompt limits, and access-tier fields stay with the worker lane so downstream bounded-worker doctrine remains enforceable.
- Project-local Codex hooks now exist as a phase-1 report-first lifecycle layer. They have deterministic tests, redacted local state, and a failed-tool investigator handoff ledger, but active Codex App runtime loading remains unverified until hook trust review and a refreshed session produce `SessionStart` evidence.
- Project, skill, agent, provider, and verification registries remain planned unless covered by the existing delivery-system contracts. Reasoning provider lanes and plugin/skill inventory are now covered by delivery-system contracts, but the broader `src/data/autopilot/*` registries remain planned.
- Product & Design OS now has deterministic foundation, schema, provenance, source-link, relationship, unique-ID, status-enum, and project-index validation; intake/change-request router; console-only Markdown reports; read-only MCP exposure; recipe/pattern/asset scoring; first marketing/creative, ecommerce, dashboard/data-heavy, internal-ops, public-sector, and client-portal registry seeds; a local Playwright Design Reader that captures screenshots, extracts DOM/CSS evidence, and feeds the structured Visual QA analyzer; plus a local external-worker adapter for the separate `pdf-supervisor` document/PDF reader. Screenshot OCR, reference comparison, AI-agent UI, document-system recipes, automation UI, and advanced automation scripts remain planned.
- Product & Design OS now has a local source/reference/project library and a project-index generator. It is not yet wired into a full automation loop; project records should run `npm run pdos:library:projects` after project onboarding or meaningful project-record changes.
- Architecture records for external/private projects are not normalized yet.
- Regular review cadence is documented. Weekly report-first sentinel automation is planned, but Codex app automation creation was blocked in this session because the automation handler was not registered.
- `codex_app` helper tools such as `automation_update` and `read_thread_terminal` may appear in thread metadata without an active handler in VS Code-sourced or mismatched desktop/runtime sessions. When this occurs, do not write automation TOML by hand; restart/reload the Codex app/thread and retest the official handler.
- `remoteControl/enable` is not a substitute for the `codex_app` host/runtime handler. A standalone `codex.exe app-server --listen stdio://` probe can move its own remote-control status from `disabled` to `connecting`, but that does not attach handlers to the active thread. `codex app-server proxy` also depends on an app-server control socket, which was absent in the observed Windows session. Do not start a parallel app-server as an Autopilot workaround; it would create a separate runtime instead of binding the current host dispatcher.
- Vercel, Linear, and Docket are not integrated into the architecture registry.
- The TypeScript package and Astro route must stay limited to pure governance validation and static read-only reporting until a later architecture decision changes the boundary.

## Architecture Change Triggers

Update this file when any of these change:

- supervisor workflow or mode rules
- `WRITE_ALLOWED` unlock criteria
- worker role responsibilities
- verification gates
- project architecture standard or registry contract
- GitHub, Linear, Docket, Vercel, Cloudflare, Gemini, or Context7 integration behavior
- `/autopilot` route or typed registry implementation
- Decision Mesh schemas, MCP tools, generated artifact, or mesh usage rules
- privacy, external disclosure, or remote mutation policy
