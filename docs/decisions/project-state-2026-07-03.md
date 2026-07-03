# Project state — autopilot-beta — 2026-07-03

**Branch audited:** `rebuild-2026-07-03` @ `f8b3a01` (integrated: audit-fixes + vendor-routing v2 Wave 1 +
prompt-library fixes), `npm run verify` green (309 tests, 8 stages, mesh STALE=0).
**Method:** 4 independent read-only Fable agents (token-economy leak · evidence/dead-code · test-integrity ·
component map) over the integrated tree; findings cited file:line, token sizes measured empirically via `tsx`.
**Purpose:** truthful "what's where / what's missing / what's wrong" to base the next component or upgrade on.

---

## 0. The one-sentence truth

**autopilot-beta is today a read-only ADVISORY control plane.** The MCP server exposes ~15–18
`readOnlyHint` tools that *advise* and *route*, but the **entire execution half is built-but-unwired**:
the vendor dispatch lane (`runCliWorker`), the routing/fallback/budget "brain", the circuit breaker,
and the evidence/alert/session-state substrate are fully coded and tested yet **have no production caller.**
The token-saving machinery is in the same state — described, budgeted, and *not enforced*.

---

## 1. Where tokens leak (the headline)

| # | Leak | Size (measured) | Why it bites |
|---|---|---|---|
| **TOK1** | `get_relevant_subgraph` returns 12 FULL node objects + an `excluded[]` list of every other node id | **26,410 B/call** (IDs-only = 4,511 B → **~22 KB / ~5.5K tokens wasted**) | It's the documented "compact first-move" → hit at every task start; MCP re-emits it in `structuredContent` too (~2×). `src/lib/decision-mesh/query.ts:70` |
| **TOK2** | `find_risks` returns 12 full risk node objects | **23,728 B/call** (IDs = 2,388 B → ~21 KB wasted) | Per-task governance call; filter is over-broad (any node with `stop_conditions`). `query.ts:216` |
| **TOK3** | Token-efficiency "brain" is dead: `selectTokenEfficiencyRoute`→`selectContextWidth`→`contextWidthSpec` terminates in `buildSupervisorRoutingDecision`, which has **no production caller** | — | The per-task budget caps (`maxFilesInPacket` 3/8/20/60, `maxContextLines` 200/600/2000/8000) compute a budget nothing consumes. `modelPolicy.ts:805` |
| **TOK4** | Context-width caps never enforced — only stored + interpolated into a human string | — | The one real budget signal is decorative; oversized context passes silently. `tokenEfficiency.ts:204` |
| **TOK5** | `runCliWorker` writes the caller's prompt to the vendor **verbatim** — no size/width/budget field | — | The actual vendor-token path applies ZERO bounding. `cliWorker.ts:333` |
| **TOK6** | `cavemanMode` / `contextUsagePolicy` (`neverDumpFullProject`, `avoid: full_repo_dump`) is inert data imported by nothing | — | The anti-leak policy is enforced by nothing; TOK1/TOK2 directly violate it. `contextEconomy.ts:51` |

**Fix leverage:** TOK1+TOK2 are quick wins — return node IDs (like `build_agent_packet` already does) and drop
`excluded[]` → ~83% payload cut on the two hottest tools, no behavior change. TOK3–6 need the execution half wired.

---

## 2. Governance holes (things that read as governed but aren't)

- **BLIND1 (high) — `hintCovers` trailing-slash bug is LIVE.** `changed-files-capabilities.ts:44` does
  `changedFile.startsWith(`${hint}/`)`, so a hint `prompt-library/` becomes `prompt-library//` and matches
  **nothing**. Three CONCRETE node hints are affected: `skill_registry_policy.yaml:21` (`prompt-library/`),
  `supervisor_execution_loop.yaml:23` (`model-output-evals/`), `model_output_evaluation_policy.yaml:46`
  (`model-output-evals/records/`). → any change under those dirs activates **no** governance node; its
  blockers/stop-conditions are silently skipped. **Correction to an earlier in-session assumption: the fix is
  NOT on this branch** — the ACK cherry-pick (`ed35865`) added only `unacknowledgedBlockers`, not this fix.
  *Fix:* strip a trailing `/` from `hint` before the checks + add a regression test.
- **BLIND2 (medium)** — the ratchet (`related-files-status.ts:110`) marks those trailing-slash hints **VERIFIED**
  (the dir exists on disk) while the changed-files gate treats them as covering nothing → the owner sees
  "VERIFIED / nothing missing" for a hint that governs nothing. Two consumers of `related_files` disagree; they
  should share one normalization helper.
- **Mesh mandates a dead path.** `mesh/rules.yaml:234` + `supervisor_execution_loop.yaml:45` **require** vendor
  delegation via `runCliWorker()` — which has **zero executable callers** (DEAD4). Governance requires a path
  that isn't wired.
- **skill-registry (ORPH3, medium)** — `skill_registry_policy.yaml` makes `skill_registry_file_missing_at_startup`
  a stop-condition and `skill_registry_loaded` a required_check, but `docs/autopilot/skill-registry.json` is empty
  and **no code reads it at runtime**. A governance requirement with no implementation.

---

## 3. Component map (what's where + status)

**LIVE-and-wired** (reachable via MCP server, the verify chain, or git hooks):
- Decision Mesh source graph (33 nodes / 70 edges / 30 rules) + `src/lib/decision-mesh/*` + 8 mesh MCP tools.
- `selectReasoningModelRoute` (+ S0 lane-priority — the one v2 Wave-1 piece that IS wired).
- MCP server `mcp/server.ts` (~15–18 read-only tools).
- Governance gates: `verify` chain (9 steps, incl. the newly-wired `model-output:validate`), git hooks
  (bind-point ①/② + ACK), vendor-manifest airlock, `.codex` guardrail hook.
- PDOS validator + in-verify QA (validate / renderability / buildability-floor / fit-safety) + PDOS data assets.
- image-point-cloud module (CLI + renderer + 4 test files).

**present-but-unwired** (fully coded + tested, no production caller — the execution half):
- `runCliWorker` + `cliWorkerCapture` (vendor dispatch, worker lock, PTY capture, telemetry, evidence).
- Routing brain: `buildSupervisorRoutingDecision`, `resolveFallback`, circuit breaker (`routingGuards.ts` all 6
  exports), `subscriptionBudget` dual-window, `assertRoleConstraint`, `deriveLearningSignal`.
- Session-state / `subagentEvidence` / `supervisorAlerts` (only reachable via the dead `runCliWorker`).
- S1 tier catalogs (`subscriptionBudget.ts`) — consumed only by the dead brain + tests.
- Unwired route fns: `selectPromptLibraryRoute`, `selectWorkerOutputNextAction`, `resolveCliVendorForLayer`.
- Prompt library (advisory docs; incl. the new `claude-sonnet-5-supervisor.md`, status draft) — **no schema
  validator runs in CI** (`prompt.schema.json` / `source-catalog.schema.json` unenforced).

**partial:** model-output-evals (gate wired, but `records/` corpus is empty — green because nothing to check);
5 manual-only PDOS gates (fit-probe, variants, visual-qa-browser, score, evidence-freshness) not in `verify`.

**planned:** vendor-routing v2 S2–S9 (ADR is PROPOSED/reconstruction; v1 still governs).

**dead:** governed-core IPC chokepoint (`src/governed-core/**` absent on this lineage — lives only on the
sibling `agitated-robinson` worktree); `mesh/generated/decision-mesh.json` (write-only orphan — only a drift
test reads it, no generator script, runtime reads the YAML); unreferenced schemas (mesh node/edge, adoption-record,
source-catalog, prompt, pdos element-map — validation implied, never performed).

---

## 4. Test integrity (false-green risk)

- **TEST1 (high):** `routing-guards.test.ts` (282 lines) exercises `buildSupervisorRoutingDecision` +
  circuit-breaker + fallback — **all dead-code**. A green routing suite reads as "production routing is safe"
  but none of it is reachable via any MCP tool; the only wired routing is the simpler `selectReasoningModelRoute`.
- **TEST2 (high):** `model-output:validate` (now in `verify`) is itself **untested** — a gate meant to prevent
  false-green has no test of its own required-field/exit-code logic. `scripts/validate-model-output-evals.ts:212`
- **TEST3 (medium):** the codex empty-output retry predicate (F4) is still untested and, being inlined in an async
  `spawnSync` fn, is effectively frozen-untestable. Extract to a pure `shouldRetryCodex(...)` + unit-test.
- **TEST4 (medium):** the F0 integrity-inventory tests assert `countsByCode === {}` (zero warnings) — they pass
  when the checker does nothing (silenced-checker blind spot); also near-duplicated.
- **Honest positives:** `cli-worker-safety`, `tier-catalog` (S1), `routing-guards` (S0), `capability-mirror`
  (5 negative-mutation cases), and the **ACK gate** (`unacknowledgedBlockers`) all assert real behavior; no
  `.only/.skip`; 309 tests pass.

---

## 5. Unverified / placeholder inputs

- **All v2 tier `costWeight` values are reconstructed placeholders** (`verifiedLocally:false`) — AND they feed
  only the dead routing brain. Any "cost-aware routing" claim is doubly unbacked. `subscriptionBudget.ts:82`
  (Note: `gemini_pro=1.0` was designated Google flagship to satisfy the `flagship===1.0` test — re-verify.)
- Many `*_unverified` assumption flags across `modelPolicy.ts` / `modelSpend.ts` / `localWorkers.ts`
  (provider availability, subscription entitlement, model-ids, hardware budget) — honest markers, but they gate
  advisory guidance and must be cleared before any of this graduates from advisory to enforced.

## 6. Doc-truth note

The prior audit doc (`whole-system-audit-2026-07-03.md`) is now **stale** on F3/L3: `model-output:validate` is
wired into `verify` this session (WIRED-OK1). The MISSING=21 ratchet entries are the known grandfathered set
(22 frozen − 1 resolved this session), all pointing at product-runtime paths this control-plane repo never built.

---

## 7. What's missing for the next component / upgrade — recommended next step

The gap between "governs/advises" and "executes" is THE thing to close. In dependency order:

1. **Fix BLIND1 first** (small, high value): normalize trailing-slash hints in `hintCovers` + regression test —
   it's a live governance hole for `prompt-library/` and `model-output-evals/`.
2. **Quick token wins:** TOK1/TOK2 → return IDs, drop `excluded[]` (~83% cut on the two hottest MCP tools).
3. **Decide the execution story:** nothing calls `runCliWorker` — either (a) wire ONE production caller (a
   supervisor loop / MCP dispatch action / the sibling governed-core chokepoint) so the whole
   cliWorker+telemetry+evidence stack becomes real and `runCliWorker` stops being mesh-mandated-but-dead, or
   (b) explicitly mark the execution half "deferred" so it isn't counted as a working capability.
4. **When wiring routing:** enforce `contextWidthSpec` at prompt assembly (TOK4/TOK5) and fold telemetry into the
   budget (`aggregateCliCallTelemetryIntoBudget`) so the dual-window/spill logic has real data — before that,
   re-measure the S1 `costWeight`s (flip `verifiedLocally:true`).
5. **Close the test-confidence gaps:** unit-test `model-output:validate` (TEST2) and extract+test the codex retry
   predicate (TEST3); label `routing-guards.test.ts` as testing an unshipped module until it's wired (TEST1).
6. **Add a prompt-library schema validator to CI** (mirrors pdos:validate) so `prompt.schema.json` /
   `source-catalog.schema.json` actually gate — and promote the `claude-sonnet-5-supervisor.md` draft.
7. **Housekeeping:** either add a real `mesh:generate` script (so the generated-JSON test is a genuine drift
   guard) or delete the orphan; wire or downgrade the empty skill-registry policy; pay down the 21 templated
   dead pointers (or move them to a per-project mesh).

**Bottom line for choosing the next build:** the highest-leverage next component is a **single, governed
production dispatch path** that (a) actually calls `runCliWorker`, (b) enforces the context-width budget, and
(c) records evidence — that one wiring turns ~8 present-but-unwired subsystems from dead weight into the live,
token-bounded execution half the whole design already anticipates. Fix BLIND1 + the TOK1/TOK2 dumps alongside it.
