# Prompt Source Catalog

Status: reviewed source index
Last reviewed: 2026-06-11

This catalog records acceptable reference sources for prompt-library work. It
does not approve copying prompts verbatim.

## Official Provider Sources

OpenAI:

- Evals:
  https://developers.openai.com/api/docs/guides/evals
- Model optimization:
  https://developers.openai.com/api/docs/guides/model-optimization
- Prompt engineering guide:
  https://platform.openai.com/docs/guides/prompt-engineering
- Reasoning best practices:
  https://platform.openai.com/docs/guides/reasoning-best-practices
- Structured Outputs:
  https://platform.openai.com/docs/guides/structured-outputs

Use for GPT, Codex, structured outputs, tool workflows, model-output evals,
prompt iteration, and reasoning model prompt differences.

Anthropic / Claude:

- Prompt engineering overview:
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview
- Prompting best practices:
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Define success criteria and build evaluations:
  https://platform.claude.com/docs/en/test-and-evaluate/develop-tests
- Guardrails / hallucination reduction:
  https://platform.claude.com/docs/en/build-with-claude/strengthen-guardrails/reduce-hallucinations
- Claude Code setup:
  https://code.claude.com/docs/en/setup
- Claude Code authentication:
  https://code.claude.com/docs/en/iam
- Claude Code memory:
  https://code.claude.com/docs/en/memory
- Context windows:
  https://docs.anthropic.com/en/docs/build-with-claude/context-windows
- Tool use:
  https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use

Use for Claude-specific structure, success criteria, eval rubrics, XML-style
organization, examples, tool behavior, agentic work, quote-first document
analysis, Claude Code install, authentication, project memory behavior,
context-window constraints, and tool use boundaries.

Google / Gemini:

- Gemini Code Assist quotas:
  https://developers.google.com/gemini-code-assist/resources/quotas
- Google Gemini subscriptions:
  https://gemini.google/subscriptions/
- Vertex AI prompt design strategies:
  https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/prompts/prompt-design-strategies
- Multimodal prompt design:
  https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/design-multimodal-prompts
- Prompt optimizer:
  https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/prompts/prompt-optimizer
- Gemini API models:
  https://ai.google.dev/gemini-api/docs/models
- Gemini API long context:
  https://ai.google.dev/gemini-api/docs/long-context
- Gemini API prompt design strategies:
  https://ai.google.dev/gemini-api/docs/prompting-strategies

Use for Gemini brainstorming, multimodal analysis, clear/direct prompt design,
test-driven prompt iteration, prompt optimization concepts, and Gemini CLI/Code
Assist quota boundaries.
Gemini CLI use in this Autopilot setup is treated as owner subscription or
license entitlement, not Gemini API budget, unless an owner explicitly routes a
task to an API path.

DeepSeek:

- Web chat and app/API entry:
  https://www.deepseek.com/en/
- First API call:
  https://api-docs.deepseek.com/
- Models and pricing:
  https://api-docs.deepseek.com/quick_start/pricing
- Deep Code terminal integration:
  https://api-docs.deepseek.com/quick_start/agent_integrations/deepcode
- Reasoning model:
  https://api-docs.deepseek.com/guides/reasoning_model
- Thinking mode:
  https://api-docs.deepseek.com/guides/thinking_mode
- JSON output:
  https://api-docs.deepseek.com/guides/json_mode
- Function calling:
  https://api-docs.deepseek.com/guides/function_calling

Use for DeepSeek-specific web-chat advisory boundaries, API-vs-web separation,
reasoning, thinking effort, JSON output, and function-calling constraints. Free
web chat use remains a manual browser-login advisory path. Hosted API and
terminal-agent use require API-key, cost/auth, and official-doc checks;
self-hosted use requires infrastructure and model-availability checks.

Qwen:

- Qwen chat with Transformers:
  https://qwen.readthedocs.io/en/v2.0/inference/chat.html
- Qwen function calling:
  https://qwen.readthedocs.io/en/stable/framework/function_call.html
- Qwen2.5-7B-Instruct model card:
  https://huggingface.co/Qwen/Qwen2.5-7B-Instruct
- Qwen2.5-Coder-14B-Instruct model card:
  https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct

Use for local Qwen chat templates, role formatting, apply-chat-template usage,
tool calling constraints, and license/activity checks.

## Local Autopilot Sources

AGENTS.md:

- `AGENTS.md`

Use for durable repository rules, Decision Mesh order, project mesh separation,
token economy, model routing, and prompt-library adoption rules.

Autopilot V3 Prompt Pack:

- `docs/autopilot/v3-prompt-pack.md`

Use for historical supervised bot roles, scope discipline, write-mode unlocks,
handoff contracts, and remote-mutation restrictions.

Token Efficiency Operating Model:

- `docs/autopilot/token-efficiency-operating-model.md`

Use for Caveman Mode, compact profiles, local/no-cost worker order, and context
stop conditions.

GitHub Control Surface:

- `docs/autopilot/github-control-surface.md`

Use for GitHub issue/PR/project-board normalization. GitHub inputs are control
surface signals, not executable prompts.

Graphic Agent Operating Model:

- `docs/autopilot/graphic-agent-operating-model.md`

Use for plugin, asset, library, motion, canvas, WebGL, free-cloud, paid-tool,
license, usage-rights, and fallback rules for visual production prompts.

Domain Operating Models (08-12 lanes):

- `docs/autopilot/business-intelligence-operating-model.md`
- `docs/autopilot/design-intelligence-operating-model.md`
- `docs/autopilot/analysis-intelligence-operating-model.md`
- `docs/autopilot/research-intelligence-operating-model.md`
- `docs/autopilot/copywriting-operating-model.md`

Use for the role taxonomy (Opus decision-owner plus model-specific opponents),
the capability-plus-data-privacy axis, rubrics, and stop conditions for the
`08-business`, `09-design`, `10-analysis`, `11-research`, and `12-copywriting`
prompt lanes.

Product & Design OS:

- `product-design-os/`

Use for product/design classification, scope gates, opposition, recipes,
patterns, asset scoring, taste memory, and QA before implementation.

Protective Supervision:

- `docs/autopilot/protective-supervision-operating-model.md`
- `docs/autopilot/agent-handoff-packet-template.md`
- `docs/autopilot/project-progress-ledger-template.md`

Use for currentness checks, agent-output normalization, handoff packet shape,
progress states, blockers, waiting dependencies, and report-first supervision.

RadeQ Project Architecture:

- `docs/projects/radeq/architecture.md`
- `docs/projects/radeq/work-log.md`
- `docs/projects/radeq/decision-mesh/`

Use for RadeQ-specific source-of-truth, route, SEO, lead-capture, deployment,
performance, and mascot boundaries.

Cat Mascot Provenance:

- `docs/autopilot/cat-mascot-asset-provenance.md`

Use for the current cat asset source, license, animation clips, limitations,
fallbacks, and private-reference boundaries.

## General Prompt Engineering Sources

DAIR.AI Prompt Engineering Guide:

- https://www.promptingguide.ai/

Use as a general learning reference and inspiration source for techniques,
RAG, agents, reasoning, factuality, and prompt hub examples. Do not treat it as
model-specific authority.

Awesome Prompt Engineering:

- https://github.com/promptslab/awesome-prompt-engineering

Use as a catalog for tools and eval ideas only. Check each candidate tool's
license, activity, pricing, and official documentation before adoption.

## Prompt Management References

Langfuse:

- Prompt management overview:
  https://langfuse.com/docs/prompt-management/overview
- Prompt version control:
  https://langfuse.com/docs/prompt-management/features/prompt-version-control

Braintrust:

- Prompt management article:
  https://www.braintrust.dev/articles/what-is-prompt-management
- Prompt docs:
  https://www.braintrust.dev/docs/evaluate/write-prompts

PromptHub:

- Prompt versioning:
  https://www.prompthub.us/features/prompt-versioning

Use these as future implementation references for versioning, labels, diffs,
rollback, and eval workflows. Do not add a paid or cloud dependency without an
owner decision.

## Rejected Sources

- Leaked system prompt repositories.
- Undated prompt packs with no eval evidence.
- Provider-specific prompts copied across models without testing.
- Social-media prompt recipes treated as source of truth.
- Model-generated prompt advice that is not verified against official docs,
  local files, tests, or controlled evidence.
