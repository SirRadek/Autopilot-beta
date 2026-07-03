# Vendor routing v2 — implementation plan (10 slices)

**Date:** 2026-07-03. **Author:** Opus (reconstruction). **Status:** PROPOSED —
companion to [`vendor-routing-policy-beta-v2.md`](./vendor-routing-policy-beta-v2.md)
(the ADR). Advisory until the owner re-ratifies; does not supersede v1.

> Reconstruction of lost uncommitted work. Numeric tunables (cost-weights, window
> capacities, complexity-gate thresholds) are **placeholders / spec-defaults** and must
> be re-confirmed before hardcoding. See the ADR's honesty preamble.

## How every slice is bounded
Each slice is **one bounded handoff packet** — one codex session + one Opus gate. Rules
that hold for **all** slices:

- **Additive-first.** Do not break existing exports or behavior. New fields land alongside
  old ones; readers migrate only in their own slice.
- **Invariants preserved:** `assertRoleConstraint`, `isSelfFallbackRoute`, the
  verified-tier guard (`isActiveTierExplicitlyUnverified`), and the **orthogonal circuit
  breaker**. None of these is modified except where a slice explicitly says so.
- **`now` is injected.** No `Date.now()` in pure functions — pass an injected `now` (the
  codebase already throws `routing_circuit_now_required` when it is missing).
- **Per-slice gate:** `typecheck` + a **targeted vitest** run for the touched area.
- **Before landing any slice:** `npm.cmd run verify` **and**
  `npm.cmd run mesh:changed -- --since origin/main --fail-on-blocker`. Editing
  `modelPolicy.ts` / `subscriptionBudget.ts` drifts the mesh content-hash ratchet
  (bind-point ①); regenerate the snapshot (`npm.cmd run mesh:snapshot:regen`) only after
  confirming the change does not invalidate the referenced nodes' guidance.

## Slice table (dependency-ordered)

| Slice | Risk | What | File(s) | Depends on |
|---|---|---|---|---|
| **S0** | low | Fix lane-selection bug — risk-priority tiebreak on multi-match | `modelPolicy.ts` | — |
| **S1** | low | Tier catalogs + `costWeight` | `subscriptionBudget.ts` | — |
| **S2** | med | `RouteTarget {provider, tierId}` + tier-aware selection | `modelPolicy.ts`, `cliWorkerCapture.ts` | S1 |
| **S3** | low | `reasoningEffort` field on `SupervisorRoutingDecision` | `modelPolicy.ts` | S0 |
| **S4** | med | Dual-window budget + weighted consumption | `subscriptionBudget.ts` | S1 |
| **S5** | med | Reset-tapered reserve + eligibility | `routingGuards.ts`, `modelPolicy.ts` | S4 |
| **S6** | med | Rate-limit refresh signal (429/quota → which window) | `cliWorker.ts`, `subscriptionBudget.ts` | S4 |
| **S7** | high | `FallbackChainStep` schema + cross-pool spill | `fallbackChains.ts`, `modelPolicy.ts` | S2 |
| **S8** | high | Load-aware balance + sticky | `modelPolicy.ts` | S4, S5, S7 |
| **S9** | med | Complexity-gate for review (new `reviewComplexity.ts`) | new file | S2, S3 |

### Landing waves
- **W1 = S0 + S1** — safe to land now (S0 bugfix, S1 additive data). **This document's
  Wave 1 is implemented.**
- **W2 = S2, S3, S4** — route target, effort field, dual-window budget.
- **W3 = S5, S6** — tapered reserve + eligibility, rate-limit window detection.
- **W4 = S7, S8, S9** — cross-pool spill, load-aware balance + sticky, complexity gate.

---

## Slice packets

### S0 (low) — fix lane-selection bug · `modelPolicy.ts`
**Problem.** `selectTaskLanes` filters `reasoningTaskLanePolicies` in declaration order and
callers take `matches[0]`. So `"audit"` (a signal on **both** `deterministic_verification`
and `architecture_security_review`) resolves to `deterministic_verification` because it is
declared first — the **riskier** review lane is silently lost on multi-match.
**Change (additive).** Add a `LANE_SELECTION_PRIORITY` risk-priority ordering and a
tiebreak inside `selectTaskLanes` so that on a **multi-match** the riskier lane wins
(e.g. `"security audit"` → `architecture_security_review`, not
`deterministic_verification`). **Single-match behavior is unchanged.**
**Gate.** `typecheck` + a lane-priority case in `routing-guards.test.ts`.

### S1 (low) — tier catalogs + `costWeight` · `subscriptionBudget.ts`
**Change (additive).** Add `costWeight: number` to `ProviderTierSpec`. Create
`anthropicKnownTiers` and `openaiKnownTiers` mirroring the `geminiKnownTiers` shape, with
**reconstructed placeholder** weights (flagship 1.0, cheaper < 1.0), **all**
`verifiedLocally: false`. Add `costWeight` to the existing `geminiKnownTiers` entries too.
`ProviderTierSpec` is constructed in ~2 places (`geminiKnownTiers` + the test fixture in
`routing-guards.test.ts`) — update both.
**`costWeight` semantics.** A **relative pool-draw proxy**, not a per-token API-credit
figure (keeps [[subscription_worker_boundary]] intact).
**Gate.** `typecheck` + new `tier-catalog.test.ts` (catalogs exported; every weight
∈ (0,1]; each pool's flagship weight === 1.0).

### S2 (med) — `RouteTarget {provider, tierId}` + tier-aware selection · `modelPolicy.ts`, `cliWorkerCapture.ts` · dep S1
Introduce a `RouteTarget = { provider, tierId }` so a routing decision names a **tier**,
not just a provider, and make selection tier-aware (reads S1 catalogs). Additive:
`assignedProvider` stays; `assignedTierId` is already present and gets populated from the
chosen `RouteTarget`. Wire `cliWorkerCapture.ts` to carry the tier through capture.
**Gate.** `typecheck` + targeted vitest on tier-aware selection.

### S3 (low) — `reasoningEffort` on `SupervisorRoutingDecision` · `modelPolicy.ts` · dep S0
Add an optional `reasoningEffort` field (e.g. `"low" | "standard" | "high"`) to
`SupervisorRoutingDecision`, derived from the (S0-corrected) lane + task signals. Additive;
existing decisions default to the current effort. Feeds the S9 complexity gate.
**Gate.** `typecheck` + a decision-shape case.

### S4 (med) — dual-window budget + weighted consumption · `subscriptionBudget.ts` · dep S1
Replace the single `activeTierRateLimitState` reader path with
`windows: { short, long }`, each `{ capacity, consumed, resetsAt, reserveSchedule }`
(additive: keep `activeTierRateLimitState` until readers migrate).
`aggregateCliCallTelemetryIntoBudget` adds the S1 `costWeight`-weighted draw to **both**
windows. `remaining(window) = capacity − consumed`; effective remaining = `min(short,long)`.
**Capacities are owner-configurable constants, `verifiedLocally:false`, never invented.**
**Gate.** `typecheck` + budget-math vitest (weight hits both windows; min() binds).

### S5 (med) — reset-tapered reserve + eligibility · `routingGuards.ts`, `modelPolicy.ts` · dep S4
Implement `reserve = min(providerBase, timeTaper)` per-window from injected `now` +
`resetsAt` (weekly taper 2d→17% / 1d→5% / reset→0; short taper 1h→0). Eligibility: a pool
is usable only when **both** windows have `remaining ≥ (weighted draw + reserve)`. Pure
functions, `now` injected.
**Gate.** `typecheck` + the ADR's worked-check table as vitest cases (Anthropic 3d→30% /
1.5d→17% / 0.5d→5%; OpenAI 1.5d→15% / 0.5d→5%; Anthropic 5h@40min→0%).

### S6 (med) — rate-limit refresh signal · `cliWorker.ts`, `subscriptionBudget.ts` · dep S4
From a 429 / quota signal, **detect which window was hit** (short vs long) and set that
window's state + `resetsAt`. Orthogonal to the circuit breaker (hard failures stay in the
breaker; a quota hit is a window state, not a breaker trip).
**Gate.** `typecheck` + a refresh-signal vitest (short-hit vs long-hit set the right window).

### S7 (high) — `FallbackChainStep` schema + cross-pool spill · `fallbackChains.ts`, `modelPolicy.ts` · dep S2
Extend `FallbackChainStep` for cross-pool spill (spill target tier, transient vs
persistent). Implement the ADR spill: binds-5h → TRANSIENT (spill + `recovers at` +
sticky-resume, don't replan the week); binds-weekly → PERSISTENT (replan onto other pools /
cheaper tiers / local). Preserve `isSelfFallbackRoute` (no self-spill) and the
checkpoint→owner terminal.
**Gate.** `typecheck` + spill-direction vitest for both window-bind cases.

### S8 (high) — load-aware balance + sticky · `modelPolicy.ts` · dep S4, S5, S7
Implement the substitutable-path tiebreaks: cheapest eligible tier by `costWeight` →
lowest pool utilization (balance) → sticky (warm-cache session for the task chain). Uses
S4 windows, S5 eligibility, S7 spill. Pure, `now` injected.
**Gate.** `typecheck` + the ADR's load worked-example as a vitest case (Anthropic 75% used
→ substitutable Sonnet review spills; critical architecture still reaches Opus in reserve).

### S9 (med) — complexity gate for review · new `reviewComplexity.ts` · dep S2, S3
New pure module: governance / auth / data paths **OR** diff > ~150 lines → **Opus**;
AST / contract / schema changes → **Codex**; else → **Sonnet / flash**. This gate is what
produces Opus's "≥50% of review" as a **result**, not a quota. Thresholds are **tunables**
defaulted to the spec values, clearly marked.
**Gate.** `typecheck` + gate-classification vitest across the three buckets.
