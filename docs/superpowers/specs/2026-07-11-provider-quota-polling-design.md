# Provider quota and model availability polling

## Goal

Expose trustworthy provider capacity data in the Autopilot hybrid cockpit. The UI must show five-hour and weekly limits, API spend, available models, health, and freshness without inventing values or exposing credentials.

## Scope

This slice covers the polling domain, persistence, provider adapters, and the read-only Control Plane API contract. It does not implement the cockpit UI, provider credential onboarding, billing changes, or automatic model switching.

## Activation and lifecycle

Polling is active only while at least one live session for the provider exists in the session registry. The first poll runs when the provider becomes active. While active, the scheduler polls every five minutes. When the last provider session closes or expires, the scheduler stops and keeps the last snapshot for audit/history.

Each provider has at most one in-flight poll. A slow or failed request cannot create overlapping calls. The scheduler uses bounded exponential backoff after failures, with a maximum interval of thirty minutes, and returns to the five-minute interval after a successful poll.

## Provider adapter contract

Each adapter implements a narrow interface:

```ts
interface ProviderQuotaAdapter {
  readonly provider: string;
  fetchSnapshot(input: { now: string; signal: AbortSignal }): Promise<ProviderSnapshot>;
}
```

`ProviderSnapshot` contains only normalized data:

- provider and source (`cli`, `api`, or `manual-fallback`)
- fetched and observed timestamps
- five-hour and weekly windows, each with limit, used, remaining, and reset time when available
- API spend and currency when available
- available models with availability, health, and source
- overall health and optional bounded error code

Missing provider data is represented as `null` with a reason. It is never represented as zero. Credential values, raw authorization headers, and raw provider error bodies are excluded from snapshots and telemetry.

Initial adapters:

- Codex: CLI/account quota probe when supported; otherwise `unavailable` with the exact probe reason.
- Claude: Claude CLI/account quota probe when supported; subscription values remain `unavailable` rather than inferred.
- AGY: AGY quota command through its PTY-safe adapter.
- OpenRouter: authenticated spend/credits probe plus public model and endpoint health probe. The existing model allowlist remains authoritative for governed dispatch.

## Persistence

Snapshots are written under the control-plane state directory:

```text
provider-quota-snapshots.json
provider-quota-events.jsonl
```

Writes are atomic for the current snapshot. Event records are append-only and bounded to provider, timestamps, status, changed fields, and error codes. Retention and rotation follow the existing state/log policy.

## Control Plane API

Authenticated read-only endpoints:

- `GET /providers/quotas` — current snapshot for all known providers
- `GET /providers/:provider/quotas` — one provider snapshot
- `GET /providers/models` — normalized model availability
- `GET /providers/health` — health and freshness summary

The response includes `freshness: fresh | stale | unavailable`, `fetched_at`, and `next_poll_at`. A stale snapshot remains visible with a warning. No endpoint triggers an arbitrary provider call; `POST` refresh is a later owner-gated operation and is not part of this slice.

## UI behavior

The recommended hybrid cockpit places a Provider & Budget panel on the right rail. It shows the active provider first, then compact cards for five-hour usage, weekly usage, API spend, model availability, and last update. Stale and unavailable states are visually distinct from healthy zero usage. A provider with no active session is shown as idle and does not poll.

## Safety and failure handling

- Poll requests have a hard timeout and cancellation signal.
- Only active-session providers are polled.
- Poll failures never block dispatch or approval operations.
- Stale data cannot authorize a new provider or bypass model allowlists.
- OpenRouter spend limits remain enforced by the existing worker gate; quota polling is informational until a separate policy explicitly consumes it.
- Every adapter is tested with success, timeout, malformed response, missing credential, and stale-cache cases.

## Testing strategy

- Unit tests for snapshot normalization, freshness, reset windows, and backoff.
- Adapter contract tests with deterministic mocked CLI/API responses.
- Scheduler tests for active-session activation, five-minute cadence, stop-on-last-session, deduplication, and cancellation.
- API tests for authentication, stale/unavailable serialization, and provider/model aggregation.
- VM smoke test with OpenRouter and read-only probes for CLI providers; no test logs credentials or raw provider responses.

## Explicit non-goals

- No automatic provider fallback or model switching.
- No billing mutations or key rotation.
- No UI implementation in this slice.
- No assumption that subscription quota is available when a provider does not expose a supported probe.
