# Autopilot-beta — whole-system audit (2026-06-29)

**Method:** 2-round, 4-model-family adversarial audit at `65d4893`. Round 1 = 12 agents
(3× codex gpt5.5-xhigh, 3× Opus 4.8 ultracode, 3× Gemini 3.1-pro, 3× Gemini 3.5-flash) across 3
lenses (A bindings/architecture, B security/boundaries, C capabilities/maturity), all with repo read
access, proposal-only. Round 2 = adversarial opposition (each family got the cross-model digest;
agy retried-until-success; codex r2 needed a no-exec prompt to complete). Every claim file:line-grounded.

This is an advisory audit record, not a decision. Fixes below are proposals, owner-gated per `CLAUDE.md`.

## Verdict (one line)
A solid (~70%) read-only governance + context-routing library with a novel, tested git-blob ratchet at
its core — honestly self-described as a *router, not an enforcer* — but it ships a RED release gate, a
fail-open governance hook, and a vendor-exec lane whose dangerous flags are guarded only by the fact that
nothing calls it yet. The core is healthy; the gap is peripheral wiring + three "by construction" claims
that are really by-convention.

## Strengths — 90%+, high certainty (unanimous, round-2 re-verified)
- **MCP read-only** — 18 tools, all `readOnlyHint:true`; no write/exec/spawn in any handler; the real airlock.
  (codex r2 nuance: "read-only by *implementation*", not a hard runtime boundary — a future handler could write.)
- **Mesh load+validate fail-closed** — `load.ts:130-166` throws on dup id / missing `why` / edge ∉ nodeset / weight ∉[0,1].
- **bind-point ① ratchet** — git-blob-hash, stateless; "strongest single piece of engineering in the repo."
- **capabilityMirror** TS↔YAML drift-lock, tested. **git hooks** real, committed, dogfooded.

## Real weaknesses (convergent; round-2 empirically confirmed)
1. **Governance is advisory data, not enforcement.** `query.ts` aggregates severity, never branches on `blocker`.
   Only enforcement = 2 `process.exit` lines in the git-hook CLI. (AGENTS.md says so explicitly.)
2. **STALE detector doubly dead** — `mesh:gate:ci` passes no `--prior`; AND the ratchet baseline stores only
   `missing[]`, so STALE never enters the diff even if wired. Catches deletion, never edit-drift.
3. **`verify` is RED** (live ×3) — `vendor-check.mjs` ignores `.gitignore`, fails on `grep.exe.stackdump`.
   (Litter cleaned 2026-06-29 → green; the gitignore-blind walk remains to fix.)
4. **changed-files gate FAILS OPEN on no-match** (empirically: unmapped file → 0 nodes → exit 0), despite a
   "fail-closed" code comment — AND `changed-files-capabilities.test.ts:31-36` asserts this as correct behavior.
5. **No CI** (`.github` absent); `verify` is `--no-verify`-bypassable and narrower than docs claim
   (omits `model-output:validate`/`prompt:validate`/`contracts:validate`).
6. **visual-qa runner only does 1440/390** (`check-visual-qa-browser-...:210`) → the R1a `fluid_floor@≤360`
   analyzers never fire.
7. **Doc rot** — `CLAUDE.md` prescribes `mesh:check`+`prompt:validate` (absent); architecture.md → old repo;
   v0.2 ADR says beta has no mesh (now false).

## What round 2 corrected (adversarial value)
- **Vendor "NOT proposal-only (SEV-HIGH)" → MEDIUM/latent** — `runCliWorker` has NO programmatic caller in
  committed code (all refs are markdown/YAML/comment). A human types the call; latent footgun, not a live hole.
- **Command-injection — disputed:** Opus refuted (prompt is file-fed; `model`/`images` from a fixed
  supervisor enum / owner paths) → robustness/quoting bug; flash+pro held it critical. Reconciled: real
  escaping bug, unanimous fix (arg-array); severity latent today (supervisor-controlled inputs).
- **Project-mesh "backdoor" → layout bug** — shadowing is dormant (`.autopilot/decision-mesh` absent); the
  real bug is *slug-collapse* (`projectSlug` validated then ignored → identical packets).

## What round 2 newly surfaced (all 12 round-1 agents missed)
- **Agent packet is lossy + NOT severity-aware** (codex r2) — `buildAgentPacket` caps to 4-7 nodes by token
  budget; rules/stop_conditions only from selected nodes → **a blocker node can be silently omitted from a
  broad packet.** The deepest governance hole: it may not even *tell* the agent about a blocker.
- **Secret/env leak** (gemini-pro) — `env: process.env` passed straight to `pty.spawn`/`spawnSync` → leaks
  GEMINI_API_KEY/GITHUB_TOKEN/cloud keys into the untrusted vendor shell.
- **Model-policy is dead-code in execution** (flash) — `cliWorker.ts` bypasses `buildSupervisorRoutingDecision`
  (routing/fallback/circuit-breaker); spawns without budget/policy checks.
- **`cli-worker-safety.test.ts` tests accounting, not containment** (Opus) — the exec path with every
  dangerous flag has 0% containment test coverage. *"The biggest claim-vs-enforcement gap."*
- **Windows path corruption + fragile regex YAML parser** (gemini-pro) — minor but real.

## Maturity reconciliation
Per-family: flash 42% · gemini-pro 52% · codex-r1 64% · opus-r1 68% · codex-r2 60% · opus-r2 72%.
The spread is not factual disagreement (all found the same things) — it's *what is measured*:
- **~70% as a read-only governance/context-routing library** (built + tested).
- **~45% as an enforced control plane** (green, non-bypassable, fail-closed).
The system honestly claims to be the former → the gap ≈ the broken release gate + dead enforcement wiring,
not architectural immaturity.

## Proposed priority fix-list (reconciled across all lanes)
1. [measured-pain] **Truthful + green release gate** — `vendor-check` honor `.gitignore` (or `git ls-files`);
   align `verify` with what docs claim; add real CI (not just bypassable hooks).
2. [measured-pain] **Scrub env before vendor spawn** — strip API keys/tokens from `process.env` (real leak).
3. [measured-pain] **Close changed-files fail-open** — default-deny for unmapped sensitive paths AND fix the
   test that currently asserts fail-open as correct.
4. [measured-pain] **Exec-containment tests** — `cli-worker-safety` should assert sandbox flag / escaping /
   gated dangerous-permissions, before anything wires `runCliWorker` into a loop.
5. [measured-pain] **Severity-aware packet construction** — blocker nodes/rules must not be droppable by
   token-budget truncation.
6. [measured-pain] **Doc-truth** — remove `mesh:check`/`prompt:validate` from `CLAUDE.md` (every agent burns
   a turn on the missing script).
7. [demoted/latent] Harden vendor exec for the day it's wired (codex `--sandbox read-only`; gate agy
   `--dangerously-skip-permissions`; Windows arg-array); wire STALE *with a human-review gate* (else it
   launders drift); fix project-mesh slug-collapse; wire visual-qa 320/360.

**Single biggest claim-vs-enforcement gap:** the repo presents `cli-worker-safety.test.ts` as proof the
vendor lane is safe, while that suite tests only the accounting of a vendor call and never its containment —
the exec path holding every dangerous flag (and the unscrubbed env) has zero containment coverage.
