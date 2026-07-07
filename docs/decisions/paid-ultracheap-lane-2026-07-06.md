# ADR - Paid ultra-cheap worker lane (candidates + posture)

**Status:** ACCEPTED (owner, 2026-07-06) for the CANDIDATE set and the usage posture. No paid model
is dispatchable yet — each must still pass the full admission pipeline (supervised smoke -> tiered
eval record -> owner-gated allowlist entry), identical to the free-substitute-ladder process.

## Context

The free-substitute-ladder ADR left the paid shortlist PROPOSED. The owner budget line is
**<= $1 USD for at least ~2 hours of worker activity** (worst-case ~2M mixed tokens -> ceiling
$0.50/Mtok blended at a 3:1 in:out mix). A persistent spend ledger with a HARD **$1 USD/day cap**
(pre-send refusal `openrouter_spend_budget_exhausted`) is already enforced in the lane. Today the
`:free` allowlist is additionally pinned by `provider.max_price = {0,0,0}` and a zero-cost assert.

## Decision 1 — admitted CANDIDATES (owner-ratified 2026-07-06)

| Candidate | $/Mtok in/out | Role | Rationale |
|---|---|---|---|
| `minimax/minimax-m2.5` | $0.12 / $0.48 | code_draft | 80.2% SWE-bench Verified (vendor-run) + **16 providers** — the strongest cheap code model with real provider redundancy (~$0.42 per worst-case 2h session) |
| `deepseek/deepseek-v4-flash` | $0.09 / $0.18 | dual-role (code_draft + planning) | best value (~$0.23 per 2h session), 1M context; NOTE: no deepseek `:free` exists (measured 2026-07-06) — this is the only DeepSeek path |

`z-ai/glm-4.7-flash` stays a PROPOSED backup (not admitted to the pipeline yet). Measured-dead
candidates for completeness: `gpt-5.3-codex` and `gpt-5.4-mini` (codex CLI on a ChatGPT account
rejects both).

## Decision 2 — usage posture (owner-ratified 2026-07-06): STRICT FREE-FIRST

A paid model may be selected by the supervisor **only when NO floor-passing free lane for the role
is USABLE** (per `npm run openrouter:health`). Free lanes are always tried first; a paid model is
the fallback of last resort BELOW the owner's paid subscription lanes decision point, never a
convenience choice. No auto-switching; explicit supervisor selection on the handoff only.

## Guard design for paid requests (to implement WITH the first paid allowlist entry, not before)

- The `:free` zero-cost assert and `max_price={0,0,0}` pinning stay EXACTLY as-is for free models.
- A paid request instead pins `provider.max_price` to the model's exact LIST PRICE (belt against
  provider routing to pricier endpoints) and `allow_fallbacks: false` stays.
- The response `usage.cost` is LEDGERED for every paid call (the ledger already exists); the
  $1/day cap binds and refuses pre-send when reached.
- Per-candidate response-model family validation entry (same dated-canonical + variant rules,
  adjusted per model).
- Attempt budgets (20/min) apply unchanged; paid calls also consume the daily request budget.

## Admission status

Both candidates: **pipeline-admitted, dispatch-blocked** — awaiting gate 1 (supervised smoke with
the paid guard design above) + gate 2 (tiered eval record) + gate 3 (owner-gated allowlist slice).
Until then `OPENROUTER_MODE_ALLOWED_MODELS` contains no paid entry and `max_price` stays zero.
