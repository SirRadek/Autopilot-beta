# ADR - Lane cost tiers

**Status:** ACCEPTED (owner, 2026-07-06).

## Context

The owner ratified a three-tier lane cost model on 2026-07-06 to refine the former binary
`EXPENSIVE_LANES` split. The decision is informed by measured Antigravity quota facts from the
owner's quota page.

This record encodes structure and decision content only. It does not change dispatch behavior, add
lanes, or pin unverified model slugs into live dispatch. The idea-mode wall and the build-mode
upstream-draft gate stay exactly as-is.

## Decision

Ordering doctrine: FREE lanes are always tried first, then MID ("mezilevné"), then EXPENSIVE. This is
supervisor doctrine + input for future routing activation, not a new dispatch gate in this slice.

Tier assignment of EXISTING lanes:

| Tier | Existing lanes |
|---|---|
| free | `deterministic_tools`, `qwen_local`, `openrouter_qwen3_code_draft`, `openrouter_nemotron_planning` |
| mid | `agy_fast`, `agy_deep` |
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

The concrete agy CLI `--model` slugs are NOT yet verified. The UI names are "Gemini 3.5 Flash
(Medium/High)" and "Gemini 3.1 Pro (High)".

Today `buildAgyArgs` passes `--model` only when explicitly provided. Otherwise the lane inherits
whatever the Antigravity APP has selected. This is a determinism gap. Wiring the pinned defaults into
dispatch happens in a FOLLOW-UP slice after the owner verifies the slugs with live smokes.

## Measured Quota Structure

Measured Antigravity quota structure (owner's screenshots, 2026-07-06): TWO separate quota groups,
each with a weekly limit + a 5-hour limit, consumed proportionally to token cost:

1. "Gemini Models" (at 95% weekly remaining).
2. "Claude and GPT models" (100% — unused).

The second group exposes Claude Sonnet 4.6 (Thinking), Claude Opus 4.6 (Thinking), and GPT-OSS 120B
(Medium) inside the SAME subscription — capacity that consumes neither the Gemini quota nor the
OpenRouter free-tier daily budget.

## Candidate MID Lanes

These are pending verification + evals and are NOT lanes yet.

| Candidate | Verification status |
|---|---|
| `agy_gpt_oss_120b` | Candidate MID lane, separate-pool via agy; pending live dispatch verification smoke and tiered eval records |
| `agy_claude_sonnet_4_6` | Candidate MID lane, separate-pool via agy; pending live dispatch verification smoke and tiered eval records |
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

No dispatch behavior changes in this slice. `LANE_COST_TIERS` is structure plus future routing input;
current enforcement stays at the existing cost-blind gates.

## Deferred / Follow-ups

- Verify concrete agy CLI `--model` slugs for Gemini 3.5 Flash Medium, Gemini 3.5 Flash High, and
  Gemini 3.1 Pro High with live smokes.
- Pin verified agy defaults into dispatch after slug verification.
- Run live dispatch verification smokes and create tiered eval records before promoting any candidate
  MID lane.
