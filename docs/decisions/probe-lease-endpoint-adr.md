# ADR: Probe-lease mutating endpoint — `POST /providers/probes/refresh`

**Date:** 2026-08-05 · **Status:** ACCEPTED (owner approved 2026-08-05).
**Author:** Claude (fable-5 orchestrator draft, cockpit-functional Phase 2).

## Context

Provider usage probes are expensive and intrusive: each one boots a full authenticated provider
TUI inside a fresh tmux session, types a slash command, and scrapes the pane
(`providerUsageProbe.ts:97-139`, ~8–14 s per provider per cycle). The scheduler currently polls
continuously every 5 minutes while any session is active
(`providerQuotaScheduler.ts:38`, `SUCCESS_INTERVAL_MS`; activation gate at `:128-131`), so
authenticated provider processes are started around the clock regardless of whether anyone is
looking at the cockpit. Meanwhile, when probes are down (the Phase 2 diagnosis), the operator has
no way to trigger a fresh snapshot: `/providers/quotas` is a pure GET read of the store
(`control-plane-server.ts:188-192`) — correctly so, GETs must stay side-effect-free.

Starting an authenticated provider CLI process **on demand from an HTTP request** is a new
mutating connector: it consumes subscription quota-window observations, spawns processes, and
writes the quota store. CLAUDE.md classifies any new mutating connector as a hard boundary —
hence this ADR (same reasoning as `figma-write-plugin-executor-adr.md`).

## Decision

Add **`POST /providers/probes/refresh`** behind the existing auth stack — the unsafe-method
CSRF/origin gate plus session-or-bearer authentication (`control-plane-server.ts:162-178`) — and
convert probing from continuous polling to a **bounded lease model**:

- **Lease semantics:** a successful POST grants (or extends) a single probe lease of **10 minutes**. While a lease is live, the scheduler runs its normal cadence (5-minute success interval, existing backoff on failure, `providerQuotaScheduler.ts:153-159`). When the lease expires, probing stops entirely — no ambient background polling. The active-session gate at `:128-131` becomes *lease AND active-adapter* rather than *sessions alone*.
- **Bounded and idempotent:** re-POST while a lease is live extends to a fresh 10 minutes (no lease stacking, no probe-per-request); at most one in-flight probe per provider is preserved via the existing `inFlight` map (`:57`, `:134`). The response returns `{ lease_expires_at, providers }`; the operator polls the unchanged GET endpoints for results.
- **No GET side-effects:** all `/providers/*` GET routes remain pure reads. Freshness semantics (`providerQuota.ts:63-81`) are unchanged; an expired lease simply lets snapshots go honestly `stale`.
- **Cockpit affordance:** the providers panel gains a "Refresh usage" action that calls the endpoint and shows lease countdown + per-provider freshness, replacing today's implicit always-on expectation.

## Consequences

- **Security:** a new authenticated mutating route exists whose effect is spawning authenticated provider CLI processes. Mitigations: it can only trigger the fixed, allowlisted probe set from OG-3 (no request-controlled command, provider list, or arguments — the body carries nothing that reaches a spawn), binaries resolve solely via the OG-1 fail-closed resolver, and the lease bounds blast radius (a stolen session/token can cause at most continuous probing, which is today's *default* behavior). CSRF origin enforcement applies as to every unsafe method.
- **Deployment surface:** none — loopback HTTP route inside the existing server; no unit change.
- **Behavior change:** quota snapshots are no longer perpetually fresh; they are fresh for ~10–15 minutes after an operator (or a governed pre-dispatch hook, later and separately) asks. This cuts steady-state load — dozens of authenticated TUI launches per hour drop to on-demand — and reduces standing exposure of authenticated processes.
- Existing tests around scheduler activation (`tests/scripts/control-plane-server.test.ts`) need the lease dimension added.

## Alternatives considered

- **Keep continuous polling and just fix PATH:** rejected — burns authenticated CLI launches 24/7 for a dashboard nobody may be watching, and still gives the operator no recovery action when probes wedge.
- **GET-triggered refresh (probe on `/providers/quotas` read):** rejected — side-effecting GETs violate the server's method discipline and would make every cockpit render spawn processes.
- **Long-lived toggle (`POST /providers/probes/enable`):** rejected — an "on" switch that outlives the operator's attention recreates continuous polling with extra state; a decaying lease is fail-safe by construction.
- **SSE/WS push of probe progress:** deferred — new transport surface; polling the existing GETs suffices for the MVP.

## Hard boundary and why owner approval is required

CLAUDE.md: "Do not create a … **new mutating connector** … without an explicit architecture decision and owner approval." This endpoint is exactly that: an HTTP-reachable action that starts authenticated provider processes and mutates managed state on demand. The owner must accept both the route's existence and the polling→lease semantic change, because the latter alters what "provider snapshot freshness" means for every downstream consumer.

