# Vendor routing policy — autopilot-beta v2 (shared-pool floor+spill, dual-window)

**Date:** 2026-07-03. **Author:** Opus (reconstruction). **Status:** PROPOSED
(advisory; does not supersede v1 until the owner re-ratifies). The ACTIVE operating
posture remains [`vendor-routing-policy-beta.md`](./vendor-routing-policy-beta.md) (v1)
until then. This file refines, it does not replace.

> Owner ratified this direction verbally in-session 2026-07-03; **this file is a
> reconstruction** of lost uncommitted work, and the numeric tunables (cost-weights,
> window capacities, complexity-gate thresholds) **must be re-confirmed** before any
> of them is hardcoded or trusted as verified.

## Honesty preamble (read before trusting any number here)
This ADR was rebuilt from an owner-supplied design spec after the original session's
uncommitted output was lost. Three classes of number appear below and each is marked:

- **Reconstructed cost-weights** — the original *verified* weights were lost. Every
  weight in this document and in `subscriptionBudget.ts` is a **reconstructed
  placeholder** (`verifiedLocally: false`), pattern: flagship = 1.0, cheaper tiers
  < 1.0. Re-verify before anyone treats a weight as a real pool-draw ratio.
- **Window capacities** (5h / weekly) — subscription-specific; owner-configurable
  constants defaulted to the spec values, never invented as verified. Learn them from
  throttle-hits or owner entry; do not hardcode.
- **Complexity-gate thresholds** (e.g. "diff > ~150 lines") — tunables, defaulted to
  the spec value and clearly marked as such.

`costWeight` is a **relative pool-draw proxy** (how much of a pool's shared quota a
tier consumes per unit of work), **not** a per-token API-credit figure. This keeps it
consistent with [[subscription_worker_boundary]] ("Do not treat subscription access
as API credit or per-token budget"): the weight subtracts from a *subscription window*,
not from a metered credit balance.

## Why a v2 (what v1 leaves open)
v1 ([[model_role_taxonomy]] refinement) set the **qualitative** vendor mix: codex as a
standing audit voice with Opus, agy from rare-exception to regular creative voice, with
directional +% targets. It is silent on the **mechanism**: how a per-task router picks a
model under a *shared* per-provider subscription quota, how it protects the expensive
lanes (Opus, GPT-5.5) from cheap bulk work, and how it behaves when a 5-hour burst limit
vs a weekly budget is the binding constraint. v2 supplies that mechanism — a reserve
**floor + spill** over **dual-window** pools — while preserving every v1 role intent and
every existing routing invariant (`assertRoleConstraint`, `isSelfFallbackRoute`, the
verified-tier guard, and the orthogonal circuit breaker).

---

## Part A — role split (refines v1 role table)

The shares below are **results of the routing mechanism, not quotas**. In particular
Opus's "≥50% of review" is what the complexity gate produces when governance / auth /
data / large-diff work is present — it is not a fixed allocation.

| Role | Lane | Engagement vs flat baseline | Self-approval |
|---|---|---|---|
| **Opus (Claude)** | architecture, high-risk final review, orchestration | ≥50% of *review* as a **result** of the complexity gate | never |
| **Codex / GPT-5.5** | bounded implementation + handoff, and the **hardest structural review** | **+30%** engagement | never |
| **agy / Gemini** | brainstorm + copy, **advisory-only**, never a critical lane | **+30%** | never |
| **Sonnet 5** | subagents: first-pass review, bounded orchestration | (new lane) | never |
| **qwen (local)** | last-resort local worker | weight 0 | never |

No self-approval anywhere; this is the standing invariant, unchanged from v1 and enforced
by `assertRoleConstraint` + `isSelfFallbackRoute`.

### Tiers under a per-provider SHARED pool (the owner's quota reality)
Each provider is **one shared pool** across its tiers (the subscription is billed/limited
per provider, not per model). Cost-weights are **reconstructed placeholders**
(`verifiedLocally: false`):

| Pool | Tier | Role | costWeight (placeholder) |
|---|---|---|---|
| **Anthropic** | Opus | flagship — architecture / high-risk review / orchestration | **1.0** |
| | Sonnet 5 | cheaper — subagents, first-pass review | 0.4 |
| **OpenAI** | GPT-5.5 | flagship — high-risk handoff, hardest structural review | **1.0** |
| | GPT-5.4 | cheaper | 0.6 |
| | mini | cheaper | 0.3 |
| | codex-spark | cheaper — spill catch | 0.2 |
| **Google** | gemini-pro | advisory-only | 0.7 |
| | gemini-flash | advisory-only — spill catch | 0.2 |
| | gemini-auto | advisory-only | 0.5 |
| **qwen local** | qwen | last-resort | **0** |

> The exact relative values above are reconstructed guesses that satisfy the *shape*
> (flagship 1.0, cheaper < 1.0, qwen 0). **Re-verify before hardcoding.**

---

## Part B — reserve floor + spill

Floor+spill **is** the "mutual substitutability" — it is one mechanism over shared pools,
**not** two machines. Each pool holds a **critical reserve** that only non-substitutable
work may touch; cheap bulk work may only draw a pool up to its bulk ceiling, and overflow
self-spills to the next-cheapest eligible pool/tier.

| Pool | Reserve (for) | Bulk may draw to | Spill target |
|---|---|---|---|
| **Anthropic** | **30%** → Opus (architecture, high-risk final review, orchestration) | 70% utilization | — |
| **OpenAI** | **15%** → GPT-5.5 (high-risk handoff, hardest structural review) | 85% | **yes** — 5.4 / mini / codex-spark |
| **Google** | **0%** (advisory-only, never critical) | 100% | **yes** — flash, only where trust allows |
| **qwen local** | **0%** | 100% | **yes** — last catch |

Reserve percentages are **subscription tunables** defaulted to the spec values above.

### Per-task routing algorithm
1. **Classify** the task: critical (non-substitutable) vs substitutable; determine the
   required trust tier + effort.
2. **Critical** → its own model (Opus / GPT-5.5 / …). It **MAY draw into the reserve** —
   that is exactly what the reserve is for.
3. **Substitutable** → among pools **above their floor**, pick, in order:
   1. **cheapest** model (shape-aware `costWeight`) that meets the required effort,
   2. tiebreak: **lowest pool utilization** (load balance),
   3. tiebreak: **sticky** — reuse the warm-cache session for this task chain.
4. **No pool above its floor** → **spill**: qwen local / deterministic, else **checkpoint
   → owner**.

**Worked example (the load case).** Anthropic pool is 75% used. A *substitutable*
first-pass review wants Sonnet, but bulk may only reach 70% → 75% > 70% → Sonnet is **not
eligible** → the review **spills** to OpenAI codex-spark / qwen. Meanwhile a *critical*
architecture task still reaches **Opus inside the 30% reserve**. Cheap bulk never eats
Opus's reserve, and the overflow self-spills — that self-spill *is* the substitutability.

---

## Dual-window pools (5h + weekly — the real subscription structure)

Each pool holds **two overlapping windows**, each with its own capacity **and** its own
consumption (in cost-weighted units — the weight subtracts from **both** windows at once):

| Window | Reset | Guards against |
|---|---|---|
| **short** | rolling ~5h | a peak burst right now |
| **long** | rolling ~7 days (weekly) | the weekly budget |

- `remaining(window) = capacity − consumed`.
- **effective pool remaining = min(short, long)** — the router **binds the tighter** window.
- **Eligibility:** a task may use a pool only when **BOTH** windows have
  `remaining ≥ (estimated weighted draw + reserve)`.
- The **reserve floor applies per-window**: Opus's 30% is held in **both** the short and
  the long window independently.

### Spill behavior depends on which window binds
- **Binds the 5h (short) window → TRANSIENT.** Spill *temporarily*, mark the pool
  "recovers at `<reset>`", and **sticky-resume** after the reset. **Do not replan the
  week** — this is a momentary burst, not a budget problem.
- **Binds the weekly (long) window → PERSISTENT.** Treat the pool as **limited for the
  rest of the week** and **replan the mix** onto other pools / cheaper tiers / local.

Window **capacities are NOT hardcoded** — they are subscription-specific, learned from
throttle-hits or owner-entered under the `verifiedLocally:false` pattern, and may be
provider-specific.

---

## Reset-tapered reserve (anti-hoarding)

Don't hold headroom that is about to refresh anyway. Each window computes its reserve
from its **own** hours-to-reset:

```
reserve = min(providerBase, timeTaper)
```

**Long (weekly) taper:**
- base (Anthropic **30%** / OpenAI **15%**) while > 2 days to reset,
- ≤ 2 days to reset: cap **17%**,
- ≤ 1 day to reset: cap **5%**,
- at reset: **0%**.

**Short (5h) taper:**
- base while > 1h to reset,
- ≤ 1h to reset: **0%** (ignore the limit — it refreshes soon).

A task must pass **each window's reserve separately** (each window uses its own
hours-to-reset).

**Worked check (must hold):**
- Anthropic weekly: 3d → **30%**, 1.5d → **17%**, 0.5d → **5%**.
- OpenAI weekly: 1.5d → **15%** (the 17% cap does **not** bind, because base 15% < 17%),
  0.5d → **5%**.
- Anthropic short 5h at 40 min to reset → **0%** (the 5h limit is ignored; the **weekly**
  window still applies independently).

All taper break-points (2d/17%, 1d/5%) and the 5h/1h cutoff are **tunables** defaulted to
the spec values.

---

## Code-impact notes (extends the prior "codex P5" block)
These describe the *target* shape for the implementation plan; they are additive and
preserve every existing invariant.

- **`SubscriptionSessionBudget` / `ProviderTierSpec`:** replace the single
  `activeTierRateLimitState` with `windows: { short, long }`, each carrying
  `{ capacity, consumed, resetsAt, reserveSchedule }`. (Additive first — the existing
  `activeTierRateLimitState` stays until S4 migrates readers.)
- **`aggregateCliCallTelemetryIntoBudget`:** add the weighted draw to **both** windows.
- **Budget-refresh:** from a 429 / limit signal, **detect which window was hit** and set
  that window's state.
- **Routing eligibility + floor read `min(short, long)`.**
- **Circuit breaker stays ORTHOGONAL** (it fires on hard failures — empty output, invalid
  JSON, timeout) and is **untouched** by windowing.
- **Window capacities are NOT hardcoded** — subscription-specific; learn from
  throttle-hits or owner-entered (`verifiedLocally:false` pattern). Windows may be
  provider-specific.

## Keeping it honest (anti-folklore, carried from v1)
Redacted context to all external vendors; real CLIs only (no roleplay); **model output is
advisory until Opus verifies it against source / tests**; no secrets / raw-logs to vendors
or commits. Every phase records a one-line vendor-engagement log; agy MISSING is reported,
never faked ([[feedback_no_vendor_roleplay]]).

## Rollout
Ratification-gated. The mechanism lands in **10 dependency-ordered slices** across 4 waves
(see [`vendor-routing-policy-beta-v2-implementation-plan.md`](./vendor-routing-policy-beta-v2-implementation-plan.md)).
**Wave 1 (S0 + S1)** is safe to land now: S0 is a lane-selection bugfix; S1 is additive
tier-catalog data with reconstructed placeholder weights. Waves 2–4 (dual-window budget,
tapered reserve, cross-pool spill, load-aware balance, complexity gate) land only after
owner re-ratification of this ADR and re-confirmation of the numeric tunables.

## Reconstructed / placeholder values the owner MUST re-verify
1. **All cost-weights** (Anthropic Opus 1.0 / Sonnet 0.4; OpenAI GPT-5.5 1.0 / 5.4 0.6 /
   mini 0.3 / codex-spark 0.2; Google pro 0.7 / auto 0.5 / flash 0.2; qwen 0) —
   reconstructed placeholders, `verifiedLocally: false`.
2. **Reserve floors** (Anthropic 30%, OpenAI 15%, Google 0%, qwen 0%) — spec defaults.
3. **Bulk ceilings** (Anthropic 70%, OpenAI 85%, Google/qwen 100%) — spec defaults.
4. **Window capacities** (short 5h, long ~7d) and the actual per-pool capacity numbers —
   learned/owner-entered, never invented.
5. **Reset-taper break-points** (weekly: 2d→17%, 1d→5%, reset→0%; short: 1h→0%) — spec
   defaults.
6. **Complexity-gate thresholds** (governance/auth/data paths → Opus; diff > ~150 lines →
   Opus; AST/contract/schema → Codex; else Sonnet/flash) — spec defaults (land in S9).
