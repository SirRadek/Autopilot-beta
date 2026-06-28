# Delivery System Runtime Package Decision

Date introduced: 2026-05-13
Status: phase-1 architecture decision
Owner: Autopilot Control Plane

Decision: allow a minimal TypeScript package for typed governance contracts and pure validation helpers.

This decision does not approve a UI, connector integration, durable workflow engine, background job, deployment, or remote mutation.

## Decision

Autopilot may add these files for phase-1 typed governance contracts:

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `vitest.config.ts`
- `src/data/delivery-system/*.ts`
- `src/lib/delivery-system/*.ts`
- `tests/delivery-system/*.test.ts`

Allowed purpose:

- encode roles, gates, workflow states, ledgers, and model policy as typed data
- validate gate results and ledger entries with pure functions
- run local tests and type checks
- support future read-only UI decisions

Forbidden purpose:

- no product runtime code
- no server routes
- no UI route
- no connector clients
- no `fetch` calls
- no filesystem mutation
- no `child_process`
- no credentials or environment variable loaders
- no durable workflows
- no background jobs
- no deployment configuration

## Dependency Policy

Runtime dependencies:

- none

Development dependencies:

- `typescript`
- `vitest`
- `@types/node`

Subsequent extension:

- `docs/autopilot/delivery-system-read-only-ui-decision.md` later approves `astro` and `@playwright/test` for static read-only UI and browser smoke verification only.
- `docs/autopilot/decision-mesh-mcp-decision.md` later approves `@modelcontextprotocol/sdk`, `yaml`, `zod`, and `tsx` for local Decision Mesh parsing, generated artifact checks, and read-only stdio MCP serving only.

Deferred dependencies:

- Schema libraries such as Zod are deferred until the first validator use case needs richer parsing than simple structural checks.
- Vite, Astro, Playwright, connector SDKs, workflow SDKs, database clients, and cloud CLIs are out of scope for this phase.

## Tooling Evidence

Local versions checked on 2026-05-13:

- Node.js: `v24.15.0`
- npm: `11.12.1`
- latest npm `vitest`: `4.1.6`
- latest npm `typescript`: `6.0.3`
- latest npm `@types/node`: `25.7.0`

Context7 checked Vitest documentation on 2026-05-13. Relevant guidance:

- Vitest supports TypeScript test files.
- `vitest --typecheck` can run tests with type checking.
- `vitest/config` is the current config import path for Vitest configuration.

Gemini advisory was run with sanitized project aliases only. Result: PASS with concerns about source-of-truth drift, dependency creep, credential shape exposure, and logic leakage. Accepted controls from that advisory are captured in this decision.

## Source-Of-Truth Rule

Markdown governance remains the human-readable source of policy.

Typed contracts are the executable mirror of:

- `docs/autopilot/delivery-system-governance.md`
- `docs/autopilot/delivery-system-ledgers.md`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/projects/multi-agent-autonomous-delivery-system/architecture.md`

When Markdown and TypeScript disagree, work must stop and a decision ledger entry must resolve the mismatch.

## No-Side-Effect Guard

Initial governance source files must export constants, TypeScript types, and pure validation helpers only.

Initial tests must prove:

- implementers cannot approve their own work
- testers cannot change business scope
- Autopilot cannot approve delivery
- blocker and major issues require rework
- minor issues require inline-fix evidence before pass
- cosmetic issues can pass with notes
- decision ledger entries require all mandatory fields
- issue ledger entries require all mandatory fields

## Decision Ledger Entry

```yaml
decision_id: 2026-05-13-runtime-package-typed-contracts
type: architecture
context: Autopilot needs typed governance contracts before read-only UI or execution runtime work can start.
decision: Add a minimal TypeScript/Vitest package for governance contracts and pure validators only.
reasoning: Typed contracts reduce ambiguity in role separation, gate decisions, and ledger completeness while preserving the no-execution boundary.
alternatives:
  - remain Markdown-only
  - add Astro UI first
  - add execution engine first
  - add schema library before pure validators
impact: Allows Task 3 and Task 4 of the multi-agent delivery plan to proceed; does not approve UI, connector clients, or execution runtime.
approved_by: user instruction to execute the large plan, supervisor architecture decision
related_tasks:
  - Task 3: Typed Contract Tests First
  - Task 4: Typed Registries And Pure Helpers
  - docs/autopilot/delivery-system-snapshots/2026-05-13-autopilot-read-only-dry-run.md
```
