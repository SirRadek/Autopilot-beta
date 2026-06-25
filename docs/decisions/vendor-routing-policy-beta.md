# Vendor routing policy — autopilot-beta (standalone)

**Date:** 2026-06-24. **Author:** Opus. **Status:** ACTIVE operating posture for all ongoing beta work
(owner directive 2026-06-24, reaffirming the standing [Beta vendor mix] rule). Supersedes the implicit
"codex implements, agy when convenient" default.

## Directive (owner, verbatim intent)
Relative to the **current autopilot activity baseline**, engage the real vendors MORE in beta:
- **codex_cli ≈ +10%** — and shift its emphasis toward **review / audits, performed jointly with Claude
  (Opus)**, on top of its implementation role.
- **agy_cli (Gemini-3.1-pro-high) ≈ +40%** — as the **creativity** lane, and **occasionally engage agy even
  where it is not the obvious fit** ("agy občas také zkusit zapojit").

The percentages are **directional targets, not literal quotas**. The real change is qualitative: codex
becomes a standing *audit* voice (with Opus), and agy moves from rare-exception to a *regular creative /
strategic* voice.

## Role split (refines [[model_role_taxonomy]])
| Vendor | Primary role in beta | Engagement cadence under this policy |
|---|---|---|
| **Opus (Claude)** | Architect · supervisor · final review · gate · land. NEVER sole work-product. | Every phase (unchanged). |
| **codex_cli** | Implementation worker · logic · **tech-opponent / reviewer / auditor (with Opus)**. | **Implement pass + a review/audit pass** per phase (was: implement only). |
| **agy_cli (Gemini) — TWO tiers** | **Creativity · strategic opponent · SEO** (redacted context). **`gemini-3.1-pro-high`** = deep verdicts; **`gemini-3.5-flash-high`** = fast/cheap frequent + parallel breadth. | **Engage MORE OFTEN** (owner 2026-06-24): pro-high on every design-bearing decision + the per-phase design verdict; flash-high liberally for quick gut-checks, breadth sweeps, extra rounds, second opinions — cheap enough to use often. |
| **qwen** | Private local worker (data-sensitive). | Unchanged; engage when privacy axis demands local. |

## What this means per phase (operational)
1. **Implementation** → codex_cli write-mode handoff (as today).
2. **Audit/review** → after implementation lands, a **codex_cli audit pass** (correctness · security ·
   baseline-drift · contract-fit) reviewed **jointly with Opus**. Codex + Opus must agree before land.
3. **Creative / strategic** → on any design-bearing or strategy decision (tokens, renderer, contracts,
   design tracks, naming, SEO), an **agy_cli** creative / strategic-opponent pass — redacted context.
4. **Occasional agy** → even on non-obvious tasks (e.g. a strategic-opponent angle on a governance audit),
   periodically include agy: it surfaces non-codex/non-Claude angles AND keeps the lane warm (agy
   auth/heartbeat is flaky — regular use catches MISSING early; the heartbeat fix is beta-F8 backlog,
   see [[project_agy_heartbeat_capture_applied]]).
5. **Exhaustive lanes (Ultracode)** → where warranted, add a Claude Workflow adversarial-verify fan-out ON
   TOP of the real-vendor lanes. Note: Workflow `agent()` spawns **Claude** subagents, NOT codex/agy — so a
   Workflow does **not** satisfy "engage codex/agy more"; the real vendors are invoked via `runCliWorker`.
6. **Two-tier agy (owner 2026-06-24)** → use agy MORE, split by cost/depth:
   - **`gemini-3.5-flash-high`** (fast/cheap) → frequent light touches: quick "does this look generic /
     does the page cohere?" gut-checks BEFORE the deep review, breadth sweeps (N flash lanes each on a
     different angle), extra brainstorm rounds, a fast second opinion. Use it liberally — it's cheap.
   - **`gemini-3.1-pro-high`** (deep) → the hard verdicts: per-phase design review (page-ready?), strategic
     calls (brand brainstorm, differentiation, naming, SEO), the final creative sign-off before land.
   Run them as SEPARATE `runCliWorker` calls (distinct stateDirs; agy auth is flaky so avoid 2 concurrent
   agy sessions — sequence pro then flash, or flash-sweep then pro-verdict). `model` field selects the tier.

## Keeping it honest (anti-folklore)
Each phase records a one-line **vendor-engagement log** (who did implement / audit / creative / review, with
runIds) in the phase's commit body or ADR, so the mix is auditable rather than assumed. agy MISSING is
reported, never faked ([[feedback_no_vendor_roleplay]]).

## Carryover doctrine (unchanged)
Redacted context to all external vendors; real CLIs only (no roleplay); **model output is advisory until
Opus verifies it against source/tests** ([[feedback_consult_codex_on_worker_logic]],
[[project_codex_only_implementation_model]]); no secrets/raw-logs to vendors or commits.

## First application
**D5 (enforceable evidence schema)** is the first phase under this policy: codex implements (done), then a
**codex audit + agy creative/strategic review run in parallel (real `runCliWorker`)**, Opus synthesizes +
gates + lands.
