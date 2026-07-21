# Dev/Prod Cockpit Environments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Runtime disclosure (recorded at plan authoring)

- **Requested runtime:** `claude-opus-4-8`, CLI reasoning effort `high`.
- **Observed runtime model identifier:** `claude-opus-4-8` (Claude Opus 4.8), as reported by the execution environment. The requested model was available; **no silent model fallback occurred.**
- **Observed CLI effort:** The environment exposes **no machine-readable reasoning-effort value** to read back from inside the session. Effort `high` was *requested*; it cannot be independently verified from within the session, so it is disclosed as **requested-not-verified** rather than asserted. This matches the precedent in `/home/radek/audits/autopilot-token-complexity-2026-07-21/reports/claude-opus-4.8-ultracode.md` (which recorded the same "no metered effort exposed" limitation). No effort value is invented.
- **Independent grouping pass:** A second, separate `claude-opus-4-8` session reviewed the plan and produced the execution packets/DAG. It also received requested effort `high`; the model identifier was observed, while effort remains requested-not-verified for the same CLI limitation. The primary reviewer then checked the proposed grouping against actual file ownership and corrected the telemetry→handoff dependency before accepting it.
- **Method:** Direct read of `package.json`, `AGENTS.md`, `src/data/delivery-system/*`, `src/governed-core/dispatch.ts`, `cockpit/src/**`, `ops/cockpit-proxy/*`, `mesh/nodes/*`, `docs/status/current-status.md`, and the four audit reports under `/home/radek/audits/autopilot-token-complexity-2026-07-21/reports/`. Cited paths were opened before being cited.

**Goal:** Add genuinely separate DEV (Draft/Preview, cheap iteration) and PROD (owner-approved showcase publishing) execution profiles and clearly separated Cockpit interfaces on the **one existing** Autopilot control-plane core, with explicit non-automatic promotion, shadow-only provider/model/reasoning recommendations, and profile-scoped verification.

**Architecture:** Introduce one `RunProfile = "dev" | "prod"` axis threaded through the existing run store, run orchestrator, governed dispatch, telemetry, control-plane API, and the existing React Cockpit — **no second control plane, no duplicate source of truth.** DEV runs default to free/cheap lanes and diff-scoped verification; PROD runs exist only via an explicit, bounded **promotion packet** (intent, immutable artifact hash, diff, tests, risks, approvals) and full fail-closed verification with independent review, immutable evidence, and rollback. Provider/model/reasoning recommendations reuse the existing `shadow_only` telemetry contract and stay `null` until the existing `compareEfficiencyWindows` gate (≥20 ordinary + ≥5 high-risk samples) accepts them.

**Tech Stack:** TypeScript, Node.js `>=24 <25` HTTP control plane, React 18 Cockpit (Vite/Vitest/Testing Library), Playwright browser QA, JSON/JSONL managed state files, existing `src/governed-core/dispatch.ts` chokepoint, existing `ops/cockpit-proxy` systemd/Caddy release + `live-cutover.sh`/`autopilot-cockpit-recovery-verify.sh` rollback, existing Decision Mesh gate (`mesh:changed`, `mesh:gate:ci`).

---

## Global Constraints

- **One core, two profiles.** Do not fork the control plane, run store, dispatcher, or Cockpit app. `RunProfile` is a field, not a parallel runtime. No new mutating connector, deployment surface, background queue, or provider gateway (per `AGENTS.md` high-risk boundaries and CLAUDE.md hard boundaries).
- **Promotion is explicit and never automatic.** No PROD run exists without an owner-approved `PromotionPacket` referencing an immutable DEV artifact hash. DEV completion never auto-creates or auto-approves a PROD run.
- **PROD carries a compact packet, not Dev history.** The packet holds intent, immutable artifact hash/ref, bounded redacted diff, test command list, bounded risks, and approvals — never the full DEV revision history or raw prompts.
- **Shadow-only routing.** `recommended_model` and `recommended_reasoning_effort` remain `null`; `routing_mode` stays `"shadow_only"`. Provider/model/reasoning are never silently changed (per `AGENTS.md` "Do not switch provider, model, reasoning effort... silently"). The owner-selected `requested_reasoning_effort` is immutable with the approved revision and must be enforced by the selected adapter's argv/request body; unsupported values fail before spawn. `actual_model`/`actual_reasoning_effort` record only that validated, adapter-applied configuration, never an inferred recommendation.
- **No silent fallback.** Route unavailability surfaces a refusal (`run_route_unavailable`) via existing `isRunRouteEligible`; retries stay on the approved route. Provider substitution requires explicit owner action.
- **Verification by profile + risk.** DEV ordinary work uses diff-scoped verification; PROD and every high-risk boundary (auth, secrets, privacy, persistence, release, cutover, rollback, remote mutation, destructive) use full fail-closed verification + independent review + immutable evidence + rollback + acceptance. High risk fails closed in every profile.
- **Efficiency stays `insufficient_evidence`.** Reuse the existing `compareEfficiencyWindows` gate. Do **not** claim 30% savings or any savings until it returns `accepted`. Until ≥20 ordinary and ≥5 high-risk comparable work units exist, the result is `insufficient_evidence`.
- **Privacy-safe.** No raw prompts, secrets, tokens, cookies, or provider logs are persisted or summarized. Reuse `redactTelemetryText` (`src/data/delivery-system/telemetryRedaction.ts`) and the aggregate-only guard `assertAggregateOnly` (`src/data/delivery-system/efficiencyReport.ts`). Token figures are coarse **estimates**, never measurements, until provider-authoritative telemetry exists.
- **Node runtime.** Keep `engines.node` `>=24 <25`. Run `npm run runtime:check` before repository JavaScript.
- **Governance overhead minimized.** Exactly **one** new mesh node and **one** canonical doc for this feature. No plan/spec/report triplication: implementation updates canonical docs in place; no per-task narrative report files are created.
- **Backward compatibility.** Existing `runs.json` records (no `profile` field) and the currently deployed production Cockpit continue to work unchanged; missing `profile` resolves to `"legacy"` (read-only, never auto-promoted, never mutated).

---

## Audit reconciliation (why this design)

The four reports (`/home/radek/audits/autopilot-token-complexity-2026-07-21/reports/*`) agree that raw repo size **fell** (845 files / 10.4 MB vs 1,348 / 13.5 MB) and the mesh/docs surface **mostly pre-existed** (34 mesh nodes unchanged; 13 operating models flat). The **key disagreement** — whether governance density or the new control-plane engine drives token cost — is reconciled per instruction toward **runtime read/route frequency, not raw file count**: Codex and Sonnet both conclude the regression is applying full governance/verify **too often**, not mesh growth. This plan therefore does **not** add governance mass; it makes the *frequency* of full verification conditional on `profile`+`risk` (DEV → diff-scoped, reusing `mesh:changed`; PROD/high-risk → full `verify`). It reuses the already-present shadow-only telemetry (`efficiencyTelemetry.ts`), work-unit classes (`efficiencyPolicy.ts`), and the 20/5 acceptance gate (`efficiencyReport.ts::compareEfficiencyWindows`) rather than creating parallel machinery. It reconciles the README↔status contradiction (README: "not been cut over"; `docs/status/current-status.md`: cutover completed 2026-07-14) in Task 10 by making `docs/status/current-status.md` authoritative and correcting the stale README line.

---

## Phase / state model and promotion invariants

**Run profile axis:** every run carries `profile ∈ {dev, prod}`; stored records lacking the field resolve to `legacy`.

**DEV lifecycle (existing `RunStatus`, profile=`dev`):**
`draft` → `approved` → `queued` → `running` → `completed | failed | cancelled`.
- **Draft** = editable revision (existing `draft`). Cheap/free lanes default; selectable providers/models/reasoning.
- **Preview** = a `completed` DEV run at an immutable revision, presented for owner inspection and iteration. "Preview" is the DEV presentation of `status:"completed"`, not a new store state — no state-machine fork.

**Promotion (new `PromotionPacket`, separate store):**
`promotion_pending` → `approved` → `published`, or `→ rejected`, or `published → rolled_back`.

**PROD lifecycle (existing `RunStatus`, profile=`prod`):** identical status enum, but a PROD run may only be created from an `approved` promotion packet and is gated by full fail-closed verification.

**Promotion invariants (enforced in Task 3 and Task 7):**
1. A packet may be built **only** from a `completed` DEV run at a specific immutable revision.
2. `artifact_hash` = SHA-256 over the source run's completed artifact previews + approved revision identity; any DEV edit produces a new revision and thus a new hash → the old packet is invalid for the new content.
3. Building a packet has **no side effects** on routing/dispatch and never enqueues work.
4. `approved` requires ≥1 recorded owner approval. `published` additionally requires non-empty full-verification, production-release acceptance, rollback, and linked PROD-run refs; approval alone can never publish.
5. Promotion is never triggered by DEV completion. The explicit sequence is `POST /runs/:id/promote` → owner `approve` → `POST /runs` with `profile:"prod"` plus that approved packet → explicit existing run approval/dispatch → existing release acceptance → `mark-published` with immutable evidence refs.
6. The packet is bounded (intent ≤ 2,000 chars, diff ≤ 32,000 chars redacted, ≤ 20 risks, ≤ 32 test commands) and carries **no** `revisions` array and **no** raw prompt.

---

## Change classification and Dev-vs-Prod verification matrix

Work-unit classes reuse `src/data/delivery-system/efficiencyPolicy.ts` (`WorkUnitClass`, `WorkUnitRisk`).

| Work unit / boundary | Risk | DEV verification | PROD verification |
|---|---|---|---|
| `deterministic_check`, `mechanical_change`, `bounded_implementation`, `research_or_design` | ordinary | **diff-scoped** (`mesh:changed --since` + narrow vitest for changed files) | full fail-closed |
| `review` | ordinary | diff-scoped + one independent review | full fail-closed + independent review |
| `high_risk` OR any high-risk boundary (auth, secrets, privacy, persistence, release, cutover, rollback, remote mutation, destructive) | high | **full fail-closed** (even in DEV) + independent review + immutable evidence | full fail-closed + independent review + immutable evidence + rollback + acceptance |
| Promotion into PROD (`promote`, `publish`, `rollback`) | high | n/a | full `verify` + `cockpit:test` + `browser:qa` + `ops:cockpit-proxy` acceptance + rollback path proven |

`resolveVerificationMode(profile, risk)` (Task 1): returns `"full_fail_closed"` iff `profile === "prod" || risk === "high"`, else `"diff_scoped"`.

---

## Failure and recovery behavior

- **DEV failure:** cheap; retry stays on the same route (no silent switch); diff-scoped re-verify. Route unavailable → `run_route_unavailable` refusal surfaced to the owner.
- **PROD verification/review failure:** fail-closed. Promotion stays `promotion_pending`/`rejected`; nothing publishes. No partial publish.
- **PROD published-run failure:** roll back using the existing `ops/cockpit-proxy/live-cutover.sh` cutover + `ops/cockpit-proxy/autopilot-cockpit-recovery-verify.sh` / `autopilot-cockpit-cutover-recovery.{service,timer}`; mark packet `rolled_back`.
- **Token reservations:** every reservation reaches exactly one settle/release terminal event via the existing `TokenGateway` (`src/data/delivery-system/tokenGateway.ts`); unchanged by this plan.
- **Internal errors:** recorded through the existing `incidentStore.ts` with `redactTelemetryText`; repair packets remain read-only exports (no dispatch capability).

---

## Observability (measuring 20 ordinary + 5 high-risk work units)

Reuse `EfficiencyTelemetryEventV1` (`src/data/delivery-system/efficiencyTelemetry.ts`) and `WorkUnitRecord` (`src/data/delivery-system/efficiencyReport.ts`); add a `profile` field to both so samples accumulate per profile. Fields already present and preserved: `work_unit_class`, `risk`, `actual_model`, `actual_reasoning_effort`, `recommended_model: null`, `recommended_reasoning_effort: null`, `routing_mode: "shadow_only"`, `status`, `total_attempts`, `attempt_delta_recorded`. The existing `buildEfficiencyReport` counts `samples.ordinary` / `samples.high_risk`; `compareEfficiencyWindows` already requires both windows to have `ordinary >= 20 && high_risk >= 5` and otherwise returns `insufficient_evidence`. `legacy`-profile events are excluded from these counts. No raw content is persisted (`contains_raw_content: false`, `assertAggregateOnly`).

**Token-range estimates (privacy-safe, estimates only — never a savings claim):** DEV diff-scoped work units are expected to touch a smaller verification surface than full `verify`; any per-work-unit token figure remains a coarse estimate band and is reported as `insufficient_evidence` until provider-authoritative telemetry and the 20/5 sample floor exist. This plan records no numeric savings.

---

## Acceptance criteria (usable Cockpit interactions)

The DEV and PROD Cockpit interfaces are usable when an owner can, end to end:
1. **Projects:** list allowlisted projects (existing `/projects`) scoped to the active environment.
2. **Sessions:** view profile-scoped sessions (existing session registry) without cross-environment leakage.
3. **Providers/budgets:** view provider quotas/spend (existing `ProviderPane`) and see DEV defaulting to free/cheap lanes.
4. **Model/reasoning selection:** select provider/model/reasoning in DEV, with the recommendation explicitly shown as **"none (shadow-only)"** and never auto-applied.
5. **Run preparation:** prepare a DEV run (Draft) without any worker being invoked before approval.
6. **Draft/Preview:** approve and run a DEV draft, then inspect the completed run as a **Preview**.
7. **Promotion status and approvals:** from a Preview, build a promotion packet, see `promotion_pending`, approve it as owner, prepare a linked PROD draft without dispatch, explicitly approve/run it, and see `published` only after full verification, production acceptance, and rollback evidence are recorded.

---

## File structure (mapped before tasks)

**Create (source):**
- `src/data/delivery-system/executionProfile.ts` — `RunProfile`, `StoredRunProfile`, `RunReasoningEffort`, `VerificationMode`, profile-default lane cost tiers, provider adapter reasoning capabilities, `resolveVerificationMode`, `classifyWorkUnitForProfile`, `assertNoSilentRouteChange`. One responsibility: the profile axis and its invariants. Pure, no I/O.
- `src/data/delivery-system/promotionPacket.ts` — `PromotionPacket`, `PromotionStatus`, `PromotionApproval`, `PromotionPublishEvidence`, `buildPromotionPacket`, strict bounded `readPromotionStore`, `approvePromotion`, `rejectPromotion`, `recordPromotionVerification`, `markPromotionPublished`, `markPromotionRolledBack`, `promotionStorePath`. Persists `promotions.json` through the existing managed-state read/atomic-write primitives.
- `scripts/verify-scope.ts` — CLI + pure `resolveVerificationPlan` mapping `{profile, risk, changedFiles}` → `{mode, commands: {file,args}[]}`, reusing `mesh:changed` without shell command strings.

**Create (cockpit):**
- `cockpit/src/app/environment.ts` — `CockpitEnvironment = "dev" | "prod"`, context/provider, `useCockpitEnvironment`.
- `cockpit/src/features/promotion/PromotionPane.tsx` — promotion packet list, status, approvals, actions.

**Create (tests):** one test file per source/cockpit module below (exact paths in each task).

**Create (governance/docs — exactly one each):**
- `mesh/nodes/execution_profile_policy.yaml` — single governance node for the profile/promotion/verification contract.
- `docs/autopilot/dev-prod-environments.md` — single canonical environments doc.

**Modify:**
- `src/data/delivery-system/runStore.ts:15-30,63-84` — add `profile: RunProfile`, `requested_reasoning_effort`, and nullable `promotion_packet_id` to `RunDraft`; add `resolveRunProfile`; legacy records resolve to `profile:"legacy"`/`promotion_packet_id:null` without rewrite.
- `src/data/delivery-system/runOrchestrator.ts:71-108` — thread `profile` and the immutable owner-selected reasoning effort into `handoffFor`; keep shadow recommendation `null`.
- `src/data/delivery-system/cliWorker.ts`, `src/data/delivery-system/cliWorkerCapture.ts`, `src/governed-core/dispatch.ts` — validate and enforce model/reasoning at the adapter boundary, then forward the applied profile/reasoning into privacy-safe telemetry. Claude uses `--model/--effort`, Agy uses `--model/--effort`, Codex uses `--model` plus strict `model_reasoning_effort` config; unsupported provider/model/effort combinations refuse before spawn and never fall back.
- `src/data/delivery-system/efficiencyTelemetry.ts:11-56` — add `profile` to event + builder input.
- `src/data/delivery-system/efficiencyReport.ts:10-17,103-214` — add `profile` to `WorkUnitRecord`; count samples per profile.
- `scripts/codex-efficiency-report.ts:88-125` — parse explicit profiles and map missing legacy work-unit profiles to `"legacy"` without rewriting input.
- `scripts/control-plane-runs.ts:73,121-124,172` — add `profile` scoping to `/runs`; add promotion routes.
- `scripts/control-plane-server.ts` — delegate the new promotion routes.
- `cockpit/src/types/controlPlane.ts`, `cockpit/src/api/controlPlaneClient.ts` — typed profile + promotion methods.
- `cockpit/src/app/App.tsx`, `cockpit/src/app/AppShell.tsx`, `cockpit/src/app/routeState.ts`, `cockpit/src/app/useCockpitData.ts` — environment split (dev/prod views).
- `cockpit/src/features/runs/RunComposer.tsx` — surface shadow recommendation = none.
- `package.json` — add `verify:dev`, `verify:prod` scripts (no removal of existing `verify`).
- `docs/status/current-status.md`, `README.md` — reconcile the cutover contradiction (Task 10).

**Sequencing.** See **Execution groups and dependency DAG** below for the authoritative packet ordering, concurrency, checkpoints, and stop conditions. Per-task parallel markers restate the same edges at task granularity.

---

## Execution groups and dependency DAG

Packets bundle cohesive tasks assignable to one worker at one review gate. **Model-class / effort lines are shadow-only assignment suggestions — never auto-applied, never written to run telemetry** (the run-time recommender stays `null`, `routing_mode:"shadow_only"`). **Token ranges are planning estimates, not measured cost, and no savings figure is claimed** (efficiency stays `insufficient_evidence` until the 20 ordinary + 5 high-risk gate returns `accepted`).

**Total estimated implementation + review range:** approximately **175k–340k tokens** across all six packets. This is a planning band obtained by summing packet estimates, not provider-authoritative usage and not a budget guarantee. Record actual provider/model/reasoning and token usage per completed packet so later comparison can replace this estimate.

```
P1 ─┬─ P2 ─── P4 ─── P5 ─┐
    │                    ├─ P6
    └─ P3 ───────────────┘
```

`P2 ∥ P3` (disjoint files, both need only P1). `P4` needs P2 and may overlap a still-running P3. `P5` needs P4. `P6` needs P3+P4+P5. **Critical path to a usable DEV Cockpit is `P1→P2→P4→P5`; P3 rides alongside and is not on it.** Preview/promotion UI lands with P5; PROD acceptance only in P6.

**P1 — Profile core & store (T1→T2).** Prereq: none. Output: `executionProfile.ts` (`RunProfile`/`StoredRunProfile`/`RunReasoningEffort`/`VerificationMode`, adapter capability matrix, `resolveVerificationMode`, `classifyWorkUnitForProfile`, `assertNoSilentRouteChange`) + immutable `runStore.profile`/`requested_reasoning_effort`/`resolveRunProfile` (legacy read). Owns `executionProfile.ts`, `runStore.ts` (+tests); internally sequential. Nothing else may start (every packet consumes its types). Checkpoint: `npm test -- execution-profile run-store-profile run-store && npm run typecheck`; T2 changes persistence/migration semantics → **independent review** of the non-rewriting legacy read. *Shadow suggestion:* mid class, medium effort. *Estimate:* ~18–40k. Stop if: a legacy record is rewritten on read; `profile` is optional-on-create; reasoning can change after approval; RED doesn't fail first.

**P2 — Domain services and adapter enforcement (T3 + T4).** Prereq: P1. Output: `promotionPacket.ts` (bounded, strictly parsed, redacted, immutable hash, backup/recovery-covered, no `revisions`, no dispatch, evidence-gated publish) + profile-aware `handoffFor`/`handoffForRun` with `legacy→prod` classification and adapter-enforced owner model/reasoning selection. Owns `promotionPacket.ts`, `runOrchestrator.ts`, `cliWorker.ts`, `cliWorkerCapture.ts`, promotion/orchestrator/adapter tests, and the focused `state-maintenance.test.ts` addition. T3 and T4 may be internally split only while their file ownership remains disjoint. Runs **concurrently with P3**. Checkpoint: focused promotion, maintenance, orchestrator, and CLI-capture tests plus `npm run typecheck`; persistence, provider invocation, and promotion invariants = **high-risk → full fail-closed + independent review**. *Shadow suggestion:* high class, high effort (invariant-heavy). *Estimate:* ~45–80k. Stop if: a packet builds from a non-`completed`/non-`dev` run; managed state accepts a symlink/oversized/malformed document; backup/recovery drops or changes promotion state; promotion has any dispatch/enqueue side-effect; `published` lacks all required evidence refs; selected model/reasoning is omitted from the actual adapter call; an unsupported effort reaches spawn; a retry shows a silent route/model/reasoning change; the hash is not derived from immutable revision + artifacts.

**P3 — Verification harness (T6).** Prereq: P1 only. Output: structured-argv `resolveVerificationPlan` and executable `verify:dev`/`verify:prod`. Owns `scripts/verify-scope.ts`, `package.json` (+tests), so it is disjoint from P2. Runs concurrently with P2. Checkpoint: `npm test -- verify-scope && npm run typecheck`; ordinary → diff-scoped + one review. *Shadow suggestion:* mid class, medium effort. *Estimate:* ~12–25k. Stop if: `verify:dev` only prints rather than runs; changed-file input is ignored; shell command strings are executed; an unmapped or malformed path is accepted.

**P4 — Telemetry integration and Control-plane API (T5 + T7).** Prereq: P2 (not P3). T5 threads the applied profile/reasoning from `GovernedHandoff` through `src/governed-core/dispatch.ts` into `EfficiencyTelemetryEventV1`; T7 adds `GET /runs?profile`, DEV `POST /runs`, evidence-gated PROD `POST /runs`, promotion endpoints, reasoning-capability metadata, and 409 error mapping. Owns telemetry/report/parser/dispatch and control-plane files (+tests); T5 and T7 are file-disjoint and may run concurrently inside the packet after T4 establishes the handoff contract. P4 may overlap P3. Checkpoint: focused dispatch telemetry, efficiency report/parser, control-plane, and server tests plus `npm run typecheck`; remote mutation boundary → **high-risk → full + independent review**. *Shadow suggestion:* high class, high effort. *Estimate:* ~35–65k. Stop if: create without `profile` returns 201; a PROD run can be created without an approved verified packet; selected reasoning is not returned unchanged; `/promote` or PROD creation dispatches automatically; any `recommended_*` becomes non-null; `legacy` samples count toward acceptance; a publish path is reachable without all evidence.

**P5 — Cockpit environments & promotion UI (T8→T9).** Prereq: P4. Output: one app / two environments (`DEV`/`PROD` tabs, `EnvironmentProvider`), typed client promotion methods, capability-bounded owner model/reasoning selectors, `PromotionPane`, and the static shadow label "none (shadow-only)". **Delivers the usable DEV Cockpit + Preview→promote→approve UI.** Owns the `cockpit/src/**` files listed in T8/T9 (+tests); internally sequential; single app tree, no concurrency. Checkpoint: `npm --prefix cockpit test && npm --prefix cockpit run build`; ordinary UI → diff-scoped + one review (publish stays server-gated, no runtime high-risk boundary). *Shadow suggestion:* high class, medium effort (breadth). *Estimate:* ~35–70k. Stop if: a second app/store is forked; any button dispatches a run or auto-applies a recommendation; a selector exposes an unsupported effort; environments leak cross-profile data.

**P6 — Governance, docs, back-compat & VM acceptance (T10).** Prereq: P3 + P4 + P5. Output: one mesh node, one canonical doc, README/status reconciliation, browser QA for DEV→Preview→promote→approve→verified PROD draft→evidence-gated publish, generated mesh + drift snapshot refresh, and VM proof that `ops/cockpit-proxy` release/rollback is unchanged. Owns the mesh node, canonical doc, `README.md`, `docs/status/current-status.md`, `tests/browser/cockpit.spec.ts`, generated mesh and snapshot; integration, no concurrency. Checkpoint: full host suite + `mesh:gate:ci` + `browser:qa`, then VM isolated/host acceptance + proven rollback. Release/cutover/rollback = **high-risk → full fail-closed + independent review (a reviewer who is not the implementer) + immutable evidence + rollback + acceptance.** *Shadow suggestion:* high class, high effort; independent reviewer separate. *Estimate:* ~30–60k. Stop if: the live checkout or `~/.local/state/autopilot` is mutated during isolated acceptance; any live provider call lacks explicit owner cost approval; README/status stay contradictory; the mesh gate blocks; a savings figure is asserted.

**Global stop conditions (all packets):** an unclassified high-risk boundary surfaces; a required RED test passes before implementation; promotion auto-triggers from DEV completion; the 20 ordinary + 5 high-risk `insufficient_evidence` gate would be bypassed or a savings number claimed; Node runtime ≠ `>=24 <25`.

---

### Task 1: Execution profile core

**Files:**
- Create: `src/data/delivery-system/executionProfile.ts`
- Test: `tests/delivery-system/execution-profile.test.ts`

**Interfaces:**
- Produces: `RunProfile = "dev" | "prod"`, `StoredRunProfile = RunProfile | "legacy"`, `RunReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max"`, `VerificationMode = "diff_scoped" | "full_fail_closed"`, `DEV_DEFAULT_COST_TIERS`, `SUPPORTED_REASONING_EFFORTS`, `resolveVerificationMode(profile, risk)`, `classifyWorkUnitForProfile(profile, touchesHighRiskBoundary)`, `assertNoSilentRouteChange(before, after)`.
- Consumes: `WorkUnitClass`, `WorkUnitRisk` from `./efficiencyPolicy`; `LaneCostTier` from `./routingModes`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { classifyWorkUnitForProfile, resolveVerificationMode, assertNoSilentRouteChange, DEV_DEFAULT_COST_TIERS } from "../../src/data/delivery-system/executionProfile";

describe("executionProfile", () => {
  it("uses diff-scoped verification only for ordinary DEV work", () => {
    expect(resolveVerificationMode("dev", "ordinary")).toBe("diff_scoped");
    expect(resolveVerificationMode("dev", "high")).toBe("full_fail_closed");
    expect(resolveVerificationMode("prod", "ordinary")).toBe("full_fail_closed");
    expect(resolveVerificationMode("prod", "high")).toBe("full_fail_closed");
  });

  it("classifies PROD and high-risk boundaries as high risk", () => {
    expect(classifyWorkUnitForProfile("dev", false)).toEqual({ class: "bounded_implementation", risk: "ordinary" });
    expect(classifyWorkUnitForProfile("dev", true)).toEqual({ class: "high_risk", risk: "high" });
    expect(classifyWorkUnitForProfile("prod", false)).toEqual({ class: "high_risk", risk: "high" });
  });

  it("defaults DEV to free/cheap lanes and refuses a silent route change", () => {
    expect(DEV_DEFAULT_COST_TIERS).toContain("free");
    expect(() => assertNoSilentRouteChange({ provider: "codex_cli", model: "gpt-5", reasoning: "high" }, { provider: "codex_cli", model: "gpt-5", reasoning: "high" })).not.toThrow();
    expect(() => assertNoSilentRouteChange({ provider: "codex_cli", model: "gpt-5", reasoning: "high" }, { provider: "codex_cli", model: "gpt-5", reasoning: "xhigh" })).toThrow("silent_route_change_forbidden");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/delivery-system/execution-profile.test.ts`
Expected: FAIL — module `executionProfile.ts` does not exist.

- [ ] **Step 3: Implement the pure profile core**

```ts
import type { WorkUnitClass, WorkUnitRisk } from "./efficiencyPolicy";
import type { LaneCostTier } from "./routingModes";

export type RunProfile = "dev" | "prod";
export type StoredRunProfile = RunProfile | "legacy";
export type RunReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type VerificationMode = "diff_scoped" | "full_fail_closed";

export const DEV_DEFAULT_COST_TIERS: readonly LaneCostTier[] = ["free", "mid"];
export const SUPPORTED_REASONING_EFFORTS = {
  codex_cli: ["low", "medium", "high", "xhigh"],
  claude_cli: ["low", "medium", "high", "xhigh", "max"],
  agy_cli: ["low", "medium", "high"],
  openrouter_api: [],
} as const satisfies Readonly<Record<string, readonly RunReasoningEffort[]>>;

export function resolveVerificationMode(profile: RunProfile, risk: WorkUnitRisk): VerificationMode {
  return profile === "prod" || risk === "high" ? "full_fail_closed" : "diff_scoped";
}

export function classifyWorkUnitForProfile(
  profile: RunProfile,
  touchesHighRiskBoundary: boolean,
): { readonly class: WorkUnitClass; readonly risk: WorkUnitRisk } {
  if (profile === "prod" || touchesHighRiskBoundary) return { class: "high_risk", risk: "high" };
  return { class: "bounded_implementation", risk: "ordinary" };
}

export interface RouteSnapshot { readonly provider: string; readonly model: string | null; readonly reasoning: RunReasoningEffort | null; }

export function assertNoSilentRouteChange(before: RouteSnapshot, after: RouteSnapshot): void {
  if (before.provider !== after.provider || before.model !== after.model || before.reasoning !== after.reasoning) {
    throw new Error("silent_route_change_forbidden");
  }
}
```

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- tests/delivery-system/execution-profile.test.ts && npm run typecheck`
Expected: all execution-profile tests pass; TypeScript exits 0.

```bash
git add src/data/delivery-system/executionProfile.ts tests/delivery-system/execution-profile.test.ts
git commit -m "feat: add dev/prod execution profile core"
```

---

### Task 2: Run store profile field and legacy migration

**Files:**
- Modify: `src/data/delivery-system/runStore.ts:15-30,63-84`
- Test: `tests/delivery-system/run-store-profile.test.ts`

**Interfaces:**
- Consumes: `RunProfile`, `StoredRunProfile` from Task 1.
- Produces: `RunDraft.profile` / `RunRecord.current.profile`, `RunDraft.requested_reasoning_effort: RunReasoningEffort | null`, `RunDraft.promotion_packet_id: string | null`; `resolveRunProfile(record): StoredRunProfile`. `RunDraftInput` requires `profile`; reasoning and promotion association are immutable after approval, and the promotion reference is null for DEV and required for PROD.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunDraft, readRunStore, resolveRunProfile } from "../../src/data/delivery-system/runStore";

const baseInput = { project_id: "autopilot-beta", prompt: "Inspect status", provider: "codex_cli", model: null, estimated_tokens: 0, requested_artifacts: ["text"] } as const;

describe("runStore profile", () => {
  it("stamps the requested profile on new drafts", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "runstore-"));
    const draft = createRunDraft(stateDir, { ...baseInput, profile: "dev", requested_reasoning_effort: "medium" }, "2026-07-21T10:00:00.000Z", { projectRoot: process.cwd() });
    expect(draft.profile).toBe("dev");
    expect(draft.requested_reasoning_effort).toBe("medium");
    expect(draft.promotion_packet_id).toBeNull();
  });

  it("resolves a stored record with no profile field as legacy", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "runstore-"));
    writeFileSync(join(stateDir, "runs.json"), JSON.stringify({ schema_version: "v1", runs: [{ schema_version: "v1", current: { run_id: "r1", revision: 1, project_id: "p", prompt: "x", provider: "codex_cli", model: null, estimated_tokens: 0, input_token_bound: 0, output_token_allowance: 0, requested_artifacts: ["text"], prompt_review_acknowledged: true, created_at: "2026-01-01T00:00:00.000Z" }, revisions: [], status: "completed", approved_revision: 1, approved_by: "owner", approved_at: "2026-01-01T00:00:00.000Z", supervisor_task_id: null, worker_run_id: null, terminal_reason: null, token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: "2026-01-01T00:00:00.000Z" }] }));
    const record = readRunStore(stateDir).runs[0];
    expect(resolveRunProfile(record)).toBe("legacy");
  });
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/delivery-system/run-store-profile.test.ts`
Expected: FAIL — `RunDraftInput` has no `profile` and `resolveRunProfile` is undefined.

- [ ] **Step 3: Add the optional-on-read, required-on-create profile field**

In `runStore.ts`, add `readonly profile: RunProfile;`, `readonly requested_reasoning_effort: RunReasoningEffort | null;`, and `readonly promotion_packet_id: string | null;` to `RunDraft` (line ~15-28). Define `RunDraftInput` so `profile` and `requested_reasoning_effort` are explicit, DEV normalizes an omitted promotion ref to `null`, and PROD requires a non-empty bounded promotion ref. Validate the effort against `SUPPORTED_REASONING_EFFORTS[input.provider]`; `null` means provider default and is the only accepted OpenRouter value until a mode-specific capability is implemented and tested. Validate these shape invariants in `createRunDraft`/`reviseRunDraft`; Task 7 validates the referenced packet's approved/verified state. Add:

```ts
import type { RunProfile, StoredRunProfile } from "./executionProfile";

export function resolveRunProfile(record: RunRecord): StoredRunProfile {
  const value = (record.current as { readonly profile?: RunProfile }).profile;
  return value === "dev" || value === "prod" ? value : "legacy";
}
```

When reading legacy records that lack `profile`/`requested_reasoning_effort`/`promotion_packet_id`, do **not** rewrite the file (non-destructive); `resolveRunProfile` supplies `"legacy"`, and consumers treat reasoning and promotion ref as `null`. New drafts always persist all three fields. Add tests rejecting PROD without a promotion ref, DEV with a non-null ref, unsupported provider/effort combinations, and revision attempts after approval that change profile, model, provider, reasoning, or promotion association.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- tests/delivery-system/run-store-profile.test.ts tests/delivery-system/run-store.test.ts && npm run typecheck`
Expected: new and existing run-store tests pass; typecheck 0. (Update existing `tests/delivery-system/run-store.test.ts` fixtures to include `profile: "dev"` where they build `RunDraftInput`.)

```bash
git add src/data/delivery-system/runStore.ts tests/delivery-system/run-store-profile.test.ts tests/delivery-system/run-store.test.ts
git commit -m "feat: add run profile field with legacy-compatible read"
```

---

### Task 3: Promotion packet store

*(Depends on T2. May run in parallel with Task 4 — disjoint files.)*

**Files:**
- Create: `src/data/delivery-system/promotionPacket.ts`
- Test: `tests/delivery-system/promotion-packet.test.ts`
- Test: `tests/delivery-system/state-maintenance.test.ts`

**Interfaces:**
- Consumes: `RunRecord`, `readRunStore` from `./runStore`; `redactTelemetryText` from `./telemetryRedaction`; `writeStateFileAtomically` from `./stateMaintenanceLock`.
- Produces: `PromotionPacket`, `PromotionStatus = "promotion_pending" | "approved" | "rejected" | "published" | "rolled_back"`, `PromotionApproval`, `PromotionPublishEvidence`, `buildPromotionPacket`, strict bounded `readPromotionStore`, `approvePromotion`, `rejectPromotion`, `recordPromotionVerification`, `markPromotionPublished`, `markPromotionRolledBack`, `promotionStorePath`.
- Persistence: `promotions.json`, schema `v1`, ≤ 256 packets, intent ≤ 2,000 chars, diff ≤ 32,000 chars, ≤ 20 risks, ≤ 32 test commands.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPromotionPacket, approvePromotion } from "../../src/data/delivery-system/promotionPacket";
import type { RunRecord } from "../../src/data/delivery-system/runStore";

const completedDevRun = {
  schema_version: "v1", status: "completed", approved_revision: 2,
  current: { run_id: "run-1", revision: 2, project_id: "p", prompt: "secret Authorization: Bearer abc", provider: "codex_cli", model: null, requested_reasoning_effort: null, profile: "dev", promotion_packet_id: null, estimated_tokens: 0, input_token_bound: 0, output_token_allowance: 0, requested_artifacts: ["text"], prompt_review_acknowledged: true, created_at: "2026-07-21T10:00:00.000Z" },
  revisions: [], approved_by: "owner", approved_at: "2026-07-21T10:00:00.000Z", supervisor_task_id: null, worker_run_id: "w1", terminal_reason: null, token_reservation: null, reservation_status: "settled", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0,
  artifacts: [{ artifact_id: "a1", type: "text", preview: "showcase output", created_at: "2026-07-21T10:00:00.000Z" }], updated_at: "2026-07-21T10:00:00.000Z",
} as const satisfies RunRecord;

describe("promotionPacket", () => {
  it("builds a compact, redacted, immutable-hash packet from a completed dev run", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "promo-"));
    const packet = buildPromotionPacket(stateDir, completedDevRun, { intent: "Publish showcase", diff_summary: "Authorization: Bearer abc + edits", tests: ["npm run verify"], risks: ["provider cost"] }, "2026-07-21T11:00:00.000Z");
    expect(packet.status).toBe("promotion_pending");
    expect(packet.source_revision).toBe(2);
    expect(packet.approvals).toEqual([]);
    expect((packet as { revisions?: unknown }).revisions).toBeUndefined();
    expect(JSON.stringify(packet)).not.toContain("Bearer abc");
    expect(packet.artifact_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses an empty owner approval", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "promo-"));
    const packet = buildPromotionPacket(stateDir, completedDevRun, { intent: "Publish", diff_summary: "d", tests: ["npm run verify"], risks: [] }, "2026-07-21T11:00:00.000Z");
    expect(() => approvePromotion(stateDir, packet.packet_id, { approver: "", approved_at: "2026-07-21T11:05:00.000Z", review_ref: "" }, "2026-07-21T11:05:00.000Z")).toThrow("promotion_not_approved");
  });
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/delivery-system/promotion-packet.test.ts`
Expected: FAIL — `promotionPacket.ts` is missing.

- [ ] **Step 3: Implement the bounded, redacted, immutable packet**

```ts
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { RunRecord } from "./runStore";
import { readManagedStateTextFile } from "./managedStateFile";
import { redactTelemetryText } from "./telemetryRedaction";
import { writeStateFileAtomically } from "./stateMaintenanceLock";

export type PromotionStatus = "promotion_pending" | "approved" | "rejected" | "published" | "rolled_back";
export interface PromotionApproval { readonly approver: string; readonly approved_at: string; readonly review_ref: string; }
export interface PromotionPublishEvidence {
  readonly prod_run_id: string;
  readonly full_verification_ref: string;
  readonly release_acceptance_ref: string;
  readonly rollback_ref: string;
}
export interface PromotionPacket {
  readonly schema_version: "v1";
  readonly packet_id: string;
  readonly source_run_id: string;
  readonly source_revision: number;
  readonly intent: string;
  readonly artifact_hash: string;
  readonly artifact_ref: string;
  readonly diff_summary: string;
  readonly tests: readonly string[];
  readonly risks: readonly string[];
  readonly approvals: readonly PromotionApproval[];
  readonly prod_run_id: string | null;
  readonly full_verification_ref: string | null;
  readonly release_acceptance_ref: string | null;
  readonly rollback_ref: string | null;
  readonly status: PromotionStatus;
  readonly created_at: string;
  readonly updated_at: string;
}
export interface PromotionStoreDocument { readonly schema_version: "v1"; readonly packets: readonly PromotionPacket[]; }
const FILE = "promotions.json";
const MAX_STORE_BYTES = 4 * 1024 * 1024;
export function promotionStorePath(stateDir: string): string { return join(stateDir, FILE); }
export function readPromotionStore(stateDir: string): PromotionStoreDocument {
  const managed = readManagedStateTextFile(promotionStorePath(stateDir), { maxBytes: MAX_STORE_BYTES });
  if (managed.status === "missing") return { schema_version: "v1", packets: [] };
  let value: unknown;
  try { value = JSON.parse(managed.text); } catch { throw new Error("invalid_promotion_store"); }
  return parsePromotionStore(value); // strict v1 shape, enum, scalar/array bounds, unique packet_id
}
function artifactHash(run: RunRecord): string {
  const material = JSON.stringify({ run: run.current.run_id, rev: run.current.revision, artifacts: run.artifacts.map((a) => ({ id: a.artifact_id, type: a.type, preview: a.preview })) });
  return createHash("sha256").update(material).digest("hex");
}
export function buildPromotionPacket(stateDir: string, run: RunRecord, input: { intent: string; diff_summary: string; tests: readonly string[]; risks: readonly string[] }, now: string): PromotionPacket {
  if (run.status !== "completed") throw new Error("promotion_source_not_completed");
  if ((run.current as { profile?: string }).profile !== "dev") throw new Error("promotion_source_not_dev");
  const packet: PromotionPacket = {
    schema_version: "v1", packet_id: `promo-${run.current.run_id}-${run.current.revision}-${randomUUID().slice(0, 8)}`,
    source_run_id: run.current.run_id, source_revision: run.current.revision,
    intent: redactTelemetryText(input.intent, 2_000), artifact_hash: artifactHash(run),
    artifact_ref: `run:${run.current.run_id}@${run.current.revision}`,
    diff_summary: redactTelemetryText(input.diff_summary, 32_000),
    tests: input.tests.slice(0, 32).map((t) => redactTelemetryText(t, 512)),
    risks: input.risks.slice(0, 20).map((r) => redactTelemetryText(r, 512)),
    approvals: [], prod_run_id: null, full_verification_ref: null,
    release_acceptance_ref: null, rollback_ref: null,
    status: "promotion_pending", created_at: now, updated_at: now,
  };
  const store = readPromotionStore(stateDir);
  if (store.packets.length >= 256) throw new Error("promotion_limit");
  writeStateFileAtomically(stateDir, promotionStorePath(stateDir), JSON.stringify({ schema_version: "v1", packets: [...store.packets, packet] }));
  return packet;
}
export function approvePromotion(stateDir: string, packetId: string, approval: PromotionApproval, now: string): PromotionPacket {
  if (!approval.approver.trim() || !approval.review_ref.trim()) throw new Error("promotion_not_approved");
  return transition(stateDir, packetId, (p) => ({ ...p, approvals: [...p.approvals, approval], status: "approved", updated_at: now }));
}
export function rejectPromotion(stateDir: string, packetId: string, now: string): PromotionPacket {
  return transition(stateDir, packetId, (p) => ({ ...p, status: "rejected", updated_at: now }));
}
export function recordPromotionVerification(stateDir: string, packetId: string, fullVerificationRef: string, now: string): PromotionPacket {
  if (!fullVerificationRef.trim()) throw new Error("promotion_evidence_required");
  return transition(stateDir, packetId, (p) => {
    if (p.status !== "approved" || p.approvals.length === 0) throw new Error("promotion_not_approved");
    return { ...p, full_verification_ref: fullVerificationRef, updated_at: now };
  });
}
export function markPromotionPublished(stateDir: string, packetId: string, evidence: PromotionPublishEvidence, now: string): PromotionPacket {
  if (![evidence.prod_run_id, evidence.full_verification_ref, evidence.release_acceptance_ref, evidence.rollback_ref].every((v) => v.trim())) throw new Error("promotion_evidence_required");
  return transition(stateDir, packetId, (p) => {
    if (p.status !== "approved" || p.approvals.length === 0) throw new Error("promotion_not_ready");
    if (p.full_verification_ref !== evidence.full_verification_ref) throw new Error("promotion_verification_mismatch");
    return { ...p, ...evidence, status: "published", updated_at: now };
  });
}
export function markPromotionRolledBack(stateDir: string, packetId: string, now: string): PromotionPacket {
  return transition(stateDir, packetId, (p) => {
    if (p.status !== "published") throw new Error("promotion_not_published");
    return { ...p, status: "rolled_back", updated_at: now };
  });
}
function transition(stateDir: string, packetId: string, fn: (p: PromotionPacket) => PromotionPacket): PromotionPacket {
  const store = readPromotionStore(stateDir);
  const index = store.packets.findIndex((p) => p.packet_id === packetId);
  if (index < 0) throw new Error("promotion_not_found");
  const next = fn(store.packets[index]);
  const packets = [...store.packets]; packets[index] = next;
  writeStateFileAtomically(stateDir, promotionStorePath(stateDir), JSON.stringify({ schema_version: "v1", packets }));
  return next;
}
```

Implement `parsePromotionStore(value)` in the same module as a total validator: require the exact `schema_version`, an array of at most 256 packets, unique `packet_id`, known status enum, bounded strings/arrays matching the persistence limits above, valid 64-character lowercase `artifact_hash`, valid nullable evidence fields, and no unknown/non-JSON values. Add RED/GREEN cases for malformed JSON, oversized files, symlinks, duplicate IDs, invalid transitions, missing evidence, verification-ref mismatch, and concurrent atomic updates following the existing managed-state tests. Extend `state-maintenance.test.ts` to prove `promotions.json` is included in a backup, validates, restores with mode `0600`, and remains byte-identical; no new backup mechanism or allowlist is introduced.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- tests/delivery-system/promotion-packet.test.ts tests/delivery-system/state-maintenance.test.ts && npm run typecheck`
Expected: promotion-packet tests pass; typecheck 0.

```bash
git add src/data/delivery-system/promotionPacket.ts tests/delivery-system/promotion-packet.test.ts tests/delivery-system/state-maintenance.test.ts
git commit -m "feat: add explicit prod promotion packet store"
```

---

### Task 4: Orchestrator profile threading and adapter-enforced model/reasoning

*(Depends on T1, T2. May run in parallel with Task 3.)*

**Files:**
- Modify: `src/data/delivery-system/runOrchestrator.ts:71-108`
- Modify: `src/data/delivery-system/cliWorker.ts:390-421,560-670`
- Modify: `src/data/delivery-system/cliWorkerCapture.ts:772-840,930-970`
- Test: `tests/delivery-system/run-orchestrator-profile.test.ts`
- Test: `tests/delivery-system/cli-worker-safety.test.ts`
- Test: `tests/delivery-system/cli-worker-capture.test.ts`

**Interfaces:**
- Consumes: `classifyWorkUnitForProfile`, `assertNoSilentRouteChange` (Task 1); `resolveRunProfile` (Task 2).
- Produces: profile-aware `handoffFor` work-unit classification; immutable requested reasoning forwarded as `generationSettings.reasoning_effort`; adapter argv that demonstrably carries the owner-selected model/reasoning; retry route identity preserved. Existing `createRunOrchestrator` options unchanged.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunOrchestrator } from "../../src/data/delivery-system/runOrchestrator";

function harness(profile: "dev" | "prod") {
  const stateDir = mkdtempSync(join(tmpdir(), "orch-"));
  const dispatch = vi.fn(async () => ({ kind: "completed", output: "{}" } as never));
  const orchestrator = createRunOrchestrator({ stateDir, projectRoot: process.cwd(), tokenGateway: { reserve: vi.fn(), release: vi.fn(), settle: vi.fn() } as never, supervisor: { enqueue: vi.fn(), peekClaimable: () => null, claim: () => null, complete: vi.fn(), fail: () => ({}), cancel: vi.fn() } as never, dispatch, isRouteAvailable: () => true });
  return { orchestrator, dispatch, profile };
}

describe("runOrchestrator profile", () => {
  it("classifies a prod run handoff as high risk", () => {
    const { orchestrator } = harness("prod");
    const run = orchestrator.prepareRun({ project_id: "autopilot-beta", prompt: "Publish", provider: "codex_cli", model: "gpt-5.5", requested_reasoning_effort: "xhigh", estimated_tokens: 0, requested_artifacts: ["text"], profile: "prod", promotion_packet_id: "packet-1" });
    const handoff = orchestrator.handoffForRun(run.current.run_id);
    expect(handoff.efficiency.work_unit).toEqual({ work_unit_id: run.current.run_id, class: "high_risk", risk: "high" });
    expect(handoff.model).toBe("gpt-5.5");
    expect(handoff.generationSettings?.reasoning_effort).toBe("xhigh");
  });

  it("keeps a dev run ordinary and leaves the recommendation null", () => {
    const { orchestrator } = harness("dev");
    const run = orchestrator.prepareRun({ project_id: "autopilot-beta", prompt: "Iterate", provider: "codex_cli", model: null, requested_reasoning_effort: null, estimated_tokens: 0, requested_artifacts: ["text"], profile: "dev" });
    const handoff = orchestrator.handoffForRun(run.current.run_id);
    expect(handoff.efficiency.work_unit.risk).toBe("ordinary");
    expect(handoff.efficiency.actual_reasoning_effort).toBeNull();
  });
});
```

In `cli-worker-capture.test.ts`, add table-driven pure argv tests: Claude with model `opus` + effort `high` contains exactly one `--model opus` and one `--effort high`; Agy contains exactly one pair; Codex contains `--model gpt-5.5` and `-c model_reasoning_effort="xhigh"`. Add negative cases proving Agy `xhigh`, OpenRouter non-null reasoning, an empty model, duplicate flags, and values containing whitespace/control characters are rejected before the injected spawn/fetch function is called. Do not use a live provider in tests.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/delivery-system/run-orchestrator-profile.test.ts`
Expected: FAIL — `handoffForRun` is not exposed, classification ignores profile, and current Claude/Agy/Codex capture paths do not all enforce the requested configuration.

- [ ] **Step 3: Thread profile through `handoffFor` and expose it for test**

In `runOrchestrator.ts`, replace the hard-coded `work_unit` in `handoffFor` (lines ~100-107) with profile-derived classification, pass the owner selection into the existing worker input, and expose a thin `handoffForRun(runId)` on the returned object:

```ts
import { classifyWorkUnitForProfile } from "./executionProfile";
import { resolveRunProfile } from "./runStore";

// At the start of handoffFor(run), before constructing GovernedHandoff:
const storedProfile = resolveRunProfile(run);
const executionProfile = storedProfile === "legacy" ? "prod" : storedProfile;
const wu = classifyWorkUnitForProfile(executionProfile, false);

// Replace only the current hard-coded efficiency property with:
efficiency: {
  work_unit: { work_unit_id: run.current.run_id, class: wu.class, risk: wu.risk },
  profile: storedProfile,
  actual_reasoning_effort: run.current.requested_reasoning_effort,
},
...(run.current.requested_reasoning_effort === null ? {} : {
  generationSettings: { reasoning_effort: run.current.requested_reasoning_effort },
}),

// Add this method to the returned orchestrator object:
handoffForRun: (runId: string) => handoffFor(record(runId)),
```

Before any spawn, `cliWorker.ts` must validate the tuple `(vendor, model, generationSettings.reasoning_effort)` against Task 1's capability matrix and refuse with a stable sanitized `unsupported_reasoning_effort` error. In `cliWorkerCapture.ts`, extract/export pure argv builders and use them in production: Claude `claude -p <prompt> ... --model <model> --effort <effort>`; Agy's existing `buildAgyArgs` adds `--effort`; Codex's existing config builder adds `-c model_reasoning_effort="<effort>"` and retains `--model`; no fallback-model flag is ever emitted. OpenRouter accepts only `null` reasoning in this increment rather than pretending its model-specific API capability is known. Tests assert exact argv, absence of fallback, and zero spawn on invalid input. The CLI-call telemetry already records `generation_settings`; keep that privacy-safe record.

Retry paths already reuse the same persisted route via `clearRunProviderResultForRetry`; call `assertNoSilentRouteChange` before dispatching a retry and include reasoning in both snapshots. `legacy` records classify as `prod` (high risk) so existing production runs keep full-verification treatment. Because the exact validated flag is applied and fallback is disabled, `actual_reasoning_effort` may equal the requested value; if no effort is explicitly applied it remains `null` and must not be inferred from model defaults.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- tests/delivery-system/run-orchestrator-profile.test.ts tests/delivery-system/run-orchestrator.test.ts tests/delivery-system/cli-worker-safety.test.ts tests/delivery-system/cli-worker-capture.test.ts && npm run typecheck`
Expected: new and existing orchestrator tests pass; typecheck 0. (Add `profile: "dev"` to existing orchestrator-test inputs.)

```bash
git add src/data/delivery-system/runOrchestrator.ts src/data/delivery-system/cliWorker.ts src/data/delivery-system/cliWorkerCapture.ts tests/delivery-system/run-orchestrator-profile.test.ts tests/delivery-system/run-orchestrator.test.ts tests/delivery-system/cli-worker-safety.test.ts tests/delivery-system/cli-worker-capture.test.ts
git commit -m "feat: enforce run profile model and reasoning selection"
```

---

### Task 5: Profile-scoped telemetry and work-unit sampling

*(Depends on T4 because dispatch must supply the applied profile/reasoning contract. May run in parallel with T7 and after T6.)*

**Files:**
- Modify: `src/data/delivery-system/efficiencyTelemetry.ts:11-56`
- Modify: `src/data/delivery-system/efficiencyReport.ts:10-17,139-146`
- Modify: `src/governed-core/dispatch.ts:80-88,445-461`
- Modify: `scripts/codex-efficiency-report.ts:88-125`
- Test: `tests/delivery-system/efficiency-telemetry-profile.test.ts`
- Test: `tests/scripts/codex-efficiency-report.test.ts`

**Interfaces:**
- Consumes: `StoredRunProfile` (Task 1) and the applied `GovernedHandoff.efficiency.profile`/reasoning contract (Task 4).
- Produces: `EfficiencyTelemetryEventV1.profile: StoredRunProfile`, `WorkUnitRecord.profile: StoredRunProfile`; `BuildEfficiencyTelemetryEventInput.profile`; legacy-compatible `parseWorkUnitRecord` behavior. `compareEfficiencyWindows` (≥20 ordinary + ≥5 high-risk) is reused unchanged.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildEfficiencyTelemetryEvent } from "../../src/data/delivery-system/efficiencyTelemetry";

describe("efficiency telemetry profile", () => {
  it("records the profile and keeps recommendations null and shadow-only", () => {
    const event = buildEfficiencyTelemetryEvent({ recordedAt: "2026-07-21T10:00:00.000Z", workUnit: { work_unit_id: "wu1", class: "bounded_implementation", risk: "ordinary" }, handoffId: "h1", actualModel: "gpt-5", actualReasoningEffort: "medium", status: "completed", profile: "dev" });
    expect(event.profile).toBe("dev");
    expect(event.recommended_model).toBeNull();
    expect(event.recommended_reasoning_effort).toBeNull();
    expect(event.routing_mode).toBe("shadow_only");
  });
});
```

In `tests/scripts/codex-efficiency-report.test.ts`, add one work-unit-map case with `profile:"dev"` and one legacy fixture with no profile. Assert the explicit record remains `dev`, the missing field resolves to `legacy`, and only the explicit non-legacy record contributes to the ordinary/high-risk acceptance counts.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/delivery-system/efficiency-telemetry-profile.test.ts`
Expected: FAIL — `profile` is not on the event/builder input and the work-unit parser does not preserve/default it.

- [ ] **Step 3: Add the profile field, preserving the shadow-only contract**

In `efficiencyTelemetry.ts` add `readonly profile: StoredRunProfile;` to `EfficiencyTelemetryEventV1` and `readonly profile: StoredRunProfile;` to `BuildEfficiencyTelemetryEventInput`, and set `profile: input.profile` in `buildEfficiencyTelemetryEvent`. In `src/governed-core/dispatch.ts`, add `profile: StoredRunProfile` to `GovernedHandoff.efficiency` and pass `handoff.efficiency.profile` to the telemetry builder at the existing chokepoint; extend `tests/governed-core/dispatch-telemetry.test.ts` to prove started/completed/refused events carry the same profile and applied reasoning. Keep `recommended_model: null`, `recommended_reasoning_effort: null`, `routing_mode: "shadow_only"` exactly as-is. In `efficiencyReport.ts` add `readonly profile: StoredRunProfile;` to `WorkUnitRecord`, and narrow the `samples.ordinary`/`samples.high_risk` filters (lines ~139-146) to `record.descriptor.risk === … && record.profile !== "legacy"` so `legacy` events never count toward the 20/5 acceptance floor (`samples.completed` is unchanged). In `scripts/codex-efficiency-report.ts::parseWorkUnitRecord`, accept only `"dev"`, `"prod"`, or an absent field; return absent as `profile:"legacy"` without rewriting the source map and reject every other value.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- tests/delivery-system/efficiency-telemetry-profile.test.ts tests/delivery-system/efficiency-policy.test.ts tests/governed-core/dispatch-telemetry.test.ts tests/scripts/codex-efficiency-report.test.ts && npm run typecheck`
Expected: pass; typecheck 0.

```bash
git add src/data/delivery-system/efficiencyTelemetry.ts src/data/delivery-system/efficiencyReport.ts src/governed-core/dispatch.ts scripts/codex-efficiency-report.ts tests/delivery-system/efficiency-telemetry-profile.test.ts tests/governed-core/dispatch-telemetry.test.ts tests/scripts/codex-efficiency-report.test.ts
git commit -m "feat: scope efficiency telemetry by execution profile"
```

---

### Task 6: Diff-scoped vs full verification harness

*(Depends on T1. May run in parallel with T2–T4; T5 follows T4 independently.)*

**Files:**
- Create: `scripts/verify-scope.ts`
- Modify: `package.json` (add `verify:dev`, `verify:prod`)
- Test: `tests/scripts/verify-scope.test.ts`

**Interfaces:**
- Consumes: `resolveVerificationMode` (Task 1).
- Produces: `resolveVerificationPlan({ profile, risk, changedFiles })` → `{ mode, commands: PlannedCommand[] }`; CLI entrypoint `verify-scope` with structured argv execution.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveVerificationPlan } from "../../scripts/verify-scope";

describe("verify-scope", () => {
  it("plans diff-scoped commands for ordinary dev work", () => {
    const plan = resolveVerificationPlan({ profile: "dev", risk: "ordinary", changedFiles: ["src/data/delivery-system/runStore.ts"] });
    expect(plan.mode).toBe("diff_scoped");
    expect(plan.commands).toContainEqual({ file: "npm", args: ["run", "mesh:changed", "--", "--files", "src/data/delivery-system/runStore.ts", "--fail-on-blocker", "--fail-on-ungoverned"] });
    expect(plan.commands.flatMap((command) => command.args)).not.toContain("browser:qa");
  });

  it("plans full fail-closed verification for prod or high-risk work", () => {
    const plan = resolveVerificationPlan({ profile: "prod", risk: "ordinary", changedFiles: [] });
    expect(plan.mode).toBe("full_fail_closed");
    expect(plan.commands).toEqual([
      { file: "npm", args: ["run", "verify"] },
      { file: "npm", args: ["run", "cockpit:test"] },
      { file: "npm", args: ["run", "browser:qa"] },
    ]);
    expect(resolveVerificationPlan({ profile: "dev", risk: "high", changedFiles: [] }).mode).toBe("full_fail_closed");
  });
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/scripts/verify-scope.test.ts`
Expected: FAIL — `scripts/verify-scope.ts` is missing.

- [ ] **Step 3: Implement the planner and CLI**

```ts
import { resolveVerificationMode, type RunProfile } from "../src/data/delivery-system/executionProfile";
import type { WorkUnitRisk } from "../src/data/delivery-system/efficiencyPolicy";

export interface VerificationPlanInput { readonly profile: RunProfile; readonly risk: WorkUnitRisk; readonly changedFiles: readonly string[]; }
export interface PlannedCommand { readonly file: "npm"; readonly args: readonly string[]; }
export interface VerificationPlan { readonly mode: "diff_scoped" | "full_fail_closed"; readonly commands: readonly PlannedCommand[]; }

export function resolveVerificationPlan(input: VerificationPlanInput): VerificationPlan {
  const mode = resolveVerificationMode(input.profile, input.risk);
  if (mode === "full_fail_closed") {
    return { mode, commands: [
      { file: "npm", args: ["run", "verify"] },
      { file: "npm", args: ["run", "cockpit:test"] },
      { file: "npm", args: ["run", "browser:qa"] },
    ] };
  }
  const files = [...new Set(input.changedFiles)].sort();
  if (files.length === 0) throw new Error("verification_change_set_required");
  if (files.some((path) => /[\s\0]/.test(path))) throw new Error("verification_change_path_unsupported");
  const commands: PlannedCommand[] = [
    { file: "npm", args: ["run", "runtime:check"] },
    { file: "npm", args: ["run", "typecheck"] },
    { file: "npm", args: ["run", "mesh:changed", "--", "--files", files.join(" "), "--fail-on-blocker", "--fail-on-ungoverned"] },
  ];
  if (files.some((path) => path.startsWith("src/data/delivery-system/") || path.startsWith("tests/delivery-system/"))) commands.push({ file: "npm", args: ["test", "--", "tests/delivery-system"] });
  if (files.some((path) => path.startsWith("scripts/") || path.startsWith("tests/scripts/"))) commands.push({ file: "npm", args: ["test", "--", "tests/scripts"] });
  if (files.some((path) => path.startsWith("cockpit/"))) commands.push({ file: "npm", args: ["run", "cockpit:test"] });
  if (files.some((path) => path.startsWith("docs/") || path === "README.md")) commands.push({ file: "npm", args: ["run", "docs:links"] });
  if (commands.length === 3) throw new Error("verification_scope_unmapped");
  return { mode, commands };
}
```

Add a CLI tail that reads `--profile`, `--risk`, and either repeated `--file` values or an explicit `--working-tree` selector. `--working-tree` must collect tracked, staged, renamed, and untracked paths deterministically from NUL-delimited Git porcelain output; malformed rename records fail closed. Because the existing `mesh:changed --files` contract is whitespace-delimited, reject whitespace/control characters in paths with `verification_change_path_unsupported` rather than mis-scope them. Print the plan as JSON and, with `--run`, execute each `PlannedCommand` only as `execFileSync(command.file, command.args, { stdio:"inherit" })`, exiting nonzero on the first failure. Never pass a composed shell string. Add RED cases for an empty change set, an unmapped path, refused whitespace/control paths, untracked files, and first-command failure. Add to `package.json` scripts:

```json
"verify:dev": "tsx scripts/verify-scope.ts --profile dev --risk ordinary --working-tree --run",
"verify:prod": "tsx scripts/verify-scope.ts --profile prod --risk high --run"
```

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- tests/scripts/verify-scope.test.ts && npm run typecheck`
Expected: pass; typecheck 0.

```bash
git add scripts/verify-scope.ts tests/scripts/verify-scope.test.ts package.json
git commit -m "feat: add profile-scoped verification planner"
```

---

### Task 7: Control-plane profile scoping and promotion endpoints

*(Depends on T2, T3, T4.)*

**Files:**
- Modify: `scripts/control-plane-runs.ts:73,121-124,172`
- Modify: `scripts/control-plane-server.ts`
- Test: `tests/scripts/control-plane-promotion.test.ts`

**Interfaces:**
- Adds: `GET /runs?profile=dev|prod`, DEV `POST /runs`, evidence-gated PROD `POST /runs` requiring `promotion_packet_id` + `full_verification_ref`, `POST /runs/:id/promote`, `GET /promotions`, `POST /promotions/:id/approve`, `POST /promotions/:id/reject`, `POST /promotions/:id/record-verification`, `POST /promotions/:id/mark-published`, `POST /promotions/:id/mark-rolled-back`; provider-model responses expose the adapter-validated `reasoning_efforts` list.
- Bodies are JSON ≤ 64 KiB, authenticated, covered by existing same-origin cookie mutation protection.

- [ ] **Step 1: Write the failing HTTP contract test**

```ts
it("promotes a completed dev run into a pending prod packet, never automatically", async () => {
  const prepared = await request("POST", "/runs", { project_id: "autopilot-beta", prompt: "Iterate", provider: "codex_cli", model: "gpt-5.5", requested_reasoning_effort: "high", requested_artifacts: ["text"], profile: "dev" });
  expect(prepared.status).toBe(201);
  const preparedRun = prepared.json as { current: { run_id: string; revision: number } };
  expect((await request("POST", `/runs/${preparedRun.current.run_id}/approve`, { revision: preparedRun.current.revision, operator: "owner" })).status).toBe(200);
  await vi.waitFor(() => expect(readRunStore(stateDir).runs.find((run) => run.current.run_id === preparedRun.current.run_id)?.status).toBe("completed"));
  const promote = await request("POST", `/runs/${preparedRun.current.run_id}/promote`, { intent: "Publish showcase", diff_summary: "edits", tests: ["npm run verify"], risks: ["cost"] });
  expect(promote.status).toBe(201);
  expect(promote.json.status).toBe("promotion_pending");
  const list = await request("GET", "/promotions", null);
  expect(list.json.packets).toHaveLength(1);
});

it("rejects a create without a profile", async () => {
  const response = await request("POST", "/runs", { project_id: "autopilot-beta", prompt: "x", provider: "codex_cli", model: null, requested_reasoning_effort: null, requested_artifacts: ["text"] });
  expect(response.status).toBe(400);
});

it("refuses a direct prod draft and never dispatches while linking an approved verified packet", async () => {
  expect((await request("POST", "/runs", { project_id: "autopilot-beta", prompt: "Publish", provider: "codex_cli", model: null, requested_reasoning_effort: null, requested_artifacts: ["text"], profile: "prod" })).status).toBe(409);
  const prod = await request("POST", "/runs", { project_id: "autopilot-beta", prompt: "Publish", provider: "codex_cli", model: "gpt-5.5", requested_reasoning_effort: "xhigh", requested_artifacts: ["text"], profile: "prod", promotion_packet_id: "approved-p1", full_verification_ref: "sha256:evidence" });
  expect(prod.status).toBe(201);
  expect(prod.json.status).toBe("draft");
  expect(workerDispatch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/scripts/control-plane-promotion.test.ts`
Expected: FAIL — promote/promotions routes return 404; missing-profile create still returns 201; direct PROD creation is not evidence-gated.

- [ ] **Step 3: Add profile scoping and promotion routes**

In `control-plane-runs.ts`: validate `profile ∈ {"dev","prod"}` and the explicit `requested_reasoning_effort` on `POST /runs` (400 `run_profile_required` if absent, 409 `unsupported_reasoning_effort` for a non-capable route); filter `GET /runs` by `?profile`. Extend the existing provider-model response in `control-plane-server.ts` so each provider/model route returns the adapter-validated `reasoning_efforts`; return an empty list where support is unproven rather than inventing capability. A DEV create follows the existing prepare-only behavior. A PROD create requires `promotion_packet_id` and `full_verification_ref`; within the existing state-maintenance lock, load the packet, require `status:"approved"`, at least one owner approval, `prod_run_id:null`, exact equality with its previously recorded `full_verification_ref`, and no existing PROD run whose immutable `promotion_packet_id` matches. Then create only a PROD `draft` carrying that packet ID. Never approve, queue, dispatch, publish, or release automatically. Extend the route parser with `{ kind: "promote", runId }`, `{ kind: "promotions" }`, `{ kind: "promotion_approve", packetId }`, `{ kind: "promotion_reject", packetId }`, `{ kind: "promotion_verify", packetId }`, `{ kind: "promotion_publish", packetId }`, `{ kind: "promotion_rollback", packetId }`. Handlers call the Task 3 functions. `record-verification` requires a non-empty immutable evidence ref after the full suite succeeds. `mark-published` accepts a `prod_run_id`, verifies that the referenced completed PROD run carries this packet ID, and requires the exact full-verification ref plus non-empty production-acceptance and rollback refs; it records evidence only after the existing release path succeeds and never performs deployment itself. Map every Task 3 domain code to 409, including `promotion_evidence_required`, `promotion_not_ready`, and `promotion_verification_mismatch`. Building a packet or preparing a PROD draft performs **no** dispatch (invariant 3).

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- tests/scripts/control-plane-promotion.test.ts tests/scripts/control-plane-server.test.ts && npm run typecheck`
Expected: all control-plane tests and typecheck pass.

```bash
git add scripts/control-plane-runs.ts scripts/control-plane-server.ts tests/scripts/control-plane-promotion.test.ts
git commit -m "feat: expose profile scoping and promotion control-plane api"
```

---

### Task 8: Cockpit environment split (Dev/Prod views)

*(Depends on T7.)*

**Files:**
- Create: `cockpit/src/app/environment.ts`
- Create: `cockpit/src/app/environment.test.ts`
- Modify: `cockpit/src/types/controlPlane.ts`
- Modify: `cockpit/src/api/controlPlaneClient.ts`
- Modify: `cockpit/src/app/routeState.ts`
- Modify: `cockpit/src/app/useCockpitData.ts`
- Modify: `cockpit/src/app/AppShell.tsx`
- Modify: `cockpit/src/app/App.tsx`
- Modify: `cockpit/src/app/AppShell.test.tsx`

**Interfaces:**
- Produces: `CockpitEnvironment = "dev" | "prod"`, `useCockpitEnvironment()`, `EnvironmentProvider`; typed provider/model capability data including `reasoning_efforts`; typed client `listRuns(profile)`, `createDevRun(body)`, `createProdDraft(packetId, verificationRef, body)`, `promoteRun(runId, body)`, `listPromotions()`, `approvePromotion(packetId, body)`, `recordPromotionVerification(packetId, evidenceRef)`, `markPromotionPublished(packetId, evidence)`.

- [ ] **Step 1: Write the failing test**

```tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./AppShell";
import type { CockpitEnvironment } from "./environment";

function EnvironmentRegion({ environment }: { readonly environment: CockpitEnvironment }) {
  return <section role="region" aria-label={environment === "dev" ? "Vývoj" : "Produkce"} />;
}

it("shows separate DEV and PROD environments and scopes the active one", async () => {
  function Harness() {
    const [environment, setEnvironment] = React.useState<CockpitEnvironment>("dev");
    return <AppShell environment={environment} onEnvironmentChange={setEnvironment} runWorkspace={<EnvironmentRegion environment={environment} />} />;
  }
  render(<Harness />);
  expect(screen.getByRole("tab", { name: "DEV" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "PROD" })).toBeVisible();
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "PROD" }));
  expect(screen.getByRole("region", { name: /Produkce/ })).toBeVisible();
});
```

- [ ] **Step 2: Run RED**

Run: `npm --prefix cockpit test -- src/app/environment.test.ts src/app/AppShell.test.tsx`
Expected: FAIL — no environment context or DEV/PROD tabs.

- [ ] **Step 3: Implement one app with two environments**

Add `environment.ts`:

```ts
import { createContext, useContext } from "react";
export type CockpitEnvironment = "dev" | "prod";
export const EnvironmentContext = createContext<CockpitEnvironment>("dev");
export function useCockpitEnvironment(): CockpitEnvironment { return useContext(EnvironmentContext); }
```

Add `environment` to `RouteState` in `routeState.ts` (default `"dev"`). Add required `environment: CockpitEnvironment` and `onEnvironmentChange(environment)` props to `AppShell`; it renders a separate environment `tablist` with `DEV`/`PROD` controls while preserving the existing section tabs. `App.tsx` owns the route state and passes the callback. The active environment maps to `profile` and is passed to `useCockpitData`, which requests `/runs?profile=<env>` and `/promotions`. Do **not** create a second app or duplicate stores — the same components render, filtered by environment. `EnvironmentRegion` is a tiny test-only component returning a labelled `role="region"` (`Vývoj` / `Produkce`) for the supplied environment. Extend `controlPlane.ts` types with `profile`, immutable `requested_reasoning_effort`, immutable `promotion_packet_id`, provider/model `reasoning_efforts`, the complete bounded `PromotionPacket`/evidence shapes, and all client methods above. PROD creation is available only from an approved, verification-backed packet and always returns a non-running draft. Update every existing `AppShell` test render with explicit `environment="dev"` and a no-op `onEnvironmentChange`; do not use placeholders or unsafe casts.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm --prefix cockpit test -- src/app/environment.test.ts src/app/AppShell.test.tsx src/app/useCockpitData.test.ts && npm --prefix cockpit run build`
Expected: focused tests and Vite build pass.

```bash
git add cockpit/src/app cockpit/src/api/controlPlaneClient.ts cockpit/src/types/controlPlane.ts
git commit -m "feat: split cockpit into dev and prod environments"
```

---

### Task 9: Promotion pane and shadow-recommendation surfacing

*(Depends on T8.)*

**Files:**
- Create: `cockpit/src/features/promotion/PromotionPane.tsx`
- Create: `cockpit/src/features/promotion/PromotionPane.test.tsx`
- Modify: `cockpit/src/features/runs/RunComposer.tsx`
- Modify: `cockpit/src/features/runs/RunComposer.test.tsx`

**Interfaces:**
- Consumes: Task 8 client methods and `PromotionPacket` type.
- Produces: `PromotionPane` with `onPromote`, `onApprovePromotion`, `onRejectPromotion`, `onPrepareProdDraft`; RunComposer exposes only server-advertised reasoning efforts, persists the owner's choice, and separately shows recommendation = "none (shadow-only)".

- [ ] **Step 1: Write the failing test**

```tsx
const packetFixture: PromotionPacket = makePromotionPacket({ packet_id: "p1", status: "promotion_pending", intent: "Publish", source_run_id: "run-1", source_revision: 2 });
render(<PromotionPane packets={[packetFixture]} onApprovePromotion={onApprove} onRejectPromotion={onReject} onPromote={onPromote} onPrepareProdDraft={onPrepareProdDraft} />);
expect(screen.getByText("promotion_pending")).toBeVisible();
await user.click(screen.getByRole("button", { name: "Schválit propagaci" }));
expect(onApprove).toHaveBeenCalledWith("p1");

const runComposerProps = makeRunComposerProps({ reasoning_efforts: ["low", "medium", "high"] });
render(<RunComposer {...runComposerProps} />);
await user.selectOptions(screen.getByLabelText("Reasoning"), "high");
await user.click(screen.getByRole("button", { name: "Připravit běh" }));
expect(runComposerProps.onPrepare).toHaveBeenCalledWith(expect.objectContaining({ requested_reasoning_effort: "high" }));
expect(screen.getByText(/Doporučení: žádné \(shadow-only\)/)).toBeVisible();
```

- [ ] **Step 2: Run RED**

Run: `npm --prefix cockpit test -- src/features/promotion/PromotionPane.test.tsx src/features/runs/RunComposer.test.tsx`
Expected: FAIL — pane missing; composer has neither a capability-bounded reasoning selector nor the shadow-recommendation label.

- [ ] **Step 3: Implement the pane and the shadow label**

`PromotionPane.tsx` lists packets with status, intent, `artifact_ref`, approvals, and evidence state. Buttons: `Propagovat` (build packet from selected Preview), `Schválit propagaci`, `Odmítnout`, and `Připravit PROD draft` only after owner approval plus recorded full-verification evidence. Promote is enabled only for a `completed` DEV run. Preparing PROD creates a linked draft and does not dispatch. `published` is read-only in ordinary Cockpit UI and appears only after the separately authorized existing release/acceptance path records its immutable evidence. In `RunComposer.tsx`, add a controlled `Reasoning` selector whose options come only from the selected provider/model route's `reasoning_efforts`; changing provider/model clears an invalid effort and invalidates any prepared draft. Include `requested_reasoning_effort` in `input`, `boundKey`, and `sameInput`, so approval cannot accidentally bind a different effort. Render a separate static, non-interactive label `Doporučení: žádné (shadow-only)` so the owner sees that no recommendation was auto-applied. Test helpers `makePromotionPacket` and `makeRunComposerProps` must return fully typed fixtures with all required fields; do not use `as never`.

- [ ] **Step 4: Run the full cockpit suite, build, and commit**

Run: `npm --prefix cockpit test && npm --prefix cockpit run build`
Expected: all cockpit tests pass; Vite build exits 0.

```bash
git add cockpit/src/features/promotion cockpit/src/features/runs
git commit -m "feat: add promotion pane and shadow-only recommendation surface"
```

---

### Task 10: Governance node, canonical doc, backward-compat + VM acceptance

*(Depends on all prior tasks. Final integration.)*

**Files:**
- Create: `mesh/nodes/execution_profile_policy.yaml`
- Create: `docs/autopilot/dev-prod-environments.md`
- Modify: `docs/status/current-status.md`
- Modify: `README.md`
- Modify: `tests/browser/cockpit.spec.ts`
- Modify: `mesh/generated/decision-mesh.json`, `mesh/related-files-snapshot.json` (via `npm run mesh:generate` then `npm run mesh:snapshot:regen`)

**Interfaces:**
- Adds one governed capability node linking the profile/promotion/verification files; one canonical doc; browser QA for the DEV→Preview→promote→approve flow.

- [ ] **Step 1: Add the failing browser scenario and mesh gate check**

Extend `tests/browser/cockpit.spec.ts`: login → DEV tab → select allowlisted project/provider/model (free lane) → prepare Draft (assert no worker invoked) → approve → run → inspect Preview → build promotion packet → PROD tab shows `promotion_pending` → approve → record fixture full-verification evidence → prepare linked PROD Draft (assert still no worker invoked). Assert `published` remains unavailable until fixture production-acceptance + rollback evidence are supplied through the privileged test boundary, then becomes visible. Assert the recommendation label reads "none (shadow-only)".

- [ ] **Step 2: Run RED**

Run: `npm run browser:qa`
Expected: new scenario fails until the environment/promotion UI is wired end to end.

- [ ] **Step 3: Author the single governance node and canonical doc; reconcile status**

Create `mesh/nodes/execution_profile_policy.yaml` with every schema-required field (`id`, `type`, `name`, `question`, `why`, `signals`, `related_agents`, `related_files`, `required_checks`) and only the minimum non-duplicated content. `related_files` points to `executionProfile.ts`, `promotionPacket.ts`, `runOrchestrator.ts`, `scripts/verify-scope.ts`, and `scripts/control-plane-runs.ts`; `required_checks` covers owner approval + full verification/release/rollback evidence, DEV diff scope, shadow-only null recommendations, and no silent route change. Do **not** restate prose from `AGENTS.md`. Create `docs/autopilot/dev-prod-environments.md` as the one canonical description (phase model, promotion invariants, verification matrix) — no separate spec/report. In `docs/status/current-status.md`, add a line recording DEV/PROD environments as repository-tested; in `README.md`, correct the stale "the live service has not been cut over" sentence to point to `docs/status/current-status.md` as authoritative (cutover completed 2026-07-14), resolving the audit-flagged contradiction. Run `npm run mesh:generate`, then `npm run mesh:snapshot:regen`; do not edit `mesh/related-files-baseline.json` unless a separately reviewed missing-path waiver is actually required.

- [ ] **Step 4: Verify host, then VM acceptance**

Run on host:

```bash
npm run typecheck
npm test -- tests/delivery-system/execution-profile.test.ts tests/delivery-system/run-store-profile.test.ts tests/delivery-system/promotion-packet.test.ts tests/delivery-system/run-orchestrator-profile.test.ts tests/delivery-system/efficiency-telemetry-profile.test.ts tests/scripts/verify-scope.test.ts tests/scripts/control-plane-promotion.test.ts
npm --prefix cockpit test
npm --prefix cockpit run build
npm run docs:links
npm run mesh:generate
npm run mesh:snapshot:regen
npm run mesh:gate:ci
npm run browser:qa
```

Expected: zero failures; `mesh:gate:ci` clean after regeneration; browser QA completes the DEV→Preview→promote→approve→publish flow. Then, on the VM, exercise the existing PROD release/rollback surface unchanged (`npm run ops:cockpit-proxy:isolated`, `npm run ops:cockpit-proxy:host-acceptance`, and prove rollback via `ops/cockpit-proxy/autopilot-cockpit-recovery-verify.sh`) to confirm no regression to deployed production Cockpit. No live provider invocation; no mutation of the live checkout or `~/.local/state/autopilot` during isolated acceptance.

- [ ] **Step 5: Commit**

```bash
git add mesh/nodes/execution_profile_policy.yaml mesh/generated/decision-mesh.json mesh/related-files-snapshot.json docs/autopilot/dev-prod-environments.md docs/status/current-status.md README.md tests/browser/cockpit.spec.ts
git commit -m "feat: govern and document dev/prod cockpit environments"
```

---

## Self-Review

**1. Spec coverage** (each requested requirement → task):
- Shared core, separate DEV/PROD profiles, separated Cockpit → T1 (profile axis), T8 (two environments, one app).
- DEV Draft/Preview, quick iteration, selectable providers/models/reasoning, cheap/free defaults, shadow routing overridable → T1 (`DEV_DEFAULT_COST_TIERS`), T4 (dev ordinary), T9 (selection + shadow label). Preview = completed DEV run (phase model section).
- PROD = owner-approved publishable showcase; promotion explicit, never automatic → T3, T7 (`/promote` + approval), promotion invariants section.
- Compact promotion packet (intent/artifact/diff/tests/risks/approvals), not Dev history → T3 (bounded, no `revisions`, redacted).
- DEV diff-scoped default; PROD/high-risk full fail-closed + independent review + immutable evidence + rollback + acceptance → T6, verification matrix, T10 VM.
- High-risk boundaries stay high-risk everywhere → T1 `resolveVerificationMode`/`classifyWorkUnitForProfile`, matrix.
- Recommendations shadow-only/null until approved and measured; never silent change → T4, T5 (reuse `shadow_only`, `null`), `compareEfficiencyWindows` reuse; `assertNoSilentRouteChange`.
- Node >=24 <25 → Global Constraints; `runtime:check` unchanged.
- Preserve high-risk review quality → matrix + T10 independent review/acceptance.
- No 30% claim; `insufficient_evidence` until 20 ordinary + 5 high-risk → Global Constraints + T5 (reuse existing gate, no new gate, no numbers).
- Future providers (Claude/Codex/AGY/OpenRouter/cheap-free), actual model/reasoning captured, no silent fallback → T1 capability matrix, T2 immutable owner selection, T4 exact adapter argv enforcement, existing `RunProvider` union + `providerUsageProbe`/`actual_*` fields preserved; unsupported routes refuse before spawn.
- No second control plane/duplicate SoT → Global Constraints; profile is a field; one node, one doc.
- Audit reconciliation (runtime frequency over file count) → Audit reconciliation section.
- Preserve existing Cockpit + production proxy/release → T8 reuses app; T10 exercises `ops/cockpit-proxy` unchanged.
- Privacy-safe telemetry + token-range estimates, no raw prompts/secrets → Observability section; `redactTelemetryText`/`assertAggregateOnly` reused; estimates labelled.
- Minimize governance overhead, no triplication → one mesh node, one doc, compact final evidence.
- Migration/back-compat for existing sessions/run records + deployed prod Cockpit → T2 (`legacy` read), T4 (legacy→prod treatment), T10 (VM regression check).
- Observability fields for 20+5 → Observability section, T5.
- Acceptance criteria for Cockpit interactions → Acceptance criteria section, T8/T9/T10.
- Sequential vs parallel identified → File-structure sequencing note + per-task parallel markers.

**2. Placeholder scan:** No unresolved work markers, generic edge-case instructions, cross-task copy shortcuts, or placeholder fixture comments. Pure functions and critical invariants have concrete snippets; integration steps name the existing harness to extend, exact assertions, exact commands, and expected results. No numeric savings claim appears anywhere.

**3. Type/interface consistency:** `RunProfile` ("dev"|"prod"), `StoredRunProfile` (+"legacy"), and `RunReasoningEffort` are defined once in T1 and consumed by T2 (`resolveRunProfile`), T4, T5, T6, T8/T9. `resolveVerificationMode` (T1) is consumed by T6. `PromotionStatus`/`PromotionPacket` defined in T3, consumed by T7/T8/T9. `classifyWorkUnitForProfile` returns `{class, risk}` matching the existing `efficiency.work_unit` shape in `runOrchestrator.handoffFor`. Control-plane domain error codes added in T7 match the strings thrown in T3/T4. `EfficiencyTelemetryEventV1.profile` (T5) matches `StoredRunProfile`, keeping legacy events explicit and excluded. Cockpit `CockpitEnvironment` maps 1:1 to profile query values, while `requested_reasoning_effort` travels unchanged from typed UI input to the validated adapter call.

**Scope control:** No new runtime, connector, gateway, queue, or deployment surface is introduced; the existing `src/governed-core/dispatch.ts` chokepoint, `TokenGateway`, `ops/cockpit-proxy` release/rollback, and the single Cockpit app are reused. The only new persisted store is `promotions.json` (a bounded projection of existing runs), and the only new governance artifacts are one mesh node and one canonical doc.
