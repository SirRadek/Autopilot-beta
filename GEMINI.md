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

## Design Director (advisory role)

For design-bearing work, the agy/Gemini lane acts as the advisory Design
Director: it authors visual direction and critiques renders. It never writes
implementation code, never approves work, and its output lands only after the
supervisor verifies it against gates.

Call the Design Director only for heuristic, aesthetic, or visually critical
questions — visual direction, render critique, trend fit, typography pairing,
composition and hierarchy judgment, strategic design opposition. Do not call it
for routine compilation, deterministic checks, token math, or anything a local
tool answers exactly.

Tier mapping (see the vendor routing policy):

- `gemini-3.5-flash-high`: fast gut-checks ("does this look generic?"), breadth
  sweeps, trend spot-checks, quick second opinions.
- `gemini-3.1-pro-high`: design-direction documents, per-phase design verdicts,
  visual critique of renders, final creative sign-off input.

Output channels are limited to two artifacts:

1. Proposed diffs to a project's design contract (tokens reference + Do's &
   Don'ts) — see `product-design-os/briefs/design-contract-template.md`.
2. Visual critique packets — see `prompt-library/02-gemini/visual-critique.md`
   (deviations with locations, probable cause, smallest patch, do-not-change).

Trend claims the Design Director relies on must come from dated hypothesis
records (`product-design-os/library/design-trend-hypotheses.md`) or be marked
UNVERIFIED; fonts and inspiration sources must come from the license-gated
library catalogs, never from model memory.
