# Autopilot Hybrid Cockpit

## Goal

Provide a local operator cockpit for managing projects, sessions, approvals, governed workers, provider quotas, model availability, and token usage from one three-pane workflow.

## Product boundary

The cockpit is an authenticated read/write client of the local Control Plane API. It does not call Codex, Claude, AGY, or OpenRouter directly. It never makes routing decisions outside the governed dispatch API and never treats stale quota data as authorization.

## Layout

The desktop layout uses three persistent panes:

### Left pane: Projects and Sessions

- project list with active project highlight
- sessions grouped beneath each project
- agent/vendor badge
- session state: running, waiting, blocked, completed, or error
- create, resume, close, and select actions
- compact session age and TTL indicator

The selected project/session is the context for all center and right pane data.

### Center pane: Approval and Workflow

- approval queue sorted by priority, risk, and age
- prompt preview with bounded text
- selected vendor/model and activated skill IDs
- estimated token usage and applicable budget
- required checks and stop conditions
- actions: Review, Approve, Reject
- detail tabs: Prompt, Diff, Files, Plan, Logs

Approve and reject actions require an explicit confirmation affordance and show the resulting audit event.

### Right pane: Live Operations and Provider Budget

- active workers with vendor, model, session, elapsed time, and state
- terminal cards with bounded output tail and cancel action
- provider cards for five-hour usage, weekly usage, API spend, model availability, endpoint health, freshness, and next poll
- provider values distinguish `fresh`, `stale`, and `unavailable`; missing values render as unavailable, never zero
- model cards show provider, availability, health, and last update

The right pane prioritizes the provider used by the selected session, then shows other providers in compact cards.

## Navigation and states

The initial route is `/cockpit`. Selecting a project/session updates the URL query so the view can be restored after reload. Empty states explain how to create a session or submit an approval. Loading uses skeletons only within the affected pane. Errors remain local to their pane and preserve the last known safe data.

## Data flow

```text
Session Registry → selected session context
        ↓
Governed route → approval queue and skill list
        ↓
Token gateway → estimate and budget state
        ↓
Approval API → explicit owner decision
        ↓
Governed dispatch → worker/terminal state
        ↓
Telemetry + quota polling → provider budget and audit views
```

The browser uses authenticated Control Plane endpoints. Reads may poll or use server-sent updates later; mutations remain explicit HTTP requests and are reflected only after the API confirms them.

## API dependencies

Existing endpoints:

- `GET /status`
- `GET /sessions`
- `GET /approvals`
- `POST /approvals/:id`
- `GET /providers/quotas`
- `GET /providers/:provider/quotas`
- `GET /providers/models`
- `GET /providers/health`

Future worker endpoints are intentionally isolated behind a small client module so the UI can render current worker telemetry without inventing lifecycle state.

## Safety and interaction rules

- The UI cannot approve a record that is no longer pending.
- The UI cannot dispatch a record without a valid approved status, live session, governed skill route, and token budget.
- Cancel requires a confirmation dialog showing worker ID, vendor, project, and session.
- Reject requires a reason or an explicit default reason.
- Bearer tokens are supplied by the local runtime environment and are never displayed or persisted by the UI.
- Prompt previews, terminal output, and logs are bounded and must be redacted by the API before rendering.
- Stale quota is a warning only; it cannot block or authorize dispatch by itself.

## Visual system

- dark engineering cockpit visual language
- restrained charcoal surfaces with cyan, amber, green, red, and gray status accents
- compact monospace values for IDs, tokens, costs, timestamps, and terminal output
- accessible contrast and non-color status labels/icons
- responsive fallback: on narrow screens panes become tabs in this order: Approval, Sessions, Providers, Workers

## MVP acceptance criteria

- Operator can select a project/session and see its approvals and provider context.
- Operator can inspect prompt, model, skill IDs, budget, checks, and stop conditions before approval.
- Operator can approve or reject through authenticated API calls and see the audit result.
- Operator can see provider quotas, spend, model availability, freshness, and health.
- Operator can see live worker status and bounded terminal output.
- Reload preserves selected project/session context.
- UI never calls vendors directly and renders unavailable/stale states honestly.

## Testing

- component tests for pane states, empty/loading/error/stale/unavailable rendering
- API client tests for authentication, 401, 404, stale data, and mutation errors
- approval flow integration test from pending to approved/rejected
- session selection and reload restoration test
- quota card tests for fresh, stale, unavailable, null values, and model lists
- worker card tests for running, completed, blocked, error, and cancel confirmation
- accessibility checks for keyboard navigation, focus, labels, and non-color status cues
