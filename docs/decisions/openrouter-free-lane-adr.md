# ADR: OpenRouter free-model WORKER lane — staged adoption

**Date:** 2026-07-04 · **Status:** PROPOSED (v2 — rewritten to the owner's worker-lane intent,
2026-07-04; v1 misread the intent as comparison-only advisory). **Author:** Claude (Fable 5), from
a 10-lane brainstorm (6 delivered) + the owner's corrective architecture directive.

## Context

The owner directs that OpenRouter free (`:free`) models become a **worker lane**: a production
draft-tier workhorse — **not a new source of truth and not a default supervisor**. Premium models
(Claude, codex, Gemini) keep supervision, prompt review, security, testing, and critical parts.

This is still architecturally novel: the control plane has no direct HTTP client today (verified:
zero `fetch|axios|https.request` hits in `src/` + `scripts/`); all vendor access goes through
spawned CLIs. The OpenRouter client is therefore a **named narrow exception**: one module, one
host (`https://openrouter.ai`), one endpoint (`/api/v1/chat/completions`). OpenRouter's
one-endpoint-for-many-models shape silently recreates the forbidden multi-provider gateway unless
the bans below are enforced in code.

## Decision 1 — models and roles (owner-verified 2026-07-04)

- **`qwen/qwen3-coder:free`** (price 0, ~1M context; agentic coding model per OpenRouter model
  page) → **main coding worker**: code drafts, test drafts, refactor drafts.
- **`nvidia/nemotron-3-ultra-550b-a55b:free`** (price 0, 1M context) → **planning worker**:
  brainstorming, planning, design reasoning, multi-agent critique, long-context research.
- **Llama 4 Scout — REJECTED**: the `:free` variant is unverified in the Models API (only paid
  found), and the creative mandate stays with the agy/Gemini lane.
- Worker output is a draft by definition. It never approves, never lands unreviewed, and is never
  treated as source of truth (`assertRoleConstraint` already enforces this for non-local
  providers). Trust tier: `bounded_draft` (the `qwen_local` analog) — NOT comparison_only: this
  lane does real production draft work at volume.

## Decision 2 — the governed workflow (owner architecture)

1. **Claude Fable 5 ultracode (Opus fallback) — supervisor**: scope, orchestration, prompt
   packet, architecture, critical review. Does not routinely implement.
2. **Codex GPT-5.5 xhigh — prompt gate**: checks every packet BEFORE it reaches a free worker:
   redaction, allowed files, output schema, stop conditions, expected output.
3. **OpenRouter free worker lane executes**: qwen3 coding drafts / nemotron planning + reasoning.
4. **Codex reviews + tests the worker output.** Small fix → codex. Bigger failure → Claude +
   codex investigate what failed: prompt, model, schema, hallucination, or bad context.
5. **Design loop**: Nemotron + Gemini design brainstorm → Claude synthesis → GPT critique →
   owner approval → Figma design (per the Figma read-only ADR) → iterate. Free models propose;
   the owner approves.
6. **Post-approval build**: Claude writes the dev plan, codex validates it, qwen3 drafts, codex
   tests, Claude reviews the critical parts.

## Decision 3 — staged adoption (unchanged from v1)

1. **Stage 0 (policy-only, deepseek precedent):** `ReasoningProviderId` `"openrouter_free"` in
   `modelPolicy.ts`, `advisoryTrustTier: "bounded_draft"`, worker-lane task mapping. No network
   code.
2. **Stage 1 (client):** **in-process** `captureOpenRouterResponse()` inside the `runCliWorker`
   harness — not a spawned CLI. Load-bearing reason: `buildVendorEnv()` deliberately strips
   `*_API_KEY` from every child environment; an in-process fetch keeps the key from ever crossing
   a process boundary and leaves the scrubber untouched. Lock, telemetry JSONL, evidence records,
   alerts inherited. (Sibling worker lane considered and rejected on exactly this argument.)
3. The C1 dispatch-mode pattern (commit f70ec12: `codexMode` + hard `taskPacketRef` guard) is the
   template: the OpenRouter lane gets an analogous `openrouterMode` ("qwen3_code_draft" |
   "nemotron_planning") with the same **hard packet-ref guard** — no packet reference, no call.

## Decision 4 — chokepoint mechanics (code-enforced, not convention)

- **Explicit model IDs only** — compiled-in allowlist of the two exact `:free` slugs above.
  **Never** the `openrouter/free` random auto-router for governed workflow. Anything off-list is
  rejected pre-network.
- **Per-call zero-cost assertion** from the response usage; nonzero cost → refuse + alert. Spill
  on exhaustion goes to BLOCKED, never to paid OpenRouter.
- **Key handling**: `OPENROUTER_API_KEY` from `process.env` only (Bearer auth per OpenRouter
  docs); never in the repo, telemetry, evidence, or logs. Kill-switch: missing env → lane reports
  MISSING (like flaky agy; never faked).
- **Redaction (owner guardrail)**: never send free models secrets, credentials, raw logs,
  customer data, or whole private-repo dumps. Code-enforced pre-send scan; free routes are
  assumed to log/train — per-provider data policy (OpenRouter provider-logging + ZDR controls)
  must be checked and recorded as dated evidence before stage 1.
- **Rate budget (owner-verified via OpenRouter pricing)**: free plan **50 requests/day + 20 rpm**;
  with ≥ $10 pay-as-you-go credit **1000 requests/day + 20 rpm** on free models. **Failed attempts
  count into the quota** → the budget/circuit-breaker counts attempts, not successes
  (dual-window: per-minute + per-day).
- **Eval mandatory per output, day one**: every worker output carries an eval score + source
  pointers + test evidence, recorded into `model-output-evals/records/` (this replaces v1's
  "defer qwen3 until evals exist" — the lane itself generates the eval corpus).
- **Exclusions by construction**: `sensitive_private_context`, security-critical review, final
  implementation authority, approval, broad repo dumps.

## Open items

- Re-verify both slugs, limits, and per-provider data policy at stage-1 implementation time with
  dated evidence records (free variants appear and vanish without notice).
- v1-vs-v2 routing integration point resolved after the branch merge (this tree runs routing v1).
- **Key rotation required** — the initial key was exposed in chat plaintext.

## Consequences

- Routine draft volume moves to a 0-cost lane with 1M context, relieving codex/agy quotas;
  premium models concentrate on gating, review, security, and critical work.
- The control plane gains its first HTTP client under a named narrow exception with in-code bans.
- The empty eval corpus starts filling as a side effect of normal worker use.

## Ratification checklist (owner)

- [ ] Confirm the two-model allowlist and the worker-role mapping above.
- [x] Key policy (owner 2026-07-04): **rotate quarterly** (every 3 months); key lives only in
      local env. Rotation regime STARTED 2026-07-04 (owner confirmation "začíná teď"); the
      chat-exposed initial key is to be revoked on openrouter.ai as rotation #1. **Next rotation
      due: 2026-10-04.**
- [x] Top-up decision (owner 2026-07-04): **no $10 top-up for now** — the lane budget is the
      free window: 50 requests/day + 20 rpm, attempts counted. Revisit when the daily window
      measurably blocks work.
- [ ] Confirm per-provider data-policy/ZDR verification as a stage-1 precondition.
- [x] Eval rule — **GPT-5.5 xhigh consult verdict (2026-07-04): severity/kind-tiered evals**,
      not hard per-output and not pure sampling. Every free-worker output must pass codex review
      before use (accepted/retry/blocked stamp + source pointers + verification evidence), but
      only mandatory-trigger outputs (failures, retries, prompt/input deltas, format breaks,
      hallucinations, privacy/provider anomalies, route changes, governance/security/release-
      affecting work, anything used to tune prompts/routing) plus a stratified sample of trivial
      accepted outputs (~10–20 %, ≥1 per active model/task-kind/day) create full
      `model-output-evals/records/` records. Codex scores during its existing review pass; Claude
      audits high-risk/planning cases + weekly aggregates; worker self-score forbidden. Decision 4
      "eval mandatory per output" is amended accordingly.
