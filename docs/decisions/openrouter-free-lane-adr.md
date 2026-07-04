# ADR: OpenRouter free-model lane — staged advisory adoption (PROPOSED)

**Date:** 2026-07-04 · **Status:** PROPOSED (owner directive 2026-07-04: use OpenRouter free models;
this ADR defines the governed way in — ratify before any code lands). **Author:** Claude (Fable 5),
synthesized from a 10-lane brainstorm (6 lanes delivered: Fable A/B, Sonnet A/B, codex 5.5 ×2);
verdict unanimous **ADOPT-PARTIAL**.

## Context

The owner directed that OpenRouter's free (`:free`) models be usable as advisory capacity. This is
architecturally novel: `rg` for `fetch|axios|https.request` across `src/` + `scripts/` returns zero
hits — the control plane has **no direct HTTP client today**; all vendor access goes through spawned
CLIs (`runCliWorker`). Adopting OpenRouter therefore creates the control plane's **first direct
network client** and must be scoped as a **named narrow exception**: one module, one host
(`https://openrouter.ai`), one endpoint (`/api/v1/chat/completions`). Anything wider is the wedge
for future ad-hoc APIs and collides with the hard boundary forbidding multi-provider gateways.
OpenRouter's one-endpoint-for-many-models shape is itself the risk: without in-code bans it silently
recreates the forbidden parallel gateway. The bans are part of the decision, not commentary.

## Decision 1 — staged adoption (deepseek precedent)

`deepseek_api_or_self_hosted` in `modelPolicy.ts` is the existing precedent for policy metadata
landing **before** any executable client. OpenRouter follows the same two stages:

1. **Stage 0 (policy-only):** add `ReasoningProviderId` `"openrouter_free"` to `modelPolicy.ts`
   with `advisoryTrustTier: "comparison_only"` (the `deepseek_web_chat_manual` analog) and
   `advisoryWeight` ~40 (below agy 70 / codex 85, beside qwen_local 45, deepseek 40). No network
   code ships in stage 0.
2. **Stage 1 (client):** an **in-process** `captureOpenRouterResponse()` inside the `runCliWorker`
   harness — a third capture branch, **not** a spawned CLI. Load-bearing reason: `buildVendorEnv()`
   is default-deny and deliberately strips `*_API_KEY` from every child environment; an OpenRouter
   key would be the first env-borne secret in any vendor lane, and spawning a child would require
   punching that scrubber. An in-process fetch keeps the key from ever crossing a process boundary
   and leaves the scrubber untouched. Worker lock, telemetry JSONL, evidence records, and alerting
   are inherited from the harness. The `CliVendor` union and the telemetry `provider` union widen
   accordingly.

**Considered and rejected — sibling worker lane** (`openrouterWorker.ts` reusing the governance
skeleton, favored by two lanes): rejected because it either duplicates the lock/telemetry/evidence
machinery or spawns a child process that forces an API-key exception through `buildVendorEnv()`.
The env-scrubber argument was not rebutted by any lane; it decides the split.

## Decision 2 — roles (all three original role titles rejected)

- **ADOPT — Nemotron skeleton-drafter.** `nvidia/nemotron-3-ultra-550b-a55b:free` (web-verified via
  `/api/v1/models`: price 0/0, 1M context). Fills a real gap: nothing today owns skeleton/outline
  drafting upstream of codex. Strictly schema-fed (composition schema + the 44-code `page_profile`
  matrix) so output survives `pdos:validate`; every draft goes to codex/Claude review. A
  freestanding "ideator" framing is rejected — it duplicates the agy brainstorm mandate.
- **DEFER — `qwen/qwen3-coder:free` as `free_code_drafter`.** `model-output-evals/records/` is
  empty: no one can honestly claim any free model is "good enough". The first slice must ship
  seeded comparative eval records (qwen3-free vs local qwen2.5-7b vs codex on the same bounded
  tasks) before this role activates. Honest niche: non-private free drafts above the 7b local
  ceiling — never a replacement for codex.
- **REJECT — Llama 4 Scout.** The `:free` variant is unverified (the roles lane found only the paid
  Scout in `/api/v1/models`; one lane claims a free slug — contradiction unresolved), and the role
  duplicates the agy creative mandate while lacking agy's verified screenshot vision.
- **Role-title rejection (structural):** "main developer" is impossible regardless of model
  quality — a chat-completions lane has no repo/tool/file access, and `assertRoleConstraint()`
  already throws if a non-`local_evidence` provider is promoted beyond advisory.

## Decision 3 — chokepoint mechanics (code-enforced, not documented)

1. **Compiled-in `FREE_MODEL_ALLOWLIST`** of exact `:free` slugs; anything else refused pre-network.
   Routers, aliases, `models[]` arrays, `:nitro`/`:floor` variants, provider fallbacks, and paid
   slugs are rejected in code; requests pin a single `model` with `provider.allow_fallbacks=false`
   and `data_collection="deny"` where available.
2. **Per-call zero-cost assertion** from the response `usage` block; nonzero cost fails the call and
   trips the lane.
3. **Key handling:** `OPENROUTER_API_KEY` read from `process.env` only; never written to telemetry,
   evidence, logs, or error text.
4. **Kill-switch:** absence of the env var makes the lane report **MISSING** (the flaky-agy
   convention) — never silently faked or skipped.
5. **Pre-send redaction scan** (code-enforced): assume free routes log and may train. No secrets,
   client data, raw logs, private source dumps, absolute local paths, or account identifiers.
6. **Request-count dual-window budget** (per-minute + per-day). Exact caps are UNVERIFIED
   (candidates: 20/min; 50/day below vs ~1000/day above a credit threshold) — verify via
   `/api/v1/key` before stage 1 lands and encode the verified numbers.
7. **Excluded by construction** from `sensitive_private_context`, `architecture_security_review`,
   and `agent_validation` lanes.
8. **Spill order:** gemini-flash → `openrouter_free` → qwen_local → **blocked**. Never spills to
   paid OpenRouter; exhaustion is a checkpoint, not a purchase.

## Open items

- Re-verify at implementation time with dated evidence records: all `:free` slugs (lanes
  contradicted each other on Scout and initially on Nemotron), rate-limit caps, and per-provider
  data/logging policy for free routes.
- v1-vs-v2 routing integration: v1 is ACTIVE in this tree; the v2 dual-window draft lives on
  another branch. Stage 0 targets v1 mechanics; reconcile after branch merge.
- **Key rotation required:** the current OpenRouter key was exposed in a chat transcript. Rotate
  before stage 1; the old key must never be encoded anywhere.

## Consequences

- The control plane gains its first direct HTTP client, but as a single named exception whose
  scope (module/host/endpoint) is testable — a grep guard for `openrouter.ai/api/v1` outside the
  capture module keeps it that way.
- Free capacity becomes routable as comparison-only advisory drafts without touching the trust
  ladder: local evidence and owner decisions still outrank anything the lane produces.

## Ratification checklist (owner)

- [ ] Confirm the named-exception scope (one module, one host, one endpoint) and the in-process
      capture decision over the sibling-lane alternative.
- [ ] Confirm stage 0 policy values (`openrouter_free`, `comparison_only`, weight ~40).
- [ ] Confirm roles: Nemotron skeleton-drafter adopt / qwen3 defer-until-evals / Scout reject.
- [ ] Confirm spill order and the never-to-paid rule (exhaustion = blocked checkpoint).
- [ ] Rotate the exposed OpenRouter API key before any stage-1 work.
- [ ] Approve stage 1 only after slugs, caps, and data policy are re-verified with dated evidence.
