# Cockpit user guide

[Back to the documentation index](../README.md)

The Cockpit is the operator view over the loopback Control Plane. It does not bypass server-side
authentication, project allowlisting, owner approval, token policy, or provider dispatch guards.

## Login and session lifetime

Enter the Control Plane token on the login screen. A successful login creates an HttpOnly,
SameSite=Lax cookie for loopback use; the TLS deployment adds `Secure`. The server stores browser
sessions in memory for eight hours. A restart logs every browser out. Never put the token in a URL,
repository file, screenshot, or incident packet.

## Main destinations

- **Overview** summarizes sessions, approvals, telemetry, and provider state.
- **Sessions** creates, resumes, and closes operator session records.
- **Approvals** shows pending and decided approval records.
- **Workers** displays state, bounded terminal output, elapsed time, and errors.
- **Providers** displays quota windows, freshness, API spend, models, and health.
- **Projects** shows the server-side allowlist; registry edits remain an operator-file task.
- **Runs** prepares, revises, approves, and inspects governed runs.
- **Incidents** shows bounded operational failures and manual repair packets.
- **Observability** presents bounded correlated events and aggregate counters.

## Sessions

A session record includes an ID, agent command, working directory, state, and timestamps. Creating or
resuming it does not start a provider process. Closing a session is supported in the Cockpit and is
distinct from cancelling a running worker.

## Providers and quotas

Quota cards distinguish fresh, stale, degraded, and unavailable evidence. Codex uses `/status`;
Claude and AGY use `/usage` through explicitly enabled trusted tmux probes. OpenRouter uses its API
credential. Active providers are polled on a bounded schedule; absent capability is visible rather
than guessed. Five-hour and weekly limits may be unavailable when a provider does not expose them.

Do not approve a route whose quota/model data is stale or unavailable. The UI disables such choices,
but the operator still owns the provider decision.

## Prepare, revise, and approve

1. Select an enabled registered project.
2. Select a fresh provider and a model reported available by both quota and model views.
3. Enter the prompt, estimated tokens, and requested artifacts.
4. Select `Připravit běh`.
5. Inspect the persisted revision. Revise rather than approving text that needs changes.
6. Approve the exact revision.

Approval does not rewrite history. The inspector refuses to substitute a newer unapproved prompt
when the approved revision is missing.

## Run details

The run inspector shows status, approved input, provider/model, reservation state, supervisor task,
worker result, bounded output, artifacts, retry totals, terminal reason, and timeline. Output is
redacted before persistence and bounded again for display. A visual request without a visual artifact
is explicitly marked unavailable; it is never replaced by a fabricated preview.

## Worker details and cancellation

Workers are ordered by running, blocked, error, and completed state. Select a worker to inspect its
bounded terminal tail. The current application does not pass a cancellation callback to the Worker
pane, so running workers display `Cancel unavailable`. Use the reviewed CLI procedure only when an
operator has confirmed the worker ID and understands the process-tree effect.

## Incidents and repair packets

Incidents expose a fixed stage/code, status, occurrence count, timestamps, safe summary, and bounded
correlation identifiers. `Připravit balíček pro opravu` creates a manual packet for work outside the
Autopilot run being diagnosed. Copying the packet does not run it. Repair Autopilot separately,
verify the affected path, mark repaired, then acknowledge.

## Error behavior

Each destination can show stale or failed data without destroying the shell. A route failure is also
recorded best-effort as an operational incident. If state persistence itself fails, the API still
returns a fixed safe error and request ID; consult system logs rather than asking the UI to expose raw
exceptions.

## Accessibility and responsive behavior

Browser QA covers keyboard tab navigation and a narrow viewport. Treat this as a regression baseline,
not a claim of complete assistive-technology certification. Report inaccessible controls as product
defects with route, viewport, keyboard steps, and a screenshot that contains no token or provider data.
