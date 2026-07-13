# Autopilot Hybrid Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local authenticated hybrid cockpit UI with project/session navigation, approval workflow, live worker visibility, provider budgets, and accessible responsive states.

**Architecture:** Add a small React/Vite frontend under `cockpit/` with a typed API client and pure view-model selectors. The UI talks only to the local Control Plane API; pane components consume normalized client data and never call vendors. Keep the existing TypeScript backend unchanged except for any narrowly missing read-only worker endpoint required by the MVP.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, axe-core, existing Control Plane HTTP API.

## Global Constraints

- The UI never calls Codex, Claude, AGY, or OpenRouter directly.
- Mutations require authenticated API confirmation and render the confirmed audit result.
- Missing quota values render as unavailable, never zero.
- Stale quota data is a warning only and cannot authorize dispatch.
- Prompt previews, terminal output, IDs, and logs are bounded before rendering.
- Desktop uses three panes; narrow screens switch to tabs in the order Approval, Sessions, Providers, Workers.
- Status is conveyed with text/icons as well as color.

---

### Task 1: Scaffold frontend shell and API client

**Files:**
- Create: `cockpit/package.json`, `cockpit/index.html`, `cockpit/src/main.tsx`, `cockpit/src/app/App.tsx`
- Create: `cockpit/src/api/controlPlaneClient.ts`
- Create: `cockpit/src/types/controlPlane.ts`
- Test: `cockpit/src/api/controlPlaneClient.test.ts`
- Modify: root `package.json` scripts

**Interfaces:**
- `ControlPlaneClient` methods: `getStatus`, `getSessions`, `getApprovals`, `getProviderQuotas`, `getProviderModels`, `getProviderHealth`, `decideApproval`.
- All methods return typed results and throw `ControlPlaneApiError` with status and bounded message.

- [ ] **Step 1: Write failing API client tests** for bearer header, 401, 404, bounded error body, and typed success.
- [ ] **Step 2: Implement** the client with `fetch` injection for tests and `VITE_CONTROL_PLANE_URL` runtime configuration.
- [ ] **Step 3: Scaffold** the minimal React mount and add `npm run cockpit:dev`, `cockpit:build`, and `cockpit:test` scripts.
- [ ] **Step 4: Run** the focused client tests and `npm run typecheck`.

### Task 2: Add shell layout and responsive navigation

**Files:**
- Create: `cockpit/src/app/AppShell.tsx`
- Create: `cockpit/src/app/app.css`
- Create: `cockpit/src/components/StatusBadge.tsx`
- Test: `cockpit/src/app/AppShell.test.tsx`

**Interfaces:**
- `AppShell` receives selected project/session, pane data slots, and navigation callbacks.
- Desktop renders Projects/Sessions, Approval/Workflow, and Live Operations/Provider Budget panes.
- Narrow viewport renders accessible tabs in Approval, Sessions, Providers, Workers order.

- [ ] **Step 1: Write rendering tests** for desktop three-pane layout, selected session, status labels, and narrow tab order.
- [ ] **Step 2: Implement** semantic regions, keyboard navigation, focus states, and responsive CSS.
- [ ] **Step 3: Run** component tests and axe checks.

### Task 3: Implement Projects & Sessions pane

**Files:**
- Create: `cockpit/src/features/sessions/SessionPane.tsx`
- Create: `cockpit/src/features/sessions/sessionSelectors.ts`
- Test: `cockpit/src/features/sessions/SessionPane.test.tsx`

**Interfaces:**
- Selector groups sessions by project/cwd and exposes active, expired, closed, and empty states.
- Pane supports select, create, resume, and close callbacks without direct API calls.

- [ ] **Step 1: Write selector and component tests** for grouping, empty state, TTL, and session status.
- [ ] **Step 2: Implement** bounded labels and accessible action buttons.
- [ ] **Step 3: Run** focused tests and axe checks.

### Task 4: Implement Approval & Workflow pane

**Files:**
- Create: `cockpit/src/features/approvals/ApprovalPane.tsx`
- Create: `cockpit/src/features/approvals/ApprovalDetail.tsx`
- Create: `cockpit/src/features/approvals/approvalSelectors.ts`
- Test: `cockpit/src/features/approvals/ApprovalPane.test.tsx`

**Interfaces:**
- Approval pane renders pending/approved/rejected states, risk, vendor/model, skills, token estimate, required checks, and stop conditions.
- Mutations call the typed client and render confirmed status/audit result.

- [ ] **Step 1: Write tests** for queue sorting, bounded prompt preview, approve confirmation, reject reason, 401/409 errors, and detail tabs.
- [ ] **Step 2: Implement** Review/Approve/Reject flow with disabled stale actions and explicit confirmation.
- [ ] **Step 3: Run** focused tests and accessibility checks.

### Task 5: Implement Provider & Budget pane

**Files:**
- Create: `cockpit/src/features/providers/ProviderPane.tsx`
- Create: `cockpit/src/features/providers/quotaSelectors.ts`
- Test: `cockpit/src/features/providers/ProviderPane.test.tsx`

**Interfaces:**
- Render five-hour/week windows, spend, models, health, freshness, fetched time, and next poll.
- Render `null` values as unavailable and stale values with text warning.
- Never render credential fields or raw provider errors.

- [ ] **Step 1: Write tests** for fresh, stale, unavailable, zero-used, null-limit, model list, and provider health states.
- [ ] **Step 2: Implement** cards, compact model list, and responsive provider tab.
- [ ] **Step 3: Run** focused tests and axe checks.

### Task 6: Implement Live Workers and terminal pane

**Files:**
- Create: `cockpit/src/features/workers/WorkerPane.tsx`
- Create: `cockpit/src/features/workers/workerSelectors.ts`
- Test: `cockpit/src/features/workers/WorkerPane.test.tsx`
- Modify: Control Plane API only if a typed read-only worker endpoint is required.

**Interfaces:**
- Render running/completed/blocked/error worker states, vendor/model/session, bounded output tail, elapsed time, and cancel confirmation.
- Cancel remains a typed mutation with confirmed result; no direct process handling in the browser.

- [ ] **Step 1: Write tests** for each worker state, bounded output, empty state, and cancel confirmation/error.
- [ ] **Step 2: Implement** worker cards and terminal tabs with non-color status labels.
- [ ] **Step 3: Run** focused tests, axe checks, and API contract tests.

### Task 7: Compose data hooks, routing, and refresh behavior

**Files:**
- Create: `cockpit/src/app/useCockpitData.ts`
- Create: `cockpit/src/app/routeState.ts`
- Modify: `cockpit/src/app/App.tsx`
- Test: `cockpit/src/app/useCockpitData.test.ts`

**Interfaces:**
- Poll read-only data on bounded intervals; preserve last safe snapshot on pane-local errors.
- Persist selected project/session in URL query state.
- Never poll providers directly from the browser; consume Control Plane quota snapshots.

- [ ] **Step 1: Write tests** for initial load, pane-local failure, refresh, URL restore, and stale data.
- [ ] **Step 2: Implement** typed hooks and route state.
- [ ] **Step 3: Run** frontend tests and production build.

### Task 8: VM integration and final verification

- [ ] Run `npm run cockpit:build`.
- [ ] Start the systemd Control Plane and serve the cockpit from a local static server or documented local dev command.
- [ ] Verify authenticated API calls from the browser against `127.0.0.1:8787`.
- [ ] Run all cockpit tests, axe checks, root typecheck, and `npm run verify` in VM.
- [ ] Confirm no credentials appear in browser storage, logs, snapshots, or rendered error states.
