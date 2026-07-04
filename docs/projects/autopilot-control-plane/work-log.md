# Autopilot Control Plane Work Log

## 2026-07-03 page_profile Dual-Track + Motion Brief Contract (P0–P2)

Date: 2026-07-03
Request or trigger: owner supplied a "motion effect production system" design;
pairing audit + independent GPT-5.5 xhigh opposition review (codex read-only +
web search, verdict GO-WITH-CHANGES); owner ratified start of P0–P2. See
`docs/decisions/page-profile-dual-track-adr.md` for decisions and deferrals.
Mode: governed implementation in worktree branch (3 parallel Fable 5 subagents
with disjoint file ownership + supervisor integration/review). No push.

Landed:

- P0: canonical `page_profile` enum (`seo_led|balanced|brand_led|
  experimental_showcase`) required in recipe + project-brief schemas; all 8
  recipes declare it; `rules/design-seo-tradeoff.md` names the canonical field;
  new `recipes/standard-web-fast.json` (normal fast-pages track, seo_led,
  motion_level 1).
- P1: `qa/profile-check-matrix.json` (+schema +loader) — 44 codes × 4 profiles,
  fail-closed (unknown code/profile → blocking); `--profile` wired into
  fit-safety and visual-qa-browser (default `balanced` = decision-identical to
  prior behavior); only 2 downgrades, both experimental_showcase-only, reasons
  recorded; downgraded findings stay reported (`advisory_profile` /
  `profile_downgraded_reasons`).
- P2: `briefs/motion-brief.schema.json` + `motion-brief-template.md` (driver/
  objects/states/constraints/acceptance, NEED_SPEC_CLARIFICATION protocol);
  `pdos:validate` now requires the new files and validates `briefs/motion/*.json`
  and the matrix.
- Integration: score-baseline fixtures regenerated (all 7 `selected_recipe`
  winners unchanged; standard-web-fast is runner-up on public-sector input);
  f1a recipe count 7→8; vendor-manifest: 3 files marked
  `patched_by: page-profile-p0`, 6 new files registered `beta_authored`.

Verification: `npm run verify` full pass (vendor-check OK 77 pristine + 44
patched; ratchet 0 new dead / 0 stale); `mesh:changed --since origin/main
--fail-on-blocker` → 25 changed, 0 blockers; targeted suites f1a 6/6, f5 5/5,
f7 5/5, profile-matrix 14/14, f8 visual-qa 6/6, f2 fit-safety 8/8.

Deferred (measured-pain order, see ADR): P3 motion-stack decision tree +
candidate_source entries + dated evidence records; P4 preset layer; P5
visual-qa scroll-progress + debug-API convention; P6 skills adoption
(`greensock/gsap-skills` first candidate). visual-qa-browser stays a per-task
gate, not part of `verify` (owner decision). Motion-lab/demos belong to a
supervised project repo as part of the beta bootstrap, not this control plane.

## 2026-06-21 VEM Live Capture + AST-Stamp Decision

Date: 2026-06-21
Request or trigger: owner asked to (1) run the VEM element-map capture against
the live radeq preview instead of sample HTML, and (2) decide whether to add a
build-time AST stamp for 100% source:line binding.
Mode: READ_ONLY verification + architecture decision (Opus). No product runtime
code, no radeq-repo changes, no commit/push. One read-only target URL load.

Live capture (decision: done):

- Ran `pdos:reader:element-map -- --url https://sirradek.github.io/radeq/`
  (live Pages deploy, HTTP 200; no PR preview active, so used the stable
  same-pipeline deploy). Artifacts under `output/playwright/radeq-live/`.
- `captureElementMap` + pure `resolvePointToPassport` both work on live:
  `--xy desktop 174 793` resolved to the burgundy `#7a1f2b` "Napsat poptávku"
  CTA, correctly picking the topmost paint-visible node.
- SourceRef coverage: `0` real / `100%` `unknown`; `identityConfidence` all
  `medium`, `0` `high` — the production Astro build ships no `data-source-*`.
- Determinism caveat: node count varied `92 → 66` across runs; the hero is a
  Three.js WebGL `<canvas>` captured at different `rAF`-settle states.
- Stack confirmed via `gh`: Astro 6 + React 19 islands + Tailwind 4 + Three.js.

AST-stamp decision (owner-ratified: DEFER):

- "100% source:line" is architecturally impossible here: (a) the Three.js hero
  canvas has no DOM sub-elements to stamp; (b) `.astro` has no first-party
  source-stamp (`jsx-source` is dev-only and React-islands-only); (c) Pages is
  public, so stamping `data-source-*` into shipped HTML discloses the source tree.
- Decision: do NOT build a stamp now. Use the existing `medium`-confidence
  locator (domPath + role + accessibleName + textSnippet + rect + thumbnail crop)
  as the bounded-fix locator; Codex `rg`s radeq source from it.
- Phase-2 trigger: only if repeated/generic nodes (e.g. a grid of identical
  cards) demonstrably fail to disambiguate. If triggered, the mechanism MUST be
  preview-build-only or a non-shipped sidecar source-map (never production HTML),
  scoped to `.astro` + React islands, with canvas regions marked unaddressable.
  That work is a radeq product-repo change requiring its own bounded handoff and
  owner approval.

Files:

- `output/playwright/radeq-live/` (capture artifacts; gitignored output dir)
- `docs/projects/autopilot-control-plane/work-log.md`

Verification:

- `npm.cmd run pdos:reader:element-map -- --url https://sirradek.github.io/radeq/ --output-dir output/playwright/radeq-live`
  produced the map + screenshots; `--xy desktop 174 793` produced the resolved
  echo payload + thumbnail crop. No repo source files changed.

## 2026-06-21 Remove Radeq Project State from Control Plane

Date: 2026-06-21
Request or trigger: owner approved relocating radeq project state to the radeq
repo (per the repository-separation convention) and removing the control-plane
copies, choosing the canonical control-plane line as the authoritative radeq mesh.
Mode: WRITE_ALLOWED for deleting migrated radeq artifacts and fixing the
resulting references. Cross-repo writes were made in `SirRadek/radeq` (the import
PRs) and here.
Scope: delete radeq project state from the control plane after re-validating that
the radeq repo holds a complete superset.
Files changed:

- deleted `docs/projects/radeq/**` (13 files: architecture, work log, decision mesh)
- deleted `model-output-evals/records/*radeq*.json` (14 records)
- deleted `docs/autopilot/*radeq*` (25 design/baseline assets + mission note)
- `prompt-library/source-catalog.json` (radeq-project-architecture/mesh/work-log
  now point to `SirRadek/radeq:.autopilot/...`)
- `docs/autopilot/project-architecture-registry.md` (radeq record points to the
  radeq repo; control-plane canonical local root corrected to
  `C:\Programování\autopilot`)

Cross-repo: migrated to `SirRadek/radeq` `.autopilot/` via PRs #3 (mesh), #4
(eval records + design assets), and #5 (mesh synced to canonical authoritative
version). The radeq work log there is the superset (canonical entries plus the
cat-door entries).

Architecture impact: the control plane no longer stores radeq project state.
Radeq's architecture, work log, decision mesh, eval records, and design assets
live in the radeq repo under `.autopilot/`. The control plane keeps only the
radeq prompt templates (`02-gemini/radeq-design-brainstorming.md`,
`06-supervisor/radeq-novel-design-supervisor.md`) whose source ids now point to
the radeq repo.
Decisions:

- Canonical control-plane line is the authoritative radeq mesh; the radeq repo
  was synced to it before deletion (re-validated as a complete superset).
- Keep the 2 radeq prompt templates and their cited source ids in the control
  plane; only their `location` pointers move to the radeq repo.
Verification:

- Re-validation confirmed `radeq/.autopilot` is a superset of the control-plane
  radeq set (mesh content-identical incl. `preview_publishing`; work log 0
  canonical lines lost; all 14 eval records and 25 design assets covered).
- After deletion: `npm run prompt:validate` 54/0, `npm run model-output:validate`
  8 files/1 record/0 errors, `npm run pdos:validate` 64/0/0, `npm run mesh:check`
  in sync.
Risks / follow-up:

- Residual radeq references remain as a separate category: 5 `output/` scratch
  docs and 5 `docs/superpowers/` radeq plans/specs (planning history), plus the 2
  prompt templates. Decide later whether to migrate or keep.
- `build` and `test:e2e` not run in this pass.

## 2026-06-20 Expanded-Domain Prompt Lanes Integrated

Date: 2026-06-20
Request or trigger: owner asked to establish the autopilot control plane as a
usable standalone repo at `C:\Programování\autopilot` and integrate the
expanded-domain prompt lanes built earlier on `claude/jovial-chaum-276e2e`.
Mode: WRITE_ALLOWED for prompt-library, domain operating-model docs, governance
records, and work log. Local only; nothing pushed.
Scope: bring the canonical control-plane line current, make it usable, and add
the business/design/analysis/research/copywriting lanes without colliding with
the existing `07-deepseek` lane.
Files changed:

- `prompt-library/08-business/`, `09-design/`, `10-analysis/`, `11-research/`,
  `12-copywriting/` (renumbered from 07-11 to sit after `07-deepseek`)
- `prompt-library/05-evaluation/{business,design,analysis,research,copywriting}-lane-cases.md`
- `docs/autopilot/{business,analysis,research}-intelligence-operating-model.md`,
  `docs/autopilot/copywriting-operating-model.md`, `docs/autopilot/handoffs/`
- `prompt-library/prompt.schema.json` (`copywriting` task_type)
- `prompt-library/source-catalog.json`, `source-catalog.md` (5 operating-model sources)
- `prompt-library/README.md` (lane index + domain governance)
- `product-design-os/rules/multi-agent-routing.md` (Opus = architect; Codex =
  implementer/logic/technical opponent, per the 2026-06-19 decision)

Architecture impact: the standalone autopilot repo now carries the full expanded
domain governance (one Opus decision-owner plus model-specific opponents, the
capability-plus-data-privacy axis) alongside the canonical worker-loop runtime.
Domain lanes are numbered 08-12 to coexist with the model lanes 01-04/07 and the
process lane 06.
Decisions:

- Renumber the domain lanes 08-12 rather than collide with `07-deepseek`.
- Keep all expanded prompts at `candidate`/`draft`; the validator `approved`
  guard stays in place.
- Apply the 2026-06-19 role taxonomy to `multi-agent-routing.md`.
Verification:

- `npm run prompt:validate`: 54 files, 0 errors.
- `npm run pdos:validate`: 64 files, 0 errors, 0 warnings.
- `npm run mesh:check`: in sync.
- `npm run typecheck`: clean (node-pty installed for the CLI worker loop).
- `npm run test`: 41 files, 299 tests passed.
- `npm run diff:check`: only LF/CRLF normalization notices.
Risks:

- `npm run build` and `npm run test:e2e` were not run in this pass (heavy);
  core verify chain is green.
- The 4 prior local radeq-artifact commits are preserved on
  `backup/local-radeq-artifacts-9c8685e`; per the repository-separation rule they
  belong in the radeq repo (follow-up).

## 2026-06-17 S1 Hook Verification Instruction Follow-Up

Date: 2026-06-17
Request or trigger: owner identified three follow-ups from the S1/R1 hook
verification: the ledger path in the plan was wrong, the PowerShell pipeline
smoke command produced invalid JSON, and the actual runner/lifecycle for
`.codex/hooks.json` needed clarification before the live B test can be treated
as evidence.
Mode: WRITE_ALLOWED for documentation and verification instructions only. No
production hook code, schemas, remote state, connector, deployment, or runtime
mutation changed.

Files changed:

- `output/s1-hook-verification-plan-for-gpt.md`
- `output/live-hook-test-instructions.md`
- `docs/autopilot/codex-hooks-operating-model.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Findings:

- The active hook ledger path is `.codex/state/events.jsonl`. The older
  `.codex/hooks/state/ledger.jsonl` path in the S1/R1 plan was corrected.
- Manual PowerShell pipeline input (`$payload | node ...`) is not reliable for
  the hook JSON stdin smoke test on this Windows setup. The instructions now use
  an explicit UTF-8 Node `spawnSync` stdin wrapper.
- `.codex/hooks.json` is a Codex CLI/App lifecycle configuration loaded from
  active config layers after trust review. It is not inherently a Claude Code
  hook runner, and the available `multi_agent_v1.spawn_agent` tool did not
  produce parent-workspace Codex hook lifecycle evidence.
- Local inspection found `codex.cmd` works for CLI inspection while the
  PowerShell `codex.ps1` shim is blocked by execution policy. `codex.cmd
  --version` reported `codex-cli 0.106.0`.
- Official Codex hook docs list `SubagentStart` fields including `turn_id`,
  `agent_id`, `agent_type`, and `permission_mode`; `handoff_id` is not a native
  documented field. The live B test must therefore prove custom top-level
  metadata propagation, or the design must switch to a reviewed fallback such as
  native `agent_id` or approved text parsing.

Verification:

- `codex.cmd --version`, `codex.cmd --help`, `codex.cmd exec --help`, and
  `codex.cmd features list` completed for local inspection.
- `npm.cmd run verify` passed after the documentation update: mesh check,
  prompt validation (`37` files), model-output validation (`15` files, `8`
  records), PDOS validation (`64` files), contract validation (`5` files), diff
  check, typecheck, `38` Vitest files with `254` tests, Astro build, and `4`
  Playwright Chromium tests.

## 2026-06-17 Supervisor Execution Wave 4

Date: 2026-06-17
Request or trigger: owner approved continuing from the Core POC into Wave 4 and
asked to proceed further after review fixes R1-R6 and a live Codex worker spike.
Mode: WRITE_ALLOWED for local governance contracts, deterministic tests, mesh
metadata, prompt/eval/adoption records, and documentation only. No connector
mutation, deployment, remote mutation, API key creation, provider gateway, or
autonomous execution queue was added.

Scope:

- Add subscription session budget and Gemini tier records for subscription CLI
  routing, with unverified Flash/Pro tiers left without `cliAccessPath`.
- Add provider fallback chains that keep Gemini inside Gemini tiers or blocked,
  and route Claude unavailability to owner decision.
- Update model policy so Codex/OpenAI worker use is subscription-interactive,
  serial, and handoff-bound.
- Add supervisor routing decisions, learning signals, correction-loop types,
  context-width specs, skill registry types, dependency freshness, and reuse
  gate contracts.
- Add mesh nodes for subscription worker boundary, skill registry policy, reuse
  gate, and supervisor execution loop, including `failure_modes`.
- Finalize the Claude Opus orchestrator adoption record.

Files changed:

- `.codex/hooks/autopilot-hook.mjs`
- `src/data/delivery-system/subscriptionBudget.ts`
- `src/data/delivery-system/fallbackChains.ts`
- `src/data/delivery-system/modelPolicy.ts`
- `src/data/delivery-system/modelOutputEvaluation.ts`
- `src/data/delivery-system/tokenEfficiency.ts`
- `src/data/delivery-system/toolInventory.ts`
- `src/data/delivery-system/dependencyFreshness.ts`
- `src/lib/decision-mesh/load.ts`
- `src/lib/decision-mesh/types.ts`
- `mesh/schemas/node.schema.json`
- `mesh/nodes/subscription_worker_boundary.yaml`
- `mesh/nodes/skill_registry_policy.yaml`
- `mesh/nodes/reuse_gate.yaml`
- `mesh/nodes/supervisor_execution_loop.yaml`
- `mesh/edges.yaml`
- `mesh/generated/decision-mesh.json`
- `docs/autopilot/adoption-record.schema.json`
- `docs/autopilot/adoption-records/2026-0617-claude-opus-orchestrator.md`
- related deterministic tests under `tests/`

Architecture impact:

- Autopilot now has typed contracts for subscription worker budgets, fallback
  behavior, supervisor routing decisions, context width, skill replacement
  registry data, dependency freshness, and reuse decisions.
- OpenAI/Codex worker routing is modeled as subscription-interactive and serial,
  not API-credit based.
- Gemini CLI remains advisory and tier-bound; when Gemini tiers are exhausted it
  becomes blocked instead of silently falling back to GPT.
- Decision Mesh node schema and loader now support `failure_modes[]`, allowing
  supervisor loop failures to be explicit local governance metadata.
- The static command-center mesh graph now reflects 33 nodes and 70 links.

Verification:

- `gemini.cmd --help` confirmed the local CLI wrapper and `-m/--model`; concrete
  Flash/Pro model IDs were not confirmed, so they remain `verifiedLocally: false`.
- Set A targeted tests passed: 6 files, 45 tests.
- Set B targeted tests passed: 2 files, 22 tests.
- `npm.cmd run mesh:generate` and `npm.cmd run mesh:check` passed after adding
  four new mesh nodes and edges.
- Adoption record parsed into the schema shape and validated against
  `docs/autopilot/adoption-record.schema.json`.
- `npm.cmd run test:e2e` passed: 4 Chromium tests after updating the mesh graph
  count baseline to `33 nodes / 70 links`.
- `npm.cmd run verify` passed after Wave 4 closeout: mesh check, prompt validation
  (`37` files), model-output validation (`15` files, `8` records), PDOS
  validation (`64` files), contract validation (`5` files), diff check,
  typecheck, `38` Vitest files with `251` tests, Astro build, and `4`
  Playwright Chromium tests.

## 2026-06-12 Advisory Provider Run Artifact Gate

Date: 2026-06-12
Request or trigger: owner pointed out that a copied `prompt.txt` from a new
session should have been reviewed as an Autopilot workflow/mesh failure, not as
Radeq content. The file contained prompt echoes and CLI runner logs without
actual Claude, Gemini, or DeepSeek advisory output.
Mode: WRITE_ALLOWED for local governance contracts, Decision Mesh metadata,
docs, deterministic tests, and work log only. No provider call, connector
mutation, remote mutation, model gateway, runtime queue, or product content
change was added.

Scope:

- Treat failed external advisory runs as control-plane diagnostics.
- Separate provider runner artifacts from model output artifacts.
- Block content review when provider execution failed or no model output is
  present.
- Preserve the existing boundary: external model output remains advisory and
  product/project content stays in the supervised project.

Files changed:

- `src/data/delivery-system/modelOutputEvaluation.ts`
- `src/data/delivery-system/modelPolicy.ts`
- `src/data/delivery-system/modelSpend.ts`
- `src/data/delivery-system/capabilities.ts`
- `tests/delivery-system/model-output-evaluation-policy.test.ts`
- `tests/delivery-system/model-policy.test.ts`
- `tests/delivery-system/context-economy-policy.test.ts`
- `tests/decision-mesh/query.test.ts`
- `mesh/nodes/model_output_evaluation_policy.yaml`
- `mesh/nodes/observability_mesh.yaml`
- `mesh/nodes/reasoning_strategy.yaml`
- `mesh/nodes/model_spend_policy.yaml`
- `mesh/nodes/protective_supervision_policy.yaml`
- `mesh/edges.yaml`
- `mesh/rules.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/`
- `docs/autopilot/model-output-evaluation-operating-model.md`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact:

- External advisory runs now require provider run status, runner artifact type,
  and model-output presence before content review.
- Runner logs, prompt echoes, shell transcripts, CLI syntax errors, trust-flag
  failures, login failures, and provider availability failures are not model
  output.
- If a required advisory provider is unavailable or output is missing, the
  workflow must set `blocked` or `waiting_owner` and stop unless the owner
  changes scope.
- Capability routing now recognizes advisory model run failures as
  `observability_mesh` diagnostics, then routes into model-output evaluation,
  reasoning, and protective-supervision stop conditions.

Verification:

- `npm.cmd test -- tests/delivery-system/model-output-evaluation-policy.test.ts tests/decision-mesh/query.test.ts` failed before implementation on the new regression tests.
- `npm.cmd test -- tests/delivery-system/model-output-evaluation-policy.test.ts tests/delivery-system/model-policy.test.ts tests/delivery-system/context-economy-policy.test.ts tests/decision-mesh/query.test.ts` passed after implementation: 4 files, 47 tests.
- `npm.cmd run verify` passed after updating the read-only command-center E2E graph expectation from `29 nodes / 64 links` to `29 nodes / 66 links`.

## 2026-06-11 DeepSeek Web Chat Advisory Workflow

Date: 2026-06-11
Request or trigger: owner verified DeepSeek web login and asked Autopilot to
record how to use it through the mesh, including Quick vs Expert mode, exact
paths, prompt best practices, and fallback input shape.
Mode: WRITE_ALLOWED for local governance contracts, prompt library, mesh
metadata, docs, tests, and work log only. No DeepSeek API key, stored
credential, CLI runtime, connector, provider gateway, remote mutation, or paid
provider usage was added.

Evidence:

- Browser login to `https://chat.deepseek.com/` was verified without reading or
  storing credentials, cookies, tokens, or account identifiers.
- Basic web chat returned `BASIC_OK`.
- Deep thinking toggle produced visible `Přemýšlení po dobu 1 sekundy` evidence
  and returned `REASONING_OK=42`.
- Fresh Quick-mode chat from `https://chat.deepseek.com/` showed `Rychlý režim`
  before send, `Rychlý` in the chat header after send, and returned
  `QUICK_SWITCH_OK`.
- Fresh Expert-mode chat from `https://chat.deepseek.com/` showed
  `Expert režim` before send, `Expert` in the chat header after send, and
  returned `EXPERT_SWITCH_OK`.
- Hiding the in-app Browser did not preserve a stable DeepSeek tab in this
  session, so hidden/headless browser control is not registered as a stable CLI
  or runtime path.
- Official DeepSeek docs verified that API and terminal-agent integrations
  require an API key, while the public product page links to free web access.

Architecture impact:

- Added `deepseek_web_chat_manual` as a separate manual web-login advisory
  provider policy, distinct from `deepseek_api_or_self_hosted`.
- Added `deepseek_web_chat_manual` to tool inventory as provider-policy routing
  metadata, not a callable runtime connector.
- Added `prompt-library/07-deepseek/manual-web-advisory.md` as the bounded
  redacted input packet and missing-input fallback contract.
- Updated root mesh and Autopilot project mesh nodes so future packets route
  DeepSeek web chat through fresh-chat, selected-mode, redaction, browser
  evidence, and local-verification checks.

Stop conditions preserved:

- `authentication_missing`
- `browser_session_unavailable`
- `mode_switch_unverified`
- `private_data_not_redacted`
- `broad_private_context_sent_to_lower_trust_model`
- `model_output_used_as_source_of_truth`
- `api_credit_path_requested_without_owner_decision`

Verification:

- `npm.cmd run prompt:validate` passed.
- `npm.cmd test -- tests/delivery-system/model-policy.test.ts tests/delivery-system/context-economy-policy.test.ts tests/delivery-system/tool-inventory.test.ts tests/delivery-system/prompt-library-policy.test.ts tests/delivery-system/prompt-library-validation.test.ts` passed with 5 files and 38 tests.
- `npm.cmd run mesh:check` passed.
- `npm.cmd run typecheck` passed.
- Local `tsx` route smoke test returned `deepseek_web_chat_manual` for
  reasoning, `deepseek_web_chat_manual` in tool inventory, and
  `manual_web_advisory_prompt` with
  `prompt-library/07-deepseek/manual-web-advisory.md` guidance.
- `npm.cmd run diff:check` passed.

## 2026-06-11 DeepSeek Provider Mesh Connection Fix

Date: 2026-06-11
Request or trigger: owner asked to resolve why DeepSeek was not connected to
the Decision Mesh.
Mode: WRITE_ALLOWED for local governance contracts, Decision Mesh metadata,
docs, tests, and work log only. No DeepSeek API call, API key creation,
credential storage, provider gateway, connector mutation, remote mutation, or
paid provider usage was added.
Scope:

- Reproduce the mismatch through read-only MCP routes.
- Keep DeepSeek registered as an advisory API/self-hosted provider, not as a
  callable runtime.
- Add DeepSeek to provider/tool inventory as a `provider_policy_only` item so
  inventory routing returns its availability, cost, redaction, official-doc, and
  source-of-truth gates.
- Add DeepSeek to Prompt Library provider guidance so provider-specific prompt
  work routes through official-doc and eval checks.

Findings:

- `select_reasoning_model_route` already returned
  `deepseek_api_or_self_hosted` for structured-output and architecture/security
  advisory tasks.
- `select_tool_inventory_route` did not know DeepSeek because
  `toolInventory.ts` only modeled plugins, local skills, and cached bundles.
- `selectPromptLibraryRoute` did not include `deepseek` in provider guidance
  even though `prompt-library/source-catalog.*` and model-output evaluation
  already had DeepSeek source IDs.
- No `DEEPSEEK_*` environment variable name was present in the inspected local
  environment; no token value was read or printed.

Files changed:

- `src/data/delivery-system/toolInventory.ts`
- `src/data/delivery-system/promptLibrary.ts`
- `tests/delivery-system/tool-inventory.test.ts`
- `tests/delivery-system/prompt-library-policy.test.ts`
- `mesh/nodes/tool_inventory_policy.yaml`
- `mesh/nodes/prompt_library_policy.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/nodes/tool_inventory_boundary.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/nodes/prompt_library_boundary.yaml`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact:

- DeepSeek is now connected to the mesh as a provider-policy routing record
  across reasoning, model-output evaluation, prompt guidance, and inventory.
- DeepSeek remains blocked for actual use until availability, cost or
  self-hosting, redacted context, official provider documentation, and local
  verification checks pass.
- The change does not add a multi-provider gateway, autonomous worker loop,
  API-key handling, stored credentials, or model output authority.

Verification:

- Local DeepSeek inventory check through `selectToolInventoryForTask` returned
  `deepseek_provider_policy` with provider availability, API/self-hosting cost,
  redaction, official-doc, and local-verification checks.
- Local DeepSeek prompt check through `selectPromptLibraryRoute` returned
  `provider_guidance` with `deepseek` included in the provider list.
- Local `getRelevantSubgraph` from source returned `prompt_library_policy`,
  `tool_inventory_policy`, `model_spend_policy`, and `reasoning_strategy` for
  the DeepSeek provider-policy inventory task.
- The active Codex-thread MCP server still returned the pre-change inventory
  result, confirming it needs a restart/reload before the new local source is
  visible through `mcp__autopilot_decision_mesh`.
- `npm.cmd test -- tests/delivery-system/tool-inventory.test.ts tests/delivery-system/prompt-library-policy.test.ts tests/delivery-system/model-policy.test.ts tests/delivery-system/model-output-evaluation-policy.test.ts` passed:
  `4` files, `28` tests.
- `npm.cmd run mesh:generate` regenerated `mesh/generated/decision-mesh.json`.
- `npm.cmd run verify` passed:
  - `mesh:check`
  - `prompt:validate` (`34` files, `0` errors)
  - `model-output:validate` (`5` files, `3` records, `0` errors)
  - `pdos:validate` (`64` files, `0` errors, `0` warnings)
  - `contracts:validate` (`5` files, `0` errors)
  - `diff:check`
  - `typecheck`
  - `vitest run` (`32` files, `173` tests)
  - `astro build`
  - `playwright test` (`4` Chromium tests)

## 2026-06-11 Dependency Refresh

Date: 2026-06-11
Request or trigger: owner asked to complete all recommended next-order work
after the full audit, including the optional dependency refresh.
Mode: WRITE_ALLOWED for `package.json`, `package-lock.json`, local
verification, branch publication, and draft PR only. No product runtime code,
connector mutation, deployment, model gateway, prompt-management SaaS, or
execution queue was added.
Scope:

- Refresh the small outdated development dependencies reported by
  `npm.cmd outdated`.
- Preserve the existing dependency style: exact pins for `@types/node`,
  `astro`, and `vitest`, and caret range for `tsx`.
- Re-run local verification before publication.

Files changed:

- `package.json`
- `package-lock.json`

Architecture impact:

- No architecture, project mesh, MCP, hook, prompt-library, model-output eval,
  Product & Design OS, or source-of-truth boundary changed.
- The dependency refresh is a maintenance slice only; the Autopilot control
  plane remains a local governance, validation, read-only MCP, and static
  command-center project.

Verification:

- `npm.cmd install --save-dev @types/node@25.9.3 astro@6.4.6 tsx@^4.22.4 vitest@4.1.8` completed and reported `0` vulnerabilities.
- `npm.cmd outdated --json` returned `{}`.
- `npm.cmd run audit:deps` passed: `0` vulnerabilities.
- `git diff --check` passed.
- `npm.cmd run verify` passed:
  - `mesh:check`
  - `prompt:validate` (`34` files, `0` errors)
  - `model-output:validate` (`3` files, `1` record, `0` errors)
  - `pdos:validate` (`64` files, `0` errors, `0` warnings)
  - `contracts:validate` (`5` files, `0` errors)
  - `diff:check`
  - `typecheck`
  - `vitest run` (`32` files, `171` tests)
  - `astro build`
  - `playwright test` (`4` Chromium tests)

## 2026-06-11 Model Output Eval Record Validation

Date: 2026-06-11
Request or trigger: owner asked to keep supervising model outputs during the
learning phase, score poor outputs, tune prompts/input packets from evidence,
retry until acceptable, and make the behavior automatic through mesh rather than
ad hoc memory.
Mode: WRITE_ALLOWED for local governance contracts, deterministic validator,
Decision Mesh metadata, docs, tests, and work log only. No remote mutation,
runtime queue, model gateway, connector mutation, prompt-management SaaS, or
cloud/API worker was added.
Scope:

- Add a local JSON Schema contract for bounded model-output eval records.
- Add a deterministic validator for records, examples, source-catalog IDs,
  score dimensions, privacy review, retry deltas, repeated-failure route review,
  and weekly tuning aggregates.
- Wire the validator into `npm run verify`.
- Add negative tests so invalid eval records fail locally and in CI.

Files changed:

- `model-output-evals/model-output-eval-record.schema.json`
- `model-output-evals/README.md`
- `model-output-evals/examples/learning-loop.accepted.example.json`
- `model-output-evals/records/README.md`
- `scripts/validate-model-output-evals.ts`
- `tests/delivery-system/model-output-eval-validation.test.ts`
- `src/data/delivery-system/modelOutputEvaluation.ts`
- `tests/delivery-system/model-output-evaluation-policy.test.ts`
- `package.json`
- `mesh/nodes/model_output_evaluation_policy.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/nodes/model_output_evaluation_boundary.yaml`
- `docs/autopilot/model-output-evaluation-operating-model.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact:

- Model-output eval records now have a deterministic local source-of-truth
  shape under `model-output-evals/`.
- Eval records may store only redacted summaries, source pointers, score data,
  deltas, and verification evidence.
- `npm run verify` now fails on invalid model-output eval records before prompt
  tuning or model/reasoning route changes can rely on them.
- Weekly tuning remains blocked unless collected eval records and aggregate
  failure patterns exist.

Verification:

- `npm.cmd run model-output:validate` passed: `3` checked files, `1`
  checked record, `0` errors.
- `npm.cmd test -- tests/delivery-system/model-output-eval-validation.test.ts tests/delivery-system/model-output-evaluation-policy.test.ts` passed:
  `2` files, `12` tests.
- `npm.cmd run mesh:generate` completed without YAML/TS drift errors; topology
  was unchanged.
- `npm.cmd run mesh:check` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run diff:check` passed.
- `npm.cmd run verify` passed:
  - `mesh:check`
  - `prompt:validate` (`34` files, `0` errors)
  - `model-output:validate` (`3` files, `1` record, `0` errors)
  - `pdos:validate` (`64` files, `0` errors, `0` warnings)
  - `contracts:validate` (`5` files, `0` errors)
  - `diff:check`
  - `typecheck`
  - `vitest run` (`32` files, `171` tests)
  - `astro build`
  - `playwright test` (`4` Chromium tests)
- `npm.cmd run audit:deps` passed: `0` vulnerabilities.

## 2026-06-11 Google AI Subscription Boundary

Date: 2026-06-11
Request or trigger: owner clarified that Google AI/Gemini access is also
subscription-based, not API-budget based, with provider limits depending on the
subscription/license path.
Mode: WRITE_ALLOWED for local model-routing policy, mesh records, source
catalog, documentation, tests, and work log only. No API key, connector
mutation, remote service mutation, deployment, or paid provider configuration
was added.
Scope: correct Gemini CLI routing from free/API assumptions to Google AI
subscription or Code Assist license entitlement, while preserving advisory-only,
redacted-context, official-doc verification, and local verification boundaries.
Files changed:

- `src/data/delivery-system/modelPolicy.ts`
- `src/data/delivery-system/modelSpend.ts`
- `src/data/delivery-system/tokenEfficiency.ts`
- `tests/delivery-system/model-policy.test.ts`
- `tests/delivery-system/context-economy-policy.test.ts`
- `tests/delivery-system/token-efficiency-policy.test.ts`
- `mesh/`
- `docs/projects/autopilot-control-plane/decision-mesh/`
- `prompt-library/source-catalog.json`
- `prompt-library/source-catalog.md`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact:

- Gemini CLI is now modeled as `subscription_cli`.
- Required checks include
  `google_ai_subscription_entitlement_confirmed_for_gemini_cli` and
  authentication-state verification without token disclosure.
- Stop conditions include
  `google_ai_subscription_entitlement_unverified` and
  `gemini_api_key_or_paid_api_path_requested_without_owner_decision`.
- Official Google Gemini Code Assist quota and Gemini subscription sources were
  added to the prompt source catalog.

Verification:

- Official Google sources checked on 2026-06-11: Gemini Code Assist quotas show
  quota differences by license type, including individual/free and Google AI
  Pro/Ultra paths; Gemini API model docs remain separate API documentation.
- `npm.cmd run mesh:generate` regenerated `mesh/generated/decision-mesh.json`.
- `npm.cmd test -- tests/delivery-system/model-policy.test.ts tests/delivery-system/context-economy-policy.test.ts tests/delivery-system/token-efficiency-policy.test.ts` passed: 3 files, 17 tests.
- `npm.cmd run prompt:validate` passed: 34 files, 0 errors.
- `npm.cmd run mesh:check` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run diff:check` passed.
- `npm.cmd run verify` passed: mesh check, prompt validation, PDOS validation, contract validation, diff check, typecheck, 30 Vitest files with 153 tests, Astro build, and 4 Playwright Chromium tests.

## 2026-06-11 Reasoning Agent Mesh And Tool Inventory

Date: 2026-06-11
Request or trigger: owner asked to update available plugins and skills, use
Gemini and Claude as advisory brainstormers, and add a reasoning-agent mesh for
GPT/OpenAI, Anthropic Claude, Gemini, DeepSeek, Qwen, and deterministic/local
workers. Owner clarified that Claude access is subscription-based, not an API
budget.
Mode: WRITE_ALLOWED for local governance code, read-only MCP routing, source
catalog, Decision Mesh records, documentation, tests, and work log. No remote
mutation, connector mutation, deployment, API key creation, paid provider
configuration, or product runtime feature was added.
Scope: add typed reasoning task lanes and provider policies, distinguish Claude
Code subscription-interactive usage from API-credit usage, add plugin/skill
inventory routing, expose the inventory through read-only MCP, record provider
source IDs, and verify the new governance contracts.
Files changed:

- `src/data/delivery-system/modelPolicy.ts`
- `src/data/delivery-system/modelSpend.ts`
- `src/data/delivery-system/toolInventory.ts`
- `mcp/server.ts`
- `tests/delivery-system/model-policy.test.ts`
- `tests/delivery-system/context-economy-policy.test.ts`
- `tests/delivery-system/local-worker-policy.test.ts`
- `tests/delivery-system/tool-inventory.test.ts`
- `mesh/`
- `docs/projects/autopilot-control-plane/decision-mesh/`
- `prompt-library/source-catalog.json`
- `prompt-library/source-catalog.md`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact:

- Reasoning model routing now has explicit task lanes for deterministic
  verification, local routine work, bounded coding, structured/tool reasoning,
  long-context synthesis, multimodal design review, architecture/security
  review, agent validation, and sensitive private context.
- Provider policy now distinguishes deterministic tools, local Qwen, GPT/OpenAI,
  Claude Code subscription, Gemini CLI, and DeepSeek API/self-hosted lanes.
- Claude Code is modeled as `subscription_interactive`; subscription entitlement
  and no-API-credit checks replace the older generic paid-credit assumption for
  Claude subscription use.
- Plugin and skill inventory now distinguishes current-session callable tools,
  local skills, and cached-only plugin bundles. Cached bundles are not callable
  until active tools or `tool_search` expose them.
- MCP now exposes `select_tool_inventory_route` as a read-only routing tool and
  expands `select_reasoning_model_route` output with task lanes and provider
  policies.

Decisions:

- Keep provider output advisory until verified by local files, tests, Context7
  when connected, official docs, or controlled browser evidence.
- Do not create a parallel AI Production Studio or runtime queue.
- Keep broad `src/data/autopilot/*` project/agent/provider registries planned;
  this slice only adds delivery-system governance contracts.
- Treat Gemini and Claude brainstorming output as ideas. Use only verified
  provider practices in the mesh and docs.

Verification:

- `npm.cmd test -- tests/delivery-system/model-policy.test.ts tests/delivery-system/context-economy-policy.test.ts tests/delivery-system/local-worker-policy.test.ts tests/delivery-system/tool-inventory.test.ts` passed: 4 files, 21 tests.
- `npm.cmd run mesh:generate` regenerated `mesh/generated/decision-mesh.json`; the root graph is now 28 nodes / 58 links.
- `npm.cmd run mesh:check` passed.
- `npm.cmd run prompt:validate` passed: 34 files, 0 errors.
- `npm.cmd run typecheck` passed.
- `npm.cmd run diff:check` passed.
- First full `npm.cmd run verify` caught an E2E snapshot expectation for the old 27 nodes / 55 links graph count; the E2E expectation was updated to 28 nodes / 58 links.
- Final `npm.cmd run verify` passed: mesh check, prompt validation, PDOS validation, contract validation, diff check, typecheck, 30 Vitest files with 153 tests, Astro build, and 4 Playwright Chromium tests.
- `npm.cmd run audit:deps` passed with 0 vulnerabilities.

Risks:

- Provider documentation and model availability are unstable; future use must
  re-check current official docs and available session tools.
- Cached plugin bundles may appear in local cache without being callable in the
  active Codex session.

## 2026-06-11 Claude Code Provider Registration

Date: 2026-06-11
Request or trigger: owner asked to connect Claude into the Autopilot workflow
for later use, without assigning it to a specific task yet.
Mode: WRITE_ALLOWED for local Claude Code installation, provider-policy
registration, repository memory instructions, architecture, source catalog, and
work-log records. No Claude model call, remote mutation, deployment, connector
client, provider gateway, product runtime code, or stored secret was added.
Scope: install and verify Claude Code locally, start interactive login for the
owner, and register Claude as an optional credentialed advisory provider with
auth, cost, privacy, and verification gates.
Files changed:

- `CLAUDE.md`
- `src/data/delivery-system/modelPolicy.ts`
- `tests/delivery-system/model-policy.test.ts`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `prompt-library/source-catalog.md`
- `prompt-library/source-catalog.json`

Architecture impact: Claude Code is now a documented optional credentialed
advisory provider for architecture/security/planning critique, agent
validation, edge-case review, and bounded repo sessions after owner scope. It is
not a default worker, final approver, governance authority, provider gateway,
runtime queue, connector client, or source of truth. Routine worker loops remain
local by default.
Decisions:

- Install the official Windows `Anthropic.ClaudeCode` WinGet package instead of
  adding an npm project dependency.
- Keep Claude Code credential state outside the repository and never print or
  persist token values.
- Require owner cost decision before credentialed Claude use; registration does
  not approve paid credits or subscription usage for future tasks.
- Add root `CLAUDE.md` so Claude Code receives local Autopilot boundaries,
  `AGENTS.md`/Decision Mesh routing, and Windows `npm.cmd` check guidance.
- Record official Anthropic Claude Code setup, authentication, and memory docs
  in the prompt source catalog for future provider-specific changes.

Verification:

- Decision Mesh routed the task through `automation_mesh` and Autopilot
  control-plane project mesh with provider availability, cost, privacy, and
  source-of-truth stop conditions.
- `winget install --id Anthropic.ClaudeCode --exact` downloaded
  `claude.exe` from `downloads.claude.ai`, verified the installer hash, and
  added the `claude` command alias.
- `claude --version` reported `2.1.172 (Claude Code)`.
- `Get-AuthenticodeSignature` reported a valid signature from `Anthropic, PBC`.
- Existing shell did not yet see the new PATH entry, but the user PATH contains
  `Microsoft\WinGet\Links`; a new PowerShell should find `claude`.
- `claude doctor` in the non-interactive Codex shell timed out on interactive
  auth, so the leftover `claude` process was stopped.
- A visible PowerShell login window was started for the owner.
- After the interactive login completed, the local Claude credentials file was
  present. Token contents were not read, printed, or stored in the repository.
- No Claude model call was made during registration.

Risks:

- Claude Code requires a credentialed account path; future model use remains
  blocked on explicit owner cost/subscription approval and redacted context.
- Claude output must be verified locally and cannot approve delivery or replace
  architecture, mesh, tests, or owner decisions.

## 2026-06-07 Autopilot v0.2.0 Release

Date: 2026-06-07
Request or trigger: owner requested that all current Codex Autopilot, Decision
Mesh, governance, Product & Design OS, prompt-library, hook, and verification
work be published to GitHub as a new version.
Mode: REMOTE_MUTATION_APPROVED for `SirRadek/autopilot` branch publication,
pull request, merge, tag `v0.2.0`, and GitHub release only.
Scope: publish the complete intended Autopilot control-plane worktree. Included
project records are sanitized control-plane architecture, mesh, and work-log
records; no external product runtime repository, deployment, database, or
credential mutation is included.
Files changed: all current non-ignored files in the Autopilot repository,
including root/project meshes, MCP routing, typed governance, Product & Design
OS, prompt library, GitHub templates/workflows, Codex hooks, documentation,
command-center UI, and tests.
Architecture impact: release `v0.2.0` establishes the expanded Autopilot
control plane with capability routing, project meshes, Product & Design OS,
prompt governance, local-worker/token policies, protective supervision,
observability boundaries, GitHub control surfaces, and report-first Codex
hooks. It remains a control plane rather than a product runtime.
Decisions:

- Use semantic minor version `0.2.0` because the release adds multiple
  backward-compatible governance and tooling capabilities.
- Publish through `codex/autopilot-v0.2.0`, reviewed PR, successful GitHub CI,
  merge to `main`, annotated tag `v0.2.0`, and GitHub release.
- Exclude ignored local runtime evidence such as `.codex/state/`, build output,
  test output, local databases, environment files, and credentials.
- Preserve external product repositories as separate sources of truth.
Verification:

- High-confidence secret scan passed with no credential literals found.
- `npm.cmd ci --ignore-scripts` completed from the committed lockfile shape.
- `npm.cmd audit --audit-level=high` passed with 0 vulnerabilities.
- `npm.cmd run verify` passed for `v0.2.0`: mesh check, 64-file Product
  & Design OS validation, typecheck, 26 Vitest files with 115 tests, Astro
  static build, and 3 Playwright Chromium tests.
- `git diff --check` passed.
- GitHub authentication and `SirRadek/autopilot` remote access were verified.
- Release commit `f493d7c` was pushed to `codex/autopilot-v0.2.0`.
- Draft PR `https://github.com/SirRadek/autopilot/pull/2` was opened against
  `main`.
- GitHub Actions run `https://github.com/SirRadek/autopilot/actions/runs/27097229986`
  passed the complete verify job in 1m22s.
- Evidence-commit GitHub Actions run
  `https://github.com/SirRadek/autopilot/actions/runs/27097280620` passed in
  1m6s.
- PR `#2` merged to `main` as `290753e`.
- Post-merge GitHub Actions run
  `https://github.com/SirRadek/autopilot/actions/runs/27097315994` passed in
  1m6s and reported the GitHub-hosted Node 20 action-runtime deprecation.
- Official `actions/checkout`, `actions/setup-node`, and
  `actions/github-script` release documentation was checked on 2026-06-07.
  The release-hardening patch upgrades them to Node 24-compatible majors
  `checkout@v6`, `setup-node@v6`, and `github-script@v8`.
- Release-hardening PR `https://github.com/SirRadek/autopilot/pull/3` was opened
  against `main`.
- GitHub Actions run `https://github.com/SirRadek/autopilot/actions/runs/27097407828`
  passed in 1m7s with 0 annotations, confirming the Node 20 deprecation warning
  is removed.
- Final evidence-commit CI, merge, tag, release, and post-release checks remain
  pending.
Risks:

- The release is a large accumulated control-plane change and therefore relies
  on full automated verification and PR audit rather than direct push to main.
- The repository is private and GitHub branch protection is unavailable on the
  current plan; the branch/PR/CI sequence is therefore enforced procedurally.
Follow-up: after merge, verify `main`, tag `v0.2.0`, release notes, and clean
local tracking state.

## 2026-06-06 Codex Hooks Report-First Guardrail

Date: 2026-06-06
Request or trigger: owner asked to use Codex lifecycle hooks inside Autopilot.
Mode: WRITE_ALLOWED for project-local Codex hook configuration, deterministic
handler, redacted local state rules, tests, Decision Mesh, architecture, and
work-log records. No remote mutation, deployment, cloud model, connector, or
supervised-project runtime change was authorized.
Scope: add a phase-1 report-first hook layer for startup, prompt, tool,
compaction, subagent, and completion events without creating another runtime
queue or approval authority.
Files changed:

- `.codex/hooks.json`
- `.codex/hooks/autopilot-hook.mjs`
- `.gitignore`
- `AGENTS.md`
- `docs/autopilot/codex-hooks-operating-model.md`
- `mesh/`
- `docs/projects/autopilot-control-plane/decision-mesh/`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `tests/codex-hooks.test.ts`
- `tests/decision-mesh/query.test.ts`
- `tests/autopilot-delivery-system.spec.ts`

Architecture impact: Autopilot now has a project-local deterministic Codex
lifecycle layer. Hooks feed redacted event evidence and compact continuity into
Protective Supervision and control-plane observability, but Decision Mesh,
architecture records, work logs, tests, and explicit owner decisions remain
authoritative.
Decisions:

- Keep phase 1 report-only; no automatic allow, deny, rewrite, push, deploy,
  merge, cloud-model call, or remote mutation.
- Store only hashed identifiers, event names, tool names, risk classes, result
  classes, and input fingerprints.
- Ignore `.codex/state/` and prohibit raw prompts, commands, tool responses,
  transcripts, credentials, customer data, and project runtime logs.
- Require exact hook trust review and refreshed-session lifecycle evidence
  before claiming active Codex App or CLI runtime loading.
- Require owner approval, focused deny tests, false-positive review, and
  rollback before adding blocking rules.
Verification:

- Windows `commandWindows` smoke test passed and returned valid `SessionStart`
  JSON through the checked-in PowerShell command.
- `npm.cmd test -- codex-hooks decision-mesh/query` passed: 2 files, 22 tests.
- `npm.cmd run mesh:check` passed with 27 nodes and 55 links.
- `npm.cmd run pdos:validate` passed: 64 checked files, 0 errors, 0 warnings.
- `npm.cmd run typecheck` passed.
- Full `npm.cmd test` passed: 26 files, 115 tests.
- `npm.cmd run build` passed.
- `npm.cmd run test:e2e` passed: 3 Chromium tests.
- `git diff --check` passed after the final work-log update.
Risks:

- `PreToolUse` does not intercept every possible action path and is not a
  complete security boundary.
- Hook commands are skipped until the exact project-local definitions are
  trusted.
- The active Codex App host has not yet produced runtime hook evidence.
Follow-up: refresh or restart Codex, review/trust hooks, start a new session,
and confirm `.codex/state/events.jsonl` receives a `SessionStart` entry.

## 2026-06-05 Gemini Advisory Packet Tightening

Date: 2026-06-05
Request or trigger: user asked how Gemini brainstorming is configured, whether it receives the right data, and what prompts/files are used after a RadeQ attempt produced unusable workspace/process-focused output.
Mode: WRITE_ALLOWED for prompt-library contracts, Gemini advisory rules, RadeQ work-log note, and governance records only. No RadeQ product code, GitHub remote, deployment, or Codex App runtime claim was changed.
Scope: audit and tighten Gemini brainstorming inputs so advisory calls receive compact redacted product packets rather than broad Autopilot workspace/governance context.
Files changed:

- `prompt-library/02-gemini/input-packet-template.md`
- `prompt-library/02-gemini/radeq-design-brainstorming.md`
- `prompt-library/02-gemini/brainstorming.md`
- `prompt-library/README.md`
- `GEMINI.md`
- `docs/projects/radeq/work-log.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Gemini remains an advisory-only, free/no-cost, redacted critique/brainstorming lane. The prompt-library now includes a generic Gemini input-packet template and a RadeQ-specific design brainstorming packet that explicitly tells Gemini to focus on the product/design question and not review Autopilot internals, Codex runtime, local workspace structure, CI/process governance, or unrelated repositories.
Decisions:

- Keep Gemini output non-authoritative and verification-gated.
- Do not pass raw agent output, full workspace dumps, absolute local paths, private repo details, or broad governance context to Gemini.
- For RadeQ design brainstorming, send the sanitized product baseline: PR 2 / commit `a649c4a`, A `Guided Offer Map`, B `Cat Concierge`, C `Studio Proof`, D `Demo Worlds`, target user, critical action, design/SEO tradeoff, constraints, and required output shape.
- Discard Gemini output when it focuses on workspace/process context instead of the product packet.

Verification:

- `npm.cmd test -- prompt-library-policy prompt-pack-policy` passed: 2 files, 9 tests.
- `npm.cmd run pdos:validate` passed: 64 checked files, 0 errors, 0 warnings.
- `git diff --check` passed for `GEMINI.md`, `prompt-library`, and the RadeQ work-log change.

## 2026-06-05 Design SEO Tradeoff Profiles

Date: 2026-06-05
Request or trigger: user clarified that some sites can be intentionally design-led even at the cost of perfect SEO, and that the correct balance depends on the project's focus.
Mode: WRITE_ALLOWED for Product & Design OS rules, recipes, design-intelligence documentation, and work-log records only. No product runtime or remote service was changed.
Scope: add a design/SEO tradeoff rule so Autopilot does not force every website into the same SEO maximum.
Files changed:

- `product-design-os/rules/design-seo-tradeoff.md`
- `product-design-os/rules/theme-crossing.md`
- `product-design-os/rules/strict-process.md`
- `product-design-os/recipes/creative-motion.json`
- `product-design-os/recipes/marketing-premium.json`
- `product-design-os/README.md`
- `product-design-os/scripts/validate-product-design-os.ts`
- `docs/autopilot/design-intelligence-operating-model.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Product & Design OS now distinguishes `seo_led`, `balanced`, `brand_led`, and `experimental_showcase` profiles. Public pages still require an SEO/accessibility floor, but brand-led and experimental pages may intentionally relax exhaustive keyword coverage, dense internal linking, schema beyond basics, perfect Lighthouse scores, and conservative layouts when the tradeoff is recorded.
Verification:

- `npm.cmd run pdos:validate` passed: 64 checked files, 0 errors, 0 warnings.
- JSON parse check passed for `creative-motion.json` and `marketing-premium.json`.
- `git diff --check` passed for the touched Product & Design OS and design-intelligence files.

## 2026-06-05 Product Design Library And Clean-Room Source Governance

Date: 2026-06-05
Request or trigger: user asked to turn themes, assets, links, examples, and project references into a reusable library, keep everything free and commercially usable, and support inspiration through OCR, web checks, screenshots, and HTML analysis while building original work.
Mode: WRITE_ALLOWED for Product & Design OS library records, source/license rules, clean-room reference workflow, project-index generator, documentation, architecture, and work-log records. No remote mutation, paid tool, connector sync, or product runtime change was performed.
Scope: add a local library layer for commercial-safe source pools, inspiration-only references, clean-room reference analysis, generated project indexing, and source/provenance gates.
Files changed:

- `product-design-os/library/`
- `product-design-os/rules/source-and-license-gates.md`
- `product-design-os/rules/clean-room-reference-workflow.md`
- `product-design-os/scripts/update-project-library.ts`
- `product-design-os/scripts/validate-product-design-os.ts`
- `product-design-os/assets/asset.schema.json`
- `product-design-os/README.md`
- `product-design-os/rules/strict-process.md`
- `product-design-os/rules/anti-ai-slop.md`
- `docs/autopilot/design-intelligence-operating-model.md`
- `docs/autopilot/graphic-agent-operating-model.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `package.json`

Architecture impact: Product & Design OS now has a local design library that separates commercial-safe source pools from inspiration-only references. External assets require source, license, commercial-use, cost, provenance, fallback, performance, and QA evidence before adoption. Reference screenshots, OCR, DOM/CSS inspection, and HTML captures are allowed only as analysis evidence and must be normalized into a clean-room brief before implementation. Project records can now be indexed locally from `docs/projects/*` with `npm run pdos:library:projects`.
Decisions:

- Treat broad web references as `inspiration_only` unless their asset/code license is explicitly recorded.
- Prefer CC0, MIT, ISC, BSD, Apache-2.0, and SIL OFL for commercial-safe reuse.
- Block NC, ND, personal-use-only, editorial-only, paid-credit-required, unknown-license, ripped, leaked, or provenance-risk sources from adoption.
- Keep raw HTML/CSS/screenshots as evidence, not implementation input.
- Store project indexing locally from architecture/work-log/project-mesh records rather than remote connector state.

External source evidence checked on 2026-06-05:

- Open Doodles source page for free commercial/personal use and CC0-style terms.
- Open Peeps source page for CC0 commercial/personal use.
- Kenney per-pack page showing Creative Commons CC0 on checked packs.
- Quaternius itch asset page showing CC0 commercial/personal/educational use on the checked pack.
- Poly Haven license page for CC0 assets and commercial-use permission.
- ambientCG license page for CC0 assets and commercial-use permission.
- Lucide license page for ISC/MIT-derived icon licensing.
- Heroicons GitHub license page for MIT.
- SIL Open Font License site for OFL font usage guidance.

Verification:

- `npm.cmd run pdos:library:projects` generated `product-design-os/library/project-index.json` with three known project records.
- `npm.cmd run pdos:validate` passed: 63 checked files, 0 errors, 0 warnings.
- `npm.cmd run typecheck` passed.

Risks:

- The project index is a local deterministic generator, not a live GitHub/connector sync.
- License checks are source-level records; each concrete adopted file still needs exact URL/path evidence before use.
- Reference comparison and OCR remain partly manual/phase-later beyond the existing local Design Reader capture.

## 2026-05-30 Observability Ownership Boundary

Date: 2026-05-30
Request or trigger: user emphasized that Autopilot problems and supervised project problems must stay separated when adding logs, observability, and bottleneck localization.
Mode: WRITE_ALLOWED for typed capability routing, root mesh, project meshes, tests, architecture, and work-log records.
Scope: add an Observability Mesh capability and project-specific diagnostics boundaries. This change does not add a log collector, remote runtime, connector mutation, dashboard, or raw log storage.
Files changed:

- `src/data/delivery-system/capabilities.ts`
- `tests/delivery-system/capability-policy.test.ts`
- `tests/decision-mesh/query.test.ts`
- `mesh/`
- `docs/projects/autopilot-control-plane/decision-mesh/`
- `docs/projects/radeq/decision-mesh/`
- `docs/projects/multi-agent-autonomous-delivery-system/decision-mesh/`
- `docs/autopilot/delivery-system-connector-snapshots.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Autopilot now has a first-class observability/diagnostics routing layer. Diagnostic tasks must classify ownership as `autopilot control-plane` or `project runtime` before reading logs. Autopilot may retain redacted summaries and source pointers; raw project logs remain project-owned.
Decisions:

- Add `observability_mesh` to the root operational mesh for routing, evidence requirements, and stop conditions.
- Add `control_plane_observability_boundary` to the Autopilot control-plane project mesh.
- Add `runtime_observability_boundary` to the Radeq project mesh.
- Add `delivery_observability_boundary` to the multi-agent delivery-system project mesh.
- Stop on ambiguous ownership, raw project logs copied into Autopilot, missing log window, missing baseline, missing reproduction path, raw logs containing secrets, or production mutation without approval.

Verification:

- Targeted tests passed: 2 files, 18 tests for capability routing and Decision Mesh query behavior.
- MCP smoke test confirmed generic diagnostics activate `observability_mesh` and Radeq diagnostics route to `runtime_observability_boundary` through `build_project_mesh_packet`.
- `npm.cmd run verify` passed: mesh check, typecheck, 16 Vitest files with 66 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed cleanly after final whitespace normalization.

Project mesh impact: root mesh now routes observability diagnostics; each supervised project mesh owns its own diagnostic boundary.

## 2026-05-30 Context7 Reasoning And Gemini Brainstorm Verification

Date: 2026-05-30
Request or trigger: user asked to connect Context7 into the mesh for reasoning work and Gemini brainstorming.
Mode: WRITE_ALLOWED for typed governance policy, root mesh, project mesh, tests, documentation, architecture, and work-log records.
Scope: add Context7 as the preferred docs-verification lane for reasoning, technology research, design critique, architecture-library review, and Gemini/free-cloud brainstorming claims. The change does not install Context7, call a paid provider, approve external model output, or make Context7 a source of truth.
Files changed:

- `src/data/delivery-system/modelPolicy.ts`
- `src/data/delivery-system/modelSpend.ts`
- `src/data/delivery-system/designIntelligence.ts`
- `tests/delivery-system/model-policy.test.ts`
- `tests/delivery-system/design-intelligence-policy.test.ts`
- `mesh/`
- `docs/projects/autopilot-control-plane/decision-mesh/`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/autopilot/design-intelligence-operating-model.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `AGENTS.md`
- `GEMINI.md`

Architecture impact: Autopilot now treats Context7 as the first verification lane for current framework, library, SDK, API, browser, cloud, SEO, accessibility, and best-practice claims during strategic reasoning and Gemini brainstorming. If Context7 is unavailable, official documentation or another primary source must be recorded as fallback.
Decisions:

- Gemini remains advisory-only and can brainstorm, critique, and find risks, but implementation claims stay hypotheses until verified.
- Context7 is preferred when connected; official docs, local files, tests, and controlled browser evidence remain fallback evidence.
- Stop on `technology_claim_without_context7_or_official_docs`, `gemini_claim_adopted_without_verification`, or `gemini_claim_adopted_without_context7_or_official_docs`.
- Do not make Context7 a runtime dependency or approval authority.

Verification:

- Targeted policy tests passed: 2 files, 12 tests for model policy and design intelligence.
- MCP smoke test confirmed Gemini/best-practice brainstorming now returns `docsVerificationProviders` with `context7_when_available`, `official_docs_fallback`, local files, tests, and controlled browser evidence.
- `npm.cmd run verify` passed: mesh check, typecheck, 16 Vitest files with 63 tests, Astro build, and 3 Playwright tests.

Project mesh impact: updated `model_reasoning_boundary`, `design_intelligence_boundary`, and project rules to require Context7/official-docs verification for advisory technology claims.

## 2026-05-30 Caveman Token Efficiency Policy

Date: 2026-05-30
Request or trigger: user asked for Caveman settings and more efficient token usage.
Mode: WRITE_ALLOWED for typed governance policy, read-only MCP routing, project mesh, tests, documentation, and architecture/work-log records.
Scope: add a token-efficiency/Caveman routing layer that minimizes context before model spend. The change does not add execution authority, model runtime, paid provider usage, or autonomous operation.
Files changed:

- `src/data/delivery-system/tokenEfficiency.ts`
- `src/data/delivery-system/contextEconomy.ts`
- `mcp/server.ts`
- `tests/delivery-system/token-efficiency-policy.test.ts`
- `tests/delivery-system/context-economy-policy.test.ts`
- `docs/autopilot/token-efficiency-operating-model.md`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/autopilot/v3-prompt-pack.md`
- `docs/projects/autopilot-control-plane/decision-mesh/`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `AGENTS.md`

Architecture impact: Autopilot now has a Caveman/compact profile selector before larger context or stronger models are used. Caveman Mode handles narrow work with one task, must-read files only, `rg` first, deterministic tools first, local/no-cost worker before cloud reasoning, and stop-rather-than-guess behavior.
Decisions:

- Caveman Mode is not a quality downgrade; it is a strict context and scope budget.
- Use Caveman Mode for known-file fixes, small patches, test failure triage, simple explanations, and routine local work.
- Route architecture, security, governance, payment, and auth review to compact review mode rather than Caveman.
- Route current-docs/library/GitHub research to compact research mode with primary-source and cost/license checks.
- Expose `select_token_efficiency_route` as a read-only MCP recommendation tool.

Verification:

- Targeted tests passed: 4 files, 17 tests for token-efficiency, context economy, local worker routing, and model policy.
- MCP smoke test confirmed `select_token_efficiency_route` returns Caveman for tiny small-patch work, review compact for architecture/security, and research compact for current GitHub/library research.
- `npm.cmd run verify` passed: mesh check, typecheck, 16 Vitest files with 62 tests, Astro build, and 3 Playwright tests.

Project mesh impact: added `token_efficiency_boundary` to the Autopilot control-plane project mesh and connected it to local-worker, model-reasoning, and read-only MCP boundaries.

## 2026-05-30 Local Worker Routing Policy

Date: 2026-05-30
Request or trigger: user asked to use the mesh plus LLM/ML and local workers such as Qwen2.5-Coder 14B maximum to save paid tokens, but route them intelligently.
Mode: WRITE_ALLOWED for typed governance policy, read-only MCP routing, project mesh, tests, documentation, architecture/work-log records, and local hardware/runtime inspection.
Scope: add a Local Worker Operating Model and typed local worker router for deterministic tools, Qwen2.5-Coder 7B, Qwen2.5-Coder 14B, local summarization, and local verification. The change does not download new models, start autonomous execution, add a mutating MCP tool, or approve local model output as final evidence.
Files changed:

- `src/data/delivery-system/localWorkers.ts`
- `mcp/server.ts`
- `tests/delivery-system/local-worker-policy.test.ts`
- `docs/autopilot/local-worker-operating-model.md`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/projects/autopilot-control-plane/decision-mesh/`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `AGENTS.md`

Local inspection evidence:

- Machine: HP Victus 16-r1xxx.
- CPU: Intel Core i7-14700HX, 20 cores / 28 threads.
- RAM: 32 GB.
- GPU: NVIDIA GeForce RTX 4070 Laptop GPU with 8 GB VRAM reported by `nvidia-smi`.
- Runtime: Ollama, Node.js, Python, and NVIDIA driver tools are present.
- Installed Ollama models: `qwen2.5-coder:7b`, `qwen2.5-coder:7b-autopilot`.
- Disk free on `C:`: approximately 165 GB.

Architecture impact: Autopilot now has a general local-worker routing layer. Deterministic tools are preferred first for search and verification. `qwen2.5-coder:7b` is the fast available local coding worker. `qwen2.5-coder:14b` is the maximum local coding worker target for this PC, but remains an install candidate until the model is pulled and hardware responsiveness is verified.
Decisions:

- Use local/no-cost workers to save paid tokens before considering cloud or frontier reasoning.
- Use Qwen2.5-Coder 7B for small file-local patch drafts, test drafts, bug summaries, and summaries.
- Use Qwen2.5-Coder 14B only for bounded multi-file repair/refactor drafts or harder local coding tasks after install and hardware checks.
- Keep architecture, security, business, and delivery approval outside local worker authority.
- Expose `select_local_worker_route` as a read-only MCP recommendation tool.

External research evidence checked on 2026-05-30:

- Hugging Face records `Qwen2.5-Coder-14B-Instruct` as Apache-2.0, 14.7B parameters, and long-context capable.
- Ollama's model library exposes `qwen2.5-coder:14b`, `7b`, `3b`, `1.5b`, and `0.5b`.
- Qwen's Ollama documentation confirms Ollama runs Qwen models locally on Windows, macOS, and Linux.
- Qwen3-Coder-Next is newer and Apache-2.0, but it is not adopted because local hardware/runtime fit is not verified.

Verification:

- Targeted policy tests passed: 3 files, 13 tests for local workers, model policy, and context/model spend behavior.
- MCP smoke test confirmed `select_local_worker_route` routes small DTO tests to Qwen 7B plus deterministic checks, bounded refactor work to Qwen 14B with install/hardware gates, and security architecture review away from local-worker approval.
- `npm.cmd run verify` passed: mesh check, typecheck, 15 Vitest files with 58 tests, Astro build, and 3 Playwright tests.

Project mesh impact: added `local_worker_boundary` to the Autopilot control-plane project mesh and connected it to model reasoning, read-only MCP, and capability routing.

## 2026-05-30 Free Cloud Reasoning Policy

Date: 2026-05-30
Request or trigger: user clarified that free/no-cost cloud tooling should apply beyond graphics, and that Gemini plus other relevant free models can support brainstorming, critique, and verified reasoning where useful.
Mode: WRITE_ALLOWED for typed governance policy, read-only MCP routing, root and project mesh policy, tests, and documentation.
Scope: generalize model routing so Gemini and other free/no-cost cloud models may act as advisory reasoning support across agents. The change does not approve paid credits, provider dependency, unredacted external disclosure, routine cloud worker loops, or model output as source of truth.
Files changed:

- `src/data/delivery-system/modelPolicy.ts`
- `src/data/delivery-system/modelSpend.ts`
- `mcp/server.ts`
- `tests/delivery-system/model-policy.test.ts`
- `tests/delivery-system/context-economy-policy.test.ts`
- `mesh/`
- `docs/projects/autopilot-control-plane/decision-mesh/`
- `docs/projects/multi-agent-autonomous-delivery-system/decision-mesh/`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `AGENTS.md`
- `GEMINI.md`

Architecture impact: Autopilot now has a general free-cloud reasoning boundary. Local workers remain the default execution path. Free/no-cost cloud models can be used for redacted brainstorming, critique, planning review, architecture/security second opinions, agent validation, edge-case review, and research synthesis when provider availability, no-cost use, redaction, and factual verification are confirmed.
Decisions:

- Keep model selection provider-neutral; do not make Gemini, OpenAI, Claude, Qwen, DeepSeek, or any other provider mandatory.
- Treat Gemini CLI as available advisory tooling, not approval authority or execution worker.
- Allow other free/no-cost cloud reasoning models when they pass the same checks and add measurable review value.
- Block paid credits, unknown pricing, account upgrades, unredacted private context, routine cloud worker loops, and model output as source-of-truth evidence.
- Expose `select_reasoning_model_route` as a read-only MCP recommendation tool.

Verification:

- Regenerated root Decision Mesh artifact with `npm.cmd run mesh:generate`.
- Targeted tests passed: 3 files, 18 tests for model policy, context/model spend, and Decision Mesh query behavior.
- MCP smoke test confirmed `select_reasoning_model_route` returns free-cloud advisory routing for Gemini brainstorming and local routing for a boilerplate DTO automation loop.
- `npm.cmd run verify` passed: mesh check, typecheck, 14 Vitest files with 53 tests, Astro build, and 3 Playwright tests.

Project mesh impact: added `model_reasoning_boundary` to the Autopilot control-plane project mesh and updated the multi-agent model routing boundary to reflect free-cloud advisory use.

## 2026-05-30 Free Cloud, No Paid Policy Update

Date: 2026-05-30
Request or trigger: user clarified the governance boundary: paid services are not allowed, but cloud services are allowed.
Mode: WRITE_ALLOWED for typed governance policy, project mesh, tests, and documentation.
Scope: update Graphic Production Agent and Design Intelligence routing so cloud tools are not blocked solely because they are cloud-based. The new boundary is free/no-cost confirmation, license and usage-rights review, runtime-scope review, and paid-tool blocking.
Files changed:

- `src/data/delivery-system/graphicAgent.ts`
- `src/data/delivery-system/designIntelligence.ts`
- `tests/delivery-system/graphic-agent-policy.test.ts`
- `tests/delivery-system/design-intelligence-policy.test.ts`
- `docs/autopilot/graphic-agent-operating-model.md`
- `docs/autopilot/design-intelligence-operating-model.md`
- `docs/projects/autopilot-control-plane/decision-mesh/`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Autopilot now distinguishes free cloud tools from paid/cost-bearing tools. Free cloud tools may be considered when the no-cost path is confirmed. Paid tools, paid credits, unknown pricing, or cost-bearing gateways remain stop conditions unless the owner later creates an explicit exception.
Decisions:

- Allow cloud tools and research providers when they are free/no-cost and their account, data-disclosure, license, and runtime boundaries are understood.
- Keep local/free tools as the default production lane.
- Replace the broad `paid_or_cloud_*` stop condition with separate cloud-free-tier and paid-tool stop conditions.
- Keep runtime adoption advisory-only until architecture scope, dependency, rollback, and verification are approved.

Verification:

- Targeted policy tests passed: 2 files, 11 tests.
- MCP smoke test confirmed `select_graphic_route` and `search_architecture_library` return free-cloud checks and paid-tool stop conditions.
- `npm.cmd run verify` passed: mesh check, typecheck, 14 Vitest files with 51 tests, Astro build, and 3 Playwright tests.

Project mesh impact: updated `graphic_agent_boundary`, `design_intelligence_boundary`, and related rules to reflect free-cloud allowance and paid-tool blocking.

## 2026-05-30 Design Intelligence And Architecture Library

Date: 2026-05-30
Request or trigger: user corrected the next step: define a Design Critic and Visual Analyst, use Context7 and recommended current technologies, search free GitHub projects that may help, and start building Autopilot's own LLM/ML architecture library.
Mode: WRITE_ALLOWED for typed governance policy, read-only MCP routing, tests, documentation, project mesh, and architecture/work-log records.
Scope: add Design Intelligence roles and policy for visual analysis, critique, research provider routing, and an initial LLM/ML architecture library. The change does not approve runtime adoption, dependency installation, paid tools, cloud execution, connector mutation, or a parallel system.
Files changed:

- `src/data/delivery-system/designIntelligence.ts`
- `src/data/delivery-system/roles.ts`
- `mcp/server.ts`
- `tests/delivery-system/design-intelligence-policy.test.ts`
- `docs/autopilot/design-intelligence-operating-model.md`
- `docs/projects/autopilot-control-plane/decision-mesh/`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Autopilot now has a governed Design Intelligence layer. `Visual Analyst` handles pre-production visual strategy and acceptance criteria; `Design Critic` handles post-production critique and evidence-based rework. The local architecture library starts with current GitHub candidates for agent orchestration, TypeScript AI runtime, local AI UI, evals, and observability.
Decisions:

- Keep design critique independent from visual production.
- Treat Context7 as the preferred current-docs provider when connected; since it is unavailable in this session, use official docs, GitHub repository data, Hugging Face docs, and local architecture records as fallback.
- Keep GitHub project discovery advisory only; library entries do not approve adoption.
- Track license, activity, use case, adoption status, and risk before any dependency can move from `watch` or `candidate` to implementation.
- Expose `select_design_review_route` and `search_architecture_library` as read-only MCP tools.

Initial GitHub candidates checked on 2026-05-30:

- `langchain-ai/langgraph`
- `mastra-ai/mastra`
- `crewAIInc/crewAI`
- `vercel/ai`
- `open-webui/open-webui`
- `promptfoo/promptfoo`
- `Arize-ai/phoenix`
- `Arize-ai/openinference`

Verification:

- Added policy tests for role registration, Context7 fallback, critique rubric coverage, design route selection, architecture library candidates, and library search stop conditions.

Risks:

- Some GitHub repositories report `NOASSERTION` through the GitHub API and require manual license-file review before adoption.
- Context7 is not connected in this session; research policy records the fallback requirement rather than pretending the provider is available.
- Runtime adoption remains blocked until an explicit architecture decision approves scope, dependency, cost, and rollback.

Project mesh impact: added `design_intelligence_boundary` to the Autopilot control-plane project mesh with independent critique, current docs, GitHub license/activity review, and architecture-library status gates.

## 2026-05-29 Graphic Production Agent Policy

Date: 2026-05-29
Request or trigger: user clarified that the goal is not to add 3D to the Astro page, but to configure a graphical agent inside Autopilot and define how graphics should be created.
Mode: WRITE_ALLOWED for typed governance policy, tests, documentation, project mesh, and architecture/work-log records.
Scope: add a governed Graphic Production Agent role and policy for routing static graphics, motion backgrounds, physics visuals, moving models, and video storyboards. The change does not add a product runtime, mutating MCP tool, connector client, deployment path, or paid/cloud default.
Files changed:

- `src/data/delivery-system/graphicAgent.ts`
- `src/data/delivery-system/roles.ts`
- `mcp/server.ts`
- `tests/delivery-system/graphic-agent-policy.test.ts`
- `docs/autopilot/graphic-agent-operating-model.md`
- `docs/projects/autopilot-control-plane/decision-mesh/`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Autopilot now has an explicit visual-production governance contract and a local read-only MCP route selector. The Graphic Production Agent defaults to local/free tools such as HTML/CSS/SVG, Canvas 2D, Three.js, Rapier, Blender, and Playwright capture. Optional external tools such as Figma, Canva, HyperFrames, and Kling AI require owner decision, and Kling AI additionally requires cost and account approval.
Decisions:

- Treat graphical production as an Autopilot execution role, not a separate design runtime.
- Keep DOM content first and motion second.
- Route motion backgrounds to CSS/SVG or Canvas before WebGL.
- Use Rapier only for real physics signals such as collisions, gravity, constraints, or rigid bodies.
- Keep external paid/cloud tools behind explicit owner decision.
- Expose `select_graphic_route` as a read-only MCP tool; it routes and reports checks only, and does not generate assets or mutate providers.

Verification:

- Added policy tests for role registration, local/free defaults, motion routing, physics routing, and paid/cloud stop conditions.

Risks:

- Tool availability such as Blender or HyperFrames must be verified before a production task depends on them.
- Visual direction remains a stop condition; the agent cannot infer brand intent from tooling alone.

Project mesh impact: added `graphic_agent_boundary` to the Autopilot control-plane project mesh with local/free default, content-outside-canvas, mobile fallback, reduced-motion, and owner-cost-decision gates.

## 2026-05-29 Project Delivery Workflow Visualization

Date: 2026-05-29
Request or trigger: user requested the missing workflow view showing how work moves from proposal to completed project, which agents participate, who they communicate with, and in what order.
Mode: WRITE_ALLOWED for the static command-center UI, smoke test, and architecture/work-log records.
Scope: add a read-only workflow section to `/autopilot` that shows owner intake, mesh routing, architecture contract, task dispatch, implementation, verification, review/governance, and delivery/memory closeout. No execution runtime, connector mutation, queue mutation, or approval authority was added.
Files changed:

- `src/pages/autopilot.astro`
- `tests/autopilot-delivery-system.spec.ts`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: the command center now exposes the project delivery path alongside the Decision Mesh graph. The new view clarifies agent roles, communication order, mesh checkpoints, outputs, gates, and concurrency boundaries while preserving Autopilot as the workflow authority and GitHub as a visibility/audit mirror.
Decisions:

- Keep the workflow deterministic and static on the command-center page.
- Model the delivery path as eight ordered phases from owner intent to delivery memory.
- Show Qwen as a bounded worker lane only, with separate verification and review lanes.
- Keep Decision Mesh as context routing and stop-condition evidence, not approval authority.

Verification:

- `npm run verify` passed: mesh check, typecheck, 12 Vitest files with 40 tests, Astro build, and 3 Playwright tests.
- Playwright visual checks captured desktop and mobile workflow sections.
- Computed style checks confirmed the workflow cards, phase markers, and agent chain are styled after the Astro stylesheet scope fix.
- Mobile page check reported no horizontal overflow.

Risks:

- The workflow is explanatory and read-only; live workflow state still requires a future execution/queue decision before mutation is allowed.

Project mesh impact: no semantic mesh change. This slice visualizes the Autopilot delivery process and records the control-plane impact.

## 2026-05-29 Read-Only Decision Mesh Graph

Date: 2026-05-29
Request or trigger: user requested a graphical display of the Decision Mesh.
Mode: WRITE_ALLOWED for the static command-center UI, smoke test, and architecture/work-log records.
Scope: render the existing generated Decision Mesh graph in the read-only `/autopilot` page without changing mesh authority, execution behavior, or connector mutation.
Files changed:

- `src/pages/autopilot.astro`
- `tests/autopilot-delivery-system.spec.ts`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: the command center now includes a deterministic 2D SVG visualization of `mesh/generated/decision-mesh.json`. The root `mesh/` remains the source of truth, the generated JSON remains derived, and the visualization is read-only.
Decisions:

- Use the existing Decision Mesh loader and graph builder instead of adding a new graph runtime or separate source of truth.
- Keep the graph static and readable on the command-center page.
- Show node type counts and strongest links alongside the graph so the visual map has a compact textual fallback.

Verification:

- `npm run verify` passed: mesh check, typecheck, 12 Vitest files with 40 tests, Astro build, and 3 Playwright tests.
- Playwright screenshot checks captured desktop and mobile graph sections.
- Mobile page check reported no horizontal overflow.

Risks:

- Dense node labels are compact on narrow mobile viewports; the adjacent legend and strongest-link list provide the readable fallback.

Project mesh impact: no semantic mesh change. This slice visualizes the existing Autopilot operational mesh only.

## 2026-05-24 Mesh Audit Implementation

Date: 2026-05-24
Request or trigger: user requested implementation of the thorough workflow and mesh audit, with English core artifacts and Czech allowed only for user-facing input/output.
Mode: WRITE_ALLOWED for local mesh, MCP, typed policy, docs, tests, dashboard, and dependency hygiene.
Scope: close audit gaps by enforcing English core text, declaring YAML as capability source of truth, adding project-specific mesh packet support, updating workflow memory feedback, refreshing the static dashboard, updating the prompt pack, and applying patch dependency updates.
Files changed:

- `AGENTS.md`
- `mesh/nodes/file_upload.yaml`
- `mesh/generated/decision-mesh.json`
- `mcp/server.ts`
- `src/lib/decision-mesh/*.ts`
- `src/data/delivery-system/capabilities.ts`
- `src/data/delivery-system/workflows.ts`
- `src/pages/autopilot.astro`
- `tests/decision-mesh/query.test.ts`
- `tests/delivery-system/core-language-boundary.test.ts`
- `tests/delivery-system/prompt-pack-policy.test.ts`
- `tests/delivery-system/workflow-loop.test.ts`
- `tests/delivery-system/capability-policy.test.ts`
- `tests/autopilot-delivery-system.spec.ts`
- `docs/autopilot/v3-prompt-pack.md`
- `docs/autopilot/decision-mesh-mcp-decision.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `package.json`
- `package-lock.json`

Architecture impact: the read-only Decision Mesh context router now has a project-specific packet tool and clearer source-of-truth boundary. The root mesh remains Autopilot-only; project meshes remain separate per-project records. No execution runtime, connector mutation, remote MCP transport, deployment, or parallel system was added.
Decisions:

- Keep YAML mesh content canonical and TypeScript capability routing as an executable mirror.
- Add `build_project_mesh_packet` for supervised project work instead of overloading the root mesh.
- Keep the memory state connected back to planning so lessons and optimization signals affect the next cycle.
- Keep the dashboard read-only but show Decision Mesh coverage, capability routing, and project mesh lifecycle status.
- Update only existing patch-level packages found by audit: Astro, Vitest, and Node types.

Verification:

- New audit tests were written first and failed for the known gaps.
- Targeted tests passed after implementation: 5 files, 18 tests.
- `npm run mesh:generate` regenerated the derived mesh artifact.
- `npm run verify` passed: mesh check, typecheck, 12 Vitest files with 40 tests, Astro build, and 3 Playwright tests.
- MCP smoke test called `build_project_mesh_packet` for `radeq` and returned `lead_capture_pipeline`, `server_validation`, and `missing_server_validation`.
- `npm audit` reported 0 vulnerabilities.
- `npm outdated --json` returned `{}`.
- `npm ls --depth=0` showed no extraneous top-level packages after pruning leftover optional folders.
- `git diff --check` passed with only existing LF/CRLF normalization warnings.

Risks:

- TypeScript capability routing can still drift from YAML if future changes skip the drift policy.
- Project meshes are still initial seeds and need expansion as real implementation slices happen.

Project mesh impact: root mesh content changed only to fix English core wording; project mesh query support was added, but existing project mesh content did not require semantic changes in this slice.

## 2026-05-24 Capability Routing And Project Mesh Seeds

Date: 2026-05-24
Request or trigger: user requested implementation after research-first review, with caution that a future parallel system should remain possible but not be created now.
Mode: WRITE_ALLOWED for local governance, mesh, MCP, docs, and tests.
Scope: extend the existing Decision Mesh path with capability routing, context economy, model spend policy, `select_capabilities`, and seed project-specific meshes for current registered projects.
Files changed:

- `AGENTS.md`
- `GEMINI.md`
- `mesh/`
- `mcp/server.ts`
- `src/data/delivery-system/capabilities.ts`
- `src/data/delivery-system/contextEconomy.ts`
- `src/data/delivery-system/modelSpend.ts`
- `src/lib/decision-mesh/*.ts`
- `tests/delivery-system/*.test.ts`
- `tests/decision-mesh/query.test.ts`
- `docs/projects/*/decision-mesh/`
- `docs/autopilot/decision-mesh-mcp-decision.md`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/autopilot/project-architecture-standard.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/superpowers/plans/2026-05-24-capability-routing-mesh.md`

Architecture impact: Autopilot's read-only context router now includes capability selection before planning, context economy rules, provider-neutral model spend policy, and seed project meshes. This does not approve a parallel runtime, connector mutation, remote MCP transport, or autonomous execution.
Decisions:

- Improve the existing mesh/MCP/governance layer first.
- Keep a future parallel AI Production Studio possible only through explicit architecture decision, interop or migration plan, and owner approval.
- Treat 3D/WebGL as `three_d_experience_addon`, not a default service path.
- Use `select_capabilities` before planning broad service tasks.
- Seed project-specific meshes for `autopilot-control-plane`, `multi-agent-autonomous-delivery-system`, and `radeq`.

Verification:

- Capability and context economy tests were written first and initially failed because the modules did not exist.
- Project mesh presence test initially failed because registered project mesh directories did not exist.
- Decision Mesh query test initially failed because `selectCapabilities` did not exist.
- Targeted capability/context tests passed after typed policy implementation.
- Targeted project mesh policy test passed after seed meshes were created.
- MCP smoke test called `select_capabilities` and returned `optimization_mesh` plus `seo_mesh`, optional `data_mesh`, and avoided `three_d_experience_addon` for a slow-site SEO task.
- `npm run verify` passed: mesh check, typecheck, 9 Vitest files with 35 tests, Astro build, and 3 Playwright tests.
- `npm audit` reported 0 vulnerabilities.
- `git diff --check` passed with only existing LF/CRLF normalization warnings.

Risks:

- Project-specific meshes are initial seeds and need expansion as project work proceeds.
- Parallel-system option is intentionally documented but not implemented.

Follow-up:

- Expand project-specific meshes as each project gets real implementation slices.

Project mesh impact: `docs/projects/autopilot-control-plane/decision-mesh/` was created with control-plane boundary, read-only MCP boundary, and capability routing nodes.

## 2026-05-24 Decision Mesh MCP MVP

Date: 2026-05-24
Request or trigger: user requested research-first Decision Mesh MVP for Codex context routing, with YAML/JSON graph, MCP tools, AGENTS.md, and 3D viewer deferred until useful.
Mode: WRITE_ALLOWED for local read-only context-router implementation.
Scope: add a local Decision Mesh source of truth, deterministic graph artifact, pure TypeScript query layer, read-only MCP stdio server, root agent instructions, and tests.
Files changed:

- `AGENTS.md`
- `GEMINI.md`
- `mesh/`
- `mcp/server.ts`
- `scripts/generate-decision-mesh.ts`
- `src/lib/decision-mesh/*.ts`
- `tests/decision-mesh/*.test.ts`
- `tests/delivery-system/boundary.test.ts`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `docs/autopilot/decision-mesh-mcp-decision.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/multi-agent-autonomous-delivery-system/architecture.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/autopilot/delivery-system-runtime-package-decision.md`
- `docs/superpowers/specs/2026-05-24-decision-mesh-mvp-design.md`
- `docs/superpowers/plans/2026-05-24-decision-mesh-mvp.md`

Architecture impact: Autopilot now has a local read-only Decision Mesh context router and stdio MCP server. This does not approve execution runtime, connector mutation, remote MCP transport, product runtime code, or 3D viewer deployment.
Decisions:

- Keep YAML under `mesh/` as source of truth.
- Generate `mesh/generated/decision-mesh.json` deterministically from YAML.
- Use MCP only as a local read-only context router.
- Add reasoning strategy policy: local workers remain default; frontier reasoning is only strategic review, audit, planning, architecture, deep research, and edge-case escalation.
- Add project mesh lifecycle policy: Autopilot root mesh is operational only; every supervised project needs its own mesh during architecture onboarding and must update it after completed work.
- Defer `3d-force-graph` or React viewer until query/MCP behavior is stable.
- Keep Gemini advisory-only through `GEMINI.md`.

Verification:

- Decision Mesh tests were written first and initially failed because the module did not exist.
- After implementation, targeted Decision Mesh tests passed.
- `npm run mesh:check` passed.
- `npm run typecheck` passed after exact-optional and MCP return-type fixes.
- MCP smoke test with the official SDK client called `get_relevant_subgraph` over stdio and returned the expected avatar-upload subgraph.
- Reasoning policy tests verify local-worker default, frontier escalation boundaries, and non-local worker stop conditions.
- Project mesh policy tests verify project mesh creation and update gates.
- `npm run verify` passed after the final lockfile update.
- `npm audit fix` updated the vulnerable dev transitive dependency and `npm audit` reported 0 vulnerabilities.

Risks:

- 3D viewer is not implemented yet by design.
- MCP server is local stdio only and still needs client registration in the user's Codex config if the user wants Codex to call it outside this workspace session.
- Future 3D viewer work must preserve the read-only boundary and avoid turning visualization into an execution console.

## 2026-05-13 Architecture Governance Baseline

Date: 2026-05-13
Request or trigger: every project must have written architecture, regular updates, and a work log.
Mode: WRITE_ALLOWED for documentation only.
Scope: define architecture governance and create the first control-plane architecture record.
Files changed:

- `docs/autopilot/project-architecture-standard.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/radeq/architecture.md`
- `docs/projects/radeq/work-log.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `docs/autopilot/v3-prompt-pack.md`
- `docs/autopilot/2026-05-10-autopilot-run-log.md`

Architecture impact: created the first canonical architecture record and work log for the Autopilot control plane.
Decisions:

- Architecture evidence is now per project, not only in scattered plans and run logs.
- Work logs must be updated after every meaningful work slice.
- Active architecture records must be reviewed weekly.
- The project architecture registry is the central index.

Verification:

- `rg -n "Project Architecture|project architecture|Architecture impact|Project architecture checked|docs/projects|Next review" docs\autopilot docs\projects`: found the standard, registry, project records, prompt-pack gate, and work-log entries.
- `git diff --check`: passed with existing LF-to-CRLF warnings only.
- Placeholder-token scan over the new architecture docs and project records: no matches.

Risks:

- Regular review is not automated yet.
- External project architecture records still need onboarding.

Follow-up:

- Add typed project architecture registry when `/autopilot` is implemented.
- Consider a recurring review automation after the user approves actual scheduling.

## 2026-05-13 Strict Repository Separation

Date: 2026-05-13
Request or trigger: user clarified that Autopilot must be strictly separated from all other projects; it is a standalone project that creates and supervises separate project repositories.
Mode: WRITE_ALLOWED for documentation only.
Scope: update architecture governance so Autopilot, Radeq, and future projects have strict repository and directory boundaries.
Files changed:

- `docs/autopilot/repository-separation-policy.md`
- `docs/autopilot/project-architecture-standard.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/autopilot/v3-prompt-pack.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/radeq/architecture.md`
- `docs/projects/multi-agent-autonomous-delivery-system/architecture.md`
- `docs/superpowers/specs/2026-05-13-multi-agent-autonomous-delivery-system-design.md`
- `docs/superpowers/plans/2026-05-13-multi-agent-autonomous-delivery-system.md`
- `docs/autopilot/2026-05-10-autopilot-run-log.md`

Architecture impact: Autopilot is now explicitly modeled as a standalone control-plane repository; product projects must have their own local roots and remote repositories.
Decisions:

- Autopilot target repository is `SirRadek/autopilot`.
- Radeq target repository remains `SirRadek/radeq`.
- Current co-location is marked as transitional and `split_required`.
- Autopilot may store metadata, templates, ledgers, governance, and sanitized snapshots, not canonical product runtime code.

Verification:

- Repository-boundary search confirmed separation terms in the policy, registry, architecture records, work logs, plan, and spec.
- Placeholder-token scan returned no matches.
- `git diff --check` passed with only LF/CRLF normalization warnings for existing files `docs/autopilot/2026-05-10-autopilot-run-log.md` and `docs/autopilot/v3-prompt-pack.md`.

Risks:

- The dedicated Autopilot remote repository is not created or confirmed yet.
- Actual file/repo split is not performed in this documentation-only slice.

Follow-up:

- Create or confirm `SirRadek/autopilot`.
- Move Autopilot control-plane files into the dedicated repository.
- Move or restore Radeq runtime into a clean Radeq-only checkout.

## 2026-05-13 Physical Repository Split

Date: 2026-05-13
Request or trigger: user approved executing the strict split between Autopilot and product repositories.
Mode: WRITE_ALLOWED with remote GitHub mutation approved by user instruction.
Scope: create the dedicated Autopilot repository, preserve the mixed checkout, keep Autopilot governance in `C:\Users\sirok\Documents\Autopilot`, and place Radeq runtime in `C:\Users\sirok\Documents\Projects\radeq`.
Files changed:

- `README.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/autopilot/repository-separation-policy.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `docs/projects/radeq/architecture.md`
- `docs/projects/radeq/work-log.md`
- `docs/autopilot/2026-05-10-autopilot-run-log.md`

Architecture impact: Autopilot now has its own local root and remote repository target; Radeq has a separate local product checkout.
Decisions:

- Created `SirRadek/autopilot` as a private repository.
- Kept `C:\Users\sirok\Documents\Autopilot` as the canonical Autopilot root.
- Created `C:\Users\sirok\Documents\Projects\radeq` as the canonical Radeq product checkout.
- Preserved the previous mixed checkout at `C:\Users\sirok\Documents\Autopilot-radeq-mixed-backup-20260513-160634`.
- Excluded product runtime files from the new Autopilot root.

Verification:

- `gh repo view SirRadek/autopilot --json nameWithOwner,url,visibility,defaultBranchRef,isPrivate` confirmed the private Autopilot repository exists.
- `git push -u origin main` pushed the initial Autopilot control-plane commit.
- Follow-up GitHub verification confirmed `SirRadek/autopilot` default branch is `main`.
- Autopilot root scan found no product runtime directories or files such as `src`, `functions`, `migrations`, `public`, `tests`, `package.json`, or `astro.config.mjs`.
- Radeq cleanup branch `codex/separate-autopilot-docs` was committed and pushed.
- Radeq cleanup PR opened: `https://github.com/SirRadek/radeq/pull/1`.
- After explicit user approval, Radeq cleanup PR `https://github.com/SirRadek/radeq/pull/1` was squash-merged into `new` as `ef7053c`.
- Radeq cleanup verification passed: `git diff --check`, `npm ci`, `npm test`, and `npm run build`.
- Post-merge Radeq verification on branch `new` passed again: no legacy docs references, `npm test` passed 7 test files and 40 tests, and `npm run build` built 2 Astro pages with the existing chunk-size warning.

Risks:

- Repository separation risk for Autopilot and Radeq is closed. The mixed checkout backup remains local for audit and recovery until a retention decision is made.

## 2026-05-13 Workflow Governance Baseline Update

Date: 2026-05-13
Request or trigger: user asked to proceed with the Autopilot workflow modification.
Mode: WRITE_ALLOWED for Autopilot control-plane documentation.
Scope: align the prompt pack and registry with the post-split docs-first Autopilot repository and add workflow governance contracts.
Files changed:

- `docs/autopilot/delivery-system-governance.md`
- `docs/autopilot/delivery-system-ledgers.md`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/autopilot/v3-prompt-pack.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Autopilot's operating workflow now requires ledger impact, workflow governance evidence, and the post-split docs-first baseline before worker outputs can be accepted.
Decisions:

- Replace the stale pre-split prompt-pack baseline with the current `SirRadek/autopilot` docs-first repository baseline.
- Keep runtime, UI, and typed-contract work deferred until explicit architecture decisions exist.

Verification:

- Required-term search found workflow governance, ledger, gate, and model-policy terms across the Autopilot docs.
- Placeholder-token scan returned no matches.
- Autopilot runtime-file scan returned no matches for product or app runtime files.
- `git diff --check` passed with only LF/CRLF normalization warnings.

Risks:

- Prompt-pack consumers must use the updated baseline; old assumptions about Astro scripts in Autopilot are no longer valid.

## 2026-05-13 Connector Snapshot And Runtime Deferral Governance

Date: 2026-05-13
Request or trigger: user asked to continue the Autopilot workflow modification.
Mode: WRITE_ALLOWED for Autopilot control-plane documentation.
Scope: add connector snapshot governance and execution-engine deferral evidence to the multi-agent delivery workflow.
Files changed:

- `docs/autopilot/delivery-system-connector-snapshots.md`
- `docs/autopilot/delivery-system-execution-engine-options.md`
- `docs/autopilot/v3-prompt-pack.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/multi-agent-autonomous-delivery-system/architecture.md`
- `docs/projects/multi-agent-autonomous-delivery-system/work-log.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `docs/autopilot/2026-05-10-autopilot-run-log.md`

Architecture impact: Autopilot control-plane governance now has a connector snapshot evidence procedure and an explicit execution-engine deferral record.
Decisions:

- Connector snapshots are read-only evidence artifacts.
- Runtime execution, workflow automation, connector mutation, and deployments remain blocked until a later architecture decision and approval.

Verification:

- Required-term search found the multi-agent delivery architecture, connector snapshot procedure, execution-engine deferral record, prompt-pack rejection rules, ledger impact, and architecture impact across `docs/`.
- Placeholder-token scan returned no matches.
- Autopilot runtime-file scan returned no matches for `src`, `functions`, `migrations`, `public`, `tests`, `scripts`, `package.json`, or related runtime files.
- `git diff --check` passed with only LF/CRLF normalization warnings.

Risks:

- The snapshot procedure is documented but not yet dry-run against live connector evidence.
- There is still no typed registry or runtime enforcement layer.

## 2026-05-13 Typed Governance Contract Package

Date: 2026-05-13
Request or trigger: user asked to run the large workflow plan and allowed multiagent assistance.
Mode: WRITE_ALLOWED for minimal TypeScript/Vitest governance-contract tooling.
Scope: change the Autopilot control-plane repository surface from Markdown-only to Markdown plus pure typed governance validation.
Files changed:

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `vitest.config.ts`
- `src/data/delivery-system/*.ts`
- `src/lib/delivery-system/*.ts`
- `tests/delivery-system/*.test.ts`
- `docs/autopilot/delivery-system-runtime-package-decision.md`
- `docs/autopilot/delivery-system-snapshots/2026-05-13-autopilot-read-only-dry-run.md`
- `docs/autopilot/v3-prompt-pack.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Autopilot now has a minimal local TypeScript/Vitest package for governance contracts and tests. This does not create an app runtime, UI route, connector client, durable workflow, background job, or deployment surface.
Decisions:

- Keep package scripts limited to `test`, `typecheck`, and `verify`.
- Keep runtime dependencies empty.
- Keep source files side-effect free and local-only.
- Require a separate architecture decision before adding read-only UI or any execution runtime.

Verification:

- `npm run test -- tests/delivery-system/governance.test.ts tests/delivery-system/ledger.test.ts tests/delivery-system/boundary.test.ts`: passed 3 files and 11 tests after review fixes.
- `npm run typecheck`: passed.
- `npm run verify`: passed.
- Forbidden source/package scan returned no matches for process, network, connector, and cloud SDK usage in `src` and `package.json`.
- Forbidden product-runtime path scan returned no matches for app runtime or deployment paths.
- Placeholder-token scan returned no matches.
- `git diff --check` passed with only LF/CRLF normalization warnings.

Risks:

- Future package changes could accidentally add connector clients, deployment scripts, or product runtime folders; boundary tests now guard the first version of this risk.
- External project inventory remains unnormalized.

## 2026-05-13 Static Read-Only Command Center

Date: 2026-05-13
Request or trigger: continue executing the large Autopilot workflow plan.
Mode: WRITE_ALLOWED for static UI and local browser verification.
Scope: add a read-only `/autopilot` command center backed by local typed governance contracts.
Files changed:

- `astro.config.mjs`
- `playwright.config.ts`
- `package.json`
- `package-lock.json`
- `src/env.d.ts`
- `src/pages/autopilot.astro`
- `tests/autopilot-delivery-system.spec.ts`
- `tests/delivery-system/boundary.test.ts`
- `docs/autopilot/delivery-system-read-only-ui-decision.md`
- `docs/autopilot/v3-prompt-pack.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: the control plane now has a local static command-center route for reviewing governance state. It is not a production dashboard, connector client, execution console, or deployment surface.
Decisions:

- Use Astro for static route rendering.
- Use Playwright for local smoke and overflow verification.
- Keep connector and execution behavior out of the UI.

Verification:

- `npm run typecheck`: passed.
- `npm run test`: passed 3 files and 11 tests after review fixes.
- `npm run build`: passed, one page built.
- `npm run test:e2e`: passed after installing Playwright Chromium.
- Final `npm run verify`: passed typecheck, Vitest, Astro build, and Playwright e2e.

Risks:

- The UI has no live connector data yet by design.
- Read-only scope must be preserved before any future dashboard expansion.

## 2026-05-31 Product & Design OS Foundation

Date: 2026-05-31
Request or trigger: user asked to restart the Radeq design workflow from stricter product/design operating-system rules and provided a Product & Design OS integration prompt.
Mode: WRITE_ALLOWED for Autopilot governance/templates only.
Scope: add a phase-1 Product & Design OS foundation without redesigning current UI, adding runtime dependencies, or creating a parallel source of truth.
Files changed:

- `AGENTS.md`
- `product-design-os/`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Autopilot now has a Product & Design OS governance/template layer for product classification, scope locking, strict opposition, recipe selection, taste memory, asset/pattern schemas, and QA planning. It extends the existing Decision Mesh and control-plane governance; it is not a runtime, connector client, execution engine, or duplicate mesh.
Decisions:

- Keep phase 1 as templates, rules, schemas, recipes, reports, and taste memory only.
- Treat Context7 as preferred docs verification when connected; in this session no callable Context7 MCP server was available, so official docs and canonical GitHub sources were used as fallback.
- Gemini CLI may be used as redacted advisory critique only when free/no-cost availability is confirmed; the advisory output from this slice had a domain-mismatch warning and was not treated as source-of-truth.
- Reddit feedback is qualitative signal only, useful for anti-template heuristics but not source-of-truth evidence.

Verification:

- External docs checked: Context7 overview, Gemini CLI pricing/quota docs, Playwright visual comparison and accessibility docs.
- GitHub connector checked canonical public repositories: USWDS, Carbon, Style Dictionary, and promptfoo.
- Gemini CLI `0.44.1` was available and ran a redacted advisory prompt outside the repo after `--skip-trust`; output was reviewed with domain-mismatch caveat.
- Product & Design OS JSON parse check passed for 21 JSON files.
- `git diff --check` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run mesh:check` passed.
- `npm.cmd test` passed: 16 test files, 66 tests.

Risks:

- Product & Design OS now has an initial deterministic foundation validator, but Design Reader/OCR/visual QA automation is still a later phase.
- Design Reader/OCR/visual QA automation is still a later phase.
- Radeq still needs its own project-level Needs Report and Scope Contract before the next implementation attempt.

## 2026-05-31 Process And Mesh Audit

Date: 2026-05-31
Request or trigger: user asked to thoroughly review the whole process and mesh separately, check errors, invalid links, Context7/best-practice usage, and run MCP if useful.
Mode: WRITE_ALLOWED for clear governance/process fixes and audit report only.
Scope: audit Product & Design OS, root mesh, Autopilot project mesh, MCP read-only boundary, links, Context7 fallback, Gemini advisory route, and dependency status. No runtime, connector mutation, product implementation, or dependency upgrade was added.
Files changed:

- `src/data/delivery-system/contextEconomy.ts`
- `tests/delivery-system/context-economy-policy.test.ts`
- `product-design-os/`
- `docs/autopilot/delivery-system-execution-engine-options.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/autopilot/repository-separation-policy.md`
- `docs/autopilot/v3-prompt-pack.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `docs/projects/multi-agent-autonomous-delivery-system/architecture.md`

Architecture impact: Current control-plane governance now points to the active local workspace `C:\Programování\Codex`, session-reset wording no longer treats summaries as source of truth, and Product & Design OS explicitly enters the Decision Mesh/MCP plus Context7/official-docs verification path.
Decisions:

- Keep MCP read-only; smoke test used stdio and closed after inspection.
- Keep Context7 as preferred when connected, but record official-docs fallback because no callable Context7 MCP server is configured locally.
- Keep Gemini advisory-only; redacted audit output was reviewed but not used as source-of-truth evidence.
- Do not update `astro` or `tsx` in this audit slice because only minor newer versions are available and `npm audit` reports zero vulnerabilities.

Verification:

- Decision Mesh MCP tools returned compact root and project packets.
- Local MCP smoke test listed 13 read-only tools and returned an Autopilot project mesh packet.
- Link audit checked active docs; localhost/example/logical schema IDs were skipped, private `SirRadek/autopilot` links are treated as private evidence, and two canonical docs links were fixed.
- `npm.cmd audit --audit-level=moderate` reported zero vulnerabilities.
- Product & Design OS JSON parse check passed for 21 JSON files.
- `npm.cmd run verify` passed: mesh check, typecheck, 16 Vitest files with 66 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed after newline/trailing-whitespace normalization.

Risks:

- Root mesh generic nodes still contain product-repository path hints that may not exist in the control-plane repo; project meshes remain the implementation authority.
- Product & Design OS now has an initial deterministic foundation validator and intake/change-request router, but Design Reader automation and advanced scoring remain planned.

## 2026-06-01 Product & Design OS Validator

Date: 2026-06-01
Request or trigger: continued Product & Design OS process/mesh hardening after audit identified missing deterministic validators.
Mode: WRITE_ALLOWED for local governance tooling, tests, and architecture/work-log updates only.
Scope: add an initial no-dependency Product & Design OS foundation validator, wire it into local verification, and keep the new tooling inside the Autopilot control-plane boundary. No runtime behavior, connector mutation, remote model dependency, or product implementation was added.
Files changed:

- `package.json`
- `tsconfig.json`
- `product-design-os/scripts/validate-product-design-os.ts`
- `tests/delivery-system/product-design-os-validation.test.ts`
- `tests/delivery-system/boundary.test.ts`
- `tests/delivery-system/core-language-boundary.test.ts`
- `product-design-os/README.md`
- `product-design-os/reports/product-design-os-foundation-report.md`
- `product-design-os/reports/process-mesh-audit-2026-05-31.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Product & Design OS moved from templates-only foundation toward a deterministic governance check. The validator checks required files, JSON validity, scope headings, recipe/schema basics, manifest shape, taste-memory shape, and strict-process MCP terms. It remains local and read-only; it does not introduce product runtime code, connector clients, cloud models, or a parallel source of truth.
Decisions:

- Keep `pdos:validate` dependency-free and deterministic.
- Add `pdos:validate` to `verify` so Product & Design OS drift is caught with normal local checks.
- Extend boundary and core-language tests to include `product-design-os/scripts`.
- Keep advanced Design Reader, OCR, visual QA, and asset scoring as later phases.

Verification:

- `npm.cmd run pdos:validate` passed: 39 checked files, 0 errors, 0 warnings.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 17 Vitest files with 68 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed after newline/trailing-whitespace normalization.

Risks:

- The validator is intentionally a phase-1 foundation guard, not the final Product & Design OS automation layer.
- Design Reader/OCR/visual QA, detailed asset scoring, and recipe-selection automation remain planned.

## 2026-06-01 Product & Design OS Intake Router

Date: 2026-06-01
Request or trigger: user asked to continue slowly and use the sensible MCP/technology route after the Product & Design OS audit.
Mode: WRITE_ALLOWED for bounded local governance tooling, tests, and architecture/work-log updates only.
Scope: add a deterministic no-dependency Product & Design OS intake and change-request router. No runtime behavior, connector mutation, cloud model dependency, paid service, product implementation, or parallel source of truth was added.
Files changed:

- `package.json`
- `product-design-os/scripts/route-product-design-os.ts`
- `product-design-os/scripts/validate-product-design-os.ts`
- `tests/delivery-system/product-design-os-router.test.ts`
- `product-design-os/README.md`
- `product-design-os/reports/product-design-os-foundation-report.md`
- `product-design-os/reports/process-mesh-audit-2026-05-31.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Product & Design OS now has a local routing layer for Gate 1 and change-request triage. The router classifies project intake, selects an approved recipe, estimates logic/design/motion/risk levels, lists required gates, and classifies change requests as clarification, scope expansion, direction change, backlog idea, or conflict with goal. It remains advisory and deterministic; owner decisions, project mesh records, and local tests remain source of truth.
Decisions:

- Use existing Decision Mesh MCP first; no Context7 MCP server was callable in this environment, and no current external technical claim was needed for this local TypeScript slice.
- Do not use Gemini or other cloud models for this slice because `select_reasoning_model_route` recommended local worker defaults for routine bounded tooling.
- Keep the router dependency-free and test-driven before attempting Design Reader/OCR or visual QA automation.

Verification:

- `npm.cmd run pdos:route -- --text "marketing website for leads with motion cursor interaction case studies and clear CTA"` passed and selected `marketing_web` with `creative-motion`.
- `npm.cmd run pdos:route -- --change "add 3d avatar to checkout payment step"` passed and classified the request as `E` / `conflict_with_goal`.
- `npm.cmd run pdos:validate` passed: 41 checked files, 0 errors, 0 warnings.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 18 Vitest files with 74 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed.

Risks:

- The router is deterministic heuristic triage, not product truth or final approval.
- It must be refined against real briefs and feedback before it can replace manual product review.
- Design Reader/OCR/visual QA and detailed asset scoring remain planned.

## 2026-06-01 Product & Design OS MCP Route And Reports

Date: 2026-06-01
Request or trigger: user approved the next recommended slice: expose Product & Design OS routing through MCP and add a console-only report generator.
Mode: WRITE_ALLOWED for bounded local governance tooling, read-only MCP exposure, tests, and architecture/work-log updates only.
Scope: expose the deterministic Product & Design OS router as a local read-only MCP tool and add Markdown report output for needs, scope, product opposition, and implementation lock. No file-writing report output, connector mutation, cloud model dependency, paid service, product runtime code, or parallel source of truth was added.
Files changed:

- `package.json`
- `mcp/server.ts`
- `product-design-os/scripts/route-product-design-os.ts`
- `tests/delivery-system/product-design-os-router.test.ts`
- `tests/delivery-system/product-design-os-mcp.test.ts`
- `product-design-os/README.md`
- `product-design-os/reports/product-design-os-foundation-report.md`
- `product-design-os/reports/process-mesh-audit-2026-05-31.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Product & Design OS routing is now available through the existing local read-only MCP server as `route_product_design_os`. The MCP tool accepts literal intake/change-request fields and returns JSON or Markdown text; it does not accept file paths, write files, call connectors, mutate projects, or approve implementation. The CLI also has `pdos:report` for console-only Markdown reports.
Decisions:

- Keep MCP exposure read-only and local-only.
- Keep report generation console-only until a later architecture decision defines where project reports should be written.
- Continue to avoid Gemini/cloud models for this bounded tooling slice because local deterministic checks cover the risk.
- Treat generated reports as draft governance aids, not owner approval or project truth.

Verification:

- `npm.cmd run pdos:report -- --text "marketing website for leads with motion cursor interaction case studies and clear CTA"` passed and printed a console-only Markdown report.
- `npm.cmd test -- product-design-os` passed: 3 Vitest files, 11 tests.
- `npm.cmd run pdos:validate` passed: 41 checked files, 0 errors, 0 warnings.
- Local MCP stdio smoke passed: `route_product_design_os` was listed and returned a Markdown report.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 19 Vitest files with 77 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed.

Risks:

- The MCP route is intentionally advisory and must remain read-only.
- Report output still needs real-project calibration before it can replace manual Needs/Scope drafting.
- Design Reader/OCR/visual QA and detailed asset scoring remain planned.

## 2026-06-01 Product & Design OS Scoring

Date: 2026-06-01
Request or trigger: user asked to continue after the Product & Design OS MCP route/report slice.
Mode: WRITE_ALLOWED for bounded local governance tooling, read-only MCP exposure, tests, and architecture/work-log updates only.
Scope: add deterministic recipe/pattern/asset scoring for Product & Design OS. No product runtime behavior, connector mutation, file-writing MCP output, cloud model dependency, paid service, or parallel source of truth was added.
Files changed:

- `package.json`
- `mcp/server.ts`
- `product-design-os/scripts/score-product-design-os.ts`
- `product-design-os/scripts/validate-product-design-os.ts`
- `tests/delivery-system/product-design-os-scoring.test.ts`
- `tests/delivery-system/product-design-os-mcp.test.ts`
- `product-design-os/README.md`
- `product-design-os/reports/product-design-os-foundation-report.md`
- `product-design-os/reports/process-mesh-audit-2026-05-31.md`
- `docs/autopilot/project-architecture-registry.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Product & Design OS now has a deterministic scoring layer for recipes, registered UX patterns, and registered design assets. The scorer uses the documented purpose/target/logic/usability/taste/accessibility/mobile/performance/complexity/template-risk/style-conflict formula and returns selected and rejected candidates. It is exposed locally through `pdos:score` and read-only MCP tool `score_product_design_os`.
Decisions:

- Keep scoring deterministic and dependency-free.
- Keep empty pattern/asset manifests explicit through warnings instead of pretending candidates exist.
- Keep MCP scoring input literal-only; no file paths and no writes.
- Treat scores as triage support, not owner approval.

Verification:

- `npm.cmd run pdos:score -- --text "marketing website for leads with motion and case studies" --format markdown` passed and produced a score report.
- `npm.cmd test -- product-design-os` passed: 4 Vitest files, 14 tests.
- `npm.cmd run pdos:validate` passed: 42 checked files, 0 errors, 0 warnings.
- Local MCP stdio smoke passed: `score_product_design_os` was listed and returned a Markdown score report.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 20 Vitest files with 80 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed.

Risks:

- Pattern and asset manifests now contain a first marketing/creative seed set, but other project types still need candidates.
- Scores are heuristics and need calibration against real projects and user feedback.
- Design Reader/OCR/visual QA remains planned.

## 2026-06-01 Product & Design OS Marketing Registry Seed

Date: 2026-06-01
Request or trigger: user approved continuing with the next Product & Design OS step after scoring showed empty pattern and asset manifests.
Mode: WRITE_ALLOWED for governance metadata, tests, and architecture/work-log updates only.
Scope: populate the first marketing/creative UX pattern and design asset registry candidates so deterministic scoring can select concrete options beyond recipes. No runtime implementation, visual asset files, connector mutation, cloud model dependency, paid service, or product website change was added.
Files changed:

- `product-design-os/patterns/pattern-manifest.json`
- `product-design-os/assets/asset-manifest.json`
- `tests/delivery-system/product-design-os-validation.test.ts`
- `tests/delivery-system/product-design-os-scoring.test.ts`
- `product-design-os/reports/product-design-os-foundation-report.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Product & Design OS now has a first real registry seed for marketing/creative websites. The registry includes positioning, proof, service-demo, cursor-responsive, scroll-linked, and asymmetric editorial patterns, plus matching hero/section/motion/layout asset metadata. The entries encode mobile, reduced-motion, SEO/content, performance, template-risk, and anti-generic constraints as metadata for later scoring and design review.
Decisions:

- Keep this seed focused on marketing/creative web work because that is the current product pressure point.
- Do not add external asset sources; entries are internal metadata only.
- Keep motion patterns as enhancements with reduced-motion and mobile fallback requirements.
- Avoid generic SaaS gradients, fake dashboards, repeated equal cards, and motion without product value.

Verification:

- `npm.cmd run pdos:score -- --text "marketing website for non technical customers with motion proof service demo links and clear inquiry CTA" --format markdown` passed and selected registered patterns/assets without empty-manifest warnings.
- `npm.cmd test -- product-design-os` passed: 4 Vitest files, 15 tests.
- `npm.cmd run pdos:validate` passed: 42 checked files, 0 errors, 0 warnings.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 20 Vitest files with 81 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed.

Risks:

- Registry coverage is still narrow; ecommerce, dashboards, internal systems, and public-sector patterns remain mostly unseeded.
- Metadata quality needs calibration against real Radeq and client design outcomes.
- Design Reader/OCR/visual QA remains planned.

## 2026-06-01 Product & Design OS Ecommerce Registry Seed

Date: 2026-06-01
Request or trigger: user asked to continue gradually after the marketing/creative Product & Design OS registry seed.
Mode: WRITE_ALLOWED for governance metadata, tests, and architecture/work-log updates only.
Scope: populate the first ecommerce UX pattern and design asset registry candidates so deterministic scoring can route product-grid, product-detail, cart, checkout, review, and trust-summary work. No runtime implementation, product checkout logic, connector mutation, cloud model dependency, paid service, or product website change was added.
Files changed:

- `product-design-os/patterns/pattern-manifest.json`
- `product-design-os/assets/asset-manifest.json`
- `tests/delivery-system/product-design-os-scoring.test.ts`
- `product-design-os/reports/product-design-os-foundation-report.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Product & Design OS now has an ecommerce registry seed aligned with the `ecommerce-conversion` recipe. The seed encodes product clarity, price visibility, variant/availability state, cart focus handling, checkout step recovery, sourced reviews, policy trust, mobile safety, low motion, and performance constraints as metadata for later scoring and design review.
Decisions:

- Keep ecommerce motion low and reject decorative checkout effects by metadata.
- Prioritize trust, price clarity, mobile checkout, error states, and deterministic cart/payment state over visual novelty.
- Do not add external dependencies or adopt third-party ecommerce UI kits in this slice.
- Do not use Gemini/Qwen for this deterministic metadata slice; mesh routing selected local/deterministic checks and local 14B availability was not verified.

Verification:

- `npm.cmd run pdos:score -- --text "ecommerce product grid cart checkout payment shipping reviews trust mobile checkout clear price" --format markdown` passed and selected `ecommerce-conversion`, checkout-safe ecommerce patterns, and low-motion ecommerce assets.
- `npm.cmd test -- product-design-os` passed: 4 Vitest files, 16 tests.
- `npm.cmd run pdos:validate` passed: 42 checked files, 0 errors, 0 warnings.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 20 Vitest files with 82 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed.

Risks:

- Dashboard, internal-system, and public-sector registry coverage was still unseeded at the end of this ecommerce slice.
- Ecommerce scoring is still heuristic and must be calibrated against real storefront/checkouts before it is treated as implementation guidance.
- Checkout/payment implementation remains high-risk and would require separate project scope, owner decision, and runtime tests.

## 2026-06-01 Product & Design OS Dashboard And Internal Registry Seeds

Date: 2026-06-01
Request or trigger: user asked to do both next registry seeds after the ecommerce Product & Design OS slice.
Mode: WRITE_ALLOWED for governance metadata, tests, and architecture/work-log updates only.
Scope: populate first dashboard/data-heavy and internal-ops UX pattern and design asset registry candidates. No runtime implementation, product database logic, connector mutation, cloud model dependency, paid service, or project website change was added.
Files changed:

- `product-design-os/patterns/pattern-manifest.json`
- `product-design-os/assets/asset-manifest.json`
- `tests/delivery-system/product-design-os-scoring.test.ts`
- `product-design-os/reports/product-design-os-foundation-report.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Product & Design OS now has first dashboard/data-heavy and internal-ops registry coverage. Dashboard metadata encodes KPI definitions, filters, drilldown tables, source/freshness labels, accessible chart fallback, alert triage, export consistency, low motion, and performance limits. Internal-ops metadata encodes table-first workflow, detail drawers, status taxonomy, bulk-action safeguards, saved filters, role/permission awareness, audit trail needs, keyboard/focus handling, and low decorative complexity.
Decisions:

- Keep dashboard design data-first: every metric needs definition, source, freshness, and a decision path.
- Keep internal systems workflow-first: roles, permissions, state model, validation, keyboard flow, and audit trail take priority over visual novelty.
- Keep motion at 0-1 for these recipes and block decorative 3D/video/particle-style assets through metadata.
- Do not use Gemini/Qwen for this deterministic metadata slice; mesh routing selected deterministic/local checks and local 14B availability was not verified.

Verification:

- `npm.cmd run pdos:score -- --text "dashboard analytics KPI metric chart filters export report data freshness drilldown table alert decision support" --format markdown` passed and selected `dashboard-data-heavy`, dashboard KPI/chart/alert patterns, and dashboard data assets.
- `npm.cmd run pdos:score -- --text "internal system operator roles permissions workflow state audit log table filters detail drawer status badges bulk action saved filters data entry" --format markdown` passed and selected `internal-ops-clean`, internal status/table/alert patterns, and internal operations assets.
- `npm.cmd test -- product-design-os` passed: 4 Vitest files, 18 tests.
- `npm.cmd run pdos:validate` passed: 42 checked files, 0 errors, 0 warnings.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 20 Vitest files with 84 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed.

Risks:

- Public-sector and client-portal registry coverage was still unseeded at the end of this dashboard/internal slice.
- Dashboard and internal scoring is still heuristic and must be calibrated against real dashboards/internal systems before it is treated as implementation guidance.
- Actual database, permission, bulk action, and export behavior remains high-risk project runtime work and requires separate project scope, owner decision, and runtime tests.

## 2026-06-01 Product & Design OS Public/Portal And Visual QA Seed

Date: 2026-06-01
Request or trigger: user asked to do both next options after dashboard/internal registry seeds: public-sector/client-portal seed and Design Reader/Visual QA layer.
Mode: WRITE_ALLOWED for governance metadata, local deterministic tooling, tests, and architecture/work-log updates only.
Scope: add public-sector and client-portal recipes, routing, patterns, assets, scoring coverage, and the first structured-snapshot Visual QA analyzer. No product runtime implementation, screenshot capture, OCR engine, connector mutation, cloud model dependency, paid service, or project website change was added.
Files changed:

- `package.json`
- `product-design-os/recipes/client-portal-trust.json`
- `product-design-os/recipes/public-sector-accessible.json`
- `product-design-os/patterns/pattern-manifest.json`
- `product-design-os/assets/asset-manifest.json`
- `product-design-os/scripts/route-product-design-os.ts`
- `product-design-os/scripts/validate-product-design-os.ts`
- `product-design-os/scripts/visual-qa-product-design-os.ts`
- `product-design-os/reader/README.md`
- `product-design-os/reader/visual-qa-sample.json`
- `product-design-os/README.md`
- `tests/delivery-system/product-design-os-router.test.ts`
- `tests/delivery-system/product-design-os-scoring.test.ts`
- `tests/delivery-system/product-design-os-visual-qa.test.ts`
- `product-design-os/reports/product-design-os-foundation-report.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Product & Design OS now has dedicated routing recipes for `public_sector` and `client_portal`, plus first registry coverage for accessible public services, plain-language content, accessible form flows, notices, office contacts, client account overviews, secure document lists, support threads, client task timelines, and permission-aware actions. It also has the first deterministic Design Reader / Visual QA script, which accepts structured viewport evidence and reports layout, contrast, motion, DOM-content, and template-risk issues.
Decisions:

- Public-sector defaults prioritize accessibility, findability, plain language, contact paths, keyboard flow, and near-zero motion.
- Client-portal defaults prioritize trust, account clarity, document access, secure actions, support, permissions, and mobile access.
- Visual QA starts with structured snapshot analysis only; full screenshot capture, OCR, DOM/CSS extraction, and reference comparison remain later phases.
- Do not use Gemini/Qwen for this deterministic metadata/tooling slice; mesh routing selected local deterministic checks and local 14B availability was not verified.

Verification:

- `npm.cmd run pdos:score -- --text "public sector municipality citizen service finder accessible forms office contact notice plain language keyboard mobile" --format markdown` passed and selected `public-sector-accessible`, public-sector patterns, and public-sector assets.
- `npm.cmd run pdos:score -- --text "client portal account overview secure documents support thread tasks timeline permissions client actions mobile trust" --format markdown` passed and selected `client-portal-trust`, client-portal patterns, and client-portal assets.
- `npm.cmd run pdos:visual-qa -- --file product-design-os/reader/visual-qa-sample.json --format markdown` passed and produced a Visual QA report with no blocking issues for the sample.
- `npm.cmd run typecheck` passed.
- `npm.cmd test -- product-design-os` passed: 5 Vitest files, 22 tests.
- `npm.cmd run pdos:validate` passed: 46 checked files, 0 errors, 0 warnings.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 21 Vitest files with 88 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed.

Risks:

- Visual QA currently analyzes provided structured evidence; it does not yet capture screenshots or independently inspect live pages.
- Public-sector and client-portal scoring is heuristic and must be calibrated against real projects before it is treated as implementation guidance.
- Auth, permissions, document access, uploads, and public forms remain high-risk project runtime work and require separate project scope, owner decision, and runtime tests.

## 2026-06-01 Product & Design OS Design Reader Capture

Date: 2026-06-01
Request or trigger: user said to continue with both next Product & Design OS steps after the structured Visual QA seed.
Mode: WRITE_ALLOWED for local deterministic tooling, tests, ignored local artifacts, and architecture/work-log updates only.
Scope: add a local Playwright Design Reader capture command that can inspect a local HTML file or URL, capture screenshots, extract DOM/CSS evidence, and feed the existing Visual QA analyzer. No product runtime implementation, OCR dependency, connector mutation, cloud model dependency, paid service, or project website change was added.
Files changed:

- `.gitignore`
- `package.json`
- `product-design-os/scripts/capture-design-reader.ts`
- `product-design-os/scripts/validate-product-design-os.ts`
- `product-design-os/reader/capture-sample.html`
- `product-design-os/reader/README.md`
- `product-design-os/README.md`
- `product-design-os/reports/product-design-os-foundation-report.md`
- `tests/delivery-system/product-design-os-reader-capture.test.ts`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Product & Design OS now has a phase-2 Design Reader capture lane. It uses the existing local Playwright dependency to open a page, capture desktop/mobile screenshots, extract headings, CTA text, visible text volume, repeated-card signals, layout overflow, text overlap, contrast warnings, canvas-content risk, motion/reduced-motion evidence, and template-risk signals, then generates the same structured Visual QA report format used by `pdos:visual-qa`. Generated screenshots and snapshots are local artifacts under ignored `output/playwright/`.
Decisions:

- Keep Design Reader capture deterministic and local before adding OCR, visual diffing, or reference comparison.
- Reuse existing Playwright tooling instead of adding a new runtime dependency.
- Treat OCR as planned work until a free, locally acceptable implementation path is selected and validated.
- Do not use Gemini/Qwen/cloud workers for this routine implementation slice; mesh routing selected deterministic local tooling and local Qwen 14B availability was not verified.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- product-design-os` passed: 6 Vitest files, 23 tests.
- `npm.cmd run pdos:reader:capture -- --html-file product-design-os/reader/capture-sample.html --output-dir output/playwright/product-design-os` passed, produced desktop/mobile screenshots, `design-reader-snapshot.json`, and `visual-qa-report.md`, with Visual QA OK and template-risk score 0/10.
- `npm.cmd run pdos:validate` passed: 49 checked files, 0 errors, 0 warnings.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 22 Vitest files with 89 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed.

Risks:

- The capture script is a first local evidence extractor, not a full OCR or screenshot-comparison engine.
- DOM/CSS heuristics can flag likely issues, but final visual judgment still requires screenshot review for real client pages.
- Live external URLs may need network availability and can vary over time; local files are preferred for deterministic regression checks.

## 2026-06-02 Product & Design OS PDF Supervisor Adapter

Date: 2026-06-02
Request or trigger: user pointed to the private GitHub `pdf-supervisor` project and asked to reuse it after model limits reset.
Mode: WRITE_ALLOWED for local deterministic tooling, tests, ignored local artifacts, and architecture/work-log updates only.
Scope: add a Product & Design OS document-reader adapter that can call the separate local `pdf-supervisor` Python repository as an external worker. No dependency install, repo clone, product runtime implementation, connector mutation, cloud model dependency, paid service, or project website change was added.
Files changed:

- `.gitignore`
- `package.json`
- `product-design-os/reader/document-reader-adapter.ts`
- `product-design-os/scripts/validate-product-design-os.ts`
- `product-design-os/reader/pdf-supervisor-adapter.md`
- `product-design-os/reader/README.md`
- `product-design-os/README.md`
- `product-design-os/reports/product-design-os-foundation-report.md`
- `tests/delivery-system/product-design-os-document-reader.test.ts`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Product & Design OS now has a bounded external-worker bridge for document/PDF extraction. Autopilot keeps `pdf-supervisor` outside the control-plane repository and invokes only `python -m document_supervisor.cli` through `pdos:reader:document`, with `PDOS_PDF_SUPERVISOR_ROOT` or `--supervisor-root` selecting the local worker root. The adapter checks Python availability, `document_supervisor` files, commercial requirements, core dependencies, optional Tesseract, source existence, worker exit code, and expected review artifacts. Generated document-reader outputs are local artifacts under ignored `output/document-reader/`.
Decisions:

- Keep `pdf-supervisor` as an external local worker, not copied code or a duplicate Autopilot source of truth.
- Use the commercial-safe `document_supervisor` CLI lane by default.
- Treat OCR and extracted document text as reviewable evidence, not verified truth.
- Keep cloud/Gemini review disabled for this adapter; local deterministic tooling is enough for this slice.
- Do not install Python packages automatically. Runtime readiness is reported by `--check-only`.

Verification:

- `npm.cmd run pdos:reader:document -- --check-only --format markdown` was run as an expected negative smoke: Python 3.13.6 was detected and the adapter correctly reported missing `PDOS_PDF_SUPERVISOR_ROOT`.
- `npm.cmd run pdos:validate` passed: 51 checked files, 0 errors, 0 warnings.
- `npm.cmd run typecheck` passed.
- `npm.cmd test -- product-design-os` passed: 7 Vitest files, 25 tests.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 23 Vitest files with 91 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed.

Risks:

- The local machine has Python 3.13.6, but the real `pdf-supervisor` runtime dependencies and Tesseract were not installed in the active environment during the earlier inspection.
- The adapter is tested with a fake bounded worker; a real PDF smoke test requires a local `PDOS_PDF_SUPERVISOR_ROOT` and installed commercial-safe dependencies.
- Screenshot OCR is still separate planned work; this slice covers PDF/document conversion through `pdf-supervisor`.

## 2026-06-03 Product & Design OS PDF Supervisor Local Worker Setup

Date: 2026-06-03
Request or trigger: user asked to download the private GitHub `pdf-supervisor` project and wire it into the existing Product & Design OS adapter.
Mode: WRITE_ALLOWED for ignored local worker/runtime artifacts, a narrow adapter fix, tests, docs, and work-log update. No cloud model, paid service, connector mutation, or copied external source was added.
Scope: clone or update `SirRadek/pdf-supervisor` as an ignored external worker under `.codex-run/workers/pdf-supervisor`, create a local Python venv under `.codex-run/venvs/pdf-supervisor`, install only `requirements-commercial.txt`, and run the Product & Design OS document-reader adapter against the real worker.
Files changed:

- `product-design-os/reader/document-reader-adapter.ts`
- `product-design-os/reader/pdf-supervisor-adapter.md`
- `tests/delivery-system/product-design-os-document-reader.test.ts`
- `docs/projects/autopilot-control-plane/work-log.md`

Local artifacts created:

- `.codex-run/workers/pdf-supervisor`
- `.codex-run/venvs/pdf-supervisor`
- `.codex-run/smoke/document-reader/sample.csv`
- `output/document-reader/pdf-supervisor-smoke/`

Architecture impact: no new Autopilot runtime or source of truth was created. `pdf-supervisor` remains a separate local worker selected by explicit path. The adapter now resolves path-like Python overrides before switching into the worker directory, which prevents relative venv paths from failing dependency checks when the worker runs with a different `cwd`.
Decisions:

- Use Python 3.11.9 for the worker venv instead of the machine default Python 3.13.6.
- Install only the commercial-safe dependency profile: `pypdfium2`, `pdfplumber`, `Pillow`, and `ftfy`.
- Keep Tesseract optional for native-text/common-document smoke tests; OCR pages still require uncertainty handling when Tesseract is missing.
- Keep all cloned worker code, venv files, smoke inputs, and generated conversion outputs ignored/local.

Verification:

- `gh repo view SirRadek/pdf-supervisor --json nameWithOwner,defaultBranchRef,isPrivate,isArchived,pushedAt,updatedAt,url` confirmed the private repo, `main` branch, non-archived status, and GitHub access.
- `gh repo clone SirRadek/pdf-supervisor .codex-run/workers/pdf-supervisor` cloned commit `a3cf4fa`.
- `py -3.11 -m venv .codex-run/venvs/pdf-supervisor` created the local worker venv.
- `.codex-run/venvs/pdf-supervisor/Scripts/python.exe -m pip install -r .codex-run/workers/pdf-supervisor/requirements-commercial.txt` installed the commercial-safe dependencies successfully.
- `npm.cmd run pdos:reader:document -- --check-only --supervisor-root .codex-run\workers\pdf-supervisor --python .codex-run\venvs\pdf-supervisor\Scripts\python.exe --format markdown` passed with runtime status OK and a warning that Tesseract is not in PATH.
- `npm.cmd run pdos:reader:document -- --source .codex-run\smoke\document-reader\sample.csv --output-dir output\document-reader\pdf-supervisor-smoke --supervisor-root .codex-run\workers\pdf-supervisor --python .codex-run\venvs\pdf-supervisor\Scripts\python.exe --format markdown` passed and produced all expected Markdown/JSON review artifacts.
- `npm.cmd test -- product-design-os-document-reader` passed: 1 Vitest file, 3 tests.
- `npm.cmd run pdos:validate` passed: 51 checked files, 0 errors, 0 warnings.
- `npm.cmd run typecheck` passed.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 23 Vitest files with 92 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed.

Risks:

- Tesseract is still not available in PATH, so scanned PDFs that need OCR will fall back or report uncertainty until local OCR is installed and verified.
- The smoke input was a common-document CSV. A real PDF smoke test should be run with a non-sensitive sample PDF before relying on PDF/OCR conversion quality.
- The external worker remains a private repo dependency. Update it explicitly and rerun the adapter checks when `pdf-supervisor` changes.

## 2026-06-03 Prompt Library Foundation And Mesh Application Plan

Date: 2026-06-03
Request or trigger: user asked to add a prompt-library layer based on official provider guidance plus DAIR.AI/GitHub inspiration, then plan how to apply that prompt layer into the Decision Mesh.
Mode: WRITE_ALLOWED for local prompt-library contracts, typed governance policy, Decision Mesh nodes/rules/edges, tests, architecture, and work-log records. No cloud model, prompt-management SaaS, paid service, runtime selector, connector mutation, or leaked prompt source was added.
Scope: create the phase-0 local `prompt-library/`, add provider-specific seed prompt contracts for GPT, Gemini, Claude, and Qwen/local workers, add prompt metadata schema and source catalog, add typed `promptLibrary` policy, add root/project mesh boundaries, and document the staged mesh application plan.
Files changed:

- `prompt-library/`
- `src/data/delivery-system/promptLibrary.ts`
- `tests/delivery-system/prompt-library-policy.test.ts`
- `mesh/nodes/prompt_library_policy.yaml`
- `mesh/rules.yaml`
- `mesh/edges.yaml`
- `mesh/generated/decision-mesh.json`
- `docs/projects/autopilot-control-plane/decision-mesh/nodes/prompt_library_boundary.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/rules.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/edges.yaml`
- `docs/autopilot/prompt-library-operating-model.md`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `AGENTS.md`
- `tests/decision-mesh/query.test.ts`
- `tests/autopilot-delivery-system.spec.ts`

Architecture impact: Autopilot now has a local prompt-library governance boundary. Reusable prompts are stored as Git/Markdown contracts with metadata, source authority, expected output, eval pointers, and model-family scope. Prompt work routes through `prompt_library_policy`, `model_spend_policy`, `reasoning_strategy`, `context_economy_policy`, and the Autopilot project `prompt_library_boundary`. This adds governance and memory only; it does not add prompt runtime execution or external prompt-management dependency.
Decisions:

- Use official OpenAI, Anthropic, Google, and Qwen documentation for provider-specific prompt behavior.
- Use DAIR.AI and GitHub prompt catalogs as inspiration only.
- Keep Git/Markdown as the initial prompt source of truth.
- Block leaked system prompts, private prompts without permission, prompt changes without eval/version evidence, and paid prompt-management tools without owner exception.
- Treat Gemini/free-cloud prompt output as advisory until verified.
- Treat Qwen/local-worker prompt output as drafts requiring supervisor review and deterministic checks.

External source evidence checked on 2026-06-03:

- OpenAI prompt engineering, reasoning best practices, and structured output docs.
- Anthropic prompt engineering overview, Claude prompting best practices, and hallucination-reduction guidance.
- Google Vertex/Gemini prompt design strategies, multimodal prompt design, and prompt optimizer docs.
- Qwen docs and Qwen2.5-Coder-14B-Instruct model card for chat template and local worker constraints.
- Langfuse, Braintrust, PromptHub, DAIR.AI, and Awesome Prompt Engineering docs/catalogs as implementation or inspiration references only.

Verification:

- `npm.cmd run mesh:generate` regenerated `mesh/generated/decision-mesh.json`.
- `npm.cmd test -- prompt-library-policy` passed: 1 Vitest file, 5 tests.
- `npm.cmd test -- decision-mesh` passed: 2 Vitest files, 15 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run test:e2e` passed after updating the expected graph count to `25 nodes / 46 links`.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 24 Vitest files with 99 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed.

Risks:

- Prompt metadata validation is not automated yet; phase 2 must add a deterministic validator before prompts become defaults.
- Seed prompts are contracts and starting points, not proven production prompts.
- Agent-packet prompt selection is planned only; MCP remains read-only and does not yet serve prompt text.

## 2026-06-03 Prompt Library V3 Alignment Pass

Date: 2026-06-03
Request or trigger: user asked to compare the new prompt-library layer with older prompts and lightly adjust rules for all agents, roles, token efficiency, plugins, libraries, assets, and GitHub.
Mode: WRITE_ALLOWED for prompt-library rules, typed prompt policy, mesh metadata, tests, docs, and work-log only. No runtime prompt selector, connector mutation, GitHub mutation, paid service, cloud model call, or copied leaked prompt source was added.
Scope: compare `docs/autopilot/v3-prompt-pack.md` with the new `prompt-library/`, keep V3 as historical operating guidance, and add shared prompt rules for role/scope, token efficiency, plugin/MCP capability checks, library/asset source checks, and GitHub issue/PR normalization.
Files changed:

- `prompt-library/00-rules/autopilot-global-routing.md`
- `prompt-library/README.md`
- `prompt-library/source-catalog.md`
- `prompt-library/05-evaluation/v3-comparison-report.md`
- `src/data/delivery-system/promptLibrary.ts`
- `tests/delivery-system/prompt-library-policy.test.ts`
- `tests/delivery-system/prompt-pack-policy.test.ts`
- `mesh/nodes/prompt_library_policy.yaml`
- `mesh/generated/decision-mesh.json`
- `docs/projects/autopilot-control-plane/decision-mesh/nodes/prompt_library_boundary.yaml`
- `docs/autopilot/prompt-library-operating-model.md`
- `docs/autopilot/v3-prompt-pack.md`
- `AGENTS.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact: Prompt Library now explicitly carries forward the strongest V3 prompt-pack rules instead of replacing them. Reusable prompts must declare role/scope, use token-efficiency routing, verify plugin/MCP availability and boundaries, normalize GitHub issue/PR/project-card inputs into bounded task contracts, and verify library/asset source/license/usage-rights before adoption. V3 remains historical operating guidance; reusable prompt contracts live in `prompt-library/` and migrate incrementally.
Decisions:

- Do not bulk-convert the V3 prompt pack into prompt-library files.
- Add `autopilot-global-routing` as the shared first rule for roles, token efficiency, plugins, GitHub, libraries, and assets.
- Treat GitHub as a control surface whose issue/PR text must be normalized before prompting agents.
- Treat plugin and MCP references as capability requests, not prompt authority.
- Treat assets, UI kits, libraries, generated media, icons, fonts, and model assets as source/license/performance/accessibility gated inputs.

Verification:

- `npm.cmd run mesh:generate` regenerated `mesh/generated/decision-mesh.json`.
- `npm.cmd test -- prompt-library-policy` passed after fixing a routing bug where short `pr` matched inside `prompt`.
- `npm.cmd test -- prompt-pack-policy` passed.
- `npm.cmd test -- decision-mesh` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 24 Vitest files with 102 tests, Astro build, and 3 Playwright tests.
- `git diff --check` passed after normalizing `tests/delivery-system/prompt-pack-policy.test.ts` line endings.

Risks:

- Prompt metadata validation is still planned, not automated.
- Role-specific prompt extraction from V3 is intentionally deferred to avoid bulk migration errors.
- Library/asset license checks are policy-level gates here; future automation should make them deterministic where possible.

## 2026-06-04 Protective Supervision Layer

Date: 2026-06-04
Request or trigger: user asked for a protective guard above Autopilot that occasionally checks current information, turns agent outputs into clean input for the next agent, and tracks what is done, missing, blocked, waiting, and next.
Mode: WRITE_ALLOWED for typed governance policy, read-only MCP routing, root/project Decision Mesh records, templates, tests, architecture, and work-log records. Attempted Codex app automation creation was read-only/report-first in intent, but the app handler was unavailable.
Scope: add Protective Supervision as a report-first guardrail for currentness sentinel checks, agent handoff compilation, project progress ledger deltas, blocker review, waiting dependencies, and next action sequencing. This change does not add a runtime queue, remote mutation, connector mutation, GitHub mutation, deployment action, paid provider dependency, or delivery approval authority.
Files changed:

- `src/data/delivery-system/protectiveSupervision.ts`
- `src/data/delivery-system/roles.ts`
- `mcp/server.ts`
- `tests/delivery-system/protective-supervision-policy.test.ts`
- `tests/delivery-system/product-design-os-mcp.test.ts`
- `tests/decision-mesh/query.test.ts`
- `tests/autopilot-delivery-system.spec.ts`
- `mesh/nodes/protective_supervision_policy.yaml`
- `mesh/rules.yaml`
- `mesh/edges.yaml`
- `mesh/generated/decision-mesh.json`
- `docs/projects/autopilot-control-plane/decision-mesh/nodes/protective_supervision_boundary.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/rules.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/edges.yaml`
- `docs/autopilot/protective-supervision-operating-model.md`
- `docs/autopilot/agent-handoff-packet-template.md`
- `docs/autopilot/project-progress-ledger-template.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `AGENTS.md`

Architecture impact: Autopilot now has a first-class Protective Supervisor role, typed routing policy, root Decision Mesh node, project mesh boundary, templates, and read-only MCP route. Agent outputs must be normalized into bounded handoff packets before another agent receives them. Project progress now has explicit states and must name blockers, owners, waiting dependencies, source pointers, and verification gaps.
Decisions:

- Keep Protective Supervision report-first and read-only unless the owner approves a scoped write.
- Use Context7 when connected, or official docs/source pointers/local evidence as fallback for currentness claims.
- Reject raw agent output as the next prompt.
- Keep progress tracking in project work logs or explicit progress ledgers, not in a duplicate queue runtime.
- Stop on missing next-agent scope, stale progress ledger, blocker without owner, waiting state without dependency, remote mutation without approval, paid/cloud-only guardrail dependency, or raw project logs copied into Autopilot.
- Expose `select_protective_supervision_route` through the local MCP server as a read-only recommendation tool.

Automation status:

- Attempted to create a weekly Codex app sentinel named `Autopilot protective supervision sentinel`.
- Creation was blocked by the app response: `No handler registered for tool: automation_update`.
- No manual automation TOML was written, to avoid creating a second automation source of truth outside the Codex app API.

Verification:

- `npm.cmd run mesh:generate` regenerated the root Decision Mesh artifact.
- Root graph count is now 26 nodes / 51 links.
- `npm.cmd test -- protective-supervision-policy` passed: 1 file, 4 tests.
- `npm.cmd test -- decision-mesh` passed: 2 files, 17 tests.
- `npm.cmd test -- product-design-os-mcp` passed: 1 file, 1 test.
- `npm.cmd run mesh:check` passed.
- `npm.cmd run typecheck` passed.
- `git diff --check` passed before full verification.
- `npm.cmd run verify` passed: mesh check, Product & Design OS validation, typecheck, 25 Vitest files with 108 tests, Astro build, and 3 Playwright tests.

Risks:

- Weekly sentinel scheduling is not active until the Codex app automation handler is available.
- Protective Supervision is still a governance/reporting layer; it does not yet write progress ledgers automatically.
- Currentness checking still depends on Context7 availability or official-doc/source-pointer fallback at the time of each sentinel pass.

## 2026-06-04 Context7 And Codex App Handler Investigation

Date: 2026-06-04
Request or trigger: user asked why Context7 was not available and why the sentinel automation handler was missing, then asked to investigate the handler.
Mode: INSPECT_ONLY plus one owner-requested local MCP configuration change for Context7 and supported app-server remote-control probes. No repository runtime, GitHub, deployment, or automation TOML mutation was performed.
Scope: inspect tool/plugin/app registry, local Codex config, Codex app cache, dynamic tool metadata, process state, logs, app-server protocol, and automation storage. Configure Context7 only through the official Codex MCP CLI path after a no-key local MCP handshake test passed.
Files changed:

- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Local config changed:

- Backed up `C:\Users\sirok\.codex\config.toml` to `C:\Users\sirok\.codex\config.toml.bak-context7-20260604`.
- Added global MCP server `context7` via `codex.exe mcp add context7 -- npx.cmd -y @upstash/context7-mcp`.

Findings:

- Context7 exists in the local app-directory cache as app id `asdk_app_69ef18c674308191a2f952431f91ea61`, but the cached app entry has `isAccessible: false`.
- `list_available_plugins_to_install` did not return Context7, so it could not be installed as a Codex app connector from the available plugin installer list.
- The connector MCP cache `codex_apps_tools` contains GitHub, Hugging Face, Figma, and Canva namespaces only; it has no Context7, no `automation_update`, and no `read_thread_terminal`.
- Official Context7 docs list Codex configuration through `codex mcp add context7 -- npx -y @upstash/context7-mcp --api-key YOUR_API_KEY` or `[mcp_servers.context7]` in `~/.codex/config.toml`.
- `npx.cmd -y @upstash/context7-mcp --help` worked and reported version `3.1.0`; `npm view` reported MIT license.
- A direct MCP `initialize` probe against `npx.cmd -y @upstash/context7-mcp` succeeded without an API key.
- `codex mcp list` now shows `context7` as an enabled global stdio MCP server.
- Current running tool discovery still did not expose `mcp__context7`, so the active thread likely needs restart/reload before the new MCP server is usable.
- The current thread has `automation_update` and `read_thread_terminal` in `state_5.sqlite.thread_dynamic_tools` under namespace `codex_app`, but calls to both returned `No handler registered`.
- The current thread is recorded with `source = vscode`.
- The local automation data layer exists in `C:\Users\sirok\.codex\sqlite\codex-dev.db` and contains the paused `all-project-codex-qwen-autopilot-watchdog` automation.
- Codex app logs showed repeated `app-server remote control websocket ... initial_enabled=false` entries while local feature state had `remote_control` enabled.
- On Windows, `codex app-server daemon version` fails with `codex app-server daemon lifecycle is only supported on Unix platforms`, so the Unix daemon restart/enable path is not available.
- Generated app-server protocol bindings list `remoteControl/enable`, `remoteControl/status/read`, `mcpServer/tool/call`, and server-to-client `item/tool/call`; `item/tool/call` is the dynamic tool path that requires a host-side handler.
- `codex app-server proxy` failed against the default Windows path because `C:\Users\sirok\.codex\app-server-control\app-server-control.sock` was absent and the socket connection returned OS error `10050`.
- The active process tree shows the current runtime as `node_repl.exe` -> `codex.exe app-server --listen stdio://`; the desktop app also owns a separate `codex.exe app-server --analytics-default-enabled` child. Neither exposes the default proxy socket.
- A standalone `codex.exe app-server --listen stdio://` probe reported remote-control status `disabled`. A supported `remoteControl/enable` request moved that standalone process to `connecting`, but a fresh status probe returned `disabled` again after that process exited.
- Retesting `codex_app.read_thread_terminal` in the active thread still returned `No handler registered`, so the remote-control probe did not attach the missing `codex_app` handler.

Conclusion:

- Context7 was unavailable because it was not installed/accessible as a Codex app connector and was not configured as a local MCP server. It is now configured as a local global MCP server, pending thread/app reload.
- The sentinel automation failed because the `codex_app` helper tool metadata exists for the thread, but the runtime handler for the `codex_app` namespace is not attached in this session. This appears to be a host/runtime mismatch, likely related to the VS Code-sourced thread or stale desktop app-server bridge, not an Autopilot mesh defect.
- `remoteControl` is a separate app-server websocket feature. Enabling it in a standalone app-server process is not enough to bind `codex_app` dynamic tools in the active thread. Starting a parallel app-server would create another runtime and should not be used as the Autopilot workaround.

Recommended next step:

- Restart or fully reload the Codex desktop/thread, then retest `tool_search` for Context7 and call `codex_app.read_thread_terminal` or `codex_app.automation_update` through the official tool path.
- Prefer a fresh desktop-local thread rooted at `C:\Programování\Codex` for the retest, because the current thread is recorded as `source = vscode` and has dynamic tool metadata without the matching runtime handler.
- If `codex_app` still has no handler after restart, keep automations as blocked and use a Codex app/platform issue report with the evidence above.
- Do not hand-edit automation TOML unless the owner explicitly accepts it as a temporary local-only workaround.

Verification:

- `codex mcp get context7` reports enabled stdio transport with command `npx.cmd` and args `-y @upstash/context7-mcp`.
- `codex mcp list` includes `context7`.
- `tool_search` in the active thread still did not expose Context7 tools, confirming reload is required.
- Standalone app-server stdio protocol probe verified `remoteControl/status/read` and `remoteControl/enable` behavior without fixing the active thread's `codex_app` handler.

## 2026-06-04 Supervisor Prompt Stack For Codex App Restarts

Date: 2026-06-04
Request or trigger: user asked to strengthen the Codex App restart prompt with more distinct design examples, more realistic playful cat-avatar behavior, supervisor watchpoints, and a reusable main prompt plus project-specific task prompt pattern.
Mode: WRITE_ALLOWED for local prompt-library contracts, source catalog, operating-model documentation, architecture, and project work-log records. No runtime selector, connector mutation, GitHub mutation, paid service, or automation TOML mutation was added.
Scope: add a reusable supervisor base prompt for fresh Codex App threads and a RadeQ-specific novel-design supervisor prompt that layers on top of it. The prompts are candidate contracts, not automatic execution.
Files changed:

- `prompt-library/06-supervisor/autopilot-supervisor-base.md`
- `prompt-library/06-supervisor/radeq-novel-design-supervisor.md`
- `prompt-library/05-evaluation/supervisor-startup-checklist.md`
- `prompt-library/README.md`
- `prompt-library/source-catalog.md`
- `docs/autopilot/prompt-library-operating-model.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`
- `docs/projects/radeq/work-log.md`

Architecture impact: Prompt Library now has an explicit supervisor prompt stack: shared base prompt, project-specific prompt, then the owner's current instruction. The base prompt owns runtime bridge checks, Decision Mesh routing, source authority, handoff normalization, progress states, stop conditions, and QA gates. Project prompts add local repository, GitHub baseline, asset, workflow, and product constraints.
Decisions:

- Keep the supervisor base provider-neutral so it can be reused across projects.
- Keep RadeQ-specific GitHub baseline, distinct design requirements, cat-avatar motion, SEO/performance, and lead-capture guards in a separate project prompt.
- Distinguish `codex_app_bridge: verified`, `exposed_without_handler`, and `not_exposed`.
- Treat `exposed_without_handler` and `not_exposed` as blockers for automation creation, heartbeat scheduling, thread-terminal verification, and full Codex App runtime verification claims.
- Allow degraded supervisor planning from local files, GitHub, Decision Mesh, and deterministic checks when the current task does not depend on Codex App runtime tools.
- Require mascot/canvas work to preserve source/license checks, reduced-motion fallback, WebGL fallback, and static SEO content.

Verification:

- `npm.cmd test -- prompt-library-policy prompt-pack-policy` passed: 2 files, 9 tests.
- `npm.cmd run mesh:check` passed.
- `git diff --check` passed.

## 2026-06-11 Autopilot Foundation Hardening

Date: 2026-06-11
Request or trigger: handoff requested foundation hardening before any further Autopilot expansion, with no new product features or redesign.
Mode: WRITE_ALLOWED for local governance code, deterministic validators, schemas, tests, local documentation, Decision Mesh records, architecture registry, and work log. No connector mutation, runtime queue, deployment, remote service change, or product feature work was added.
Scope: verify and harden capability routing no-match behavior, lock project mesh packet rules in tests, add YAML/TS capability drift tests, validate prompt-library frontmatter and source catalogs, validate Product & Design OS schema/provenance relationships, add evidence/completion contracts, harden MCP output metadata, and keep local/CI verification gates deterministic.

Primary files changed and created:

- `src/lib/decision-mesh/index.ts`
- `src/lib/decision-mesh/capabilityMirror.ts`
- `scripts/generate-decision-mesh.ts`
- `scripts/validate-prompt-library.ts`
- `scripts/validate-contracts.ts`
- `mcp/server.ts`
- `docs/contracts/`
- `docs/QUICKSTART.md`
- `README.md`
- `prompt-library/`
- `product-design-os/`
- `package.json`
- `tests/`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/autopilot/project-architecture-registry.md`

Architecture impact:

- Current routing/query behavior is now regression-tested so unknown capability tasks return neutral results with no SEO/optimization fallback and no false stop conditions.
- `getRelevantSubgraph`, `findRisks`, `buildAgentPacket`, and `buildProjectMeshPacket` no-match behavior is covered by negative tests; exact node matches are asserted ahead of neighboring expansion at low `max_nodes`.
- `build_project_mesh_packet` returns applicable rules with `id`, `title`, `severity`, `instruction`, `applies_to`, plus `must_not_assume`, and the project packet path remains read-only.
- YAML/TypeScript capability drift validation is now a reusable pure module and fails on capability IDs, signals, required agents, required checks, and the `baseline_metric` regression case.
- Prompt Library now validates YAML frontmatter against `prompt.schema.json`, source IDs against `source-catalog.json`, `source-catalog.json` against `source-catalog.schema.json`, eval existence, self-reference by path or prompt ID, and candidate-only status until real eval evidence exists.
- Product & Design OS validation applies schema checks plus relationship checks for duplicate IDs, unknown source/reference/asset/pattern links, source-recorded provenance, inspiration-only references, non-adoptable sources, and project status enum usage.
- Phase-0 evidence/completion contracts now live under `docs/contracts/`, are validated by `scripts/validate-contracts.ts`, and are wired into `npm run verify`.
- MCP server version is sourced from `package.json`; server instructions, read-only annotations, per-tool output schemas, and structured content are present for tools.

Decisions:

- Keep TypeScript routing as an executable mirror for now, guarded by drift failure, rather than introducing generated routing in this slice.
- Treat unknown-license or unknown-commercial-use PDOS sources as `inspiration_only` or `blocked`.
- Normalize project library status to the Protective Supervision enum and keep free-form labels in `status_label`.
- Keep prompt contracts as `candidate`; none were promoted to `approved` without real eval results.
- Keep the current basic Playwright accessibility smoke test as the CI a11y gate for this slice; do not add an axe/pa11y dependency without a separate owner decision.
- Keep hooks report-first. This work does not claim refreshed-session `SessionStart` evidence; a Codex restart/reload is still required for current hook runtime evidence.

Verification:

- `npm.cmd run audit:deps` passed: 0 vulnerabilities.
- `npm.cmd run verify` passed:
  - `mesh:check`
  - `prompt:validate` (`34` files, `0` errors)
  - `pdos:validate` (`64` files, `0` errors, `0` warnings)
  - `contracts:validate` (`5` files, `0` errors)
  - `git diff --check`
  - `typecheck`
  - `vitest run` (`29` files, `146` tests)
  - `astro build`
- `playwright test` (`4` Chromium tests, including basic accessibility labels)

## 2026-06-11 Claude Advisory And Failed-Tool Investigation Handoff

Date: 2026-06-11
Request or trigger: owner asked why Claude Code was not used, requested a permanent fix, a Claude critique of the WordPress/WooCommerce lead-scanner plan, and report-first behavior where failed tool/model work is logged for an investigator agent.
Mode: WRITE_ALLOWED for local user PATH, report-first Codex hook hardening, deterministic tests, architecture documentation, and work-log evidence. No connector mutation, cloud/API runtime dependency, deployment, GitHub mutation, or automatic investigator runtime was added.
Scope:

- Persistently add the WinGet portable links directory to the user PATH so `claude` resolves after refreshed shells.
- Use Claude Code only as a redacted subscription-interactive advisory reviewer.
- Keep Codex hooks local, deterministic, redacted, and report-first.
- Add a failed-tool investigator handoff ledger that a supervisor can use to assign an `INSPECT_ONLY` investigator.

Findings:

- Claude Code was installed through WinGet as `Anthropic.ClaudeCode` version `2.1.172`.
- The executable existed at `C:\Users\sirok\AppData\Local\Microsoft\WinGet\Links\claude.exe`, but that WinGet Links directory was missing from user PATH.
- `claude mcp list` reports the `github` MCP server connected in read-only mode.
- Existing hook definitions could flag `tool_result_failed` in `events.jsonl`, but active runtime evidence in `.codex/state/events.jsonl` was stale from 2026-06-06 and no refreshed-session `SessionStart` evidence exists yet for the current Codex App host.
- Existing hooks did not create a structured investigator handoff. That gap is now covered by `.codex/state/investigation-queue.jsonl`.

Files changed:

- `.codex/hooks/autopilot-hook.mjs`
- `tests/codex-hooks.test.ts`
- `docs/autopilot/codex-hooks-operating-model.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact:

- Failed `PostToolUse` results now write a redacted investigator handoff record with hashed input and response fingerprints, failure class, scope, target agent, required checks, forbidden actions, and expected output.
- Hooks still do not spawn agents, call cloud models, retry tools, approve delivery, mutate remotes, or copy raw logs. The handoff ledger is evidence for Protective Supervision only.
- Runtime activation remains separate from file verification: a refreshed trusted Codex session must produce new hook lifecycle evidence before claiming hooks are active in the host.

Claude advisory highlights:

- Add ownership or authorization verification for customer-submitted URLs before scanner work.
- Treat SSRF protection as DNS rebinding and redirect-chain validation, not just private-IP blocking.
- Define failure taxonomy and structured failure schema before scanner implementation.
- Keep investigator agents advisory and `INSPECT_ONLY`; remediation remains owner/supervisor controlled.
- Add false-negative disclaimers and exact mini-audit scope before selling scanner-backed outputs.

Verification:

- `claude --version` resolves in the current PowerShell process after PATH update: `2.1.172 (Claude Code)`.
- `claude mcp list` reports `github ... --read-only - Connected`.
- `npm.cmd test -- codex-hooks` passed: `1` file, `7` tests.
- Synthetic hook smoke test wrote both redacted `events.jsonl` and `investigation-queue.jsonl`; the queue contained `target_agent: investigator` and did not contain the raw command or raw response text.

Remaining follow-up:

- Restart or refresh Codex desktop/thread, review/trust the exact hook definitions, and confirm a fresh `SessionStart` row in `.codex/state/events.jsonl`.
- Use `investigation-queue.jsonl` as a supervisor cue to spawn or assign an `INSPECT_ONLY` investigator; do not make hooks spawn agents automatically.

## 2026-06-11 Failed-Process Repair Protocol And Advisory Hierarchy

Date: 2026-06-11
Request or trigger: owner clarified that investigations of non-working processes must stop/drain the affected process before applying a fix, restart or refresh the session after the fix, update continuity, and continue from the last state; owner also clarified Claude Code should have higher advisory trust and broader read scope than Gemini, with Gemini weighted above Qwen or DeepSeek.
Mode: WRITE_ALLOWED for local governance contracts, Decision Mesh nodes, deterministic hook/test updates, architecture documentation, and work-log evidence. No remote mutation, runtime process kill/restart, connector mutation, deployment, or model API path was added.
Scope:

- Add process-repair sequencing to failed-tool investigator handoffs.
- Add a Protective Supervision `failure_repair_supervision` lane for failed process/session repair.
- Encode advisory model hierarchy in TypeScript policy, model spend policy, root mesh, and Autopilot project mesh.
- Preserve report-first boundaries: hooks and supervision record requirements but do not automatically mutate runtimes.

Files changed:

- `.codex/hooks/autopilot-hook.mjs`
- `tests/codex-hooks.test.ts`
- `src/data/delivery-system/protectiveSupervision.ts`
- `tests/delivery-system/protective-supervision-policy.test.ts`
- `src/data/delivery-system/modelPolicy.ts`
- `src/data/delivery-system/modelSpend.ts`
- `tests/delivery-system/model-policy.test.ts`
- `tests/delivery-system/context-economy-policy.test.ts`
- `mesh/nodes/reasoning_strategy.yaml`
- `mesh/nodes/model_spend_policy.yaml`
- `mesh/nodes/protective_supervision_policy.yaml`
- `mesh/nodes/codex_hooks_guardrail.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/nodes/model_reasoning_boundary.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/nodes/protective_supervision_boundary.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/nodes/codex_hooks_boundary.yaml`
- `docs/autopilot/protective-supervision-operating-model.md`
- `docs/autopilot/codex-hooks-operating-model.md`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact:

- Failed-process remediation now has an explicit governance sequence: reproduce or source-pointer the failure, identify the affected process/session, checkpoint progress, stop or drain before fix, apply the scoped fix, restart or refresh, update continuity/progress, and resume from the last verified state.
- Hook-generated investigator handoffs now include the stop/drain, restart, continuity, and resume checks plus forbidden actions for live-process fixing without stop/drain.
- Claude Code subscription is now the higher-trust broad-read advisory reviewer after owner scope, while Gemini is standard advisory below Claude and above Qwen or DeepSeek draft/comparison lanes.
- Local files, tests, architecture records, work logs, owner decisions, Context7, and official docs remain the source-of-truth layers; model output cannot approve delivery or override verified local evidence.

Verification:

- `npm.cmd test -- codex-hooks` passed: `1` file, `7` tests.
- `npm.cmd test -- delivery-system/model-policy delivery-system/context-economy-policy delivery-system/protective-supervision-policy` passed: `3` files, `18` tests.
- `npm.cmd run mesh:generate` regenerated `mesh/generated/decision-mesh.json` after YAML source updates.
- `npm.cmd run mesh:check` passed.
- `npm.cmd run typecheck` passed.
- `git diff --check` passed.
- `npm.cmd test` passed: `30` files, `157` tests.

## 2026-06-11 Model Output Evaluation And Prompt Tuning Loop

Date: 2026-06-11
Request or trigger: owner asked to introduce model-output scoring, immediate learning-phase prompt/input tuning for poor outputs, weekly tuning once enough eval data exists, Caveman/Context7/provider-best-practice routing for all models, and repeated-failure model/reasoning review governed by mesh.
Mode: WRITE_ALLOWED for local governance contracts, Decision Mesh nodes/rules, read-only MCP route, docs, source catalog, and deterministic tests. No remote mutation, connector mutation, prompt-management SaaS, background runtime queue, model gateway, or automatic cloud/API worker was added.
Scope:

- Add typed model-output evaluation route and policy.
- Expose a read-only MCP tool for model-output evaluation routing.
- Add root and project mesh boundaries for output scoring, prompt/input deltas, reruns, repeated-failure route review, and weekly eval-based tuning.
- Extend prompt-library and model-spend policies so prompt/model changes require scored output evidence.
- Add provider-best-practice source IDs for OpenAI evals/model optimization, Anthropic evals, Gemini API prompting, DeepSeek thinking mode, and existing Qwen/DeepSeek structured-output sources.

Source checks:

- Context7 resolved OpenAI API docs and returned OpenAI eval/model-optimization guidance for using evals to iterate prompts.
- Anthropic official docs on 2026-06-11 state that LLM application success starts by defining success criteria and building evaluations, and recommend task-specific evals and clear rubrics.
- Google Gemini API prompt strategy docs on 2026-06-11 state prompt engineering is iterative and should be refined from observed model responses, with clear/specific instructions.
- Qwen official docs on 2026-06-11 identify prompt engineering/templates as key for function/tool use and recommend Hermes-style tool use for Qwen3.
- DeepSeek official docs on 2026-06-11 describe JSON mode requirements and thinking-mode controls; those are provider-specific source checks, not adoption approvals.

Files changed:

- `src/data/delivery-system/modelOutputEvaluation.ts`
- `tests/delivery-system/model-output-evaluation-policy.test.ts`
- `mcp/server.ts`
- `tests/delivery-system/product-design-os-mcp.test.ts`
- `src/data/delivery-system/promptLibrary.ts`
- `tests/delivery-system/prompt-library-policy.test.ts`
- `src/data/delivery-system/modelSpend.ts`
- `tests/delivery-system/context-economy-policy.test.ts`
- `mesh/nodes/model_output_evaluation_policy.yaml`
- `mesh/nodes/model_spend_policy.yaml`
- `mesh/nodes/reasoning_strategy.yaml`
- `mesh/nodes/prompt_library_policy.yaml`
- `mesh/edges.yaml`
- `mesh/rules.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/nodes/model_output_evaluation_boundary.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/nodes/model_reasoning_boundary.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/nodes/prompt_library_boundary.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/edges.yaml`
- `docs/projects/autopilot-control-plane/decision-mesh/rules.yaml`
- `docs/autopilot/model-output-evaluation-operating-model.md`
- `docs/autopilot/delivery-system-model-policy.md`
- `docs/autopilot/prompt-library-operating-model.md`
- `docs/autopilot/protective-supervision-operating-model.md`
- `docs/projects/autopilot-control-plane/architecture.md`
- `prompt-library/source-catalog.md`
- `prompt-library/source-catalog.json`
- `tests/decision-mesh/query.test.ts`
- `docs/projects/autopilot-control-plane/work-log.md`

Architecture impact:

- Model outputs that affect prompts, handoffs, routing, governance, architecture, security, or delivery decisions now require dimension scoring before acceptance.
- During learning, poor outputs route to prompt/input delta plus rerun until acceptable or blocked.
- Repeated similar failures route through token-efficiency and reasoning-model review before changing reasoning effort, model, or provider.
- Weekly prompt/input tuning requires collected eval records and repeated failure patterns.
- The MCP exposure is read-only and returns structured route guidance only; it does not store eval records, spawn workers, or mutate prompts.

Verification:

- `npm.cmd test -- delivery-system/model-output-evaluation-policy delivery-system/prompt-library-policy delivery-system/context-economy-policy delivery-system/product-design-os-mcp decision-mesh/query` passed: `5` files, `42` tests.
- `npm.cmd run mesh:generate` regenerated `mesh/generated/decision-mesh.json` after adding the model-output evaluation node and edges.
- `npm.cmd run mesh:check` passed.
- `npm.cmd run prompt:validate` passed: `34` files, `0` errors.
- `npm.cmd run typecheck` passed.
- `git diff --check` passed.
- `npm.cmd test` passed: `31` files, `164` tests.
- `npm.cmd run audit:deps` passed: `0` vulnerabilities.
- `npm.cmd run test:e2e` passed: `4` Chromium tests.
- `npm.cmd run verify` passed:
  - `mesh:check`
  - `prompt:validate`
  - `pdos:validate`
  - `contracts:validate`
  - `diff:check`
  - `typecheck`
  - `vitest run`
  - `astro build`
  - `playwright test`
