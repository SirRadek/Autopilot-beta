# Design Intelligence Operating Model

Date introduced: 2026-05-30
Status: active control-plane policy
Owner: Autopilot Control Plane

This document defines Autopilot's design-analysis and design-critique layer. It complements the Graphic Production Agent: production creates assets and specs; design intelligence decides whether the visual direction, tooling, and result are good enough.

## Roles

### Visual Analyst

Runs before production.

Responsibilities:

- understand the visual goal, target audience, brand constraints, and product context
- decide whether the work needs static graphics, motion, Canvas, WebGL, model assets, video, or no new visual layer
- define visual acceptance criteria before the Graphic Production Agent starts
- identify performance, accessibility, SEO, licensing, and tool-risk constraints
- classify the design/SEO tradeoff profile as `seo_led`, `balanced`,
  `brand_led`, or `experimental_showcase`

Output:

```yaml
analysis_packet:
  purpose: string
  audience: string
  visual_strategy: string
  reference_style: string
  tool_recommendation: string
  risks: string[]
  required_fallbacks: string[]
  acceptance_criteria: string[]
  page_profile: string
```

### Design Critic

Runs after production or implementation.

Responsibilities:

- critique visual hierarchy, clarity, brand fit, accessibility, performance, maintainability, and motion value
- compare the output against the brief and project constraints
- identify rework with evidence instead of taste-only feedback
- hand off findings to UX Reviewer, QA, Frontend/Web Agent, or Governance

Output:

```yaml
critique_packet:
  verdict: pass | pass_with_notes | rework | reject
  score:
    hierarchy: number
    clarity: number
    brand_fit: number
    motion_value: number
    accessibility: number
    performance: number
    maintainability: number
  findings: string[]
  required_rework: string[]
  evidence: string[]
  handoff_target: string
```

The Design Critic cannot approve delivery and cannot review its own production work.

### Source Librarian

Runs before asset adoption or reference-driven implementation.

Responsibilities:

- classify sources as `approved_source`, `candidate_source`,
  `inspiration_only`, or `blocked`
- verify cost, license, commercial-use status, attribution needs, and source
  evidence
- separate usable assets from inspiration-only references
- require clean-room briefs before a reference becomes implementation work
- update `product-design-os/library/` and project work logs with source pointers

Output:

```yaml
source_packet:
  source_id: string
  status: approved_source | candidate_source | inspiration_only | blocked
  commercial_use: allowed | allowed_with_attribution | inspiration_only | unknown | blocked
  license: string
  evidence: string[]
  adoption_requirements: string[]
  blocked_reuse: string[]
```

### Design Director (agy/Gemini, advisory)

The agy/Gemini vendor lane executes the Visual Analyst direction work and the
Design Critic render critique for design-bearing decisions, under the
advisory boundary in `GEMINI.md` ("Design Director (advisory role)"). It is
called only for heuristic, aesthetic, or visually critical questions — never
for deterministic checks or routine compilation. Its only output channels are
proposed design-contract diffs
(`product-design-os/briefs/design-contract-template.md`) and visual critique
packets (`prompt-library/02-gemini/visual-critique.md`). It cannot approve
delivery, and its trend/typography claims must come from the dated hypothesis
records and the license-gated library catalogs.

## Rubric

| Criterion | Question | Blocker examples |
| --- | --- | --- |
| Hierarchy | Is the primary information visually dominant within the first scan? | unclear primary action, competing focal points |
| Clarity | Can the intended user understand the visual in three seconds? | ambiguous purpose, decorative noise |
| Brand fit | Does the visual language match the project? | generic AI style, off-brand palette |
| Motion value | Does motion explain something better than static design? | motion-only decoration, missing static equivalent |
| Accessibility | Are contrast, readability, keyboard flow, and reduced motion preserved? | text in canvas only, missing reduced motion |
| Performance | Does the visual stay inside the budget? | mobile jank, oversized assets |
| SEO tradeoff | Is SEO optimized to the right level for the project goal? | perfect SEO forced onto brand work, or brand motion hiding public content |
| Maintainability | Can it be edited, tested, versioned, and handed off? | proprietary lock-in, missing asset manifest |

## Research Provider Policy

Preferred order:

1. Context7 for current framework and library docs when available.
2. Official documentation and release notes.
3. GitHub repository search for free/open project discovery, activity, license, and security review.
4. Hugging Face docs for models, datasets, Spaces, and ML tooling.
5. Local Autopilot architecture library for previously reviewed candidates and internal decisions.

Context7 is not available in the current Codex session. Until it is connected, the required fallback is official docs plus GitHub/Hugging Face where relevant.

Context7 also belongs in the reasoning and Gemini brainstorming path. When a Visual Analyst, Design Critic, Gemini Critic, or architecture-library review makes a current technology or best-practice claim, the claim must be checked through Context7 first when connected. If Context7 is unavailable, the handoff must record the fallback source and use official documentation or another primary source.

Gemini brainstorming output is allowed to expand options, critique direction, and identify risks, but it must separate ideas from verified facts. A Gemini-suggested library, framework pattern, motion technique, SEO rule, accessibility rule, or cloud capability is blocked from adoption until Context7 or official documentation verifies it.

Cloud research sources and cloud-hosted free tools are allowed when the no-cost path is confirmed. Paid services, unknown pricing, paid credits, or cost-bearing gateways remain blocked unless the owner later creates an explicit exception.

For visual inspiration specifically: analyze the project's established
competitors first — they encode the visual language the market already
trusts — then curated galleries registered as `inspiration_only` in
`product-design-os/library/source-catalog.json`. Award-show galleries
(Awwwards-class) carry an award-bait caveat: over-animated, weak on
accessibility/conversion — use them as reference only for `brand_led` /
`experimental_showcase` page profiles, never as templates for `seo_led`
work. All gallery use goes through the clean-room reference workflow.

## Architecture Library

Autopilot keeps a local, read-only candidate library for LLM/ML architecture decisions. A library entry is not an adoption approval.

Initial candidates checked on 2026-05-30:

| Candidate | Category | Repository | Status | Primary use |
| --- | --- | --- | --- | --- |
| LangGraph | agent orchestration | `langchain-ai/langgraph` | candidate | stateful agents, durable graph workflows |
| Mastra | TypeScript AI runtime | `mastra-ai/mastra` | watch | TypeScript agents, workflows, MCP, evals |
| CrewAI | agent orchestration | `crewAIInc/crewAI` | watch | role-based Python agent crews |
| Vercel AI SDK | TypeScript AI runtime | `vercel/ai` | candidate | provider-agnostic generation, structured output, agent UI |
| Open WebUI | local AI interface | `open-webui/open-webui` | watch | local LLM UI and RAG UI reference |
| Promptfoo | LLM evaluation | `promptfoo/promptfoo` | candidate | prompt, agent, RAG evals and red teaming |
| Arize Phoenix | LLM observability | `Arize-ai/phoenix` | watch | tracing, evals, prompt experiments |
| OpenInference | telemetry | `Arize-ai/openinference` | candidate | OpenTelemetry LLM tracing conventions |

## MCP Routing

The local read-only MCP server exposes:

- `select_design_review_route`
- `search_architecture_library`

These tools only return routes, candidate ids, required checks, and stop conditions. They do not install dependencies, call providers, mutate repositories, or approve adoption.

## Stop Conditions

- missing visual brief
- missing target audience
- missing performance budget
- missing accessibility requirements
- unverified technology claim
- unknown license for asset or template adoption
- reference copied into implementation without clean-room abstraction
- Gemini claim adopted without Context7 or official-docs verification
- unknown license for adoption
- unapproved runtime scope
- cloud dependency without free-tier/no-cost confirmation
- paid dependency without owner exception
- critic is the same actor as producer

## Handoff Order

```text
Owner intent
  -> Visual Analyst
  -> Graphic Production Agent
  -> Frontend/Web Agent
  -> Design Critic
  -> UX Reviewer / QA
  -> Governance
```
