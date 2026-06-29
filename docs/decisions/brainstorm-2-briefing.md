# AUTOPILOT-BETA — RE-AUDIT + PLAN-COMPLETION + ENTRY-GATE DECISION (brainstorm briefing)

You are one of several model families (gpt5.5-xhigh / opus-4.8-ultracode / gemini-3.1-pro /
gemini-3.5-flash) brainstorming autopilot-beta through-and-through. You have READ access to the repo
(cwd, `origin/main`) and its data — VERIFY every claim against real source; do not trust this briefing
blindly. **PROPOSAL / AUDIT ONLY: change no file.** Be decisive and file-grounded, not a survey. Where you
disagree with the briefing or find it stale, say so with the file. This runs in 2 rounds: round 1 is your
independent take; round 2 you receive the other families' outputs as opposition.

## What autopilot-beta is (current state, post-remediation)
A governance / decision / capability-routing control plane for an AI-agent system, NOT a product runtime.
The single self-contained, portable source of truth on `origin/main`. Three planes: GOVERNANCE (live — the
Decision Mesh: ~33 hand-authored YAML policy nodes + typed weighted edges + ~30 rules; engine in
`src/lib/decision-mesh/`; MCP server `mcp/server.ts` with 18 read-only tools), DISCOVERY (deliberately
minimal — bind-point ① related_files gate), LEARNING (deferred). Bindings: bind-point ① (related_files
status + ratchet, NOW with a committed snapshot so it detects content DRIFT/STALE, not just deletion),
bind-point ② (changed-file → governing nodes/rules, with a sensitive-roots "newly-added ungoverned file"
deny in the pre-commit hook). Gates: `npm run verify` (vendor-check + typecheck + vitest 300 + pdos:validate
+ renderability + buildability + fit-safety + mesh:gate:ci) + git pre-commit/pre-push hooks (dogfooded).
Vendor lanes via `runCliWorker` / `cliWorkerCapture.ts`: codex (now read-only sandbox + shq-escaped args +
bounded retry), agy/gemini (now tree-killed teardown + `--dangerously-skip-permissions` gated opt-in,
default OFF), env scrubbed of host secrets before any vendor spawn.

A 2-round 4-family audit on 2026-06-29 scored the system ~70% as a read-only governance/context-routing
library / ~45% as an enforced control plane, and found: governance was advisory (mesh never branched on
blocker; packets could truncate blockers away), STALE was doubly-dead, verify was RED on gitignore-blind
vendor-check, changed-files failed open, env leaked to vendor spawns, the vendor exec lane was unsandboxed.
A 14-commit remediation (AF1–AF6, INFRA1/2, STALE wiring, gate-agy, + residuals) then closed every
actionable finding — see `docs/decisions/whole-system-audit-2026-06-29.md` for the baseline. **Your job is
to audit the NEW state and the plan, NOT to re-find the already-fixed.**

How the owner operates today: runs autopilot as a raw Claude Code session (CLI/app) — types to Claude,
which orchestrates the vendor lanes + the mesh. The owner finds this "open" and wants a contained front door
(Objective 3). The first real supervised project has NOT been onboarded yet.

## WHERE EVERYTHING IS (repo map — verified at HEAD 2206a28, start here)
- **Repo root + remote:** `C:/Programování/autopilot-beta` · `git@github.com:SirRadek/Autopilot-beta.git`
  (branch `main`). Self-contained + portable (copy the folder + `npm install`). `npm.cmd` not `npm` on Win.
- **GOVERNANCE — Decision Mesh:** `mesh/` → `nodes/` (33 `*.yaml` policy nodes), `edges.yaml`, `rules.yaml`,
  `schemas/`, `generated/`, ratchet artifacts `related-files-baseline.json` (MISSING floor) +
  `related-files-snapshot.json` (drift/STALE snapshot, NEW).
- **Engine:** `src/lib/decision-mesh/` → `load.ts` (loader + fail-closed `validateMesh`), `query.ts`
  (scoring + packet builders `buildAgentPacket`/`buildProjectMeshPacket` + the severity-aware
  `withRelevantBlockerNodes`), `types.ts`, `capabilityMirror.ts` (TS↔YAML drift lock), `graph.ts`, `index.ts`.
- **MCP server (the agent-facing surface):** `mcp/server.ts` — 18 read-only tools. Run: `npm run mcp`.
- **Bind-point ① (related_files status + ratchet):** `src/lib/mesh-tools/related-files-status.ts` + `-cli.ts`.
- **Bind-point ② (changed-file → governing nodes/rules + ungoverned-sensitive):**
  `src/lib/mesh-tools/changed-files-capabilities.ts` + `-cli.ts`.
- **Vendor lanes + harness (codex/agy):** `src/data/delivery-system/cliWorkerCapture.ts`
  (`buildVendorEnv`/`buildCodexBashCommand`/`buildAgyArgs`/`shq`/`killProcessTree`) + `cliWorker.ts`
  (`runCliWorker`, locks/telemetry/budget). Routing/policy lives in the same dir (23 modules):
  `modelPolicy.ts`, `capabilities.ts`, `subscriptionBudget.ts`, `routingGuards.ts`, `fallbackChains.ts`,
  `protectiveSupervision.ts`, `workflows.ts`, etc.
- **Gates (package.json scripts):** `verify` (the aggregate) = `beta:vendor-check` + `typecheck` + `test`
  (vitest, `tests/`) + `pdos:validate` + `pdos:renderability` + `pdos:buildability-floor` +
  `pdos:fit-safety-lint` + `mesh:gate:ci`. Also `mesh:gate`, `mesh:changed`, `mesh:snapshot:regen` (manual
  STALE regen), `pdos:visual-qa-browser`, `pdos:render`. Airlock: `scripts/vendor-check.mjs` +
  `vendor-manifest.json` (VENDOR_ROOTS = `product-design-os`, `src`).
- **Enforcement wiring:** git hooks `scripts/git-hooks/` (`pre-commit`, `pre-push`, `lib.sh`, `install.mjs`,
  via `core.hooksPath`); codex runtime hooks `.codex/hooks/autopilot-hook.mjs` + `.codex/hooks.json`
  (report-only).
- **Product Design OS (the thing autopilot renders/QAs):** `product-design-os/` → `renderer/`
  (`render-composition.ts` + `components/`), `qa/fit-safety/` (static R2–R8 checks + baseline),
  `qa/visual-qa-browser/` (Playwright; `check-visual-qa-browser-…ts` viewport matrix incl. 320/360/414),
  `scripts/` (capture/route/score), `specs/examples/`, `patterns/`, `tokens/`, `recipes/`.
- **Docs:** `docs/decisions/` → **`whole-system-audit-2026-06-29.md` (the prior-audit baseline — READ FIRST)**,
  `autopilot-v0.2-three-plane-adr.md`, `next-session-continuation-plan.md`. `docs/autopilot/` (operating
  models + `autopilot-mobile-responsive-rules.md` R1–R10). `docs/projects/<slug>/decision-mesh/` — 3 project
  meshes: `autopilot-control-plane`, `multi-agent-autonomous-delivery-system`, `radeq`.
- **Per-project mesh layout (for a supervised project repo):** `<project-repo>/.autopilot/decision-mesh/nodes/…`
  — the slug-respecting resolver (`loadProjectDecisionMeshFromRoot`). NOT present in autopilot's own root
  (`.autopilot/` absent) — no first project onboarded yet (relevant to Objective 3 readiness).
- **Deferred-plane evidence:** `model-output-evals/records/` (only a README → learning plane E7 deferred);
  `prompt-library/`; `output/` (gitignored render/QA outputs); `radeq_tmp/.autopilot/agy-brainstorm.cjs`
  (the agy node-pty lane this brainstorm runs on).
- **Vendor CLI recipes (how this brainstorm's lanes run):** codex =
  `codex exec -c sandbox_mode=read-only -c approval_policy=never -o <out> - < <prompt>` (from repo cwd);
  agy = `node radeq_tmp/.autopilot/agy-brainstorm.cjs <promptfile> <outfile> [model] [timeoutMs]` (node-pty;
  models `gemini-3.1-pro-high` / `gemini-3.5-flash-high`); Opus = the Workflow tool.

---

## OBJECTIVE 1 — Re-audit the post-remediation system (through-and-through)
Same rigor as the prior audit, on the NEW state. For bindings, security, and capabilities:
1. **Did the remediation actually hold + introduce no regressions?** Re-verify the load-bearing fixes
   against source: STALE wiring (is the snapshot + --prior + ratchet real, and is the human-gate regen NOT
   in any hook?), severity-aware packet (can a relevant blocker still be truncated?), env-scrub, codex
   sandbox/escaping/retry, agy flag-gating + tree-kill, the changed-files ungoverned-sensitive deny.
2. **What is NOW genuinely 90%+ done with certainty** vs still weak / self-declared / latent?
3. **What NEW gap did the remediation create or expose?** (e.g. the AF3 sensitive-roots set, the snapshot
   regen being reflexively run, the retry masking a real failure, the `attempts` field unused in telemetry.)
4. Re-score maturity (router % AND enforced-control-plane %) with justification, and name the single
   highest-leverage thing still missing.

## OBJECTIVE 2 — Plan-completion verification (was it all done, and CORRECTLY?)
Audit completeness + correctness against the actual plan, not vibes:
1. **The etapy E0–E7** (ADR, classify, load.ts, bind-points ①/②, v0.2 consolidation, + the DEFERRED E2
   project-repo hygiene, E3 self-maint lane, E7 learning plane): is each "done" really done, and is each
   "deferred" a SOUND measured-pain deferral or an avoidance of the hard part?
2. **The AF/INFRA remediation**: for each fix, is it complete + correct, or partial / papered-over / a
   narrower thing than the finding it claims to close? (e.g. is AF3's deny actually meaningful given the
   mesh covers ~0 of the control plane's own code? is AF5/INFRA2 containment coverage real or token?)
3. **The mobile rules R1–R10** (fit-safety + visual-qa floor): operationalized + actually firing, or
   asserted? Were the 6 components really verified, or is that stale?
4. **The gap between claim and reality**: anything the docs / commit messages / CLAUDE.md / ADR claim that
   the code does NOT do (the audit found several doc-rot cases — are there more?). Any planned thing
   silently dropped or half-finished.
Output a per-item PASS / PARTIAL / MISSING table with evidence + the one item most over-claimed.

## OBJECTIVE 3 — Single entry gate: build a front door, or use what exists? (DESIGN + recommendation)
The owner wants ONE simple interface to (a) talk to Claude/the autopilot supervisor, (b) see live activity,
(c) view the agents'/vendors' work, (d) get preview links (rendered components, visual-qa). Three fears to
resolve decisively:
1. **"Does the Claude app already offer enough?"** Survey what Claude Code (CLI + desktop/web app) ALREADY
   provides toward (a)–(d): the /workflows progress tree, the transcript, task/spawn chips, the
   visualize/preview tooling, background-task notifications. Be concrete: what's covered already vs the gap
   a custom front door would fill. Do NOT recommend building what already exists.
2. **"Won't a custom UI BYPASS autopilot?"** This is the crux. A naive front door that talks to an LLM
   directly circumvents the Decision Mesh, the gates, and the vendor lanes — i.e. it would be the exact
   ungoverned path the whole system exists to prevent. Design the entry gate so it is a GOVERNANCE
   CHOKEPOINT, not a bypass: every request funnels through `build_agent_packet` / the mesh + the gated
   vendor lanes; the UI is a thin display+input shell over the autopilot supervisor, never a direct
   LLM/codex/agy caller. Specify the exact boundary (what the UI may call vs what only the governed core may
   call) and how to make a bypass structurally impossible (not just discouraged) — connect this to the
   audit's recurring "enforced-by-construction vs by-convention" theme.
3. **"Is it ready for the first project?"** Define the MINIMUM to onboard project #1 safely: input
   isolation (what "isolated input" should mean + whether it's worth it), the per-project mesh
   (`<repo>/.autopilot/decision-mesh`, now slug-respecting), the gate/preview wiring, and a concrete
   readiness checklist. Is the control plane actually ready, or is there a blocking gap?
Deliver: a build-vs-use-existing verdict; if build, the THINNEST viable governance-enforcing design (a
small sketch — components + the chokepoint boundary + the bypass-prevention mechanism); and the
project-#1 readiness checklist. Flag every recommendation [measured-pain] or [speculative]; the owner's
ethos is to not build speculative infrastructure.

---

## What to produce (per family, round 1)
A decisive, file-grounded report: (O1) re-audit verdict + maturity re-score + the top NEW/remaining gap;
(O2) the PASS/PARTIAL/MISSING completion table + the most over-claimed item; (O3) the entry-gate verdict +
thin design + bypass-prevention mechanism + project-#1 readiness checklist. End with ONE overall
recommendation: the single most important next move, and whether the system is ready for project #1
(yes / yes-with-N-fixes / no). Disagreement and what everyone else will miss are worth more than agreement.
