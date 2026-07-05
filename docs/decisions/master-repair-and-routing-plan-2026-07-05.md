# Master repair + consolidation + routing-integration plan — autopilot-beta — 2026-07-05

**Purpose:** one sequenced, Codex-executable plan that (1) consolidates the usable work already stranded on
three unmerged branches, (2) turns the audit's patches into root fixes, and (3) wires in the owner's
token-cost tiered routing. Companion to `docs/decisions/whole-system-audit-2026-07-05.md` (the audit) — read
its §2b (what's already on a branch) and §6 (sequencing) first.

**Provenance:** two 3-lens brainstorms on top of the 12-lane audit. Brainstorm A (are the branch fixes real
or patches? + mergeability): codex-adversarial + codex-merge-plan, cross-checked by the audit's V1. Brainstorm
B (routing integration): Fable-architecture + codex-gap-analysis + codex-enforcement-design. Every load-bearing
claim is file-grounded; the supervisor re-verified the branch-topology and gate facts directly.

**Execution rule for Codex:** work one PHASE at a time, one task-unit at a time. Run `npm run verify` after
every unit. Never hand-merge generated files (`mesh/generated/decision-mesh.json`, `mesh/*-snapshot.json`,
`vendor-manifest.json`) — regenerate from source. After any `cliWorker*` change, explicitly re-verify the
checklist in Phase 2.3. Do not approve your own work; the owner gates each phase boundary.

---

## 0. The two truths this plan is built on

1. **Most of the "enforced control plane" is already written — just stranded.** `main` is 81%/51% mature, but
   the enforcement + security + STALE + telemetry cluster lives on `agitated-robinson`, and the tests +
   prompt-lib + hintCovers + cheap-worker cluster lives on `eloquent`. **Consolidation is the single
   highest-leverage move; most "new work" would be re-implementation.**
2. **But the branch fixes are mostly PATCHES, not root fixes** (Brainstorm A verdict, confirmed by two
   independent lanes). Merging them is necessary but not sufficient — Phase 3 must harden them, and the
   *structural* half of enforcement lives **out of the repo** (branch protection, harness Bash deny-rules,
   the global codex config).

Brainstorm A per-fix verdict (what merging actually buys):

| Branch fix | Verdict | Why |
|---|---|---|
| `mesh:generate` generated-JSON guard (eloquent) | **ROOT** | test compares committed JSON to freshly built graph; drift genuinely caught |
| `hintCovers` shared normalizer (eloquent) | **PARTIAL→near-root** | shared by BOTH consumers (good); only strips trailing `/` — no backslash/case/`./`/`..`/canonical-key handling |
| STALE fail-closed / `loadPriorOrDie` (agitated) | **PARTIAL** | root for FILE hints; DIRECTORY hints still coarse-VERIFIED with no drift tracking; reflexive `snapshot:regen` can launder |
| codex-retry test (eloquent) | **PARTIAL** | tests the real exported predicate (good) — but see attempts telemetry |
| agy `--sandbox` by construction (agitated) | **PARTIAL** | true for the in-repo helper only; the untracked `radeq_tmp` agy `.cjs` still spawns with full env |
| `promptlib:validate` (eloquent) | **PARTIAL** | enforces metadata SHAPE, not contract TRUTH (source-IDs vs catalog, eval files exist, body sections) |
| `model-output:validate` in verify (rebuild) | **PARTIAL** | wired + real semantic checks, but its own required-field/exit-code logic is untested |
| attempts telemetry (agitated) | **PATCH** | records `attempt_count` in a record **nobody reads** — no aggregator/breaker |
| governed-core chokepoint (agitated) | **PATCH (most misleading)** | dispatch only ANNOTATES + refuses on 3 shallow checks (packet-hash freshness, empty `required_checks`, no-viable-provider); never branches on stop_conditions/blockers; boundary test is a regex over `src/**/*.ts` only; the real vendor channel is Bash. A door beside other doors, not a wall |

---

## Phase 0 — Pre-merge cheap wins on `main` (branch-less; shrink the merge surface)

These exist on NO branch (audit §2b) and touch files the merges won't, so they land conflict-free first. Each
is a small, testable unit.

- **0.1 — vendor-check.mjs self-tests.** New `tests/…/vendor-check.test.ts`: point `verify()` at a temp
  manifest + tree with (a) a planted drift, (b) a planted untracked vendored file, (c) `VENDOR_ROOTS`
  missing a root; assert non-zero exit / thrown each. Closes the "0 tests on the airlock" hole (F2 probe c).
- **0.2 — empty-packet warning.** In `buildAgentPacket`/`buildProjectMeshPacket` (`src/lib/decision-mesh/
  query.ts`), when `relevant_nodes` is empty, set an explicit `no_governance_matched: true` field and
  force-include the context-economy + capability-routing floor nodes. Add a test. (Also a prerequisite for
  Idea-Mode packets in Phase 4.)
- **0.3 — self-approval baseline hardening** (the mechanical root of "green but not correct", V2). Make the
  gates fail when a commit adds/edits a *baseline excuse* without a separate reviewed waiver: new
  `vendor-manifest.json` `beta_authored`/`patched_by` entries, new `fit-safety-baseline.json` entries, and
  `related-files-baseline.json` growth must each require a `waiver:` marker (or a `--allow-baseline-change`
  flag used only in a dedicated commit). Add tests.
- **0.4 — anti-reimplementation guard (process, not code).** Do NOT land STALE-fail-closed, slug-collapse
  test, `attempts`, `hintCovers`, codex-retry test, CI, or mobile R6 on main — they arrive via Phase 2.
  Re-implementing them creates a third variant and reproduces the ACK-triplication pathology.

**Out-of-repo track (owner, parallel — the real structural half of enforcement; cannot be a branch):**
- **0.5** Fix `~/.codex/config.toml`: drop `danger-full-access` default + the `trusted` entries for `C:\` and
  `C:\Users\sirok`; keep permissive settings only in an explicitly-selected `[profiles.autopilot]`.
- **0.6** Add Claude-harness permission deny-rules for direct `codex`/`agy` Bash outside the sanctioned
  read-only pattern (so the live bypass channel the audit found is actually constrained).
- **0.7** Enable GitHub branch protection with required `verify` check (so the CI merged in Phase 2 becomes
  *structural*, not advisory).

---

## Phase 1 — Reconciliation ADR (one page, decide BEFORE merging)

Write `docs/decisions/branch-consolidation-adr-2026-07-05.md` fixing the semantic-conflict winners so the
merges resolve to decided targets, not merge-time improvisation:

- **ACK mechanism:** winner = eloquent `Mesh-Ack:` commit-trailer (node-grammar). Drop the `a1bee39`/`ed35865`
  env-var/rule-id ACK and any `AUTOPILOT_ACK_BLOCKERS` bypass. **Framing:** the ACK is an auditable *consent
  journal*, NOT an enforcement gate — a committer can self-ack (a blocker's first ack was self-written), so
  the owner reviews acks in history; never treat a present ack as prevention.
- **`hintCovers`:** winner = eloquent shared `normalizeRelatedFileHint` / `related-file-hints.ts`, used by
  BOTH the ratchet and the changed-files gate. (Phase 3 extends its normalization.)
- **`load.ts` slug semantics:** union — keep main's `5a5f048` slug precedence AND agitated's `585726c`
  sibling project-root binding.
- **`query.ts` return shape:** union — eloquent's compact public subgraph (`{id,name,score}`) is fine, but
  keep agitated's ceiling-based blocker retention for packets; update MCP schemas + tests together.
- **`verify` chain:** include BOTH `model-output:validate` (rebuild) and `promptlib:validate` (eloquent);
  keep `mesh:generate` MANUAL (or add a non-mutating `--check` mode) — never a mutating step inside verify.
- **OpenRouter + vendor-routing v2 catalogs:** merge but keep **INERT** — no automatic provider routing or
  fallback until separately approved after tiered evals.

---

## Phase 2 — Consolidation merges (the core of "use what's already built")

One integration branch off `main`. **One branch per step, `verify` green between each**, never octopus.

### 2.1 — Merge `claude/agitated-robinson-9e114f` FIRST
Brings the enforcement base: `src/governed-core/` chokepoint + `.github/workflows/verify.yml` (server CI) +
pre-push-runs-test + STALE fail-closed + slug-collapse test + `attempt_count` telemetry + agy `--sandbox` +
sibling mesh binding + mobile R6/R1. After merge: `npm run verify`. Make the CI `verify` job **required**
(Phase 0.7); keep browser-QA a **non-required** job initially (flake/cost → red-fatigue risk).

### 2.2 — Merge `claude/rebuild-2026-07-03` SECOND
Keep `model-output:validate` in verify + vendor-routing v2 tier catalogs (INERT). Drop its env/rule-id ACK
per the ADR. After merge: `npm run verify` + `npm run model-output:validate`.

### 2.3 — Merge `claude/eloquent-chatterjee-0b6e41` LAST
Brings the final ACK design + shared hint normalizer + OpenRouter stage 0/1 (Nemotron+Qwen, INERT) +
`promptlib:validate` + `mesh:generate` + compact mesh APIs + motion P3–P6.

> **MERGE LANDMINE #1 (from BrA-codex2 — the one most likely to break silently):**
> `src/data/delivery-system/cliWorker.ts` + `cliWorkerCapture.ts` are triple-touched (attempts vs
> codexMode/taskPacketRef vs openRouterConfig). A clean-looking resolve can **silently drop agitated's
> `attempt_count` telemetry and agy `--sandbox` default** while keeping eloquent's OpenRouter/codex modes —
> passing surface checks while regressing observability and re-opening a permission boundary.
> **After resolving that file, explicitly re-verify:** `attempt_count` telemetry present · agy `--sandbox`
> default · `taskPacketRef` guard on `codex_implement` · OpenRouter `openrouterMode`+`taskPacketRef` guard +
> access-tier reject of `cwd/addDirs/images` · codex-retry predicate + its test · the `EvalRecordSummary`
> provider type gains `"openrouter"`.

After merge: regenerate `mesh/generated/decision-mesh.json`, `mesh/*-snapshot.json`, `vendor-manifest.json`
from source (do NOT hand-merge hashes); then `npm run verify` + `npm run promptlib:validate`.

### 2.4 — Branch cleanup
After the integration branch lands and `verify` passes: tag the three feature branch tips, then delete them
(and the dead `blissful-merkle` + the 4 behind-main branches). Leaving them live recreates the divergence.

---

## Phase 3 — Turn the merged PATCHES into ROOT fixes

The merges give the mechanisms; these units close the residual holes Brainstorm A found.

- **3.1 — governed-core: door → wall.** (a) Make vendor-spawn helpers (`runCliWorker` / `cliWorkerCapture`)
  **private to governed-core** — no direct import outside `src/governed-core/` + tests; extend the boundary
  test from a `src/**/*.ts` regex to a **whole-repo** scan (scripts/, `.cjs`, product-design-os/, direct
  `child_process.spawn("codex"|"agy")`). (b) Dispatch must **refuse on unresolved stop_conditions/blockers**
  unless an audited owner waiver is present — not just the 3 shallow checks. (c) Require routing context;
  issue dispatch-side one-time route tokens instead of self-computable packet hashes (HMAC provenance).
  *(Note: the Bash channel is only fully closed by the out-of-repo 0.5–0.7 — state that plainly, don't
  declare the chokepoint "done" while Bash spawns remain.)*
- **3.2 — STALE: cover directory hints.** Hash directory hints as a recursive tree snapshot (or expand them
  to files) so dir-hint drift is detected; add an explicit reviewed-regen ack so `snapshot:regen` can't
  silently launder drift.
- **3.3 — agy full-env side path.** Promote the `radeq_tmp/.autopilot/agy-brainstorm.cjs` lane into the
  governed `src/` lane (allowlisted env by construction) and delete the scratch; same for the
  `document-reader-adapter` Python spawn (env allowlist, preserving only `PYTHONPATH`/`VIRTUAL_ENV`).
- **3.4 — one canonical path normalizer** shared by hints AND changed-files: separators, `./`/`..` segments,
  case policy, trailing slash/dot, canonical snapshot keys.
- **3.5 — attempts telemetry gets a reader** (do this WITH Phase 5, not before): an aggregator/circuit signal
  that reads `attempt_count` and flags sustained retries; add an integration test.
- **3.6 — promptlib + model-output validators get teeth/tests:** promptlib cross-checks source-IDs vs
  `source-catalog.json`, proves eval files exist, checks required body sections; add the missing
  required-field/exit-code tests for `model-output:validate`.
- **3.7 — raw-prompt TTL:** TTL-sweep `%TEMP%\autopilot-handoffs` + `autopilot-codex-captures`, with a
  carve-out for eval-flagged records (per the tiered-eval regime); gitignore `docs/autopilot/session-state/`;
  document the worker-buffer carve-out in AGENTS.md/CLAUDE.md (the audit found this is non-compliant-by-letter
  today).

---

## Phase 4 — Routing integration (the owner's token-cost tiered stack)

**Net-new surface is tiny** (Brainstorm B): 1 catalog file, 1 mesh rule, 1 optional packet field, 2 dispatch
refusal reasons, 1 telemetry field, 1 read-only MCP tool. Everything else is reuse of merged code. Modes are
the task-level umbrella over the per-lane modes that already exist (`CodexDispatchMode`, `OpenRouterMode`).

**Role → real lane (confirmed in source):** Claude = the supervisor session (never a spawned lane) · Codex =
`codex_cli` · Antigravity = `agy_cli` (tiers `gemini-3.1-pro-high` deep / `gemini-3.5-flash-high` fast) ·
Nemotron = `openrouter_api:nemotron_planning` · Qwen3-Coder = `openrouter_api:qwen3_code_draft` (distinct from
local `qwen_local`!) · Gemini/VLM = `agy_cli` + `images`. **Do NOT build on** unverified IDs: `gemini_flash`/
`gemini_pro` (`verifiedLocally:false`), `deepseek_*` (no lane), `qwen2_5_coder_14b_max` (install-candidate).

- **4.0 — fix the existing role inconsistencies first** (BrB-codex1): `layerProviderMapping` vs
  `supervisorCliVendorMap` disagree on `reviewer`/`architect`; and `bounded_coding_worker` prefers OpenAI
  before Qwen (Build mode is currently INVERTED vs the owner's intent). Reconcile per the role table above.
- **4.1 — `RoutingMode` catalog (new file `src/data/delivery-system/routingModes.ts`)** in house style
  (`as const satisfies`), mirrored by mesh rule `MODE-ROUTE-001`. Four modes:

  | Mode | Allowed lanes | Expensive lane allowed only when | Refuse when |
  |---|---|---|---|
  | `idea` | agy_cli (fast+deep), openrouter nemotron_planning | **never** (Claude/Codex forbidden) | any expensive lane requested |
  | `spec` | nemotron_planning, agy_cli, local search | Claude gets `nemotron_spec_draft` ref + risks + acceptance criteria | no cheap draft / no package hash |
  | `build` | openrouter qwen3_code_draft, qwen_local, deterministic tests | Codex gets approved patch plan + file list + tests (extends existing `taskPacketRef` guard) | raw prompt / missing draft or failed-attempt trail |
  | `review` | Gemini/VLM (agy+images), agy_cli critique | Claude only for high-severity arch/product; Codex only bounded patch/test review | severity not declared / cheap artifact absent / low-severity polish → Claude |

- **4.2 — cheap-first as a dispatch precondition (structural, cost-blind).** Third guard in the existing
  family (`codex_implement` already throws w/o `taskPacketRef`; `openrouter_api` w/o mode). Add to
  governed-core `dispatch.ts`: fields `routing_mode`, `task_package_ref` + `task_package_hash`,
  `prep_provenance` (cheap-lane attempt ids or an explicit enum `cheap_not_applicable` + owner override); two
  new refusal reasons `lane_not_allowed_in_mode`, `missing_upstream_draft`. The check is **artifact-presence
  + lane-membership only — no cost numbers** (honest: it's a consistency/freshness gate, self-attestable, not
  unforgeable — but an expensive call can't be *silently* made without a named cheap draft). Add `routing_mode`
  to `computePacketHash`'s canonical object so an `idea` handoff can't replay a `build` hash. Belt-and-braces
  mirror throw in `runCliWorker`.
- **4.3 — plug mode into the packet + MCP.** Optional `mode?: RoutingModeId` on `AgentPacketInput`;
  `build_agent_packet` merges the mode's stop-conditions/required-checks and echoes `routing_mode`; add
  read-only MCP tool `get_routing_mode_contract` (19th tool, same `registerTool` pattern). **Mode is an
  explicit human/supervisor input** — any keyword auto-classifier is advisory only (auto-classification is the
  first step toward auto-switching).
- **4.4 — ship Idea Mode ONLY as the first slice**, then stop and measure. Rationale: brainstorming/variants
  are today's biggest discretionary Claude spend; Idea Mode moves 100% to agy-fast + Nemotron behind a hard
  "no expensive lane" wall, needs **no upstream-artifact machinery** (pure lane-membership), and produces the
  mode-tagged telemetry that later proves/disproves the 70/30 split. Then Build (4.x) → Spec → Review as
  separate slices.

---

## Phase 5 — Observability spine, then DECIDE (don't wire) the routing brain

- **5.1 — minimal redacted event spine** (V3 + BrB-codex2), all hashes/enums/counts, no raw content:
  `governance_match` (relevant_node_count, no_governance_matched) · `route_decision` (assigned vs actual
  vendor, mismatch flag) · `vendor_call` (+ attempts, first_attempt_outcome, retry_reason, prompt/output
  hashes, routing_mode) · `cheap_lane_attempt` + `expensive_dispatch_decision` (for Phase 4's gate) ·
  `gate_outcome` (gate, commit/range, exit, failed_check_ids) · `alert_lifecycle`.
- **5.2 — ONE aggregation reader** (`npm run telemetry:summary -- --since 7d` or an MCP tool) — wire
  `aggregateCliCallTelemetryIntoBudget` to the real telemetry file, grouped by `routing_mode`. Answers "how
  many vendor calls this week / how many retried / quota left / which gates failed / what % of prep ran on
  cheap lanes." **Build this BEFORE adding more telemetry fields** (don't add fields nobody reads).
- **5.3 — DECIDE the routing brain, don't blind-wire it.** Only after tiered evals exist does the owner decide
  whether any automated routing activates; until then keep `buildSupervisorRoutingDecision`/fallback/circuit
  breaker + the v2 cost catalogs INERT. The dormancy is recorded owner intent, and the tier data is
  half-verified.

---

## Anti-footguns (apply throughout — the owner's hard rules)

1. **Never auto-switch models.** Rate-limited/failed cheap lane → **stop / `waiting_owner`**, never silently
   promote to Claude/Codex (that inverts the whole cost design under load). Matches `selectModelForLayer`
   returning the same provider on rate-limit.
2. **Never activate unverified-cost tiers** (`verifiedLocally:false`) or route real work through them.
3. **Don't gate on the 70/30 ratio** — it's a report metric, not a gate; gating on it incentivizes skipping
   genuinely-needed Claude calls (the "fixes AFTER cheap models failed" clause).
4. **Don't make a gate so strict it trains bypass** (the `--no-verify` lesson); allow an explicit
   `cheap_not_applicable` enum + owner override.
5. **Don't pretend repo code blocks Bash** — the live bypass is direct `codex exec`/agy; only the out-of-repo
   controls (0.5–0.7) close it. Don't declare enforcement "done" while it's open.
6. **Human stays in the loop** for: mode selection, paid/credentialed provider use, unverified cost claims,
   security/architecture decisions, and repeated cheap-lane failure. Keep model output advisory
   (`assertRoleConstraint`); worker self-scoring stays forbidden (ACCESS-TIER-001).

---

## Sequencing summary (what Codex does, in order)

```
Phase 0  cheap wins on main (0.1 vendor-check tests, 0.2 empty-packet, 0.3 baseline waivers)
         ‖ owner out-of-repo (0.5 codex config, 0.6 harness deny-rules, 0.7 branch protection)
Phase 1  reconciliation ADR (ACK / hintCovers / slug / query shape / verify chain / OpenRouter-inert)
Phase 2  merge agitated → verify → rebuild → verify → eloquent → regenerate+verify → branch cleanup
         (watch LANDMINE #1: cliWorker* re-verify checklist)
Phase 3  harden patches → root (3.1 governed-core, 3.2 STALE dirs, 3.3 agy/python env, 3.4 normalizer,
         3.6 validator teeth, 3.7 raw-prompt TTL)   [3.5 attempts-reader deferred to Phase 5]
Phase 4  routing: 4.0 fix role inconsistencies → 4.1 RoutingMode catalog → 4.2 dispatch precondition →
         4.3 packet+MCP → 4.4 SHIP IDEA MODE ONLY, measure, then Build/Spec/Review
Phase 5  5.1 event spine → 5.2 one aggregation reader → 5.3 DECIDE routing brain (don't blind-wire)
```

**Do first, get most value:** Phase 0 + the out-of-repo controls + Phase 2.1 (merge agitated). That alone
moves `main` from "advisory + bypassable" toward "enforced" and unblocks project #1. Routing (Phase 4) is
real cost savings but should wait until the cheap lanes actually exist on main (post-Phase-2) and the
Idea-Mode telemetry can measure the benefit.
