# Autopilot Prompt Library

Status: phase-0 local prompt library

This library stores prompt contracts as versioned Markdown artifacts. It is not
a runtime prompt registry, external prompt-management platform, or source of
truth for provider behavior.

## Source Hierarchy

Use sources in this order:

1. Official provider documentation for model-specific behavior.
2. Local Autopilot policy, mesh nodes, tests, and architecture records.
3. Local eval cases and reviewed production evidence.
4. DAIR.AI and GitHub prompt engineering catalogs as inspiration only.
5. External prompt-management tooling documentation as optional future
   implementation reference.

Do not use leaked system prompts, copied private prompts, unverified social
media prompts, or model output as authority.

## Structure

```txt
prompt-library/
  00-rules/
  01-gpt/
  02-gemini/
  03-claude/
  04-qwen-local/
  05-evaluation/
  06-supervisor/
  07-deepseek/
  08-business/
  09-design/
  10-analysis/
  11-research/
  12-copywriting/
  prompt.schema.json
  source-catalog.md
  source-catalog.json
```

Lanes `01`-`04` and `07-deepseek` are grouped by model. Lanes `08`-`12` are
domain lanes (work spans several models): each pairs an Opus decision-owner with
model-specific opponents per the 2026-06-19 role taxonomy.

- `08-business/` — `docs/autopilot/business-intelligence-operating-model.md`
- `09-design/` — `docs/autopilot/graphic-agent-operating-model.md` and
  `docs/autopilot/design-intelligence-operating-model.md`
- `10-analysis/` — `docs/autopilot/analysis-intelligence-operating-model.md`
- `11-research/` — `docs/autopilot/research-intelligence-operating-model.md`
- `12-copywriting/` — `docs/autopilot/copywriting-operating-model.md`

## Required Metadata

Every prompt file must state:

- `id`
- `model_family`
- `task_type`
- `version`
- `status`
- `last_reviewed`
- `sources`
- `risk_level`
- `expected_output`
- `evals`

Use `prompt.schema.json` as the contract for future automation.
Use `source-catalog.json` as the machine-readable catalog of allowed source
IDs; `source-catalog.md` remains the human-readable source policy.

## Operating Rules

- Keep prompts model-specific when provider behavior differs.
- Start with `00-rules/autopilot-global-routing.md` when work touches roles,
  token efficiency, plugins/MCP, GitHub, libraries, assets, or remote surfaces.
- Keep local worker prompts small, explicit, and bounded.
- Keep reasoning-model prompts higher level and goal oriented.
- For Gemini, send a compact redacted advisory packet. Use
  `02-gemini/input-packet-template.md`; for RadeQ design work use
  `02-gemini/radeq-design-brainstorming.md`.
- For DeepSeek free web-chat advisory, use
  `07-deepseek/manual-web-advisory.md`. Start a fresh chat, select Quick or
  Expert before sending, keep the packet redacted, and treat the answer as
  advisory only.
- For supervised projects, use a prompt stack: shared supervisor base prompt
  first, then a short project-specific task prompt, then the owner's current
  instruction.
- Require sources, uncertainty handling, and validation rules for factual work.
- Treat Gemini/other free-cloud output as advisory until verified.
- Treat Qwen/local worker output as drafts until reviewed and tested.
- Version changes through Git and record meaningful prompt changes in the
  affected work log.
- Normalize GitHub issues/PR comments into bounded task contracts before using
  them as prompt input.

## Supervisor Prompt Stack

Use `06-supervisor/autopilot-supervisor-base.md` as the durable startup layer
for fresh Codex App supervisor threads. It handles runtime bridge checks,
Decision Mesh routing, source authority, handoff normalization, progress states,
and QA gates.

Project prompts, such as
`06-supervisor/radeq-novel-design-supervisor.md`, should stay shorter and only
add project-specific scope, source-of-truth rules, assets, risks, and output
requirements. A project prompt may narrow the base rules, but must not weaken
runtime, mesh, source, privacy, cost, or verification gates.

## First Mesh Application Plan

1. Add this local library and metadata schema.
2. Add a root Decision Mesh `prompt_library_policy` node.
3. Add an Autopilot project mesh `prompt_library_boundary` node.
4. Route prompt work through `reasoning_strategy`, `model_spend_policy`,
   `context_economy_policy`, and `local_worker_boundary`.
5. Add deterministic prompt metadata validation.
6. Add small eval fixtures before any prompt is used as a default.
7. Only after local validation exists, consider optional self-hosted or free
   prompt-management tooling. Paid services remain blocked unless the owner
   creates an explicit exception.
