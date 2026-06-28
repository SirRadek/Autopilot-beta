# Delivery System Model Policy

Date introduced: 2026-05-13
Status: phase-0 model policy
Owner: Autopilot Control Plane

This policy defines how models and agent roles may be used in the Multi-Agent Autonomous Delivery System.

The policy is provider-adaptable. No workflow may depend on one model provider, one CLI, or one local runtime unless a decision ledger entry explicitly accepts that dependency.

## Authority Model

Models can produce analysis, code, tests, summaries, critique, and proposals.

Models cannot:

- approve their own work
- override governance gates
- silently change business scope
- silently change architecture
- decide remote mutation without explicit approval
- replace local verification evidence
- become the source of truth for connector data

## Role-To-Model Policy

| Layer | Preferred Capability | Allowed Model Class | Forbidden Use |
| --- | --- | --- | --- |
| Business | product reasoning, prioritization | strong reasoning model with product context | hidden scope expansion |
| Orchestrator | dependency planning, routing | strong reasoning model | self-approval |
| Architecture | system design, tradeoffs | senior reasoning/coding model | rubber-stamping implementation |
| Analysis | impact and risk discovery | reasoning model or specialist reviewer | implementation without approval |
| Execution | bounded code changes | coding model matched to scope | architecture or business decisions |
| Testing | test design and failure analysis | reasoning or testing specialist | changing business scope |
| Review | critique and risk finding | independent reviewer model | reviewing own output |
| Copywriting | language, tone, localization | language-strong model | product approval |
| Governance | evidence checking | supervisor model plus deterministic checks | approving missing evidence |
| Autopilot Supervisor | monitoring and recovery proposals | supervisor model | product steering or delivery approval |
| Memory | summarization and retrieval | lower-cost summarizer when safe | overwriting source artifacts |

## Reasoning Usage Policy

The default worker layer is local.

Before choosing a model, call the local worker routing policy when the task may be handled by deterministic tools, Qwen2.5-Coder, local summarization, or local verification.

Before choosing any larger context or cloud reasoning path, call the token-efficiency policy when the task can plausibly fit Caveman or compact mode.

Local worker default:

- autocomplete
- boilerplate coding
- bounded implementation
- embeddings
- RAG retrieval
- indexing
- automation loops
- routine summarization
- simple utility tasks

Frontier reasoning is a strategic escalation layer, not the default worker.

Use frontier reasoning only for:

- deep research
- architecture review
- security audit
- code review
- agent validation
- strategic planning
- orchestration design
- edge-case reasoning
- cross-domain tradeoff analysis

Do not use frontier reasoning for:

- autocomplete
- boilerplate coding
- embeddings
- routine summarization
- simple tasks
- local automation loops
- unreviewed worker execution

Stop conditions:

- `non_local_worker_dependency`
- `cloud_model_for_routine_worker_loop`
- `frontier_used_for_simple_worker_task`
- `provider_availability_unverified`
- `paid_model_or_credit_required`
- `private_data_not_redacted`
- `model_output_used_as_source_of_truth`

If a task cannot run locally and is not strategic reasoning or independent review, stop and ask for an owner decision. Do not solve routine local-worker work by silently moving it to a cloud/frontier model.

Free/no-cost cloud reasoning is allowed as advisory review when it adds clear value.

Allowed free-cloud advisory uses:

- brainstorming
- architecture second opinion
- design critique
- security critique
- planning critique
- agent validation
- edge-case review
- research synthesis

Required checks:

- provider availability verified
- free tier or no-cost use confirmed
- redacted context only
- Context7 or official documentation verified for technology, framework, library, SDK, API, browser, cloud, SEO, accessibility, and best-practice claims
- Gemini brainstorm claims labeled as ideas until verified
- factual claims verified against local files, tests, Context7, official docs, or controlled browser evidence
- smallest safe model class chosen
- model/tool choice disclosed when it affects risk, cost, or delivery

Free cloud advisory output is never source of truth and never approval evidence by itself.

Provider execution evidence is separate from model output. A command transcript,
prompt echo, CLI syntax error, trust-flag failure, login failure, or provider
availability failure is a provider runner artifact, not an advisory answer.
When a runner artifact does not contain model output, the workflow must set
`blocked` or `waiting_owner` and stop before content review. Do not silently
drop the unavailable provider from a multi-model advisory request unless the
owner changes scope.

## Reasoning Agent Routing Mesh

Reasoning routing is a lane decision first and a provider decision second.

Task lanes:

| Lane | Primary use | Preferred providers or tools | Hard boundary |
| --- | --- | --- | --- |
| `deterministic_verification` | tests, typecheck, build, schema validation, diff checks | deterministic local tools | never replace review or owner decisions |
| `local_routine_worker` | boilerplate, DTOs, small patches, indexing, routine summaries | deterministic tools, local Qwen | no cloud/frontier worker loop |
| `bounded_coding_worker` | focused bugfixes, bounded refactors, test drafts | local Qwen, deterministic tools | draft only until diff review and tests pass |
| `structured_tool_reasoning` | JSON, structured outputs, tool/function calling, MCP schemas | GPT/OpenAI, DeepSeek, deterministic validation | provider-specific claims require official docs |
| `long_context_synthesis` | broad planning, long documents, research synthesis | Gemini CLI, Claude Code subscription, GPT/OpenAI | redacted advisory only |
| `multimodal_design_review` | screenshots, UX critique, visual/multimodal review | Gemini CLI, Claude Code subscription, GPT/OpenAI | visual claims require evidence |
| `architecture_security_review` | architecture, security, privacy, edge cases | GPT/OpenAI, Claude Code subscription, Gemini CLI, DeepSeek | model output is not source of truth |
| `agent_validation` | supervisor, handoff, orchestration, routing critique | GPT/OpenAI, Claude Code subscription, Gemini CLI, local Qwen | normalize output before reuse |
| `sensitive_private_context` | credentials, secrets, customer data, private repo facts | deterministic tools, local Qwen | cloud use requires explicit owner exception |

Provider policies:

| Provider policy | Access mode | Best fit | Required boundary |
| --- | --- | --- | --- |
| `deterministic_tools` | local deterministic | search, tests, build, schema validation | command scope and workspace boundary known |
| `qwen_local` | local LLM | small code drafts, test drafts, summaries | bounded scope, review, tests |
| `openai_gpt` | API or platform session | structured outputs, tool orchestration, deep reasoning review | cost/entitlement, official docs, redaction |
| `anthropic_claude_subscription` | subscription interactive | high-trust architecture/security/planning critique, broad repo-read review after owner scope, and agent validation | subscription entitlement, no API-credit claim, redaction, no secrets/customer data/raw logs |
| `gemini_cli` | Google AI subscription CLI | standard advisory long-context brainstorming, multimodal critique, edge cases | subscription/license entitlement, no API-key claim, selected redacted context, ideas labeled until verified |
| `deepseek_api_or_self_hosted` | API or self-hosted | JSON/reasoning comparison and cost-aware critique | hosted cost or self-hosting checks, official docs, minimal redacted context |
| `deepseek_web_chat_manual` | manual web login | free web-chat second opinion, Quick mode sanity checks, Expert mode reasoning critique | logged-in browser session, fresh chat per prompt, selected mode, redacted packet, controlled browser evidence |

Gemini and Claude brainstorming output remains advisory. It can propose options,
risks, and critique, but any factual, API, library, model, pricing, or tool-use
claim must be verified through Context7 when connected, official provider docs,
local files, tests, or controlled browser evidence before it enters a plan.

Advisory trust hierarchy:

1. Local repository facts, deterministic checks, tests, architecture records,
   work logs, and owner decisions outrank every model.
2. Claude Code subscription is the preferred high-trust advisory reviewer when
   broad repository reading is useful, the owner scope is explicit, and secrets,
   credentials, customer data, raw project logs, and remote mutation paths are
   excluded.
3. GPT/OpenAI remains a high-trust structured/deep reasoning route when its
   cost or entitlement path is approved and redaction checks pass.
4. Gemini CLI is a standard advisory reviewer for brainstorming, long-context
   synthesis, multimodal critique, and edge cases. It receives selected redacted
   context by default and its claims require verification before adoption.
5. Qwen local workers and DeepSeek comparison routes produce bounded drafts or
   comparison notes. They do not override Claude or Gemini advice without
   verified local evidence, tests, or primary-source documentation.

## Model Spend Policy

Model selection is provider-neutral. DeepSeek, Qwen, Gemini, OpenAI, Claude, or any cheaper GPT-class worker may be useful when available, but no workflow may silently depend on one of them.

Use low-cost or local workers for:

- bulk summarization
- SEO drafts
- data cleanup plans
- document reconstruction drafts
- task packet generation
- first-pass code
- classification

Use long-context research models for:

- long-context research
- brainstorming variants
- market research
- document understanding
- broad planning

Use free/no-cost cloud advisory models for:

- brainstorming variants
- independent critique
- architecture or security second opinion
- design and UX critique
- agent validation
- research synthesis

Use manual web-login advisory providers for:

- DeepSeek web chat manual second opinion
- DeepSeek Quick mode low-latency advice
- DeepSeek Expert mode reasoning advice

Use subscription-interactive providers for:

- Gemini CLI advisory through Google AI subscription or license entitlement
- Claude Code architecture second opinion
- Claude Code security critique
- Claude Code planning critique
- Claude Code agent validation
- bounded interactive repository session after owner scope

Use API or self-hosted providers for:

- OpenAI structured outputs
- OpenAI tool orchestration
- DeepSeek JSON or reasoning comparison
- DeepSeek self-hosted candidate evaluation
- hosted provider review after cost decision

Use repo execution agents for:

- repository editing
- tests
- bounded refactors
- debugging
- patch workflow

Use frontier reasoning only when:

- risk is high
- requirements are ambiguous
- architecture-level decisions are involved
- security sensitivity is high
- previous attempts failed repeatedly
- final independent review is needed

Stop if provider availability is unverified, if free/no-cost use is unconfirmed for a free route, if a routine local-worker task depends on a non-local model, if paid credits are required, or if model choice affects risk without disclosure.

For DeepSeek web chat, stop if browser login is missing, the browser session is
unavailable, the Quick/Expert mode switch cannot be verified, the packet is not
redacted and bounded, or the output would be treated as source of truth.

For subscription tools, stop if subscription entitlement is unverified or if the
task silently switches into an API-credit path. For API/self-hosted providers,
stop unless API cost, account boundary, or self-hosted infrastructure has been
explicitly checked.

For Gemini CLI in this project, the default entitlement path is Google AI
subscription or Code Assist license, not Gemini API budget. Stop on
`gemini_api_key_or_paid_api_path_requested_without_owner_decision` if a task
tries to switch Gemini work to an API key, Vertex/AI Studio paid route, or API
rate-limit assumption without owner approval.

Technology and best-practice recommendations from any advisory model must pass the docs-verification lane before adoption:

1. Query Context7 when it is connected and covers the library, framework, SDK, browser API, cloud API, SEO rule, or accessibility topic.
2. If Context7 is unavailable or does not cover the topic, record the fallback and use official documentation, release notes, local code, tests, or controlled browser evidence.
3. Treat unverified Gemini, subscription, or free-cloud brainstorm output as a hypothesis, not a plan or source of truth.
4. Stop on `technology_claim_without_context7_or_official_docs` or `gemini_claim_adopted_without_verification`.

## Model Output Evaluation

Autopilot is currently in a learning phase for multi-model supervision. Model
and local-worker outputs must be scored before acceptance when they affect
prompts, handoffs, model routing, governance, architecture, security, or delivery
decisions.

Use `src/data/delivery-system/modelOutputEvaluation.ts` and
`docs/autopilot/model-output-evaluation-operating-model.md` for the route and
operating contract. Real eval records use
`model-output-evals/model-output-eval-record.schema.json` and must pass
`npm run model-output:validate`, which is part of `npm run verify`.

Learning-loop rule:

1. Score output by task fit, instruction following, source grounding, format
   contract, verification readiness, privacy/safety, handoff clarity, token
   efficiency, and workflow compatibility.
2. Before scoring, verify the provider run status, runner artifact type, and
   model-output presence.
3. If the provider run failed, output is missing, or the artifact is prompt/log
   only, set `blocked` or `waiting_owner` and do not review content.
4. If the score is weak, select Caveman or compact routing before adding more
   context or model spend.
5. Verify provider-specific prompt or reasoning claims through Context7 when
   connected, otherwise official provider docs.
6. Record the exact prompt or input-packet delta.
7. Rerun until the output is acceptable or blocked.

Repeated-failure rule:

- after `3` similar weak outputs, rerun token-efficiency and reasoning-model
  routing before changing reasoning effort, model, or provider
- changing model/provider still requires entitlement, cost, redaction, and
  source checks
- the new output must be scored and verified again

Weekly tuning rule:

- once enough eval records exist, routine prompt/input updates move to weekly
  batch review
- weekly changes must be based on collected eval records and repeated failure
  patterns, not anecdotes or raw model preference
- eval records must pass deterministic schema, source-catalog, privacy, delta,
  route-review, and aggregate validation
- prompt changes need versioning, evals, source authority, and rollback

## Prompt Library Policy

Reusable prompts live in `prompt-library/` as local Git/Markdown contracts.
They are not copied from leaked system-prompt repositories and they are not
adopted from public prompt packs without review.

Prompt source authority follows this order:

1. Official provider documentation for model-specific behavior.
2. Local Autopilot policy, mesh nodes, tests, and architecture records.
3. Local eval cases and verified outputs.
4. DAIR.AI and GitHub prompt catalogs as inspiration only.
5. Prompt-management tooling documentation as optional future implementation
   reference.

Every reusable prompt must declare model family, task type, version, status,
sources, risk level, expected output, and evals. Provider-specific prompts may
not be reused across GPT, Claude, Gemini, and Qwen without review and eval
evidence.

Prompt changes stop when:

- a leaked system prompt is used
- source authority is missing
- evals are missing
- a model-specific prompt is copied across providers without review
- private data or secrets are embedded in the prompt
- model output is treated as source of truth
- paid prompt-management tooling is required without owner exception

Initial prompt-management remains local and free. Langfuse, Braintrust,
PromptHub, or similar tools may be researched later for versioning, labels,
diffs, rollback, and eval workflows, but runtime adoption requires a separate
architecture decision and cost/privacy review.

## Qwen2.5-Coder Policy

Qwen2.5-Coder 7B and Qwen2.5-Coder 14B are optional bounded worker candidates.

Current local baseline on 2026-05-30:

- `qwen2.5-coder:7b` is installed in Ollama and may be used as the fast local coding worker.
- `qwen2.5-coder:7b-autopilot` is installed in Ollama and may be used for local summaries and handoff drafts.
- `qwen2.5-coder:14b` is the maximum local coding worker target for this computer, but it is not installed yet and must pass install and hardware checks before use.
- The observed machine profile is 32 GB RAM and RTX 4070 Laptop GPU with 8 GB VRAM.

They may be considered for:

- micro tasks
- small CRUD changes
- DTOs and model files
- isolated utility functions
- small refactors
- isolated bug fixes
- adding focused tests

They must not be used for:

- architecture decisions
- business decisions
- governance approval
- security approval
- broad refactors
- multi-repository changes
- ambiguous scope
- incidents without supervisor review

Use of Qwen2.5-Coder requires:

- local or approved runtime availability verification
- bounded file scope
- independent review
- test evidence
- ledger entry if the model choice affects risk, cost, or delivery time

Use of Qwen2.5-Coder 14B additionally requires:

- `model_install_confirmed`
- `hardware_budget_verified`
- bounded multi-file scope
- fallback to Qwen 7B or deterministic tools when 14B is unnecessary
- escalation to advisory/free-cloud or human review for architecture, security, or business decisions

## Gemini Policy

Gemini CLI may be used as advisory critique and brainstorming only through the
owner's Google AI subscription or Code Assist license entitlement unless an
owner explicitly routes work to a Gemini API path.

Allowed:

- brainstorming
- architecture second opinion
- UX critique
- security critique
- proposal refinement
- agent validation
- edge-case review

Forbidden:

- file edits without local supervisor scope
- governance approval
- delivery approval
- receiving unredacted private data
- overriding local repository facts
- consuming Gemini API credits, API keys, Vertex/AI Studio paid paths, or
  requiring an account upgrade without owner decision

Required checks:

- provider availability verified
- Google AI subscription or Code Assist license entitlement confirmed
- authentication state verified without printing or storing tokens
- redacted context only
- official Google docs verified for Gemini-specific behavior and quota limits
- local verification required after any output

Gemini output must be treated as external advice and checked against local files, official docs, or connector snapshots.

For technology or best-practice brainstorming, Gemini must be paired with the docs-verification lane. Context7 is preferred when connected; official documentation is the fallback. Gemini may suggest options, tradeoffs, and critique, but those claims cannot enter an implementation plan until verified.

Gemini has lower advisory weight than scoped Claude Code subscription review and
higher advisory weight than Qwen or DeepSeek drafts. It should receive selected
redacted packets rather than broad private repository context by default.

## DeepSeek Web Chat Policy

DeepSeek has two separate Autopilot paths:

1. `deepseek_web_chat_manual`: manual free web-chat advisory through
   `https://chat.deepseek.com/`.
2. `deepseek_api_or_self_hosted`: API or self-hosted provider use.

The manual web-chat path is allowed only as an external opinion. It is not a
CLI, API runtime, connector, stable headless browser contract, default worker,
approval authority, or source of truth. Official DeepSeek docs describe free web
access from the public product page, while API and terminal-agent integrations
require an API key and token/cost checks.

Manual web-chat workflow:

1. Use the Browser plugin and open `https://chat.deepseek.com/`.
2. Verify a logged-in chat session without reading, printing, or storing
   credentials, tokens, cookies, or account identifiers.
3. Start a fresh chat for every advisory request.
4. Select `Rychlý` / Quick or `Expert` before sending the prompt.
5. For mode tests, run two fresh chats: one Quick, one Expert, and verify the
   post-send chat header.
6. Treat `Hluboké přemýšlení` / deep thinking as a separate UI control; Expert
   may enable it, but Quick can also show thinking if the control is left on.
7. Paste only the bounded redacted packet from
   `prompt-library/07-deepseek/manual-web-advisory.md`.
8. Normalize the answer into advisory ideas, risks, assumptions, and
   verification needs before any local plan uses it.

Prompt input shape:

```md
# DeepSeek Advisory Packet

Role: external advisory reviewer.
Authority: advisory only. Do not approve implementation and do not treat your
answer as source of truth.

Mode requested: Quick | Expert.
Task:
-

Verified facts:
-

Assumptions:
-

Constraints:
- no secrets, credentials, customer data, raw logs, private identifiers, or full
  repository dumps
- keep the answer concise
- mark factual, API, library, pricing, security, or implementation claims as
  verification_needed unless already proven in the packet

Output format:
1. Short answer
2. Risks or objections
3. Better alternative if any
4. What must be verified locally or in official docs
5. Advisory verdict: use | do_not_use | needs_more_evidence
```

If the owner asks for a DeepSeek opinion without a concrete prompt, build the
smallest safe fallback packet from local evidence: one task, at least one
verified fact with a source pointer, one assumption, one concrete question, and
the output format above. If that cannot be filled safely, ask the owner for a
bounded prompt instead of sending a broad request.

## Claude Code Policy

Claude Code is registered as an optional subscription-interactive advisory
provider, not an API-credit worker, default worker, gateway, approval authority,
or source of truth.

Allowed after the required checks pass:

- architecture second opinion
- security critique
- planning critique
- agent validation
- edge-case review
- bounded broad repository read after the owner declares scope

Forbidden:

- default routine worker use
- local automation loops
- final approval or governance approval
- unredacted private context
- secrets, credentials, customer data, raw project logs, or private account
  identifiers
- unbounded autonomous execution
- remote mutation without explicit approval

Required checks:

- provider availability verified
- authentication state verified without printing or storing tokens
- subscription entitlement confirmed
- no API budget or credit claim for subscription use
- redacted context only
- broad-read scope declared by the owner
- official Anthropic docs verified for Claude-specific behavior
- bounded scope declared
- local verification required after any output
- model choice disclosed when it affects risk, cost, or delivery

Stop conditions:

- `provider_availability_unverified`
- `authentication_missing`
- `subscription_entitlement_unverified`
- `api_credit_path_requested_without_owner_decision`
- `private_data_not_redacted`
- `model_output_used_as_source_of_truth`
- `cloud_model_for_routine_worker_loop`
- `remote_mutation_without_approval`

Local setup evidence on 2026-06-11: Claude Code was installed through the
official WinGet package `Anthropic.ClaudeCode`, `claude --version` reported
`2.1.172`, and the Windows Authenticode signature verified as `Anthropic, PBC`.
The first non-interactive `claude doctor` attempt timed out on interactive auth.
After a visible PowerShell login window completed, the local Claude credentials
file was present; token contents were not read, printed, or stored in the
repository. No Claude model call was made during registration. The project
`CLAUDE.md` file is the local memory contract Claude Code should load for this
repository.

Owner clarification on 2026-06-11: Claude access is through a subscription, not
an Anthropic API budget. Do not use `--max-budget-usd` or API-credit language as
the default Claude Code boundary for this project.

Owner preference on 2026-06-11: Claude Code has higher advisory trust and a
broader allowed read scope than Gemini when owner-scoped. Gemini remains useful
below Claude for brainstorming and critique. Qwen and DeepSeek are lower-weight
draft or comparison lanes and must not override Claude/Gemini advice without
verified local evidence, tests, Context7, or official documentation.

## Plugin And Skill Inventory

Autopilot distinguishes:

- session-callable plugins exposed in the current Codex session
- local skills listed in the current session
- cached plugin bundles found on disk but not exposed as callable tools
- model provider policy records such as DeepSeek that exist in mesh/model
  routing but are not active credentials or runtime connectors by themselves

Current inventory is captured in `src/data/delivery-system/toolInventory.ts` and
exposed by the read-only MCP tool `select_tool_inventory_route`.

Rules:

- Use current session callable plugins before cached-only bundles.
- Use `tool_search` for deferred MCP tools when the task names a plugin capability.
- Do not claim a cached plugin is callable until it is surfaced by active tools or `tool_search`.
- Do not claim a provider-policy record is connected until credentialed runtime
  access is separately verified without exposing secrets.
- Read the relevant `SKILL.md` before applying a skill workflow.
- Treat connector/provider output as advisory until verified by local files, official docs, tests, or connector evidence.

DeepSeek is registered as `provider_policy_only` inventory. That means the
mesh can route DeepSeek JSON, reasoning-model, function-calling, and
cost-aware comparison requests to the right checks, but actual DeepSeek use
remains blocked until provider availability, cost or self-hosting, redacted
context, and official-provider-doc checks pass.

DeepSeek web chat is separately registered as a manual web-login advisory path.
It was verified on 2026-06-11 in the in-app Browser with fresh Quick and Expert
chats. It remains provider-policy inventory, not a callable runtime connector.
Quick/Expert selection must happen before sending the prompt in a fresh chat;
hidden/headless browser automation is not treated as a stable command-line
interface.

Cached-only examples observed on 2026-06-11 include ClickUp, Shopify, Remotion,
and OpenAI Developers bundles. They are installation or availability leads, not
active capabilities.

## Connector And Tool Facts

Model output about current SDKs, cloud APIs, provider pricing, model availability, GitHub state, Linear state, Vercel state, Cloudflare state, or Docket content is unstable.

Before using such claims:

- verify through local files, connector data, Context7, or official docs
- record the source in the handoff
- avoid committing secrets or private account identifiers

## Selection Rules

Choose the smallest safe model class that can complete the bounded task with review.

Escalate to a stronger reasoning model when:

- architecture changes
- security or privacy is involved
- task crosses repositories
- requirements are ambiguous
- tests fail repeatedly
- incident root cause is unclear
- business scope might change

Use deterministic checks when possible:

- tests
- type checks
- linters
- `rg` searches
- schema validation
- file and repository boundary checks

The local read-only MCP server exposes `select_local_worker_route` for worker selection. It returns the recommended local worker lane, required checks, stop conditions, and handoff expectations. It does not run Ollama, install models, edit files, or approve work.

## Handoff Requirements

Every model or worker handoff must state:

- model or tool used, if known
- role
- mode
- allowed scope
- forbidden actions
- input facts
- assumptions
- output files or artifacts
- verification evidence
- risks
- whether ledger updates are required

Missing model/tool disclosure blocks governance approval when model choice affects risk.

## Approval Rules

Approval requires independent evidence:

- implementer output
- tester evidence
- reviewer assessment
- governance gate result
- work-log update

The same model session, role, or worker cannot be both implementer and final approver.
