# Prompt Library Operating Model

Date introduced: 2026-06-03
Status: phase-0 local prompt library and mesh application plan
Owner: Autopilot Control Plane

Autopilot now has a local versioned prompt library at `prompt-library/`.

The library is not a prompt-management SaaS, a runtime registry, or a duplicate
source of truth. It is a Git-reviewed set of prompt contracts that can later be
validated and routed through the Decision Mesh.

## Purpose

Use the prompt library to:

- keep reusable prompts out of ad hoc chat history
- separate GPT, Claude, Gemini, DeepSeek, and Qwen guidance where behavior differs
- record official sources and local validation evidence
- require evals before prompt adoption
- use scored model-output records before prompt/input tuning
- support rollback through Git
- save tokens by reusing compact prompt contracts

## Source Authority

Use this order:

1. Official provider docs for provider-specific behavior.
2. Local Autopilot policy, mesh nodes, tests, and architecture records.
3. Local eval cases and verified outputs.
4. DAIR.AI and GitHub prompt catalogs as inspiration.
5. Prompt-management tool docs as optional future implementation references.

Rejected sources:

- leaked system prompt repositories
- private prompts without permission
- undated prompt packs without eval evidence
- social-media prompt recipes treated as authority
- model output used as source of truth

## Provider Notes

OpenAI / GPT / Codex:

- Use official OpenAI prompt engineering and reasoning guidance.
- GPT-style models benefit from explicit instructions and output contracts.
- Reasoning models should generally receive clear goals, constraints, and
  acceptance criteria rather than exposed chain-of-thought prompts.
- Structured outputs should use schemas or validators when reliability matters.

Claude:

- Use Anthropic prompt engineering guidance for Claude-specific behavior.
- XML-style sections can help with complex prompts when tag scope is clear.
- For document-grounded answers, require evidence extraction and allow the model
  to say that the answer is not in the source.
- Agentic Claude prompts need explicit safety boundaries for risky actions.

Gemini:

- Use Google prompt design strategies for Gemini brainstorming, multimodal
  analysis, and iterative prompt development.
- Gemini output is advisory until verified against local files, tests,
  Context7 when connected, official docs, or controlled evidence.
- Cloud use still requires redaction and free/no-cost confirmation.

DeepSeek:

- Use `prompt-library/07-deepseek/manual-web-advisory.md` for the verified
  free web-chat path.
- Start a fresh web chat, select Quick or Expert before sending, and include the
  whole bounded prompt packet in that chat.
- DeepSeek web-chat output is advisory until verified against local files,
  tests, Context7 when connected, official docs, or controlled browser evidence.
- Official API and terminal-agent workflows are separate from web login and
  require API-key, pricing, and auth checks.

Qwen local:

- Use official Qwen chat/template guidance and local worker policy.
- Keep prompts small, explicit, file-scoped, and test-backed.
- Qwen output is a draft, not approval.
- Qwen2.5-Coder 14B requires install, hardware, bounded scope, review, and
  tests before use.

## Model Output Feedback Loop

Prompt and input-packet tuning uses
`docs/autopilot/model-output-evaluation-operating-model.md`.

During the learning phase:

- score the output before accepting it
- record failure labels and source pointers
- select Caveman or compact routing before adding context or model spend
- check Context7 or official provider docs for provider-specific behavior
- record the exact prompt/input delta
- rerun until acceptable or blocked

After repeated similar weak outputs, rerun token-efficiency and reasoning-model
routing before changing reasoning effort, model, or provider.

After enough eval records exist, routine prompt updates move to weekly batch
tuning based on collected records and repeated failure patterns. Weekly prompt
changes must not come from anecdotes or raw model preference.

## Prompt Metadata

Every prompt must include:

- `id`
- `title`
- `model_family`
- `task_type`
- `version`
- `status`
- `last_reviewed`
- `sources`
- `risk_level`
- `expected_output`
- `evals`

The draft schema is `prompt-library/prompt.schema.json`.

## Alignment With V3 Prompt Pack

`docs/autopilot/v3-prompt-pack.md` remains the historical operating manual for
supervised bot assignments. Do not bulk-replace it with the new prompt library.
Move reusable pieces over incrementally when they have metadata, evals, source
authority, expected output, and rollback.

The first comparison is recorded in
`prompt-library/05-evaluation/v3-comparison-report.md`.

Rules carried forward from V3 into prompt-library:

- role and scope must be explicit
- token-efficiency routing is required before broad context use
- plugins, connectors, and MCP tools need availability/cost/privacy checks
- GitHub issues and PR comments must be normalized into bounded task contracts
- libraries, assets, and GitHub project candidates need source, license,
  usage-rights, and adoption checks
- worker output is never approval evidence by itself

## Shared Autopilot Prompt Rule

Use `prompt-library/00-rules/autopilot-global-routing.md` whenever a prompt
touches:

- agent roles or handoffs
- token efficiency
- plugins, connectors, MCP tools, or apps
- GitHub issues, PRs, or Projects
- libraries, third-party repositories, UI kits, assets, icons, fonts, generated
  media, or model assets
- remote mutation or cloud/free-tool decisions

## Supervisor Prompt Stack

Supervisor startup prompts use a layered contract:

1. Shared base prompt:
   `prompt-library/06-supervisor/autopilot-supervisor-base.md`
2. Project-specific prompt:
   for example `prompt-library/06-supervisor/radeq-novel-design-supervisor.md`
3. Owner's current task instruction.

The base prompt owns runtime bridge checks, Decision Mesh order, source
authority, handoff normalization, progress states, stop conditions, and
verification gates. Project prompts add local repository, GitHub baseline,
asset, workflow, and product constraints.

A project prompt may narrow scope, but it cannot weaken runtime, mesh, source,
privacy, cost, or QA gates from the base prompt.

## Decision Mesh Application Plan

Phase 0 - Foundation:

- Create `prompt-library/`.
- Add source catalog, metadata schema, base rules, model-family prompts, and eval
  placeholders.
- Add typed prompt policy in `src/data/delivery-system/promptLibrary.ts`.

Phase 1 - Mesh boundary:

- Add root mesh node `prompt_library_policy`.
- Add Autopilot project mesh node `prompt_library_boundary`.
- Connect prompt policy to `reasoning_strategy`, `model_spend_policy`,
  `context_economy_policy`, `local_worker_boundary`, and `bot_rag_mesh`.
- Keep prompt work read-only in MCP until a separate architecture decision
  approves any runtime selector.

Phase 2 - Deterministic validation:

- Add a prompt metadata validator.
- Reject missing metadata, missing evals, leaked-prompt sources, and
  provider-specific prompts used across models without review.
- Add prompt eval fixtures for normal, ambiguous, missing-source,
  conflicting-instruction, and high-risk requests.
- Add model-output eval records for weak, retried, accepted, and blocked outputs.

Phase 3 - Agent packet integration:

- Let compact agent packets reference approved prompt IDs.
- Keep prompt text in the local library and include only the minimal relevant
  excerpt or ID in task packets.
- Record prompt version changes in work logs when they affect delivery.

Phase 4 - Optional prompt-management tooling:

- Evaluate self-hosted/free options first.
- Paid tools, unknown pricing, cloud-only dependence, or unredacted private
  prompt data are stop conditions.
- Tooling may help with diff, labels, rollback, and evals, but Git/Markdown
  remains the initial source of truth until an explicit decision changes it.

## Definition Of Done For Prompt Adoption

A prompt can become a default only when:

- metadata is complete
- source authority is recorded
- model family is explicit
- uncertainty behavior is defined
- output validation is defined
- evals exist
- redaction rules are satisfied
- provider-specific claims are verified
- rollback path is available
- mesh/work-log impact is recorded
