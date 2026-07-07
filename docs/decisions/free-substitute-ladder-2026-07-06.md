# ADR - OpenRouter free substitute ladder

**Status:** ACCEPTED (owner, 2026-07-06) for the FREE ladder and policy. Paid ultra-cheap shortlist is
PROPOSED pending its own ADR and max_price change.

## Context

Owner-directed 3-provider brainstorming on 2026-07-06 combined Fable live measurement of 22 endpoints,
GPT live catalog review, and Gemini policy-only review. The ratified result is a substitute policy for
OpenRouter free lanes, not an automatic dispatch expansion.

Measured facts on 2026-07-06:

- `qwen/qwen3-coder:free` has one Venice endpoint with `uptime_last_1d=0`; it is down.
- Four Venice-only free models degraded simultaneously, establishing provider correlation risk.
- `nvidia/nemotron-3-ultra-550b-a55b:free` was healthy at about 99%.
- `google/gemma-4-31b-it:free` is the only multi-provider free lane found in the live catalog.
- No DeepSeek `:free` model exists in the live catalog. A `deepseek-r1:free` suggestion came from stale
  model memory and was rejected.

The public health signal requires no auth and no budget cost:
`GET https://openrouter.ai/api/v1/models/{id}/endpoints`, returning `endpoints[]` fields such as
`name`, `provider_name`, `status`, `uptime_last_5m`, `uptime_last_30m`, `uptime_last_1d`,
`latency_last_30m`, and `throughput_last_30m`.

## Free Ladders

Correlation rule: the first fallback should be on a different provider than the failed primary wherever
possible. The ladder is over `(model, provider)` pairs, not only model ids.

### Code Draft

| Order | Model | Provider | Quality | Evidence | Notes |
|---:|---|---|---|---|---|
| 1 | `poolside/laguna-m.1:free` | Poolside | pending_eval | 72.5% SWE-bench Verified - vendor-run, Poolside blog | Poolside free tier may train on inputs; packet-only redaction required; max_out 32K |
| 2 | `poolside/laguna-xs-2.1:free` | Poolside | pending_eval | 70.9% SWE-V - vendor-run, Poolside blog | Poolside free tier may train on inputs; packet-only redaction required |
| 3 | `tencent/hy3:free` | Novita | pending_eval | 74.4% SWE-V - Tencent claim, UNVERIFIED independently | De-correlated provider |
| 4 | `cohere/north-mini-code:free` | Cohere | pending_eval | 67.6% SWE-V pass@1 |  |

### Planning

| Order | Model | Provider | Quality | Evidence | Notes |
|---:|---|---|---|---|---|
| 1 | `tencent/hy3:free` | Novita | pending_eval | 74.4% SWE-V - Tencent claim, UNVERIFIED independently | De-correlated vs Nvidia primary |
| 2 | `nvidia/nemotron-3-super-120b-a12b:free` | Nvidia | pending_eval | AIME25 90.2 - NVIDIA card | Provider-correlated with the nemotron-ultra primary |
| 3 | `google/gemma-4-31b-it:free` | OpenInference | pending_eval | AA Intelligence Index 29 | Only multi-provider free lane - most outage-resilient |
| 4 | `openai/gpt-oss-120b:free` | OpenInference | pending_eval | UNVERIFIED for planning; below_floor for code_draft | Do not list under code_draft |

## Selection Policy

USABLE predicate:

- `status !== null`
- `status >= 0`
- `uptime_last_30m !== null`
- `uptime_last_30m >= 95`
- `uptime_last_5m !== null`

Grey endpoints are down for routing: null short-window uptimes with nonzero 1d uptime are treated as
DOWN. Measured negative statuses such as `-2` and `-5` are DOWN.

Hysteresis:

- Mark a lane down only after two consecutive probe failures or predicate failures.
- Mark a lane up only after two healthy probes at least 10 minutes apart.
- Permit at most one ladder move per 15 minutes per role.
- Never switch mid-task. Pin the selected lane per packet.

Monitoring cadence:

- Queue non-empty: probe the current and next candidate roughly every 5 minutes. Probes are free.
- Queue empty: probe only at dispatch time.

Quality floor:

- A genuinely weak model is worse than no free tier.
- `below_floor` is never selectable.
- If no floor-passing free lane is usable, fail over to paid subscription lanes such as codex or Claude.
- Do not force a below-floor model to preserve "free" routing.

Candidate admission:

1. Supervised smoke.
2. Tiered eval record.
3. Explicit owner-gated allowlist plus response-model-family entry for the candidate.

Only after those gates may a candidate become dispatchable and flip to `eval_passed`.

## Paid Ultra-Cheap Shortlist

This section is PROPOSED. It needs a separate owner ADR and `max_price` change before implementation.

| Candidate | Price | Evidence | Notes |
|---|---:|---|---|
| `minimax/minimax-m2.5` | $0.12 input / $0.48 output | 80.2% SWE-V vendor-run | 16 providers |
| `deepseek/deepseek-v4-flash` | $0.09 input / $0.18 output | Pending independent eval | About $0.23 per 2h session; dual-role; 1M context |
| `z-ai/glm-4.7-flash` | $0.06 input / $0.40 output | Pending independent eval | Candidate reserve |

Ceiling math: $1 per at least 2 hours at worst-case 2M mixed tokens equals $0.50/Mtok blended.

Measured note: no DeepSeek `:free` exists in the live catalog. The stale `deepseek-r1:free` suggestion was
rejected.

## Risks

- Provider correlation can take out several "different" free models at once when they share a serving
  provider.
- Every candidate needs response-model family validation before dispatch; provider model echoes may drift.
- Prompt-format drift can make nominally strong models fail the actual Autopilot packet contract.
- Flapping burns attempt budget, so hysteresis is mandatory.
- Poolside free tier may train on inputs. Mitigation: packet-only redaction is required, and this risk must
  be recorded in candidate eval/admission evidence.

## Consequences

The new health reader is advisory only. It can recommend a primary, a catalog candidate that still requires
supervised smoke plus eval before dispatch, or a paid subscription fallback. It must not mutate dispatch
state, send an API key, write files, or auto-switch during a task.
