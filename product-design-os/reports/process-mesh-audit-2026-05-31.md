# Process And Mesh Audit

Date: 2026-05-31
Status: completed

## Scope

Reviewed the Product & Design OS process, root Decision Mesh, Autopilot
project-specific mesh, local MCP server boundary, current documentation links,
Context7 fallback behavior, Gemini advisory route, local worker policy, and
technology/dependency status.

## Decision Mesh Result

MCP routing was run before the audit. The relevant boundaries were:

- `project_mesh_lifecycle`
- `reasoning_strategy`
- `context_economy_policy`
- `control_plane_boundary`
- `read_only_mcp_boundary`
- `capability_routing_layer`
- `design_intelligence_boundary`
- `model_reasoning_boundary`
- `local_worker_boundary`
- `token_efficiency_boundary`

The project mesh correctly keeps Autopilot control-plane concerns separate from
supervised project runtime concerns.

## MCP Smoke Test

The local MCP server was started through stdio using the official SDK client.

Verified tools:

- `select_capabilities`
- `get_relevant_subgraph`
- `build_agent_packet`
- `build_project_mesh_packet`
- `find_risks`
- `explain_node`
- `select_graphic_route`
- `select_design_review_route`
- `search_architecture_library`
- `select_reasoning_model_route`
- `select_local_worker_route`
- `select_token_efficiency_route`

`build_project_mesh_packet` for `autopilot-control-plane` returned the
read-only MCP and control-plane boundaries, plus required checks for no
connector client, no execution API, no product runtime, local worker review, and
compact context.

## External Source Verification

- Context7 docs are valid at `https://context7.com/docs/overview`, but no
  callable Context7 MCP server is configured locally. Use official docs fallback
  until Context7 is installed.
- MCP official docs define MCP as an open protocol for connecting LLM apps to
  external data/tools and explicitly call out consent, data privacy, and tool
  safety requirements.
- Gemini CLI docs confirm a free tier for individual Google-account usage and
  separate paid/pay-as-you-go modes. Keep Gemini redacted and advisory only.
- Playwright docs confirm screenshot visual comparisons and recommend combining
  automated accessibility scans with manual assessment.
- JSON Schema Draft 2020-12 is the correct schema draft for the current
  Product & Design OS schemas.

## Link Audit

Checked public HTTP links in active Autopilot/Product Design OS docs. Results:

- Valid: Gemini CLI docs, Playwright docs, JSON Schema, Cloudflare docs,
  GitHub Actions docs, Reddit references, Poly Pizza, process-academy.
- Skipped by design: localhost, example domains, `autopilot.local` schema IDs.
- Private/inaccessible from unauthenticated link checker: `SirRadek/autopilot`
  links. These are repository evidence, not public docs.
- Redirect/canonical fix applied: Context7 report link now uses
  `/docs/overview`; Workflow DevKit link now uses `/docs/getting-started`.
- `openai.com/academy/codex-automations/` returned 403 to the local checker.
  Treat as access-blocked, not proof of deletion.

## Fixed Issues

1. Session reset prompt incorrectly said the compact summary was the source of
   truth. It now says the summary is only a compact handoff; local files, tests,
   architecture records, and explicit owner decisions remain the source of
   truth.
2. Current governance records still pointed to the old local Autopilot root.
   Active architecture and registry entries now use `C:\Programování\Codex` for
   the Autopilot control-plane workspace.
3. Product & Design OS rules did not explicitly say how to enter the existing
   Decision Mesh/MCP path. The strict process now names the MCP routing calls and
   Context7/official-docs fallback requirement.
4. Gemini reviewer notes now explicitly require Context7 or official-docs
   verification before adopting technical or best-practice claims.
5. Two external documentation links were canonicalized.

## Findings To Watch

- Root mesh generic nodes include product-repository file hints such as
  `src/storage/index.ts` or `tests/upload`. They are useful as project-context
  hints, but they are not guaranteed to exist in the Autopilot control-plane
  repo. Project-specific meshes should remain the authority for actual
  implementation files.
- `astro` and `tsx` have minor newer versions available (`astro` 6.4.2 and
  `tsx` 4.22.4 at audit time). No update was applied because the current slice
  is governance review, `npm audit` reported zero vulnerabilities, and runtime
  dependency churn is outside the locked scope.
- `qwen2.5-coder:14b` remains a candidate until installed and hardware-tested.
- Product & Design OS has an initial deterministic foundation validator and
  intake/change-request router with console-only Markdown reports and read-only
  MCP exposure. It also has an initial scoring engine for recipes, registered
  patterns, and registered assets. Design Reader automation is still planned,
  not implemented.

## Gemini Advisory Result

Gemini CLI ran as a redacted advisory reviewer outside the repository. Useful
advisory points retained:

- read-only MCP must stay read-only until a security-reviewed update mechanism
  exists
- project mesh synchronization/versioning should be watched
- local/no-cost worker defaults should remain unless measured bottlenecks prove
  otherwise
- templates need a controlled deviation path

Gemini output was not treated as source-of-truth evidence.

## Verification

- Product & Design OS JSON parse check passed for 21 JSON files.
- `npm.cmd run pdos:validate` passed.
- `npm.cmd run pdos:route` is available for deterministic local intake and
  change-request routing.
- `route_product_design_os` is exposed through the local read-only MCP server.
- `npm.cmd run pdos:report` is available for console-only Markdown reports.
- `npm.cmd run pdos:score` and `score_product_design_os` are available for
  deterministic local scoring.
- `npm.cmd audit --audit-level=moderate` passed with zero vulnerabilities.
- `npm.cmd run mesh:check` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd test` passed: 16 test files, 66 tests.
- `npm.cmd run build` passed.
- `npm.cmd run test:e2e` passed: 3 Playwright tests.
- `npm.cmd run verify` passed.
- `git diff --check` passed after newline/trailing-whitespace normalization.
