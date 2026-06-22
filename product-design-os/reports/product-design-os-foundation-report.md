# Product & Design OS Foundation Report

Date: 2026-05-31
Status: phase-1 foundation

## Scope

Created the first minimal Product & Design OS foundation as a governance and
template layer. This does not redesign any website, add runtime dependencies,
create a workflow engine, or duplicate the Decision Mesh source of truth.

## Local Audit Summary

- Existing Autopilot already has Decision Mesh routing, project-specific mesh
  separation, model routing policy, token-economy rules, design intelligence,
  graphic-agent policy, local worker policy, and observability routing.
- Therefore this foundation must extend the current governance layer, not create
  a parallel AI Production Studio or separate runtime.
- The repository already had unrelated dirty changes before this work. This
  slice only adds `product-design-os/` and updates governance documentation.

## External Verification

- Context7 official docs confirm the intended role: current, version-specific
  documentation and examples injected into assistant context. Local Codex config
  did not expose a callable Context7 MCP server in this session, so Context7 is
  recorded as unavailable locally and official docs/GitHub fallback is required.
  Source: https://context7.com/docs/overview
- Gemini CLI is installed locally as `0.44.1`. Official Gemini CLI pricing docs
  state that Google account usage has a free tier with request limits, while API
  key/pay-as-you-go modes can incur costs. The advisory run used redacted
  context outside the repo. Source:
  https://google-gemini.github.io/gemini-cli/docs/quota-and-pricing.html
- Gemini advisory critique was useful mainly as a process warning. It
  misunderstood "Autopilot" as aviation autopilot, so domain-specific output was
  rejected. Retained generic guidance: add explicit safety/governance gates,
  preserve fallbacks for external dependencies, and avoid premature runtime
  coupling.
- GitHub connector verified canonical public references for USWDS, Carbon,
  Style Dictionary, and promptfoo. These are advisory references for patterns,
  accessibility, tokens, and evals, not source-of-truth for Autopilot.
- Playwright official docs were checked for future visual regression and
  accessibility automation. Sources:
  https://playwright.dev/docs/test-snapshots and
  https://playwright.dev/docs/accessibility-testing
- Reddit was used only as qualitative market/design feedback. The signal matches
  the current Radeq feedback: generic SaaS pages often fail because visual
  language and CTA logic do not communicate the offer quickly enough. Sources:
  https://www.reddit.com/r/design_critiques/comments/1sro44f/redesigned_my_saas_landing_to_feel_less_generic/
  and
  https://www.reddit.com/r/SaaS/comments/1t3f7t7/after_auditing_30_saas_landing_pages_i_think_the/

## Created Foundation

- brief schema and brief template
- scope, change-request, decisions, and out-of-scope templates
- strict process, logic-first, multi-agent routing, change-request,
  anti-template, accessibility, and performance rules
- initial recipes for internal systems, ecommerce, dashboards, marketing, and
  creative motion
- taste memory capturing the current "too similar/template" feedback
- asset and pattern schemas plus empty manifests
- basic agent task template and role notes for Design Critic, Strict Product
  Opponent, Gemini Reviewer, and Qwen Worker
- empty directories for future logic, pattern, asset, report, token, and QA
  expansion

## Direction For Radeq-Type Website Work

Future variants must be structurally different, not just color variants. Each
direction needs its own:

- positioning idea
- layout rhythm
- visual anchor
- motion concept
- CTA logic
- proof/case-study strategy
- accessibility and performance budget

## Next PR-Sized Steps

1. Add screenshot OCR hook, reference comparison, and visual-diff support on top
   of the local Design Reader capture layer.
2. Expand pattern and asset manifests beyond the first marketing/creative,
   ecommerce, dashboard, internal-system, public-sector, and client-portal
   candidates into AI-agent UI, document-system, and automation UI scenarios.
3. Add project-level Needs Report and Scope Contract for Radeq before another
   implementation attempt.
4. Add visual QA tests and reduced-motion checks only after a concrete design
   direction is locked.

## Explicit Non-Work

- No runtime behavior changed.
- No new dependencies added.
- No connector mutation performed.
- No product website redesigned in this slice.
- No paid tool adopted.

## Verification Results

- Product & Design OS JSON parse check passed for 21 JSON files.
- `npm.cmd run pdos:validate` now checks required files, recipes, manifests,
  taste memory, Markdown templates, and MCP entry terms.
- `npm.cmd run pdos:route` now provides a local deterministic intake and
  change-request route for project type, recipe, risk, gates, and stop
  conditions.
- `npm.cmd run pdos:report` now prints a console-only Markdown report covering
  needs, scope, opposition, and implementation-lock checkpoints.
- `npm.cmd run pdos:score` now scores recipes, registered patterns, and
  registered assets with the documented scoring formula.
- Pattern and asset manifests now include first marketing/creative candidates
  for positioning, proof, demos, cursor detail, scroll proof, editorial layout,
  and motion-safe assets.
- Pattern and asset manifests now include first ecommerce candidates for product
  grids, product detail, cart drawer, checkout steps, reviews, trust summaries,
  and low-motion conversion assets.
- Pattern and asset manifests now include first dashboard/data-heavy candidates
  for KPIs, filters, drilldown tables, source-backed charts, alerts, and
  low-motion data assets.
- Pattern and asset manifests now include first internal-ops candidates for
  table-first workbenches, detail drawers, status badges, bulk actions, saved
  filters, role-aware workflows, and audit-safe assets.
- Pattern and asset manifests now include first public-sector and client-portal
  candidates plus dedicated recipes for accessible public services and trusted
  client account work.
- `npm.cmd run pdos:visual-qa` now provides the first deterministic Design
  Reader / Visual QA layer for structured viewport evidence, template-risk
  signals, reduced-motion checks, canvas-content risk, and layout issues.
- `npm.cmd run pdos:reader:capture` now uses local Playwright to capture
  screenshots, extract DOM/CSS evidence, write a reader snapshot, and generate
  a Visual QA Markdown report for local HTML files or URLs.
- `npm.cmd run pdos:reader:document` now provides a local external-worker
  adapter for the separate `pdf-supervisor` Python project, including runtime
  checks, source-preserving conversion invocation, and expected Markdown/JSON
  artifact review.
- `git diff --check` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run mesh:check` passed.
- `npm.cmd test` passed: 16 test files, 66 tests.
