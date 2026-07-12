# Provider Quota Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trustworthy, session-gated provider quota/model polling with persistent snapshots and authenticated Control Plane read endpoints.

**Architecture:** A small quota domain owns normalized snapshots, freshness, backoff, and persistence. Provider adapters are isolated behind one interface and never expose credentials or raw provider errors. A session-aware scheduler polls only active providers; the existing Control Plane serves cached snapshots read-only.

**Tech Stack:** TypeScript, Node.js `fetch`/`child_process`, Vitest, existing session registry, Control Plane HTTP server, JSON snapshot/event files.

## Global Constraints

- Poll only while at least one live provider session exists.
- Poll every five minutes while active; one in-flight poll per provider.
- Use bounded exponential backoff with a thirty-minute maximum after failures.
- Represent missing values as `null`, never as zero.
- Never persist credentials, authorization headers, or raw provider error bodies.
- Stale data cannot authorize dispatch or bypass model allowlists.
- Do not implement automatic fallback or model switching.

---

### Task 1: Define normalized quota domain

**Files:**
- Create: `src/data/delivery-system/providerQuota.ts`
- Test: `tests/delivery-system/provider-quota.test.ts`
- Modify: `vendor-manifest.json`

**Interfaces:**
- Produce `ProviderQuotaWindow`, `ProviderModelAvailability`, `ProviderSnapshot`, `ProviderQuotaAdapter`.
- Produce `freshnessForSnapshot(snapshot, now)` returning `"fresh" | "stale" | "unavailable"`.
- Produce `normalizeProviderError(error)` returning a bounded error code without raw body text.

- [ ] **Step 1: Write failing tests** for null-vs-zero normalization, freshness thresholds, and bounded error codes.
- [ ] **Step 2: Run** `npm test -- tests/delivery-system/provider-quota.test.ts`; expect missing-module failures.
- [ ] **Step 3: Implement** the interfaces and pure functions with immutable return values.
- [ ] **Step 4: Run** the same test; expect all tests passing.
- [ ] **Step 5: Run** `npm run typecheck`.

### Task 2: Implement atomic snapshot persistence

**Files:**
- Create: `src/data/delivery-system/providerQuotaStore.ts`
- Test: `tests/delivery-system/provider-quota-store.test.ts`

**Interfaces:**
- Produce `readProviderQuotaStore(stateDir)` and `writeProviderQuotaStore(stateDir, document)`.
- Produce `appendProviderQuotaEvent(stateDir, event)`.
- Use `provider-quota-snapshots.json` and `provider-quota-events.jsonl`.

- [ ] **Step 1: Write tests** for missing files, atomic replacement, malformed JSON rejection, and bounded event fields.
- [ ] **Step 2: Run the focused tests; expect failures.**
- [ ] **Step 3: Implement** temp-file write plus rename and append-only event records.
- [ ] **Step 4: Run focused tests and `npm run typecheck`**; expect PASS.

### Task 3: Add provider adapters

**Files:**
- Create: `src/data/delivery-system/providerQuotaAdapters.ts`
- Test: `tests/delivery-system/provider-quota-adapters.test.ts`

**Interfaces:**
- Produce `createProviderQuotaAdapters(dependencies)` returning adapters for `codex_cli`, `claude_cli`, `agy_cli`, and `openrouter_api`.
- OpenRouter adapter consumes injected fetch and existing public model health/allowlist helpers.
- CLI adapters consume injected command runners; tests must not invoke real CLIs.

- [ ] **Step 1: Write contract tests** for success, timeout, malformed output, missing credential, and unavailable subscription quota.
- [ ] **Step 2: Run focused tests; expect failures.**
- [ ] **Step 3: Implement** normalized snapshots and provider-specific bounded error codes.
- [ ] **Step 4: Verify** with focused tests and `npm run typecheck`.

### Task 4: Implement session-gated scheduler

**Files:**
- Create: `src/data/delivery-system/providerQuotaScheduler.ts`
- Test: `tests/delivery-system/provider-quota-scheduler.test.ts`

**Interfaces:**
- Produce `ProviderQuotaScheduler.start()` and `.stop()`.
- Scheduler input consumes `SessionRegistryRecord[]`, adapter map, clock, and persistence store.
- Enforce one in-flight poll, immediate first poll, five-minute success interval, and capped backoff.

- [ ] **Step 1: Write fake-clock tests** for activation, deduplication, stop-on-last-session, cancellation, and backoff.
- [ ] **Step 2: Run focused tests; expect failures.**
- [ ] **Step 3: Implement** timer scheduling with injected clock and AbortController.
- [ ] **Step 4: Run focused tests and typecheck; expect PASS.**

### Task 5: Expose authenticated Control Plane endpoints

**Files:**
- Modify: `scripts/control-plane-server.ts`
- Test: `tests/scripts/control-plane-server.test.ts`

**Interfaces:**
- Add `GET /providers/quotas`, `GET /providers/:provider/quotas`, `GET /providers/models`, and `GET /providers/health`.
- Responses include `freshness`, `fetched_at`, and `next_poll_at`.
- Reuse existing bearer auth and return `401` without it.

- [ ] **Step 1: Write HTTP tests** for auth, empty store, stale snapshots, provider filtering, and model aggregation.
- [ ] **Step 2: Run focused tests; expect failures.**
- [ ] **Step 3: Implement** read-only endpoint handlers backed by the snapshot store.
- [ ] **Step 4: Run focused tests and mesh gate; expect PASS.**

### Task 6: Wire the scheduler into the VM service

**Files:**
- Modify: `scripts/control-plane-server.ts`
- Modify: `ops/systemd/autopilot-control-plane.service`
- Modify: `ops/systemd/README.md`
- Test: `tests/scripts/provider-quota-service.test.ts`

**Interfaces:**
- Start the scheduler with the same persistent state directory and session registry used by the service.
- Stop scheduler cleanly on SIGTERM/SIGINT.

- [ ] **Step 1: Write tests** for startup/shutdown wiring and state directory selection.
- [ ] **Step 2: Implement** signal cleanup and scheduler lifecycle.
- [ ] **Step 3: Run** `npm run typecheck`, focused tests, and `npm run mesh:gate:ci`.
- [ ] **Step 4: Run VM smoke** with OpenRouter public health and no credential output.

### Task 7: Final verification

- [ ] Run `npm run verify` in the VM.
- [ ] Confirm no stale/unsnapshotted mesh entries.
- [ ] Confirm no credentials or raw provider errors in snapshot/event files.
- [ ] Review API output for fresh, stale, and unavailable states.
- [ ] Record the final smoke results in the project work log.
