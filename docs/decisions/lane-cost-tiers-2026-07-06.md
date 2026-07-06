# ADR - Lane cost tiers

**Status:** ACCEPTED (owner, 2026-07-06).

## Context

The owner ratified a three-tier lane cost model on 2026-07-06 to refine the former binary
`EXPENSIVE_LANES` split. The decision is informed by measured Antigravity quota facts from the
owner's quota page and follow-up live verification smokes.

The owner ran live agy verification smokes on 2026-07-06 around 17:54:
`agy --print "Reply with exactly: OK" --sandbox --model <slug>`. Each verified slug returned exactly
`OK`.

Verified dispatch targets:

- `gemini-3.5-flash-medium`
- `gpt-oss-120b`
- `claude-4.6-sonnet`

This follow-up wiring slice adds the verified Claude/GPT pool targets as MID lanes for `idea` and
`review`, and pins governed agy dispatch to the verified flash-medium default when no explicit model
is supplied. The idea-mode wall and the build-mode upstream-draft gate stay exactly as-is.

## Decision

Ordering doctrine: FREE lanes are always tried first, then MID, then EXPENSIVE. This is supervisor
doctrine + input for future routing activation, not a new dispatch gate in this slice.

Tier assignment of lanes:

| Tier | Lanes |
|---|---|
| free | `deterministic_tools`, `qwen_local`, `openrouter_qwen3_code_draft`, `openrouter_nemotron_planning` |
| mid | `agy_fast`, `agy_deep`, `agy_gpt_oss_120b`, `agy_claude_sonnet_4_6` |
| expensive | `claude_supervisor`, `codex_cli` |

`agy_deep` is reclassified as decidedly NOT cheap: Antigravity quota is consumed proportionally to
token cost, and Gemini 3.1 Pro burns the shared Gemini weekly quota far faster than 3.5 Flash.

## agy Defaults

Owner decision:

| Lane | Default posture |
|---|---|
| `agy_fast` | Gemini 3.5 Flash MEDIUM as the routine default (quota saver) |
| `agy_fast` quality escalation | Gemini 3.5 Flash HIGH, explicit quality-escalation variant (owner: "kvalita") |
| `agy_deep` | Gemini 3.1 Pro High, used only with explicit justification |

Verified agy CLI `--model` pins:

| Lane or posture | Verified slug |
|---|---|
| `agy_fast` routine default | `gemini-3.5-flash-medium` |
| `agy_fast` quality escalation | `gemini-3.5-flash-high` |
| `agy_deep` explicit escalation | `gemini-3.1-pro-high` |
| `agy_gpt_oss_120b` | `gpt-oss-120b` |
| `agy_claude_sonnet_4_6` | `claude-4.6-sonnet` |

Governed dispatch now closes the prior determinism gap: when an `agy_cli` handoff has no explicit
model, the governed path injects `gemini-3.5-flash-medium`. Explicit models still win, including
flash-high quality escalation, pro-high deep escalation, and the two Claude/GPT pool MID lanes.
Direct `runCliWorker` callers remain unchanged.

## Measured Quota Structure

Measured Antigravity quota structure (owner's screenshots, 2026-07-06): TWO separate quota groups,
each with a weekly limit + a 5-hour limit, consumed proportionally to token cost:

1. "Gemini Models" (at 95% weekly remaining).
2. "Claude and GPT models" (100% unused).

The second group exposes Claude Sonnet 4.6 (Thinking), Claude Opus 4.6 (Thinking), and GPT-OSS 120B
(Medium) inside the SAME subscription, capacity that consumes neither the Gemini quota nor the
OpenRouter free-tier daily budget.

Follow-up measurement after live smokes:

- One flash-medium mini call burned about 1% of the shared Gemini 5-hour window.
- The Claude+GPT pool did not move for the Sonnet 4.6 and GPT-OSS 120B mini calls.

## Wired MID Lanes

These are verified dispatch targets and wired as MID lanes for advisory `idea` and `review` modes.
`build` and `spec` exposure awaits tiered eval records.

| Lane | Status |
|---|---|
| `agy_gpt_oss_120b` | Wired MID lane via agy; verified live smoke 2026-07-06; allowed in `idea` + `review`; `build`/`spec` await tiered evals |
| `agy_claude_sonnet_4_6` | Wired MID lane via agy; verified live smoke 2026-07-06; allowed in `idea` + `review`; `build`/`spec` await tiered evals |

Anti-footgun rule: never route through unverified models.

## Spend policy (owner-ratified 2026-07-06)

The owner topped up the OpenRouter account with $20 USD. With an account balance >= $10, the
OpenRouter `:free` daily request limit moves from 50/day to 1000/day; re-verify this balance-backed
limit on key rotation or balance drain.

The OpenRouter lane has a hard maximum spend cap of $1 USD/day, enforced before sends from a
persistent local spend ledger. The `:free` allowlist and zero-cost assertion remain unchanged: this
cap is a safety ceiling, not paid-tier opt-in. Paid models require their own ADR and allowlist change.

## Candidate MID Lanes

These are still pending verification and/or evals.

| Candidate | Verification status |
|---|---|
| `agy_opus_4_6` | Candidate mid-high advisory reserve; pending live dispatch verification smoke and tiered eval records |
| `gpt-5.3-codex` via `codex -m` | Candidate MID lane; cheap to verify; pending live dispatch verification smoke and tiered eval records |
| `gpt-5.4-mini` | KNOWN NOT WORKING in codex CLI (verified 2026-07-04) |
| `sonnet-5` / `haiku-4.5` | No spawned-Claude lane in the control plane; Claude is the supervisor session, never a spawned lane |

A candidate becomes a lane only after:

1. A live dispatch verification smoke.
2. Tiered eval records.

Anti-footgun rule: never route through unverified models.

## Consequences

Because quota burn is token-cost-proportional, `telemetry:summary`'s `tokens_by_provider` is a usable
proxy for Antigravity quota burn.

Governed agy dispatch no longer inherits the Antigravity app-selected model when no model is supplied.
It pins `gemini-3.5-flash-medium` on the governed path. `LANE_COST_TIERS` remains structure plus future
routing input; current enforcement stays at the existing cost-blind gates.

## Deferred / Follow-ups

- Run tiered eval records before exposing `agy_gpt_oss_120b` or `agy_claude_sonnet_4_6` to `build` or
  `spec`.
- Verify and evaluate the still-pending candidates (`agy_opus_4_6`, `gpt-5.3-codex`, `sonnet-5` /
  `haiku-4.5`) before any lane promotion.
- Evaluate `antigravity-usage quota` as a programmatic quota reader and candidate input for
  `telemetry:summary`, so telemetry can use real burn instead of only the token proxy.
