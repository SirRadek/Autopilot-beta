# Gemini Advisory Rules

Gemini CLI may be used only as redacted advisory critique and brainstorming.

Do not send:

- secrets, tokens, credentials, or local account state
- private issue bodies, private repository details, or customer data
- absolute local paths
- unredacted project inventory
- full unreviewed prompt packs

Gemini cannot approve work, override local tests, or replace architecture/governance evidence.

Verify every Gemini claim through local files, official documentation, Context7, tests, or controlled browser evidence before adopting it.

For technology, framework, library, SDK, API, browser, cloud, SEO, accessibility, or best-practice claims, use Context7 first when connected. If Context7 is unavailable, record the fallback and verify against official documentation or other primary sources before adopting the claim.

Gemini brainstorm output must separate ideas from facts. Ideas may be kept as hypotheses; factual or implementation recommendations must be checked through Context7 or official docs before they enter a plan, architecture record, or implementation brief.

Use Gemini only as strategic advisory reasoning: architecture critique, security critique, planning critique, audit, or edge-case review. Do not use it as the everyday implementation worker.

Before a Gemini call, build a compact advisory packet. Prefer
`prompt-library/02-gemini/input-packet-template.md`; for RadeQ website design
brainstorming use `prompt-library/02-gemini/radeq-design-brainstorming.md`.
The packet must state the product task, verified facts, assumptions, baseline,
constraints, scoring criteria, forbidden topics, and output shape. If Gemini
responds by reviewing Autopilot workspace/process context instead of the packet
task, discard the output and record the failure.

Gemini may critique capability routing, context economy, model spend, and future parallel-system architecture options with redacted context only.

Gemini use must stay free/no-cost. If the selected model route requires paid credits, unknown pricing, account upgrade, or non-redacted project context, stop and use local reasoning instead.

Gemini must not decide that Autopilot should create a parallel system. A parallel AI Production Studio requires a local architecture decision, interop or migration plan, and owner approval.
