# Whole-system audit — autopilot-beta — 2026-07-05

**Target:** `C:/Programování/autopilot-beta` @ `main` (`f91043f` = origin/main), read-only, plus the
autopilot-related surface elsewhere on the PC.
**Method:** a 2-round, 12-lane audit. Round 1 = 9 lanes: **3× Claude Fable** (F1 *executed* the A–Z run;
F2 *ran* `verify` + 8 mutation probes in an isolated worktree; F3 security + whole-PC sweep) and
**6× GPT-5.5 xhigh, read-only** (C1 re-audit remediation, C2 plan-completion, C3 adversarial tests,
C4 defensive security, C5 prompt/skill/cleanup, C6 synthesis + entry-gate). Round 2 = 3 verification lanes
(**V1 Fable** root-cause/cascade, **V2 GPT-5.5** re-check of green-but-false tests, **V3 GPT-5.5** logging/
observability). The supervisor (Claude) ran `verify` and spot-verified every load-bearing claim against
source before recording it. Severities are calibrated for a governance **control plane**, not a runtime.

> This is a findings + recommendation record. It changes no governed file and approves no work. It
> supersedes nothing; it updates the picture from `whole-system-audit-2026-06-29.md` and the branch-side
> `project-state-2026-07-03.md`.

---

## 0. The one-paragraph truth

autopilot-beta on `main` is a **real, working, read-only governance / context-routing library with a
developer-run verification harness — not yet a non-bypassable execution control plane.** Everything that
*routes context and advises* is live, deterministic, fail-closed on load, and genuinely tested. Everything
that would *enforce* — a merge/spawn chokepoint, the routing/fallback/budget "brain", the evidence trail,
observability — is **built-but-unwired or lives only on unmerged branches.** The single root cause behind
almost every finding is one sentence: **governance and safety are enforced by CONVENTION above a hard spawn
boundary and a real-but-developer-only gate; the execution half is coded but not in the loop.** Nothing
leaks today, the tests are mostly real, and the architecture instincts are sound — but the system cannot yet
*prevent* an ungoverned path, only *advise against* one, and it cannot *observe its own failures*.

**Adjusted maturity (main):** ~**81 %** as a read-only governance/routing library · ~**51 %** as an enforced
control plane. (The prior 84/58 is fair only if you credit the unmerged branches.)

**Project-#1 readiness:** **NO on `main` today** — but the shortest path is *not* new UI; it is branch
consolidation + three out-of-repo structural moves (below). Call it **yes-with-fixes** once Phase 0 + the
governed-core merge land.

---

## 1. Ground truth the supervisor verified directly

- `npm run verify` = **fully green**: 8/8 sub-gates, **31 test files / 300 tests pass**, ~20 s total. Mesh
  ratchet: total=111, VERIFIED=81, STALE=0, MISSING=22 (frozen floor), PLACEHOLDER=8, 0 new dead pointers.
- Git hooks (read directly): **pre-commit** runs only `mesh:gate:ci` + `mesh:changed --fail-on-blocker`
  (staged) + `--fail-on-ungoverned` (added files). **pre-push** runs only `mesh:changed --fail-on-blocker`
  + `typecheck` + `pdos:fit-safety-lint --no-pages`. **Neither hook runs vitest / vendor-check /
  pdos:validate / renderability / buildability-floor.**
- **`.github/` is absent on `main`.** A `verify.yml` CI workflow exists only on `claude/agitated-robinson`.
- STALE fail-open confirmed in source (`related-files-status.ts:117-118`: a missing prior hash → VERIFIED;
  dir hints VERIFIED with no drift tracking, `:110-113`). Vendor airlock = `["product-design-os","src"]`
  only (`vendor-check.mjs:33`). `src/governed-core/` present on `agitated-robinson`, absent on `main`;
  autopilot-console's IPC client targets `<betaRoot>/src/governed-core/ipc-server.ts` → **console is broken
  against main's default layout today.**

---

## 2. main is NOT the most-complete state (the headline)

`main` lags **three superset branches that do not see each other**; each fixes real audit items:

| Branch | Ahead of main | Carries (verified) |
|---|---|---|
| `claude/agitated-robinson-9e114f` | +10 | `src/governed-core/` IPC dispatch+server (the Objective-3 chokepoint, already built) · `.github/workflows/verify.yml` (server-side CI) · `attempts` telemetry · agy read-only-by-construction · mobile R6/R1 · sibling project-mesh binding |
| `claude/rebuild-2026-07-03` | +14 | `model-output:validate` wired into `verify` · vendor-routing v2 Wave 1 · per-blocker ACK gate · audit-fix docs |
| `claude/eloquent-chatterjee-0b6e41` | +24 | OpenRouter worker lane stage 0+1 (full guard set) · ACCESS-TIER-001 · **BLIND1/2 `hintCovers` trailing-slash fix** · codex-retry test · motion P3–P6 · prompt-library fixes · shared `normalizeRelatedFileHint` |

**Dead/deletable branches:** `blissful-merkle` (== main), plus 4 branches strictly behind main
(`great-aryabhata` −1, `keen-spence` −36, `frosty-swirles` −71, this worktree's own base). Several audit
fixes are cherry-picked into two lineages with **divergent patch-ids** → future merges are *semantic*
reconciliation, not textual. This branch fragmentation is itself the biggest single liability: real fixes
exist but no one integrated them, and each new session re-derives or re-implements them.

### 2b. Which round-1 findings are ALREADY fixed on a branch (cross-branch verification)

The supervisor grepped every round-1 finding against the three branches. **Most are already solved on a
branch — merge-lag, not missing work.** This is the strongest possible argument for consolidation-first.

| Finding | Fixed on a branch? | Where / evidence |
|---|---|---|
| CI (`.github/workflows/verify.yml`) | **YES** | `agitated-robinson` |
| pre-push runs the **test suite** (closes part of the hook gap) | **YES** | `agitated-robinson` (`pre-push` adds `run test`) |
| STALE fails-CLOSED on missing/empty `--prior` | **YES** | `agitated-robinson` (`loadPriorOrDie` → `exit 2`; exact form recommended below) |
| slug-collapse regression test (`5a5f048`) | **YES** | `agitated-robinson` (`tests/decision-mesh/project-root.test.ts`) |
| `attempts` in vendor telemetry | **YES** | `agitated-robinson` (`cliWorker.ts`) |
| agy read-only **by construction** (`--sandbox` forced) | **YES** | `agitated-robinson` (`buildAgyArgs`) |
| `hintCovers` trailing-slash fix (BLIND1/2) | **YES** | `eloquent` (`normalizeRelatedFileHint`, shared normalizer) |
| codex-retry test | **YES** | `eloquent` (`tests/delivery-system/cli-worker-retry.test.ts`) |
| prompt-library validator + gate + test | **YES** | `eloquent` (`promptlib:validate` in `verify` + `prompt-library-validate.test.ts`) |
| `mesh:generate` script (make generated-JSON a real drift guard) | **YES** | `eloquent` (`scripts/generate-decision-mesh.ts`) |
| `model-output:validate` wired into `verify` | **YES** | `rebuild-2026-07-03` |
| R6 (CTA above-fold) — code exists (gating still weak) | **PARTIAL** | `agitated-robinson` (visual-qa-browser; not confirmed in a required gate) |
| **`vendor-check.mjs` tests** | **NO** | absent on all branches — genuine gap |
| **empty-packet warning** (`no_governance_matched`) | **NO** | absent on all branches — genuine gap |
| **self-approval baselines** (author edits code + excusing baseline in one commit) | **NO** | absent on all branches |
| **raw-prompt TTL / redaction sweep** | **NO** | absent on all branches |
| **document-reader full-env spawn** allowlist | **NO** | absent on all branches |
| R9 (cumulative padding) | **NO** | absent everywhere (confirms C2) |
| full-env `radeq_tmp` agy lane | **NO** (untracked — can't be branch-fixed) | root fix = promote to governed `src/` |
| global `~/.codex/config.toml` full-access | **NO** (out-of-repo) | must be fixed on the machine |
| branch protection / harness deny-rules on Bash vendor calls | **NO** (out-of-repo) | the structural half of finding A |

**Net:** the entire enforcement + security + STALE + telemetry cluster is already built on
`agitated-robinson`; the tests + prompt-lib + hintCovers cluster is already built on `eloquent`. What is
fixed on **no** branch is a short list: vendor-check tests, the empty-packet warning, self-approval baseline
hardening, raw-prompt TTL, the document-reader env allowlist, R9 — plus the three out-of-repo controls.

---

## 3. A–Z run-flow map (F1 executed this end-to-end)

| Stage | Verdict | Evidence |
|---|---|---|
| 1. Entry / MCP server (`mcp/server.ts`) | **VERIFIED-WORKS** | 18 tools, all read-only-annotated, zod live (rejected empty task with `-32602`), clean stdin-EOF exit, no orphan process |
| 2. Mesh load (`load.ts`) | **VERIFIED-WORKS** | 33 nodes / 70 edges / 30 rules; 4 broken-mesh negatives all threw (fail-closed) |
| 3. Packets (`query.ts`) | **WORKS-WITH-GAP** | blocker-truncation invariant holds (16 combos, 0 viol); project meshes pairwise-distinct. GAP: a task with no signal-match returns a **silent empty packet** (0 rules/0 stops, no warning) — hit a real radeq task |
| 4. Bind-points ①② | **WORKS-WITH-GAP** | `mesh:gate:ci` exit 0; deny paths fire for real (WORKER-CLI-001 → exit 1, AF3 ungoverned → exit 1). MISSES: `mcp/server.ts` edits (majors only, no blocker); files outside hints+sensitive-roots pass (documented fail-open) |
| 5. Vendor lanes (`cliWorker*.ts`) | **WORKS-WITH-GAP** | codex read-only sandbox + shq escaping + bounded retry real; agy dangerous-flag default-OFF + tree-kill. **No budget check in the spawn path** (the dual-window brain is not called here). Canonical `session-state/` empty in both repos; raw prompts persist unredacted in `%TEMP%`; `attempts` dropped before telemetry |
| 6. Routing / fallback / budget brain | **DEAD WIRING (code) / partly DEFERRAL** | `buildSupervisorRoutingDecision`→`resolveFallback`→circuit breaker called by nothing in the spawn path. `runCliWorker` spawns whatever vendor/model the caller passes. See §6 for the corrected read |
| 7. OpenRouter stage-1 client | **ABSENT ON MAIN** | zero hits in `src/` at HEAD; exists guarded on `eloquent`. The memory note "VŠE LANDED" is drift vs main |

---

## 4. Findings by theme (reconciled across both rounds; ✓ = supervisor-confirmed in source)

### A — Enforcement is developer-only *(the #1 structural gap)*
✓ Hooks are narrower than `verify`; no CI on main. All 8 of F2's mutation probes (env-scrub off,
blocker-truncation, shq-weaken, sensitive-deny off, fit-safety break, slug-collapse, retry-unbounded,
vendor-root drop) **sail through a hook-passing commit+push**. The behavioral safety net lives only in
developer-run `verify`.
**Round-2 correction (V1):** merging CI does *not* fully close A. `verify.yml` runs on push (detection
after the fact), branch protection is a GitHub setting that can't be committed, and the workflow is editable
by the same agent it polices. **The true root: the only enforcement point is a machine where the agent has
full write access — and every real vendor call today is a Bash `codex exec`/agy invocation that no
import-boundary test or IPC server constrains.** Structural closure needs three *out-of-repo* moves:
(1) GitHub branch protection + required `verify` check; (2) Claude-harness permission deny-rules on direct
vendor-CLI Bash outside the sanctioned read-only pattern; (3) fix the global codex config (§C).

### B — Tests: real, but with specific coverage voids + green-by-construction gates
✓ The suite is genuinely strong: mutation probes turned it RED for env-scrub, blocker-truncation, shq,
sensitive-deny, fit-safety. Not a false-green suite. **But** round-2 (V2) revised the *reality-coupled*
share down: ~50 % of the tested surface, **~35–40 % for UX/release truth**, because the release *gates*
lean on curated examples, mutable baselines, committed-tree cleanliness, and generated==current equivalence.
- **Self-approval baseline holes (the deep pattern, V2+V1):** `related-files-baseline/snapshot`,
  `fit-safety-baseline.json`, `vendor-manifest.json` `beta_authored`/`patched_by`, `decision-mesh.json` —
  an author can edit the code *and* the baseline that excuses it **in the same commit, with no second
  signal**. This is the mechanical root of "green but not correct".
- ✓ STALE fails **open** when `--prior` is missing/`{}`; dir hints have no drift tracking.
- **Green-by-construction gates (V2, new vs round 1):** buildability floor *excludes* `visual_qa` from its
  pass/fail verdict (a test even codifies that low contrast keeps `build_floor_passed === true`);
  renderability/buildability are *vacuously green* on an empty default target set; PDOS `validate` warnings
  print but never fail `verify`; `install.mjs` reports success while leaving a foreign `core.hooksPath`
  untouched (hooks can be silently inactive).
- **Untested load-bearing logic:** `scripts/vendor-check.mjs` (0 tests), `captureCodexResponse` retry loop,
  the CLI wrappers + git hooks, `validate-model-output-evals.ts`, `modelOutputEvaluation.ts`.
- **Round-2 correction (V1):** the codex-retry test *already exists on eloquent*
  (`cli-worker-retry.test.ts`) — the void is a **merge-lag symptom, not a missing artifact.** Do not
  re-implement; take it via merge.
- **Round-2 correction (V2):** "8 PLACEHOLDER pointers baselined" was imprecise — PLACEHOLDERs pass by
  exclusion, not baselining; a missing `--baseline` file does *not* green the gate (only missing `--prior`
  is the fail-open path). Corrected here.

### C — Security: leak-free today; hard at the spawn boundary, convention-only above it
✓ **No secret leak** — OPENROUTER key value-prefix probe = 0 hits across beta + console + PC root; telemetry
stores counts/hashes only; git history clean. **No CRITICAL findings.**
- **HIGH — raw prompts/outputs persisted unredacted** in `%TEMP%` (~9 MB, 1000+ files, no TTL) + agy clean
  output to stateDir. **Round-2 correction (V1):** CLAUDE.md's hard boundary forbids storing raw
  prompts/logs *globally* (the hooks-only scoping is AGENTS.md's) → the honest posture is **non-compliant,
  needs an explicit documented carve-out for worker buffers + TTL**, not "compliant by letter".
- **HIGH — arbitrary remote egress** in PDOS capture scripts (`page.goto(--url)`), operator-invoked, ungated.
- **MED — two full-host-env spawn paths bypass the `buildVendorEnv` allowlist:** `radeq_tmp/.autopilot/
  agy-brainstorm.cjs` (`env: process.env`) and `product-design-os/reader/document-reader-adapter.ts` (Python).
  **Round-2 (V1):** the radeq_tmp lane is *untracked/gitignored* — no commit can fix or keep it fixed; the
  root fix is to **promote the agy-pty lane into governed `src/` and delete the scratch.** The Python
  doc-reader is a local, non-network tool → accepted-risk note, and scrubbing its env can break venv
  resolution (`PYTHONPATH`/`VIRTUAL_ENV`).
- **MED — vendor FS scope** (`cwd`/`addDirs`/`images`) caller-controlled, repo-boundary not enforced.
- **MED — "never pass raw agent output as the next prompt" is unenforced in code** (`runCliWorker` accepts
  an arbitrary prompt string); task text reaches packets with zod *shape* validation only, no instruction
  isolation.
- **HIGH (PC-global) — `~/.codex/config.toml` = `danger-full-access` + `approval_policy=never` + `trusted`
  for all of `C:\` and `C:\Users\sirok`.** Any ad-hoc codex run anywhere on the machine is unrestricted; our
  lane overrides only per-invocation. **V1 flags this as the single highest real-world-leverage security
  item, and no round-1 fix touched it.**
- **MED (PC) — a PAUSED autonomous cross-project codex/qwen watchdog** is still installed in
  `~/.codex/automations` (30-min heartbeat, 100-iteration qwen loop across all of `Projects/`).

### D — Routing/execution brain: mostly DEFERRAL, one real bug
✓ `buildSupervisorRoutingDecision` and the circuit breaker are test-only on main.
**Round-2 correction (V1) — do NOT "fix by wiring":** the "rate-limit branches are no-ops" reading is
doctrinally misread — `modelPolicy.ts:882-888` returns the *same* provider on rate-limited/exhausted, which
matches the owner's hard rule *"never auto-switch models; stop and wait."* The routing-activation dormancy
is *recorded owner intent* (activate the openrouter_free lane only after tiered evals). Wiring the brain
would let a **half-verified cost model** (gemini tier `verifiedLocally:false`) route real work — worse than
dormancy. The **one genuine bug** in this theme is the silent empty packet (§3, stage 3). The correct move
is to *decide* the routing brain (activate-after-evals or explicitly mothball + annotate), not to wire it.

### E — Observability: observability-shaped, not observability-operational (V3)
✓ `attempts` returned (`cliWorkerCapture.ts:384`) but dropped from `CliCallTelemetryRecord`. Canonical
`session-state/` empty. **V3 mapped 14 log sinks; the load-bearing ones are write-only:** CLI telemetry
(no summary reader), supervisor alerts (`resolveAlert` unused — pending alerts just accumulate), hook
investigation queue (no consumer), gate stdout (pass/fail history lost, `--no-verify` invisible), raw temp
artifacts (no TTL), subagent evidence tree (read API exists, no owner-facing surface).
**The owner cannot answer from stored data:** "how many vendor calls this week / how many retried / quota
left / which gates failed." `aggregateCliCallTelemetryIntoBudget` is unit-tested but **not wired to the
telemetry file.** **Round-2 caution (V1):** adding `attempts` to a record nobody reads closes the finding
without touching the root — **build one aggregation reader first, then add fields.**

### F — Plan-completion (C2): most over-claimed = mobile R1–R10
- **PASS:** E1 slug resolver, E4 ratchet, AF2 env-scrub, AF4 packet-blocker, R2/R3/R4/R8 static lint.
- **MISSING on main:** INFRA1 CI/release gate; R6 (CTA above-fold) & R9 (cumulative-padding) not in code.
- **Most over-claimed:** "R1–R10 enforced + 6 components verified on real phones" — reality is static
  fit-safety lint in `verify`; browser QA is a separate script not in `verify`/hooks; R6 is built only on a
  branch, R9 is absent everywhere. **Round-2 correction (V1):** round-1 said "R6/R9 absent from code
  entirely" while the topology section credited agitated-robinson with R6 — corrected: *absent on main; R6
  on a branch; R9 absent everywhere.*
- **Doc-rot:** docs reference nonexistent scripts (`mesh:check`, `mesh:generate`, `prompt:validate`,
  `model-output:validate`, `contracts:validate`, `audit:deps`); `next-session-continuation-plan.md`
  references nonexistent `scrapeflow`/`zednik-hero` checkouts; `README.md` is pre-consolidation stale;
  `GEMINI.md` omits mesh order / stop-condition / `npm.cmd` quirk / gates (safe only if Gemini is always
  handed a prepared packet).

### G — Prompt / skill / plugin layer (C5)
Provider docs uneven: AGENTS.md authoritative, CLAUDE.md a good thin wrapper, GEMINI.md incomplete, README
stale. `prompt-library/` = 51 real contracts but **enforcement is aspirational** (no `prompt:validate` gate;
validator script absent; `selectPromptLibraryRoute` unwired). Registry reality: 45 pattern / 42 asset / 13
contract entries but **only 6 concrete renderers**; `skill-registry.json` empty; `workflows.ts` is a typed
contract, not a live engine. No unused npm dependencies; all script paths exist (the issue is
manual/unwired, not broken).

---

## 5. Is the entry gate (Objective 3) worth building — and is governed-core the answer?

**Verdict: use what exists + merge/harden governed-core — do NOT build a new runtime or a new chat UI.**

- **Claude Code already covers most of the front door** (transcript, `/tasks` progress, diff review, remote
  control, session/preview links). Rebuilding chat/progress/diff would be wasted. The real gap is
  Autopilot-specific: mesh packet, stop-conditions, ACKs, project-mesh status, governed vendor runs,
  verification status, preview artifacts.
- **A custom UI is safe only as a thin client over `governed-core`.** That chokepoint (IPC dispatch+server)
  **already exists on `agitated-robinson`**, and autopilot-console is already the thin IPC front door →
  the move is **merge + harden, not build.**
- **Round-2 reality check (V1) — governed-core is a good door, but the wall is missing.** Verified on the
  branch: (1) the boundary test is a regex over `src/**/*.ts` only — blind to `scripts/`,
  `product-design-os/`, direct `child_process.spawn("codex",…)`, and the untracked radeq_tmp pty lane;
  (2) the **live bypass channel is Bash** — every real session (including these audit lanes) spawns vendors
  via `codex exec`/agy, which no IPC server constrains; (3) even *through* the chokepoint, `dispatch.ts`
  refuses on only three things (self-computable packet-hash freshness, empty `required_checks` array,
  no-viable-provider) — it never branches on stop_conditions/blockers, the prompt stays an arbitrary
  string, and **routing does not route** (vendor/model come from the caller; the decision only annotates
  `tier_id`). So merging it buys a single audited path with consistent env-scrub/locks/telemetry/allowlist —
  valuable discipline — but it **moves the convention boundary up one level ("use the console, not Bash")**.
  Structural closure still requires the three out-of-repo moves in §A.

---

## 6. Recommended sequencing (corrected by V1 — cascade-aware)

C6's merge order was directionally right but incomplete. The corrected plan lands cheap, conflict-free
fixes and the *structural* half of enforcement **before** the big merges:

**Phase 0 — land on main first.** Per §2b, STALE fail-closed and the slug-collapse test are *already on
`agitated-robinson`* (in the exact recommended form) — they arrive via the Phase-2 merge, do **not**
re-implement them. The genuinely branch-less fixes to land now (~zero merge-conflict surface) are:
1. `vendor-check.mjs` vitest coverage (VENDOR_ROOTS assertion + tamper fixture).
2. Empty-packet warning in `buildAgentPacket` (`no_governance_matched` flag).
3. Self-approval baseline hardening (fail CI on new `beta_authored`/`patched_by`/baseline entries unless a
   separate reviewed waiver exists) — the mechanical root of "green but not correct".
4. **Out-of-repo, same day (the real structural half of finding A):** fix `~/.codex/config.toml`
   full-access default; add Claude-harness permission deny-rules for direct `codex`/`agy` Bash outside the
   sanctioned read-only pattern; enable GitHub branch protection so the merged CI becomes *required*.
5. **Anti-rule:** do NOT re-implement `attempts` telemetry / codex-retry test / `hintCovers` fix / STALE
   fail-closed / slug-collapse test / R6 / CI on main — they arrive via merge; fresh variants reproduce the
   ACK-triplication pathology.

**Phase 1 — one-page reconciliation ADR before any merge:** pre-decide the winners — ACK = `Mesh-Ack:`
node-grammar commit-trailer (auditable consent journal, *not* enforcement — a committer can self-ack, so it
must be owner-reviewed, never treated as a prevention gate); `hintCovers` = eloquent's shared
`normalizeRelatedFileHint`; the `load.ts` slug-resolution semantics.

**Phase 2–4 — merge one branch per reviewed step, `verify` green between each, `git diff --stat` per merge:**
agitated-robinson (chokepoint + CI; land browser-QA as a **non-required** CI job to avoid flake→red-fatigue)
→ rebuild-2026-07-03 → eloquent-chatterjee. Expect *semantic* conflicts in `package.json`, hooks,
`cliWorker*.ts`, `query.ts`, mesh snapshots/generated JSON, `changed-files-capabilities*`, vendor-manifest.

**Phase 5 — post-merge:** promote the agy-pty lane from `radeq_tmp` into governed `src/` + delete the
scratch; build **one** telemetry aggregation reader (`telemetry:summary` or an MCP tool) *before* adding
telemetry fields; then **decide** the routing brain (activate-after-evals or mothball+annotate).

**The single thing most likely to be papered over (V1):** declaring the chokepoint "done" after the
governed-core merge while every real session keeps spawning vendors through Bash under a full-access global
codex config. The enforcement for the *actual* channel lives outside the repo — and none of it was in the
round-1 fix list.

---

## 7. Minimum observability spine (V3) — so these deficiencies become self-evident

Add one redacted JSONL event stream (or extend `cli-call-telemetry.jsonl`) with linked events — all
hash/count/enum, no raw content, so it respects the redaction rules:
`governance_match` (relevant_node_count, no_governance_matched) · `route_decision` (assigned vs actual
vendor, mismatch flag) · `vendor_call` (+ attempts, first_attempt_outcome, retry_reason, output/prompt
hashes) · `budget_usage` (provider/tier/window deltas, quota remaining/reset) · `gate_outcome` (gate name,
commit/range, exit, failed_check_ids) · `alert_lifecycle` (created/read/resolved). Plus **one read-only
aggregation surface** — `npm run telemetry:summary -- --since 7d` or MCP `summarize_control_plane_telemetry`
— reporting no-match rate, route-vs-spawn mismatches, retries, budget windows, open circuits, failed gates,
unresolved alerts, corpus freshness. Keep raw prompts/outputs ephemeral with TTL cleanup (carve-out for
eval-flagged records per the tiered-eval regime).

---

## 8. Structure map + cleanup

**Annotated top-level (alive / dead / gate coverage):** `mcp/` read-only MCP server (alive, tested) ·
`mesh/` YAML source-of-truth + ratchets (alive, gated) · `src/lib/decision-mesh/` engine (alive, tested) ·
`src/lib/mesh-tools/` bind-points (alive, gated) · `src/data/delivery-system/` policy/routing/vendor lanes
(alive code, **execution half unwired**) · `product-design-os/` renderer + QA (alive; many manifest entries
are catalog metadata, only 6 render-backed) · `prompt-library/` 51 contracts (alive, **no validation gate**)
· `scripts/` vendor-check + hooks + eval validator (partly wired) · `tests/` vitest (alive, `test` gate) ·
`model-output-evals/` (schemas + empty corpus → deferred) · `docs/` (mixed alive + stale history) ·
`output/` (gitignored artifacts).

**Cleanup — in-repo:** `skill-registry.json` empty (seed or label reserved); `model-output-evals/records/`
empty; 3 orphan worktrees in `.claude/worktrees`; `settings,local.json.txt` typo-duplicate; stale gate docs
(§F doc-rot); README/continuation-plan corrections. No unused deps.
**Cleanup — off-repo (owner action, none touched):** empty `C:\Programování\autopilot` (canonical already
archived to `_backups`); `radeq_tmp` 18 MB (harvest → delete, after promoting the agy lane);
`radeq_html.txt` (0 B) + `radeq_raw.html` (243 KB); 2 config `.bak`s in `~/.codex`; `CODEX_CLOUD_*.md`
one-offs; the paused `~/.codex/automations` watchdog; `%TEMP%\autopilot-handoffs` + `autopilot-codex-captures`
(~9 MB, needs TTL).

---

## 9. What phase autopilot is in — excels / weak

**Phase:** a **matured advisory governance library on the cusp of becoming an enforced control plane** —
gated by integration (three superset branches) and three out-of-repo structural controls, not by missing
design. The design is largely done; the *wiring and enforcement* are the frontier.

**Excels at:** deterministic mesh/MCP context routing (33/70/30, 18 read-only tools, fail-closed load) ·
honest developer-run verification (`verify` = 8 gates, 300 real tests) · a hard, tested vendor **spawn**
boundary (env-scrub, codex read-only sandbox, shq escaping, agy flag-gating) · sound separation (root mesh
vs project mesh; advisory vs source-of-truth) · leak-free secret hygiene.

**Weak at:** non-bypassable enforcement (no CI/branch-protection/harness rules on main; the real vendor
channel is unconstrained Bash) · self-observability (write-only sinks, no aggregation, no evidence trail) ·
green-by-construction gates + self-approvable baselines · branch fragmentation (real fixes stranded on 3
unmerged lineages) · doc-truth drift · the execution brain being built-but-undecided (dormant by intent, but
un-annotated as such).

---

## 10. The single next move + readiness call

**Single next move:** open one integration branch off `main`, land **Phase 0** (the four cheap fixes + the
three out-of-repo structural controls), then merge **`agitated-robinson` first** (governed-core chokepoint +
CI) under the Phase-1 reconciliation ADR.

**Readiness for project #1:** **NO on `main` today → yes-with-fixes** once Phase 0 + the governed-core merge
land and the Bash vendor channel is constrained by harness permission rules. The blocking gap is not UI and
not design — it is that the control plane can still be bypassed by construction, and cannot yet observe when
it is.
