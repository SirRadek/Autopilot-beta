# Delivery System Read-Only UI Decision

Date introduced: 2026-05-13
Status: phase-2 architecture decision
Owner: Autopilot Control Plane

Decision: allow a minimal static Astro read-only command center at `/autopilot`.

This decision does not approve connector calls, server routes, credentials, background jobs, durable workflows, deployments, or remote mutation.

## Decision

Autopilot may add:

- `astro.config.mjs`
- `src/pages/autopilot.astro`
- `playwright.config.ts`
- `tests/autopilot-delivery-system.spec.ts`
- local scripts for `dev`, `build`, `preview`, and `test:e2e`

Allowed purpose:

- render typed governance contracts as a read-only dashboard
- show architecture record path, work-log path, next review date, status, and current risks
- verify the route with local Playwright smoke tests

Forbidden purpose:

- no connector calls from the UI
- no forms that mutate data
- no login, auth, credentials, or secrets
- no server-side API route
- no deployment target
- no durable workflow or automation
- no product project runtime code

## Dependency Policy

New development dependencies:

- `astro`
- `@playwright/test`

Runtime dependencies:

- none

No UI framework, component library, icon package, connector SDK, workflow SDK, database client, or cloud CLI is approved by this decision.

## Tooling Evidence

Context7 checked Astro documentation on 2026-05-13. Relevant guidance:

- Astro uses file-based routing from `src/pages`.
- Standard scripts are `astro dev`, `astro build`, and `astro preview`.
- `astro.config.mjs` uses `defineConfig` from `astro/config`.

Context7 checked Playwright documentation on 2026-05-13. Relevant guidance:

- Playwright config can start a local web server with `webServer`.
- `baseURL` allows route-relative test navigation.

Local package versions checked on 2026-05-13:

- latest npm `astro`: `6.3.2`
- latest npm `@playwright/test`: `1.60.0`

## UI Boundary

The command center must be static and read-only. It may import typed local contracts, but it must not import network, process, connector, cloud SDK, or filesystem mutation APIs.

The UI is allowed to summarize local governance contracts. It is not allowed to become the orchestrator, execution engine, connector client, or product dashboard.

## Verification

Performed on 2026-05-13:

- `npm run typecheck`: passed
- `npm run test`: passed 3 files and 11 tests after review fixes
- `npm run build`: passed, building one static page at `/autopilot/index.html`
- initial `npm run test:e2e`: failed because Playwright Chromium was not installed
- `npx playwright install chromium`: completed
- final `npm run test:e2e`: passed 3 Chromium tests

## Decision Ledger Entry

```yaml
decision_id: 2026-05-13-read-only-ui-command-center
type: architecture
context: Typed governance contracts now exist and Task 5 requires a read-only command center UI.
decision: Add a minimal static Astro `/autopilot` page and local Playwright smoke test.
reasoning: A static dashboard improves reviewability without enabling execution or remote mutation.
alternatives:
  - keep typed contracts CLI-only
  - build UI later
  - add a full app framework
  - add connector-backed dashboard
impact: Allows Task 5 and Task 6 to proceed while preserving the no-execution boundary.
approved_by: user instruction to execute the large plan, supervisor architecture decision
related_tasks:
  - Task 5: Read-Only Command Center UI
  - Task 6: Browser And Accessibility Smoke
```
