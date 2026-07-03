# Whole-system audit — autopilot-beta — 2026-07-03

**Target:** the real working folder `C:/Programování/autopilot-beta` at branch `main` (`f91043f`), read-only.
**Method:** multi-agent. One **codex GPT-5.5 (xhigh, read-only)** pass audited the vendor spawn-lane / injection /
hooks / secrets surface (the safeguard-sensitive slice, routed off Fable on purpose). Six **Fable 5** subagents
audited the non-sensitive dimensions: governance, links, mesh, routing/fallbacks, prompt library, tests/gates.
Findings below were spot-verified against source before recording. Severities are the reviewer's, calibrated for
a governance **control plane** (not a runtime): blocker = a gate is broken/bypassable now; high = broken contract
that bites on next use; medium = misleading drift; low = hygiene.

> Provenance note: this report was reconstructed from the audit session transcript after the prior
> working-session's uncommitted output was lost at a connection/session boundary. It supersedes nothing; it is a
> findings record. The vendor spawn-lane security findings (S1–S4) are the codex pass's; all others are Fable's.

## Severity roll-up

| Dim | High | Medium | Low |
|---|---|---|---|
| Security (spawn lane) | S1 | S2, S3 | S4 |
| Governance | GOV-01 | GOV-02, GOV-03 | GOV-04 |
| Links | L1, L2, L3 | L4, L5, L6 | L7 |
| Mesh | MESH-1 | MESH-2 | MESH-3 |
| Routing | R1, R2, R3 | R4, R5, R6 | R7 |
| Prompts | P1 | P2, P3, P4 | P5, P6 |
| Tests/gates | F1, F2 | F3, F4 | F5, F6 |

Known overlaps: **F3 = L3** (unwired model-output validator), **F4 ≈ S4** (codex retry), **F5 = L4** (dead pointers).

---

## Security — vendor spawn lane (codex GPT-5.5 xhigh, read-only)

- **S1 — agy lane does not force a safe mode** *(high on main)*. `cliWorkerCapture.ts:205` `buildAgyArgs` else-branch is
  `[]`: without the `dangerouslySkipPermissions` opt-in the argv carries neither `--sandbox` nor the bypass, so agy's
  own default applies (not read-only by construction). Also the untrusted prompt precedes later flags with no `--`
  end-of-options terminator (a prompt starting `--…` is parser-dependent). **Core already fixed on the unmerged branch
  `wonderful-cohen` (2b81bef → else-branch `["--sandbox"]`); the `--` terminator is still missing even there.**
- **S2 — `--add-dir` / image dirs forwarded without normalization or allowlist** *(codex high / calibrated medium)*.
  `cliWorkerCapture.ts:207`. A caller passing `addDirs`/image paths under a sensitive root re-grants broad host FS
  access. Needs an in-process caller forwarding untrusted dirs (not externally reachable). **Open on main and branch.**
- **S3 — raw prompt/handoff persisted unredacted, before the lock** *(medium)*. `cliWorker.ts:333` `writePromptFile`
  runs before `acquireWorkerLock` (`:348`); temp files under `tmpdir()/autopilot-handoffs` + `/autopilot-codex-captures`
  with predictable timestamped names, no redaction/TTL. **Open on main and branch.**
- **S4 — uncapped `retries` in `captureCodexResponse`** *(codex medium / calibrated low)*. `cliWorkerCapture.ts:319`
  `maxAttempts = (retries ?? 1) + 1`, caller-supplied and unclamped → in-proc spawn exhaustion. Reachable only via
  direct helper use (`runCliWorker` does not forward `retries`). **Open on main and branch.** (See F4.)

**Codex caveats:** Decision-Mesh MCP tools not visible to codex (expected); `vendor-chokepoint-adr.md` correctly
absent on main; secret grep was scoped to the closed file-list (not a full-repo sweep) — it confirmed
`.claude/settings.local.json` and the stray `settings,local.json.txt` are untracked/gitignored and hold only
`Bash(agy:*)`, no leak.

## Governance

- **GOV-01 — architecture record prescribes 5 nonexistent npm scripts + a fake `verify` gate** *(high)*.
  `docs/projects/autopilot-control-plane/architecture.md:210,367-375` names `mesh:check`, `prompt:validate`,
  `model-output:validate`, `contracts:validate`, `audit:deps` (none in package.json) and claims `model-output:validate`
  is in `verify` (it is not). Agents trusting this doc run failing commands and a nonexistent gate.
- **GOV-02 — v0.2 three-plane ADR's load-bearing "verified fact" is false** *(medium)*.
  `docs/decisions/autopilot-v0.2-three-plane-adr.md:55-57` says beta has no `mesh/`/`mcp/`/`src/lib/decision-mesh` —
  all three exist and are tracked on main; the "Y wins" rationale rests on the stale fact.
- **GOV-03 — control-plane root disagrees across three sources** *(medium)*.
  `repository-separation-policy.md:23,118` says `C:\Programování\Codex`; `project-architecture-registry.md:9,11` says
  `C:\Programování\autopilot`; the actual SoT is `autopilot-beta`.
- **GOV-04 — documented bind-point ② command is fail-open** *(low)*. `CLAUDE.md:31` uses only `--fail-on-blocker`;
  the AF3 ungoverned-sensitive deny needs the separate `--fail-on-ungoverned` (which the pre-commit hook does use).

## Links & references

- **L1 — project-mesh dead pointer, and project meshes are never gated** *(high)*.
  `docs/projects/autopilot-control-plane/decision-mesh/nodes/design_intelligence_boundary.yaml:25` →
  `src/data/delivery-system/roles.ts` (missing). `mesh:gate:ci` runs `--nodes-subdir mesh/nodes` only, so every
  `docs/projects/*/decision-mesh/` pointer is ungated.
- **L2 — `mesh:check` + `scripts/generate-decision-mesh.ts` don't exist** *(high)*.
  `docs/autopilot/decision-mesh-mcp-decision.md:103,25` and `architecture.md:187` claim the derived
  `mesh/generated/decision-mesh.json` "must pass npm run mesh:check". Real guard is
  `tests/decision-mesh/generated.test.ts` (deep-equal); nothing regenerates the artifact.
- **L3 — `model-output:validate` script missing, falsely claimed in `verify`** *(high)*.
  `delivery-system-model-policy.md:289`, `model-output-evaluation-operating-model.md:195`. The real validator
  `scripts/validate-model-output-evals.ts` is wired to nothing. (See F3.)
- **L4 — 22 grandfathered dead `related_files` pointers** *(medium)*. `mesh/related-files-baseline.json`; ratchet
  fails only on NEW dead pointers, so ~20% of node→file hints are hollow forever. (See F5.)
- **L5 — autopilot-console cross-repo contract dead on main** *(medium)*.
  `Projects/autopilot-console/src/ipc-client.mjs:33` + README target `governed-core:ipc` and
  `src/governed-core/ipc-server.ts`, neither present on main (governed-core is unmerged).
- **L6 — architecture.md present-tense nonexistent paths** *(medium)*. `architecture.md:161,165` describe
  `scripts/validate-contracts.ts` and `src/pages/` as current; both absent (nearby planned paths ARE disclaimed).
- **L7 — stray `.claude/settings,local.json.txt`** *(low)*. Byte-identical junk duplicate of `settings.local.json`.

## Decision Mesh

- **MESH-1 — sibling-repo binding for `build_project_mesh_packet` absent from main** *(high)*. `mcp/server.ts:627`
  resolves only in-repo `docs/projects/<slug>/decision-mesh` mirrors; the 585726c `resolveProjectMeshRoot` /
  `AUTOPILOT_PROJECTS_DIR` work (and `tests/decision-mesh/project-root.test.ts`) is not an ancestor of main. Real
  sibling project repos are unreachable; the auto-memory "binding LANDED in beta" is false for main.
- **MESH-2 — `capabilityMirror` validates only node fields, not the routing rules** *(medium)*.
  `src/lib/decision-mesh/capabilityMirror.ts:5` never checks `capabilityRoutingRules` (activate/optional/avoid) that
  `selectCapabilityModules` actually consumes; a hand-copied rule signal set can silently diverge.
- **MESH-3 — `three_d_experience_addon` dead related_file** *(low)*. `mesh/nodes/three_d_experience_addon.yaml:23` →
  `docs/superpowers/specs/2026-05-09-radeq-style-matrix-design.md` (whole tree absent), grandfathered by baseline.

## Routing & fallbacks

- **R1 — the fallback/circuit-breaker brain has no production consumer** *(high)*. `modelPolicy.ts:795`
  `buildSupervisorRoutingDecision` + `resolveFallback` are called only by tests; the real spawn path bypasses them, so
  every fallback/circuit path is advisory-only. (Repo's own 2026-06-29 audit already records this.)
- **R2 — 3 of 5 `FallbackTrigger`s never produced** *(high)*. `fallbackChains.ts:19`. Only `rate_limited` /
  `provider_unavailable` are emitted (`modelPolicy.ts:823`); `output_quality_below_threshold` is fully dead;
  `repeated_failure` / `all_tiers_exhausted` fire only via direct test calls.
- **R3 — `openai_gpt` self-fallback dead-end when state is `unknown`** *(high, tsx-reproduced)*. `modelPolicy.ts:983`
  the blocked branch only triggers for `rate_limited`/`exhausted`, so a genuinely-down provider reported `unknown`
  returns `assignedProvider` (itself) as its fallback, evading the pause-only guard.
- **R4 — the only non-terminal Gemini step is structurally unreachable** *(medium)*. `fallbackChains.ts:44`
  `gemini_auto→gemini_flash`; `gemini_flash.verifiedLocally` is never set true, so `isFallbackTierLocallyConfirmed`
  always rejects the step. Gemini can only fall back to `blocked`.
- **R5 — `SubscriptionSessionBudget` is telemetry, never enforced** *(medium)*. `subscriptionBudget.ts:40`
  accumulates token/task spend but no code blocks a route on it; the aggregator has no production caller.
- **R6 — doc↔code tier-id drift** *(medium)*. `vendor-routing-policy-beta.md:23` names `gemini-3.1-pro-high` /
  `gemini-3.5-flash-high`; code uses `gemini_auto` / `gemini_flash` / `gemini_pro`.
- **R7 — `selectModelForLayer` dead self-return branches** *(low)*. `modelPolicy.ts:882` rate_limited branches return
  the same provider the fallthrough already returns.

> Note: the brief's "dual 5h/weekly window / floors / spill" mechanics describe the (uncommitted) v2 draft, not v1 on
> main; the v1 doc is a qualitative directive and the code implements a single 10-min/15-min breaker, verified correct
> (no off-by-one). The one v1 substitution-ban ("all Gemini exhausted → pause only") IS correctly enforced.

## Prompt library & agent contracts

- **P1 — RadeQ source-catalog self-contradiction + missing target** *(high)*. `source-catalog.json:324-340` (external
  project-source) vs `source-catalog.md:186-188` (local paths) disagree on location AND authority kind;
  `docs/projects/radeq/work-log.md` (promised by the MD) does not exist.
- **P2 — top-two rules are un-citeable dead law** *(medium)*. `anti-hallucination` and `autopilot-global-routing` are
  absent from `source-catalog.json`, so the schema's sources allow-list makes them structurally un-citeable; zero lane
  prompts cite them.
- **P3 — 5 PDOS agents carry no frontmatter contract** *(medium)*. `product-design-os/agents/*.md` are agent/worker
  prompts but declare no id/model/role/allowed-surfaces/verification, so a validator silently skips them.
- **P4 — supervisor prompt cites a nonexistent function** *(medium)*. `prompt-library/06-supervisor/claude-opus-supervisor.md:78`
  calls `validateHandoffPacket()`; no such export exists in `src/`.
- **P5 — catalog schema cannot hold license/eval/date evidence** *(low)*. `source-catalog.schema.json:22-58`
  (`additionalProperties:false`) forbids the license/currentness fields the rules require for model-asset sources.
- **P6 — qwen-function-calling URL drift** *(low)*. `source-catalog.json:308` (`latest`) vs `source-catalog.md:109` (`stable`).

## Tests & gates

- **F1 — no CI exists; every gate is local/bypassable; `mesh:gate:ci` is a misnomer** *(high)*. No `.github`; gates run
  only in manual `verify` or `--no-verify`-bypassable git hooks. `package.json:34`.
- **F2 — bind-point ② (`mesh:changed`) is not in `verify`** *(high)*. `package.json:28`; the blocker + AF3 ungoverned
  denies live only in the bypassable hooks.
- **F3 — `scripts/validate-model-output-evals.ts` wired to nothing** *(medium)*. Full validator + schema + fixtures
  exist; no npm script / hook runs it. (= L3.)
- **F4 — codex empty-output retry untested** *(medium)*. `cliWorkerCapture.ts:316` retry predicate has zero coverage.
  (≈ S4.)
- **F5 — 22 tolerated dead `related_files`** *(low)*. (= L4.)
- **F6 — `vendor-check` scope is only `product-design-os` + `src`** *(low)*. `scripts/vendor-check.mjs:33`; `mesh/`,
  `prompt-library/`, `.codex/hooks` are not provenance-pinned.

**Verified positives:** full `npm run verify` passes all 8 stages (305 tests, PDOS 6/6, mesh ratchet clean); no
`.skip`/`.only`/`.todo`; no zero-`expect` test; the per-blocker ACK mechanism is fully removed on main (no self-ACK
risk); no env-var escape hatch disables a blocking gate; STALE detection is genuinely wired (`--prior`).

---

## Suggested remediation order

1. **Benign, non-code (safe now):** GOV-01/02/03/04 doc truth; L1/L2/L3/L6 doc+pointer fixes; L7 delete stray file;
   MESH-3 + L1 dead-pointer removal; P1/P2/P3/P4/P5/P6 prompt-library; F3/L3 wire `model-output:validate` into `verify`;
   F6 document vendor-check scope.
2. **Code behavior (needs tests + owner gate):** R1/R2/R3 routing brain wiring + trigger producers + self-fallback fix;
   R4/R5/R7 dead-path cleanup; MESH-1 merge/clarify the sibling-repo resolver; MESH-2 extend the mirror; F1/F2 add real
   CI + wire `mesh:changed`; F4 unit-test the retry predicate.
3. **Spawn-lane security (route via codex; safeguard-sensitive):** S1 (merge the `--sandbox` fix + add `--`),
   S2 add-dir allowlist, S3 redact + lock-before-write, S4 clamp `retries`.
