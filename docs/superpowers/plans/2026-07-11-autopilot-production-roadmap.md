# Autopilot Production Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Turn the current VM cockpit/control-plane prototype into a secure, browser-usable, budget-governed, observable multi-provider supervisor.

**Architecture:** Keep the Control Plane as the only stateful boundary. The browser receives an HttpOnly authenticated session through a same-origin proxy/login flow and never receives the long-lived control-plane token. Provider adapters feed a persisted quota/model/health store; a supervisor consumes governed handoff packets and dispatches bounded workers through the existing CLI/API boundaries.

**Tech Stack:** TypeScript, Node 24, Vite/React, Node HTTP, systemd user service, Vitest, Playwright (browser QA), JSONL/state files during this VM phase.

## Global Constraints

- Long-lived control-plane tokens must never be embedded in browser assets.
- All mutations require authentication, validation, audit logging, and bounded payloads.
- Never auto-switch provider/model mid-task; supervisor decisions must be explicit and logged.
- All worker output and telemetry exposed to the UI must be bounded and redacted.
- Every phase must have focused tests and VM verification before the next phase.
- Preserve the existing read-only governance and mesh gates.

---

### Task 1: Production browser authentication

**Deliverable:** HttpOnly session authentication for the cockpit plus same-origin deployment documentation and tests; keep the existing bearer token usable for CLI/service-to-service calls.

**Files:** `scripts/control-plane-server.ts`, `cockpit/src/api/controlPlaneClient.ts`, `cockpit/src/app/App.tsx`, `cockpit/src/features/auth/*`, systemd/reverse-proxy docs, focused tests.

**Verification:** VM typecheck, auth integration tests, cockpit tests/build, unauthenticated browser requests cannot access protected endpoints, authenticated cookie requests can.

### Task 2: Browser QA

**Deliverable:** Playwright smoke suite covering login, all four destinations, approval confirmation, session mutation, stale/error states, responsive layouts, and keyboard navigation.

**Verification:** Chromium run in VM/CI and artifact screenshots/traces on failure.

### Task 3: Token gateway

**Deliverable:** Central pre-dispatch budget gate with provider/model budgets, input/output caps, spend accounting, cache/context reuse metrics, hard refusal on budget exhaustion, and UI telemetry.

**Verification:** unit/integration tests for caps, refusal, accounting, and no mid-task provider switching.

### Task 4: Supervisor loop

**Deliverable:** Durable task queue, governed handoff packets, worker lifecycle state machine, retries/backoff, timeout/cancel, resume-after-restart, dependency and human-approval gates.

**Verification:** restart/recovery integration tests and deterministic dispatch-routing tests.

### Task 5: Provider integrations

**Deliverable:** Verified Claude/Codex/AGY/OpenRouter adapters with persisted poll metadata, capabilities, model availability, spend/quota errors, and explicit provider selection.

**Verification:** fixture tests per provider plus live health probes where credentials are available.

### Task 6: Observability

**Deliverable:** Correlation IDs, session/worker/provider timeline, bounded event store, cost/token dashboards, and waste reports.

**Verification:** end-to-end trace from UI action to provider call and telemetry redaction tests.

### Task 7: Operational hardening

**Deliverable:** state/log rotation, backups, service health alerts, secret handling, least-privilege worker execution, recovery runbook, and VM restart drill.

**Verification:** systemd failure/restart, restore, disk-pressure, and secret-leak checks.

### Task 8: Advanced automation

**Deliverable:** prompt composer, project/provider/model selectors, supervisor launch controls, multivendor brainstorm workflow, learning loop, and scheduled/batch tasks.

**Verification:** browser workflow tests plus governed end-to-end dry runs.
