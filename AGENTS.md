# Autopilot Decision Mesh

Before planning or editing, use the Decision Mesh MCP tools when the task may affect:

- auth
- payments
- database or persistence
- file uploads
- public API routes
- frontend UX
- security
- release or delivery behavior

Use this order:

1. Call `select_capabilities` when the task may touch web builds, optimization, data, SEO, automation, recovery, documents, bots/RAG, or 3D.
2. Call `get_relevant_subgraph`.
3. Call `build_agent_packet` for the active role.
4. If the task belongs to a supervised project, call `build_project_mesh_packet` for that project's mesh before reading product-specific files.
5. Read only files listed in `must_read`, plus directly necessary local context.
6. Do not assume missing context.
7. If the graph reports `stop_conditions`, stop and ask for an owner decision unless the task is explicitly to resolve that stop condition.
8. After changes, record architecture and work-log impact when the change affects Autopilot governance.

Never load the full mesh unless explicitly requested.
Prefer relevant subgraph over full project context.

The mesh is a context router, not an approval authority. Local tests, architecture records, and explicit user decisions remain the source of truth.

## Project Mesh Scope

The root `mesh/` in this repository is Autopilot's own operational mesh. It describes how Autopilot routes, governs, reviews, and reasons about work.

It is not the product mesh for every supervised project.

Observability follows the same separation rule:

1. Classify every diagnostic task as an Autopilot control-plane problem or a supervised project problem before reading logs.
2. Autopilot may store routing decisions, redacted summaries, source pointers, and verification evidence.
3. Raw project runtime logs, deployment logs, CI logs, traces, and metrics stay in the affected project or source system.
4. Project runtime problems must use that project's architecture record and project-specific mesh before implementation planning continues.

For each supervised project:

1. During project architecture onboarding, check whether the project has its own mesh at `docs/projects/<project-slug>/decision-mesh/`.
2. If the project mesh does not exist, create it before implementation planning continues.
3. Keep that project mesh scoped to that project's runtime, risks, agents, data flows, integrations, and stop conditions.
4. After every meaningful completed work slice, update the project mesh or record why the work had no mesh impact.
5. Do not reuse Autopilot's operational mesh as the product/project mesh.

Missing project mesh is a stop condition for project implementation work.

## Capability Routing

Autopilot's current implementation path is to extend the existing mesh/MCP/governance layer.

Do not create a parallel AI Production Studio, separate runtime, or duplicate source of truth unless there is an explicit architecture decision with an interop or migration plan.

The future parallel system option remains open, but it is not the current default path.

Use capability routing to keep work bounded:

- web builds: `web_build_mesh`
- optimization: `optimization_mesh`
- data work: `data_mesh`
- SEO: `seo_mesh`
- automation: `automation_mesh`
- recovery/rescue: `recovery_mesh`
- document reconstruction: `document_mesh`
- bots/RAG: `bot_rag_mesh`
- 3D/WebGL: `three_d_experience_addon`

3D is a premium add-on only. Use it when it explains product, process, data, or system state. Do not activate 3D by default, and never hide primary SEO content inside canvas.

## Product & Design OS Rules

For product, UX, design, marketing website, portfolio, ecommerce, dashboard, internal-system, agent-UI, motion, or visual redesign work, use `product-design-os/` as the governance and template layer. It extends the existing mesh; it is not a separate runtime or source of truth.

Do not implement immediately after receiving an idea. First classify:

- project type
- primary goal
- target users
- critical user action
- logic priority
- design priority
- motion level
- risk level

Before implementation:

1. Create or update scope.
2. Identify needs, contradictions, and hidden risks.
3. Run strict product opposition.
4. Select a recipe, UX patterns, and compatible assets.
5. Define tests and acceptance criteria.
6. Lock exact files, non-work, and verification.

Every new request must be classified as clarification, scope expansion, direction change, backlog idea, or conflict with goal. If it conflicts with the goal, explain the conflict and propose a safer alternative before implementing.

For marketing and portfolio work, require distinct design directions with different layout rhythm, visual anchor, motion concept, CTA logic, and proof strategy. Reject palette-only variants, generic SaaS gradients, repeated equal card grids, fake dashboards, and decorative motion that does not support the user goal.

Never mark product/design work done without scope check, logic check, responsive check, accessibility check, performance check, visual QA, report, and feedback/taste-memory update when relevant.

## Context Economy Rules

Do not load or request the whole repository by default.

Use `select_token_efficiency_route` when a task is small, repetitive, context-heavy, or likely to waste paid tokens.

Before planning or editing:

1. Classify the task.
2. Use `select_capabilities`.
3. Use `get_relevant_subgraph`.
4. Build a small agent packet.
5. Read only required local files.
6. Ask only if critical context is missing.

Restart or compress context when the topic changes, the conversation gets long, the task scope changes, output quality drops, or the agent repeats old context.

Caveman Mode is the default for narrow routine work:

- one task only
- use `rg` before opening files
- read only must-read files and direct dependencies
- deterministic tools first
- local/no-cost worker before cloud reasoning
- stop instead of guessing when context is missing
- keep the answer short unless risk requires detail

## Reasoning Model Routing

Use local workers by default for:

- repository search and indexing
- deterministic checks such as typecheck, tests, build, and `git diff --check`
- autocomplete
- boilerplate coding
- bounded implementation
- embeddings
- RAG retrieval
- indexing
- automation loops
- routine summarization

Use `select_local_worker_route` when deciding whether a task should use deterministic tools, Qwen2.5-Coder 7B, Qwen2.5-Coder 14B, or a summarizer lane.

Local Qwen routing:

- `qwen2.5-coder:7b` is the fast local worker for small file-local patches, tests, bug summaries, and routine drafts.
- `qwen2.5-coder:14b` is the maximum local coding worker for this PC and requires install, hardware, scope, diff-review, and test checks before use.
- Local LLM workers draft work; they do not approve architecture, security, business scope, or delivery.

Escalate to frontier reasoning only for:

- deep research
- architecture review
- security audit
- code review
- agent validation
- strategic planning
- orchestration design
- edge-case reasoning
- cross-domain tradeoff analysis

Free/no-cost cloud reasoning models, including Gemini CLI when available, may be used as advisory reviewers for brainstorming, critique, planning, architecture review, security review, agent validation, and edge-case reasoning when they add a clear benefit.

Before using any cloud model:

- verify provider availability
- confirm free tier or no-cost use
- redact private repository data, secrets, customer data, account identifiers, and absolute local paths
- verify factual claims through local files, tests, Context7, official docs, or controlled browser evidence
- for framework, library, SDK, API, browser, cloud, SEO, accessibility, or best-practice claims, prefer Context7 when connected; if unavailable, record the fallback to official docs or another primary source
- keep Gemini and other advisory brainstorming output labeled as ideas until factual or implementation claims are verified through Context7, official docs, local files, tests, or controlled browser evidence
- disclose model/tool choice when it affects risk, cost, or delivery

If a task depends on a non-local worker and is not strategic reasoning or independent review, stop and ask for an owner decision. Do not route routine worker loops to cloud/frontier models by default. Stop if the model requires paid credits, has unknown cost, or would become a source of truth.

## Access Tiers

Only verified vendors — the Claude supervisor, codex_cli, and agy_cli — have
access to the autopilot control plane (this repository, the mesh, governance
surfaces). Lower-trust workers (openrouter_free, qwen_local, deepseek and any
future free lane):

- see only project-scoped, redacted packets — never control-plane files, mesh
  content, or governance context;
- never receive sensitive data or security-threat content;
- never self-prompt: worker output is normalized by a verified vendor before it
  can influence any next step;
- never persist or learn from Autopilot or project data;
- have every input and output mediated and reviewed by a verified vendor.

## Prompt Library Rules

Reusable prompts live in `prompt-library/` as local Git/Markdown contracts.
Use official provider docs for provider-specific behavior, local files/tests for
Autopilot behavior, and DAIR.AI or GitHub prompt catalogs only as inspiration.

Before adopting or changing a reusable prompt:

1. Declare model family, task type, version, status, sources, risk level,
   expected output, and evals.
2. Verify provider-specific claims against official docs or Context7 when
   connected.
3. Define uncertainty behavior, output validation, and rollback path.
4. Declare role, mode, allowed files/surfaces, forbidden actions, and
   verification when a prompt is for an agent or worker.
5. Apply token-efficiency routing before loading broad context.
6. Verify plugin/MCP availability, cost, privacy, and mutation boundaries before
   a prompt can request tool use.
7. Normalize GitHub issues, PR comments, and project cards into bounded task
   contracts before using them as prompt input.
8. Verify library, asset, UI kit, icon, font, generated media, and model-asset
   sources, licenses, usage rights, performance, and accessibility impact before
   adoption.
9. Keep Gemini/free-cloud prompt output advisory until locally verified.
10. Treat Qwen/local-worker prompt output as drafts requiring review and tests.

Do not use leaked system prompts, private prompts without permission, undated
prompt packs without eval evidence, or model output as prompt authority.

## Protective Supervision Rules

Use Protective Supervision when work needs currentness checks, agent handoffs,
progress tracking, blocker review, or waiting-state tracking.

Protective Supervision is report-first and read-only unless the owner explicitly
approves a scoped write. It may compile agent outputs into bounded handoff
packets, track project progress, and identify missing evidence, but it cannot
approve delivery, mutate remote services, or become a second runtime queue.

Never pass raw agent output directly as the next prompt. Normalize it into:

- verified facts
- assumptions
- decisions already made
- risks
- open questions
- target agent and scope
- allowed files/surfaces
- forbidden actions
- required checks
- expected output
- source pointers

Track progress with explicit states: `not_started`, `ready`, `in_progress`,
`needs_review`, `blocked`, `waiting_owner`, `waiting_external`, `done`, or
`cancelled`. Every blocker needs an owner or source needed to unblock it.

## Codex Hook Guardrails

Project-local Codex hooks live in `.codex/hooks.json` and
`.codex/hooks/autopilot-hook.mjs`. They are deterministic lifecycle guardrails,
not agents, approval authorities, or a second runtime queue.

Hook rules:

- keep hooks fast, local, and report-first by default
- store only redacted metadata, hashes, classifications, and source pointers
- never store raw prompts, commands, tool responses, transcripts, project logs,
  credentials, or customer data
- never call cloud models, paid tools, connectors, deployment systems, or remote
  mutation paths from hooks
- do not claim hooks are active until the exact definitions are trusted and a
  refreshed Codex session produces lifecycle evidence
- treat `PreToolUse` as a guardrail, not a complete enforcement boundary
- require explicit owner approval, false-positive tests, and rollback before
  changing a report-only rule into a blocking rule

Hook evidence may inform Decision Mesh, Protective Supervision, architecture,
and work-log review. It cannot replace local tests or approve completion.
