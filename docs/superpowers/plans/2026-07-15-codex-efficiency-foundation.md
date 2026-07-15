# Codex Efficiency Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce median replay-adjusted tokens per comparable completed work unit by at least 30 percent through Node 24 enforcement, trustworthy measurement, bounded orchestration, and a smaller default instruction/skill surface, without changing the active model, reasoning effort, provider, or high-risk verification standard.

**Architecture:** Add a fail-fast Node 24 gate; introduce pure efficiency contracts, a replay-aware Codex rollout parser, and comparison/report CLIs; extend governed telemetry without activating routing; then apply conservative retry, hook, instruction, and personal-profile budgets through reversible changes. Model and reasoning recommendations remain null/shadow-only seams for a later separately approved routing phase.

**Tech Stack:** Node.js 24 ESM, TypeScript 6, Vitest 4, JSON/JSONL, existing Autopilot governed-core and Codex hook surfaces, Bash systemd/operations scripts, Codex CLI 0.144.4 documented `[[skills.config]]` controls.

## Global Constraints

- Runtime is exactly Node `>=24 <25`; wrong-major execution must refuse before application imports.
- Stage one keeps `gpt-5.6-sol`, `model_reasoning_effort = "medium"`, the current provider, and current high-risk review quality.
- Remove the explicit Fast service tier; do not introduce another service tier.
- No new provider, model identifier, fallback, dependency, network call, or automatic model/reasoning switch.
- Historical sessions and evidence remain untouched; generated reports must not contain prompts, responses, secrets, environment values, or raw tool payloads.
- Ordinary budget: at most two direct subagents, no recursive fan-out, one review plus one targeted re-review, and two total attempts with a recorded delta before attempt two.
- High-risk work may exceed a budget only through a structured override with risk trigger, expected assurance, and stopping condition.
- Missing telemetry produces `insufficient_evidence`, never a favorable result.
- Acceptance requires at least 30 percent median reduction, context p90 below 150k, at least 20 comparable ordinary and 5 high-risk work units, first-pass acceptance degradation no greater than two percentage points, and no escaped Critical/High finding.
- Every repository task follows RED → GREEN → focused regression → review → commit.
- Do not perform live provider calls, live cutover, or destructive session cleanup while implementing this plan.

---

### Task 1: Enforce Node 24 at repository entrypoints

**Files:**
- Create: `scripts/lib/require-node24.mjs`
- Create: `.npmrc`
- Modify: `package.json`
- Modify: `scripts/git-hooks/pre-commit`
- Modify: `scripts/git-hooks/pre-push`
- Modify: `scripts/git-hooks/commit-msg`
- Modify: `scripts/git-hooks/install.mjs`
- Test: `tests/scripts/node24-runtime-gate.test.ts`
- Test: `tests/scripts/pre-push-hook.test.ts`
- Test: `tests/operations/systemd-units.test.ts`

**Interfaces:**
- Produces: `parseNodeMajor(version: string): number | null`
- Produces: `requireNode24(input?: { version?: string; execPath?: string; writeError?: (message: string) => void }): void`
- Produces CLI behavior: exit `0` on Node 24; exit `64` with `node24_required` on every other major.
- Consumes: existing `engines.node = ">=24 <25"`, `.nvmrc = 24`, and production `/usr/bin/node` contract.

- [ ] **Step 1: Write the failing Node gate tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { parseNodeMajor, requireNode24 } from "../../scripts/lib/require-node24.mjs";

describe("Node 24 runtime gate", () => {
  it.each([["24.18.0", 24], ["v24.0.0", 24], ["bad", null]])("parses %s", (value, expected) => {
    expect(parseNodeMajor(value)).toBe(expected);
  });

  it("accepts Node 24", () => {
    expect(() => requireNode24({ version: "24.18.0", execPath: "/trusted/node" })).not.toThrow();
  });

  it.each(["18.19.1", "25.0.0", "bad"])("refuses %s before application work", (version) => {
    const writeError = vi.fn();
    expect(() => requireNode24({ version, execPath: "/usr/bin/node", writeError })).toThrow(/node24_required/);
    expect(writeError).toHaveBeenCalledWith(expect.stringContaining(`actual=${version}`));
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/scripts/node24-runtime-gate.test.ts
```

Expected: FAIL because `scripts/lib/require-node24.mjs` does not exist.

- [ ] **Step 3: Implement the standalone gate**

```js
#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export function parseNodeMajor(version) {
  const match = /^v?(\d+)(?:\.|$)/.exec(version);
  return match ? Number(match[1]) : null;
}

export function requireNode24({
  version = process.versions.node,
  execPath = process.execPath,
  writeError = (message) => process.stderr.write(`${message}\n`)
} = {}) {
  if (parseNodeMajor(version) === 24) return;
  const message = `node24_required expected=>=24 <25 actual=${version} executable=${execPath}`;
  writeError(message);
  throw new Error(message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { requireNode24(); } catch { process.exitCode = 64; }
}
```

- [ ] **Step 4: Wire lifecycle and hook gates**

Add to `package.json`:

```json
{
  "scripts": {
    "runtime:check": "node scripts/lib/require-node24.mjs",
    "preinstall": "node scripts/lib/require-node24.mjs",
    "preprepare": "node scripts/lib/require-node24.mjs",
    "pretypecheck": "node scripts/lib/require-node24.mjs",
    "pretest": "node scripts/lib/require-node24.mjs",
    "preverify": "node scripts/lib/require-node24.mjs",
    "precockpit:build": "node scripts/lib/require-node24.mjs",
    "precockpit:test": "node scripts/lib/require-node24.mjs"
  }
}
```

Create `.npmrc`:

```ini
engine-strict=true
```

Immediately after each hook resolves the repository root, run:

```bash
"${AUTOPILOT_NODE_BIN:-/usr/bin/node}" "$repo_root/scripts/lib/require-node24.mjs"
```

Make `install.mjs` import and call `requireNode24()` before reading Git configuration.

- [ ] **Step 5: Add structural entrypoint assertions**

```ts
it("gates every persistent Git hook before npm or tsx", () => {
  for (const name of ["pre-commit", "pre-push", "commit-msg"]) {
    const text = readFileSync(join(root, "scripts/git-hooks", name), "utf8");
    expect(text.indexOf("require-node24.mjs")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("require-node24.mjs")).toBeLessThan(text.search(/npm|tsx/));
  }
});
```

- [ ] **Step 6: Run GREEN and negative CLI proof**

Run:

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- \
  tests/scripts/node24-runtime-gate.test.ts \
  tests/scripts/pre-push-hook.test.ts \
  tests/operations/systemd-units.test.ts
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run runtime:check
if /usr/bin/node scripts/lib/require-node24.mjs; then
  echo "expected Node 18 refusal" >&2
  exit 1
else
  test "$?" -eq 64
fi
```

Expected: tests PASS; Node 24 gate exits `0`; current host `/usr/bin/node` (Node 18) prints `node24_required` and exits `64`.

- [ ] **Step 7: Commit**

```bash
git add .npmrc package.json scripts/lib/require-node24.mjs scripts/git-hooks tests/scripts tests/operations/systemd-units.test.ts
git commit -m "feat: enforce Node 24 repository entrypoints"
```

---

### Task 2: Define work-unit classes and orchestration budgets

**Files:**
- Create: `src/data/delivery-system/efficiencyPolicy.ts`
- Test: `tests/delivery-system/efficiency-policy.test.ts`

**Interfaces:**
- Produces: `WorkUnitClass`, `WorkUnitRisk`, `WorkUnitDescriptor`, `EfficiencyBudget`, `EfficiencyObservation`, `EfficiencyViolation`, `EfficiencyOverride`.
- Produces: `resolveEfficiencyBudget(descriptor: WorkUnitDescriptor): EfficiencyBudget`.
- Produces: `evaluateEfficiencyBudget(descriptor, observation, override?): readonly EfficiencyViolation[]`.
- Later tasks consume these exact types in telemetry, hooks, and reports.

- [ ] **Step 1: Write failing policy tests**

```ts
import { describe, expect, it } from "vitest";
import { evaluateEfficiencyBudget, resolveEfficiencyBudget } from "../../src/data/delivery-system/efficiencyPolicy";

const ordinary = { work_unit_id: "wu-1", class: "bounded_implementation", risk: "ordinary" } as const;

describe("efficiency policy", () => {
  it("uses the conservative ordinary budget", () => {
    expect(resolveEfficiencyBudget(ordinary)).toEqual({
      max_direct_subagents: 2,
      max_depth: 1,
      max_total_attempts: 2,
      max_reviews: 1,
      max_rereviews: 1,
      context_soft_limit_tokens: 150_000
    });
  });

  it("reports every exceeded dimension", () => {
    expect(evaluateEfficiencyBudget(ordinary, {
      direct_subagents: 3, depth: 2, total_attempts: 3, reviews: 2, rereviews: 2, context_tokens: 160_000,
      attempt_two_delta: null
    }).map((item) => item.code)).toEqual([
      "subagent_budget_exceeded", "recursive_fanout_forbidden", "attempt_budget_exceeded",
      "attempt_delta_missing", "review_budget_exceeded", "rereview_budget_exceeded", "context_checkpoint_required"
    ]);
  });

  it("requires a bounded high-risk override instead of silently allowing expansion", () => {
    const highRisk = { work_unit_id: "wu-2", class: "high_risk", risk: "high" } as const;
    expect(evaluateEfficiencyBudget(highRisk, {
      direct_subagents: 3, depth: 1, total_attempts: 2, reviews: 1, rereviews: 1, context_tokens: 100_000,
      attempt_two_delta: "new invariant test"
    })[0]?.code).toBe("override_required");
  });
});
```

- [ ] **Step 2: Run RED**

Run: `PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/delivery-system/efficiency-policy.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure policy types and evaluator**

```ts
export type WorkUnitClass = "deterministic_check" | "mechanical_change" | "bounded_implementation" | "research_or_design" | "review" | "high_risk";
export type WorkUnitRisk = "ordinary" | "high";
export interface WorkUnitDescriptor { readonly work_unit_id: string; readonly class: WorkUnitClass; readonly risk: WorkUnitRisk; }
export interface EfficiencyBudget { readonly max_direct_subagents: 2; readonly max_depth: 1; readonly max_total_attempts: 2; readonly max_reviews: 1; readonly max_rereviews: 1; readonly context_soft_limit_tokens: 150000; }
export interface EfficiencyObservation { readonly direct_subagents: number; readonly depth: number; readonly total_attempts: number; readonly reviews: number; readonly rereviews: number; readonly context_tokens: number; readonly attempt_two_delta: string | null; }
export interface EfficiencyOverride { readonly risk_trigger: string; readonly expected_assurance: string; readonly stopping_condition: string; }
export interface EfficiencyViolation { readonly code: "subagent_budget_exceeded" | "recursive_fanout_forbidden" | "attempt_budget_exceeded" | "attempt_delta_missing" | "review_budget_exceeded" | "rereview_budget_exceeded" | "context_checkpoint_required" | "override_required"; readonly observed: number | null; readonly limit: number | null; }

const ORDINARY_BUDGET: EfficiencyBudget = { max_direct_subagents: 2, max_depth: 1, max_total_attempts: 2, max_reviews: 1, max_rereviews: 1, context_soft_limit_tokens: 150_000 };
export const resolveEfficiencyBudget = (_descriptor: WorkUnitDescriptor): EfficiencyBudget => ORDINARY_BUDGET;

export function evaluateEfficiencyBudget(descriptor: WorkUnitDescriptor, o: EfficiencyObservation, override?: EfficiencyOverride): readonly EfficiencyViolation[] {
  const b = resolveEfficiencyBudget(descriptor);
  const violations: EfficiencyViolation[] = [];
  const add = (condition: boolean, code: EfficiencyViolation["code"], observed: number | null, limit: number | null) => { if (condition) violations.push({ code, observed, limit }); };
  add(o.direct_subagents > b.max_direct_subagents, "subagent_budget_exceeded", o.direct_subagents, b.max_direct_subagents);
  add(o.depth > b.max_depth, "recursive_fanout_forbidden", o.depth, b.max_depth);
  add(o.total_attempts > b.max_total_attempts, "attempt_budget_exceeded", o.total_attempts, b.max_total_attempts);
  add(o.total_attempts > 1 && !o.attempt_two_delta?.trim(), "attempt_delta_missing", null, null);
  add(o.reviews > b.max_reviews, "review_budget_exceeded", o.reviews, b.max_reviews);
  add(o.rereviews > b.max_rereviews, "rereview_budget_exceeded", o.rereviews, b.max_rereviews);
  add(o.context_tokens >= b.context_soft_limit_tokens, "context_checkpoint_required", o.context_tokens, b.context_soft_limit_tokens);
  if (descriptor.risk === "high" && violations.length > 0 && (!override?.risk_trigger.trim() || !override.expected_assurance.trim() || !override.stopping_condition.trim())) {
    return [{ code: "override_required", observed: null, limit: null }, ...violations];
  }
  return violations;
}
```

- [ ] **Step 4: Run GREEN and typecheck**

Run:

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/delivery-system/efficiency-policy.test.ts
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/delivery-system/efficiencyPolicy.ts tests/delivery-system/efficiency-policy.test.ts
git commit -m "feat: define conservative work unit budgets"
```

---

### Task 3: Build the replay-aware rollout collector

**Files:**
- Create: `src/data/delivery-system/codexRolloutEfficiency.ts`
- Create: `tests/fixtures/codex-efficiency/root.jsonl`
- Create: `tests/fixtures/codex-efficiency/fork-with-replay.jsonl`
- Create: `tests/fixtures/codex-efficiency/truncated.jsonl`
- Test: `tests/delivery-system/codex-rollout-efficiency.test.ts`

**Interfaces:**
- Produces: `TokenUsage`, `RolloutEfficiencyEstimate`, `summarizeCodexRolloutJsonl(text, source): RolloutEfficiencyEstimate`.
- Records only bounded aggregate counters: token events, tool names/counts, subagent/poll/compaction counts, and first/last timestamps.
- Produces no prompt or response fields.
- Task 4 consumes estimates to build window summaries.

- [ ] **Step 1: Add fixtures and failing tests**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeCodexRolloutJsonl } from "../../src/data/delivery-system/codexRolloutEfficiency";

const fixture = (name: string) => readFileSync(join(process.cwd(), "tests/fixtures/codex-efficiency", name), "utf8");

describe("Codex rollout efficiency", () => {
  it("subtracts inherited replay counters before the first current turn", () => {
    const result = summarizeCodexRolloutJsonl(fixture("fork-with-replay.jsonl"), "fork.jsonl");
    expect(result.usage).toEqual({ input_tokens: 40, cached_input_tokens: 30, output_tokens: 5, reasoning_output_tokens: 2 });
    expect(result.replay_events_excluded).toBe(1);
  });

  it("reports truncation without leaking event content", () => {
    const result = summarizeCodexRolloutJsonl(fixture("truncated.jsonl"), "truncated.jsonl");
    expect(result.parse_errors).toBe(1);
    expect(JSON.stringify(result)).not.toContain("private prompt");
  });
});
```

The fork fixture must contain a `session_meta`, an inherited `token_count`, then a current `turn_context`, followed by cumulative token counts that increase by exactly the expected usage.

- [ ] **Step 2: Run RED**

Run: `PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/delivery-system/codex-rollout-efficiency.test.ts`

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement bounded parsing and positive counter deltas**

```ts
export interface TokenUsage { readonly input_tokens: number; readonly cached_input_tokens: number; readonly output_tokens: number; readonly reasoning_output_tokens: number; }
export interface RolloutEfficiencyEstimate {
  readonly source: string; readonly root_session_id: string | null; readonly thread_source: string;
  readonly usage: TokenUsage; readonly token_events: number; readonly turn_count: number;
  readonly tool_calls: number; readonly tool_call_counts: Readonly<Record<string, number>>;
  readonly subagent_calls: number; readonly poll_calls: number; readonly compactions: number;
  readonly started_at: string | null; readonly ended_at: string | null; readonly total_wall_ms: number | null;
  readonly replay_events_excluded: number; readonly parse_errors: number;
  readonly coverage: "estimated" | "insufficient_evidence";
}

const zero = (): TokenUsage => ({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 });
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const usage = (value: any): TokenUsage => ({ input_tokens: number(value?.input_tokens), cached_input_tokens: number(value?.cached_input_tokens), output_tokens: number(value?.output_tokens), reasoning_output_tokens: number(value?.reasoning_output_tokens) });
const delta = (before: TokenUsage, after: TokenUsage): TokenUsage => ({
  input_tokens: Math.max(0, after.input_tokens - before.input_tokens),
  cached_input_tokens: Math.max(0, after.cached_input_tokens - before.cached_input_tokens),
  output_tokens: Math.max(0, after.output_tokens - before.output_tokens),
  reasoning_output_tokens: Math.max(0, after.reasoning_output_tokens - before.reasoning_output_tokens)
});

export function summarizeCodexRolloutJsonl(text: string, source: string): RolloutEfficiencyEstimate {
  const events: any[] = []; let parseErrors = 0;
  for (const line of text.split(/\r?\n/)) { if (!line.trim()) continue; try { events.push(JSON.parse(line)); } catch { parseErrors += 1; } }
  const meta = events.find((event) => event?.type === "session_meta")?.payload;
  const firstTurn = events.findIndex((event) => event?.type === "turn_context");
  const counters = events.map((event, index) => ({ event, index })).filter(({ event }) => event?.type === "event_msg" && event?.payload?.type === "token_count" && event?.payload?.info?.total_token_usage);
  const baseline = usage(counters.filter(({ index }) => firstTurn < 0 || index < firstTurn).at(-1)?.event?.payload?.info?.total_token_usage);
  const final = usage(counters.filter(({ index }) => firstTurn >= 0 && index > firstTurn).at(-1)?.event?.payload?.info?.total_token_usage);
  const measured = delta(baseline, final);
  const calls = events.filter((event) => event?.type === "response_item" && event?.payload?.type === "function_call");
  const toolCallCounts = calls.reduce<Record<string, number>>((out, event) => {
    const name = typeof event.payload.name === "string" ? event.payload.name : "unknown";
    out[name] = (out[name] ?? 0) + 1; return out;
  }, {});
  const timestamps = events.map((event) => Date.parse(event?.timestamp)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    source, root_session_id: typeof meta?.session_id === "string" ? meta.session_id : null,
    thread_source: typeof meta?.thread_source === "string" ? meta.thread_source : "unknown", usage: measured,
    token_events: counters.filter(({ index }) => firstTurn >= 0 && index > firstTurn).length,
    turn_count: events.filter((event) => event?.type === "turn_context").length,
    tool_calls: calls.length, tool_call_counts: toolCallCounts,
    subagent_calls: ["spawn_agent", "followup_task"].reduce((sum, name) => sum + (toolCallCounts[name] ?? 0), 0),
    poll_calls: ["wait", "wait_agent", "write_stdin"].reduce((sum, name) => sum + (toolCallCounts[name] ?? 0), 0),
    compactions: events.filter((event) => event?.type === "compacted" || (event?.type === "event_msg" && event?.payload?.type === "context_compacted")).length,
    started_at: timestamps.length ? new Date(timestamps[0]).toISOString() : null,
    ended_at: timestamps.length ? new Date(timestamps.at(-1)!).toISOString() : null,
    total_wall_ms: timestamps.length > 1 ? timestamps.at(-1)! - timestamps[0] : null,
    replay_events_excluded: counters.filter(({ index }) => firstTurn < 0 || index < firstTurn).length,
    parse_errors: parseErrors, coverage: firstTurn >= 0 && counters.length > 0 ? "estimated" : "insufficient_evidence"
  };
}
```

- [ ] **Step 4: Run GREEN and privacy assertions**

Run:

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/delivery-system/codex-rollout-efficiency.test.ts
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run typecheck
```

Expected: PASS; serialized estimates contain no fixture prompt or response text.

- [ ] **Step 5: Commit**

```bash
git add src/data/delivery-system/codexRolloutEfficiency.ts tests/fixtures/codex-efficiency tests/delivery-system/codex-rollout-efficiency.test.ts
git commit -m "feat: measure replay-aware Codex rollout usage"
```

---

### Task 4: Add work-unit reports and acceptance comparison

**Files:**
- Create: `src/data/delivery-system/efficiencyReport.ts`
- Create: `scripts/codex-efficiency-report.ts`
- Modify: `package.json`
- Test: `tests/scripts/codex-efficiency-report.test.ts`

**Interfaces:**
- Consumes: `RolloutEfficiencyEstimate` and `WorkUnitDescriptor`.
- Produces: `WorkUnitRecord`, `EfficiencyReportV1`, `compareEfficiencyWindows(baseline, candidate): EfficiencyComparison`.
- CLI: `npm run efficiency:report -- --sessions DIR --work-units MAP.json --since 7d --json`.
- CLI: `npm run efficiency:compare -- --baseline baseline.json --candidate candidate.json --json`.

- [ ] **Step 1: Write failing report tests**

```ts
it("requires matched sample sizes and a 30 percent median reduction", () => {
  const result = compareEfficiencyWindows(baselineFixture(), candidateFixture());
  expect(result).toMatchObject({ status: "accepted", median_reduction_pct: 30, ordinary_samples: 20, high_risk_samples: 5 });
});

it("returns insufficient evidence instead of success", () => {
  expect(compareEfficiencyWindows(baselineFixture(), candidateFixture({ ordinary: 19 })).status).toBe("insufficient_evidence");
});

it("rejects a Critical or High escape even when tokens improve", () => {
  expect(compareEfficiencyWindows(baselineFixture(), candidateFixture({ escaped_high: 1 })).status).toBe("quality_regression");
});
```

- [ ] **Step 2: Run RED**

Run: `PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/scripts/codex-efficiency-report.test.ts`

Expected: FAIL because report functions and scripts do not exist.

- [ ] **Step 3: Implement the complete aggregate report contract and exact acceptance logic**

```ts
export interface WorkUnitRecord {
  readonly source: string;
  readonly descriptor: WorkUnitDescriptor;
  readonly status: "completed" | "incomplete";
  readonly first_pass_accepted: boolean;
  readonly escaped_severity: "critical" | "high" | "lower" | null;
  readonly retry_exhausted: boolean;
}

export interface EfficiencyReportV1 {
  readonly schema_version: "autopilot-codex-efficiency-report-v1";
  readonly generated_at: string;
  readonly window: { readonly since: string; readonly until: string };
  readonly coverage: "estimated" | "provider_authoritative" | "insufficient_evidence";
  readonly contains_raw_content: false;
  readonly samples: { readonly ordinary: number; readonly high_risk: number; readonly completed: number };
  readonly tokens: { readonly median_per_completed: number; readonly cached_input: number; readonly uncached_input: number; readonly output: number; readonly reasoning_output: number };
  readonly context: { readonly input_p50: number; readonly input_p90: number };
  readonly orchestration: { readonly model_calls: number; readonly tool_calls: number; readonly poll_calls: number; readonly subagent_calls: number; readonly compactions: number; readonly total_wall_ms: number | null };
  readonly quality: { readonly first_pass_acceptance_pct: number; readonly escaped_critical: number; readonly escaped_high: number; readonly retry_exhausted: number; readonly incomplete: number };
  readonly classes: Readonly<Record<WorkUnitClass, { readonly completed: number; readonly median_tokens: number | null }>>;
}

export interface EfficiencyComparison { readonly status: "accepted" | "insufficient_evidence" | "quality_regression" | "savings_below_target"; readonly median_reduction_pct: number | null; readonly ordinary_samples: number; readonly high_risk_samples: number; readonly reasons: readonly string[]; }

export function compareEfficiencyWindows(baseline: EfficiencyReportV1, candidate: EfficiencyReportV1): EfficiencyComparison {
  const reasons: string[] = [];
  if (candidate.samples.ordinary < 20 || candidate.samples.high_risk < 5) reasons.push("minimum_sample_not_met");
  if (candidate.quality.escaped_critical + candidate.quality.escaped_high > 0) reasons.push("escaped_critical_or_high");
  if (baseline.quality.first_pass_acceptance_pct - candidate.quality.first_pass_acceptance_pct > 2) reasons.push("first_pass_acceptance_regressed");
  if (candidate.context.input_p90 >= 150_000) reasons.push("context_p90_above_limit");
  const reduction = baseline.tokens.median_per_completed === 0 ? null : Math.round((1 - candidate.tokens.median_per_completed / baseline.tokens.median_per_completed) * 10_000) / 100;
  if (reasons.includes("minimum_sample_not_met") || reduction === null) return { status: "insufficient_evidence", median_reduction_pct: reduction, ordinary_samples: candidate.samples.ordinary, high_risk_samples: candidate.samples.high_risk, reasons };
  if (reasons.some((reason) => reason.includes("escaped") || reason.includes("regressed"))) return { status: "quality_regression", median_reduction_pct: reduction, ordinary_samples: candidate.samples.ordinary, high_risk_samples: candidate.samples.high_risk, reasons };
  if (reduction < 30 || reasons.length > 0) return { status: "savings_below_target", median_reduction_pct: reduction, ordinary_samples: candidate.samples.ordinary, high_risk_samples: candidate.samples.high_risk, reasons };
  return { status: "accepted", median_reduction_pct: reduction, ordinary_samples: candidate.samples.ordinary, high_risk_samples: candidate.samples.high_risk, reasons: [] };
}
```

Export `buildEfficiencyReport(input: { estimates: readonly RolloutEfficiencyEstimate[]; workUnits: readonly WorkUnitRecord[]; since: string; until: string; generatedAt: string }): EfficiencyReportV1`. Join only by the explicit source-to-work-unit map, calculate percentiles with a deterministic nearest-rank function, derive uncached input as `max(0, input - cached_input)`, and aggregate by work-unit class. Before serialization, recursively reject any output key matching `/prompt|response|secret|environment|tool_payload/i`. A missing map, missing counters, or zero completed samples sets `coverage: "insufficient_evidence"`.

- [ ] **Step 4: Add package commands**

```json
{
  "scripts": {
    "efficiency:report": "tsx scripts/codex-efficiency-report.ts report",
    "efficiency:compare": "tsx scripts/codex-efficiency-report.ts compare"
  }
}
```

- [ ] **Step 5: Run GREEN and deterministic snapshot**

Run:

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/scripts/codex-efficiency-report.test.ts
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run efficiency:report -- --sessions tests/fixtures/codex-efficiency --work-units tests/fixtures/codex-efficiency/work-units.json --since 7d --json
```

Expected: PASS and stable aggregate-only JSON.

- [ ] **Step 6: Commit**

```bash
git add package.json src/data/delivery-system/efficiencyReport.ts scripts/codex-efficiency-report.ts tests/scripts/codex-efficiency-report.test.ts tests/fixtures/codex-efficiency
git commit -m "feat: report Codex efficiency acceptance metrics"
```

---

### Task 5: Record work-unit and shadow-routing telemetry

**Files:**
- Modify: `src/data/delivery-system/sessionState.ts`
- Create: `src/data/delivery-system/efficiencyTelemetry.ts`
- Modify: `src/governed-core/dispatch.ts`
- Modify: `src/data/delivery-system/runOrchestrator.ts`
- Modify: `scripts/telemetry-summary.ts`
- Test: `tests/governed-core/dispatch-telemetry.test.ts`
- Test: `tests/scripts/telemetry-summary.test.ts`

**Interfaces:**
- Adds optional `efficiency?: { work_unit: WorkUnitDescriptor; actual_reasoning_effort: string | null; recommended_model: null; recommended_reasoning_effort: null }` to `GovernedHandoff`.
- Produces `EFFICIENCY_TELEMETRY_PATH = "docs/autopilot/session-state/efficiency-events.jsonl"`.
- Produces `EfficiencyTelemetryEventV1`; recommendations are structurally present and always `null` in stage one.

- [ ] **Step 1: Write RED telemetry tests**

```ts
expect(readJsonl(stateDir, EFFICIENCY_TELEMETRY_PATH)[0]).toMatchObject({
  schema_version: "v1",
  work_unit_id: "wu-dispatch-1",
  work_unit_class: "bounded_implementation",
  risk: "ordinary",
  actual_model: "gpt-5.6-sol",
  actual_reasoning_effort: "medium",
  recommended_model: null,
  recommended_reasoning_effort: null,
  routing_mode: "shadow_only"
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- \
  tests/governed-core/dispatch-telemetry.test.ts tests/scripts/telemetry-summary.test.ts
```

Expected: FAIL because the efficiency event path and fields do not exist.

- [ ] **Step 3: Implement the append-only aggregate event**

```ts
export interface EfficiencyTelemetryEventV1 {
  readonly schema_version: "v1"; readonly recorded_at: string; readonly work_unit_id: string;
  readonly work_unit_class: WorkUnitClass; readonly risk: WorkUnitRisk; readonly handoff_id: string;
  readonly actual_model: string | null; readonly actual_reasoning_effort: string | null;
  readonly recommended_model: null; readonly recommended_reasoning_effort: null;
  readonly routing_mode: "shadow_only"; readonly status: "started" | "completed" | "refused" | "failed";
  readonly total_attempts: number; readonly attempt_delta_recorded: boolean;
}
```

Use the existing bounded JSONL append pattern. Never add `task`, `prompt`, `rawOutput`, or error text to this event.

- [ ] **Step 4: Wire dispatch without changing routing**

When `handoff.efficiency` exists, append `started` before `runCliWorker` and one terminal event afterward. Copy `handoff.model` and the declared current reasoning effort as actual values. Hard-code recommendation fields to `null`; do not call `buildSupervisorRoutingDecision` for a recommendation in this stage.

- [ ] **Step 5: Extend telemetry summary**

Add work-unit counts, attempts, model/effort observation, and coverage status. Keep the existing vendor and dispatch summaries backward compatible.

- [ ] **Step 6: Run GREEN**

Run:

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- \
  tests/governed-core/dispatch-telemetry.test.ts tests/scripts/telemetry-summary.test.ts
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run typecheck
```

Expected: PASS; stage-one tests assert both recommendation fields remain `null`.

- [ ] **Step 7: Commit**

```bash
git add src/data/delivery-system/sessionState.ts src/data/delivery-system/efficiencyTelemetry.ts src/governed-core/dispatch.ts src/data/delivery-system/runOrchestrator.ts scripts/telemetry-summary.ts tests/governed-core/dispatch-telemetry.test.ts tests/scripts/telemetry-summary.test.ts
git commit -m "feat: record shadow-only efficiency telemetry"
```

---

### Task 6: Unify routine retry and hook escalation budgets

**Files:**
- Modify: `src/data/delivery-system/supervisorQueue.ts`
- Modify: `src/data/delivery-system/runOrchestrator.ts`
- Modify: `src/data/delivery-system/cliWorker.ts`
- Modify: `src/data/delivery-system/cliWorkerCapture.ts`
- Modify: `.codex/hooks/autopilot-hook.mjs`
- Test: `tests/delivery-system/supervisor-queue.test.ts`
- Test: `tests/delivery-system/run-orchestrator.test.ts`
- Test: `tests/delivery-system/cli-worker-retry.test.ts`
- Create: `tests/scripts/autopilot-hook-efficiency.test.ts`

**Interfaces:**
- Ordinary supervisor default becomes exactly `2` total attempts.
- Adds `attemptDelta?: string` to `SupervisorQueue.retry`/`fail` and `supervisorOwnsRetry?: boolean` to the bounded handoff/worker path.
- `supervisorOwnsRetry = true` forces Codex capture retries to `0`; the supervisor owns the two-attempt budget.
- Produces `shouldQueueInvestigator({ failed, flags, recentFailureCount }): boolean` in the hook module.

- [ ] **Step 1: Write RED tests for the shared attempt ceiling**

```ts
it("defaults ordinary supervisor work to two total attempts", () => {
  const queued = q.enqueue({ taskId: "a", handoff: handoff("hp-a"), now: at });
  expect(queued.max_attempts).toBe(2);
});

it("requires a material delta before attempt two", () => {
  q.claim(at);
  expect(() => q.retry("a", "same input", later, { attemptDelta: "" })).toThrow(/attempt_delta_missing/);
});

it("does not multiply capture retries under supervisor ownership", async () => {
  await captureCodex({ ...options, retries: 1, supervisorOwnsRetry: true });
  expect(spawn).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Write RED tests for hook narrowing**

```ts
it("does not queue an investigator for one ordinary failed command", () => {
  expect(shouldQueueInvestigator({ failed: true, flags: ["tool_result_failed"], recentFailureCount: 1 })).toBe(false);
});

it.each(["remote_mutation", "secret_like_input", "credential_surface"])("queues immediately for %s", (flag) => {
  expect(shouldQueueInvestigator({ failed: true, flags: [flag], recentFailureCount: 1 })).toBe(true);
});

it("queues after the second ordinary failure", () => {
  expect(shouldQueueInvestigator({ failed: true, flags: ["tool_result_failed"], recentFailureCount: 2 })).toBe(true);
});
```

- [ ] **Step 3: Run RED**

Run:

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- \
  tests/delivery-system/supervisor-queue.test.ts \
  tests/delivery-system/run-orchestrator.test.ts \
  tests/delivery-system/cli-worker-retry.test.ts \
  tests/scripts/autopilot-hook-efficiency.test.ts
```

Expected: FAIL on the old three-attempt default, nested retry, and unconditional investigator queue.

- [ ] **Step 4: Implement one owner for retry**

Change `boundedIntegerInput(input.maxAttempts, 3, 1, MAX_ATTEMPTS)` to default `2`. Change the retry signature to `retry(taskId, reason?, now?, options?: { attemptDelta?: string })`; `fail` passes the same option through when it requeues. Before creating attempt two, require a non-empty delta and persist only `attempt_delta_hash: sha256(delta.trim())` on the task, never raw delta text. Pass `supervisorOwnsRetry: true` from governed dispatch and resolve capture attempts as:

```ts
const maxAttempts = opts.supervisorOwnsRetry ? 1 : Math.max(1, (opts.retries ?? 1) + 1);
```

Timeout, auth, and explicit non-retryable failures remain non-retryable.

- [ ] **Step 5: Narrow hook amplification and compaction output**

```js
export function shouldQueueInvestigator({ failed, flags, recentFailureCount }) {
  if (!failed) return false;
  if (flags.some((flag) => ["remote_mutation", "secret_like_input", "credential_surface", "destructive_command"].includes(flag))) return true;
  return recentFailureCount >= 2;
}
```

Replace the PostCompact message with:

```text
Autopilot compaction completed. Read the saved continuity pointer and only the AGENTS.md section or mesh must_read entries needed for the active work unit.
```

- [ ] **Step 6: Run GREEN and regression suites**

Run:

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- \
  tests/delivery-system/supervisor-queue.test.ts \
  tests/delivery-system/run-orchestrator.test.ts \
  tests/delivery-system/cli-worker-retry.test.ts \
  tests/scripts/autopilot-hook-efficiency.test.ts \
  tests/delivery-system/cli-worker-safety.test.ts
```

Expected: PASS; no provider call is made by tests.

- [ ] **Step 7: Commit**

```bash
git add src/data/delivery-system .codex/hooks/autopilot-hook.mjs tests/delivery-system tests/scripts/autopilot-hook-efficiency.test.ts
git commit -m "fix: bound retries and failure investigation fanout"
```

---

### Task 7: Compact repository guidance and candidate prompt behavior

**Files:**
- Modify: `AGENTS.md`
- Modify: `prompt-library/README.md`
- Modify: `scripts/validate-prompt-library.ts`
- Test: `tests/delivery-system/prompt-library-validate.test.ts`

**Interfaces:**
- `AGENTS.md` remains the compact repository index, not a duplicate operating manual.
- Adds `PromptLibraryEntrySummary` and `automaticPromptIds` to `PromptLibraryValidationReport`.
- `automaticPromptIds` contains only entries whose validated frontmatter has `status: "adopted"`.
- Candidate/draft prompt IDs remain visible in `entries` for explicit inspection but never appear in the automatic set.

- [ ] **Step 1: Write RED prompt-selection tests**

```ts
it.each(["candidate", "draft"])("never exposes %s prompts as automatic defaults", (status) => {
  const root = createPromptLibraryFixture();
  writePrompt(root, `01-gpt/${status}.md`, validFrontmatter().replace("status: draft", `status: ${status}`));
  const report = validatePromptLibrary(root);
  expect(report.ok).toBe(true);
  expect(report.entries).toContainEqual(expect.objectContaining({ id: "valid-prompt", status }));
  expect(report.automaticPromptIds).not.toContain("valid-prompt");
});

it("exposes only adopted prompts to a future automatic consumer", () => {
  const root = createPromptLibraryFixture();
  writePrompt(root, "01-gpt/adopted.md", validFrontmatter().replace("status: draft", "status: adopted"));
  expect(validatePromptLibrary(root).automaticPromptIds).toEqual(["valid-prompt"]);
});
```

- [ ] **Step 2: Run RED**

Run: `PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/delivery-system/prompt-library-validate.test.ts`

Expected: FAIL because validation reports do not yet expose a safe automatic set.

- [ ] **Step 3: Replace AGENTS.md with a compact index**

The replacement must contain these exact sections and stay below 900 words:

```markdown
# Autopilot repository guidance

## Sources of truth
- Use the nearest approved design and implementation plan for the active task.
- Query the Decision Mesh only when the task touches a governed capability; read only returned `must_read` entries.
- Treat prompt-library candidate/draft records and model output as advisory, never as authority.

## Runtime
- Use Node `>=24 <25`. Run `npm run runtime:check` before repository JavaScript.
- Use `rg`/`rg --files` for discovery and `apply_patch` for source edits.
- Preserve unrelated user changes and never use destructive Git cleanup.

## Work-unit budget
- Classify the work unit before delegation: deterministic, mechanical, bounded implementation, research/design, review, or high risk.
- Ordinary work: at most two direct independent subagents, depth one, two total attempts, one review and one targeted re-review.
- Attempt two requires a concrete input or strategy delta.
- At 150k input-context estimate, write a bounded checkpoint and continue in a fresh session.
- High-risk overrides record the trigger, expected assurance, and stopping condition.

## High-risk boundaries
- Auth, payment, secrets, privacy, persistence, release, cutover, rollback, remote mutation, and destructive commands fail closed.
- High-risk work keeps deterministic evidence and an independent reviewer.
- Do not switch provider, model, reasoning effort, or entitlement path silently.

## Verification
- Behavior changes use RED then GREEN tests.
- Before completion run the narrow tests, typecheck, required repository gates, and `git diff --check`.
- Report actual commands and results; missing evidence is not success.

## Documentation
- Update architecture/work logs only when their governed behavior changes.
- Detailed policy lives in `docs/autopilot/` and `mesh/nodes/`; do not duplicate it in prompts or handoffs.
```

- [ ] **Step 4: Implement adopted-only inventory and README wording**

While validating frontmatter, collect only `{ id, status, file }` after schema validation. Return the sorted summaries as `entries` and return `automaticPromptIds` as the sorted IDs whose status is exactly `adopted`. Do not read or return prompt bodies. README states that all current candidate/draft prompts require explicit use and that any future automatic consumer must use `automaticPromptIds`, never scan Markdown directly.

- [ ] **Step 5: Run GREEN, word-count, and mesh tests**

Run:

```bash
test "$(wc -w < AGENTS.md)" -le 900
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/delivery-system/prompt-library-validate.test.ts tests/decision-mesh/query.test.ts
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run promptlib:validate
```

Expected: PASS and candidate/draft automatic selection is impossible.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md prompt-library/README.md scripts/validate-prompt-library.ts tests/delivery-system/prompt-library-validate.test.ts
git commit -m "docs: compact Autopilot agent guidance"
```

---

### Task 8: Add a reversible personal Codex efficiency profile

**Files:**
- Create: `ops/codex-efficiency/default-skill-profile.json`
- Create: `scripts/codex-efficiency-profile.mjs`
- Test: `tests/scripts/codex-efficiency-profile.test.ts`
- Modify: `docs/operations/service-runbook.md`

**Interfaces:**
- CLI: `node scripts/codex-efficiency-profile.mjs plan --home DIR` (read-only).
- CLI: `node scripts/codex-efficiency-profile.mjs apply --home DIR` (atomic backup and CAS apply).
- CLI: `node scripts/codex-efficiency-profile.mjs rollback --home DIR --backup FILE` (CAS rollback).
- The manifest selects logical plugin prefixes and exact Superpowers skill names; the applicator resolves current absolute `SKILL.md` paths and refuses missing/ambiguous paths.

- [ ] **Step 1: Write RED fake-home tests**

```ts
it("plans removal of Fast without changing model or reasoning", () => {
  const plan = runProfile("plan", fakeHome());
  expect(plan).toMatchObject({ remove_service_tier_fast: true, model_changed: false, reasoning_changed: false });
});

it("applies atomically and records a mode-0600 backup", () => {
  const result = runProfile("apply", fakeHome());
  expect(readFileSync(configPath, "utf8")).not.toContain('service_tier = "fast"');
  expect(statSync(result.backup).mode & 0o777).toBe(0o600);
});

it("refuses rollback after foreign config modification", () => {
  const applied = runProfile("apply", fakeHome());
  appendFileSync(configPath, "# foreign\n");
  expect(() => runProfile("rollback", fakeHome(), applied.backup)).toThrow(/config_cas_mismatch/);
});
```

- [ ] **Step 2: Run RED**

Run: `PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/scripts/codex-efficiency-profile.test.ts`

Expected: FAIL because the manifest and applicator do not exist.

- [ ] **Step 3: Create the conservative manifest**

```json
{
  "version": "autopilot-codex-efficiency-profile-v1",
  "remove_exact_service_tier": "service_tier = \"fast\"",
  "disable_plugin_prefixes": [
    "atlassian-rovo", "base44", "canva", "cloudflare", "creative-production",
    "data-analytics", "build-web-data-visualization", "figma", "google-drive",
    "hugging-face", "investment-banking", "linear", "nvidia", "openai-templates",
    "public-equity-investing", "remotion", "sales", "sharepoint", "teams"
  ],
  "disable_exact_skills": [
    "superpowers/using-superpowers/SKILL.md",
    "superpowers/brainstorming/SKILL.md"
  ]
}
```

Keep system skills, build-web-apps, codex-security, GitHub, OpenAI Developers, Product Design, and the narrow Superpowers verification/debugging/TDD/execution skills. Disabled domains are re-enabled only by explicit profile change and restart.

- [ ] **Step 4: Implement fail-closed plan/apply/rollback**

The applicator must:

1. require Node 24;
2. require Codex CLI `>=0.144.4` using `codex --version`;
3. find exactly one base `config.toml` and resolve every selected current skill path;
4. refuse existing Autopilot profile markers, duplicate Fast lines, missing skill paths, symlinks, or non-user-owned config;
5. write a mode-0600 timestamped backup and its SHA-256;
6. remove only the exact Fast line;
7. append a marked block of documented `[[skills.config]]`, absolute `path`, and `enabled = false` entries;
8. fsync the temporary file, atomically rename it, and fsync the parent;
9. emit old/new hashes and restart-required status without printing other config values;
10. rollback only when the live hash equals the recorded applied hash.

The script must not edit model or reasoning keys.

- [ ] **Step 5: Run GREEN and real-home plan only**

Run:

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/scripts/codex-efficiency-profile.test.ts
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH node scripts/codex-efficiency-profile.mjs plan --home /home/radek/.codex
```

Expected: tests PASS; real-home command reports a plan only and performs no write.

- [ ] **Step 6: Commit before applying personal configuration**

```bash
git add ops/codex-efficiency scripts/codex-efficiency-profile.mjs tests/scripts/codex-efficiency-profile.test.ts docs/operations/service-runbook.md
git commit -m "feat: add reversible Codex efficiency profile"
```

- [ ] **Step 7: Apply with explicit owner-visible checkpoint**

Before this step, show the plan output and backup destination to the owner. After confirmation:

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH node scripts/codex-efficiency-profile.mjs apply --home /home/radek/.codex
```

Expected: Fast line removed, marked skill-disable block added, model/reasoning hashes unchanged, backup path printed, and `restart_required=true`. Start a new Codex session before claiming the catalog is reduced.

---

### Task 9: Run shadow rollout, acceptance gate, and routing handoff

**Files:**
- Create: `docs/operations/codex-efficiency-runbook.md`
- Create: `docs/autopilot/codex-efficiency-baseline-2026-07-15.json`
- Modify: `docs/projects/autopilot-control-plane/architecture.md`
- Modify: `docs/projects/autopilot-control-plane/work-log.md`
- Modify: `mesh/nodes/context_economy_policy.yaml`
- Modify: `mesh/nodes/model_spend_policy.yaml`
- Test: `tests/scripts/codex-efficiency-documentation.test.ts`

**Interfaces:**
- Consumes: `efficiency:report`, `efficiency:compare`, profile backup/apply output, and aggregate work-unit records.
- Produces an immutable baseline record labeled `estimated` and a later candidate comparison.
- Produces the explicit input contract for the separate routing design; it does not activate routing.

- [ ] **Step 1: Write RED documentation-contract tests**

```ts
it("documents every acceptance and rollback gate", () => {
  const text = readFileSync("docs/operations/codex-efficiency-runbook.md", "utf8");
  for (const required of ["30 percent", "150k", "20 ordinary", "5 high-risk", "Critical", "High", "rollback", "insufficient_evidence", "routing remains shadow-only"]) {
    expect(text).toContain(required);
  }
});
```

- [ ] **Step 2: Run RED**

Run: `PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm test -- tests/scripts/codex-efficiency-documentation.test.ts`

Expected: FAIL because the runbook does not exist.

- [ ] **Step 3: Generate and validate the historical baseline**

Run the collector against `/home/radek/.codex/sessions` for 2026-07-10 through 2026-07-15 with an explicit work-unit map. Commit only aggregate output. The JSON must include:

```json
{
  "schema_version": "autopilot-codex-efficiency-baseline-v1",
  "coverage": "estimated",
  "contains_raw_content": false,
  "method": "replay-aware-positive-counter-delta",
  "limitations": ["forked rollout counters are not provider billing records", "provider-authoritative telemetry unavailable"]
}
```

- [ ] **Step 4: Document the staged operating procedure**

The runbook must define work-unit start/completion, risk override, checkpoint, one-review/one-rereview rule, daily report, profile rollback, and the rule that routing fields remain null/shadow-only.

- [ ] **Step 5: Run the shadow sample**

Collect at least 20 ordinary and 5 high-risk work units. Do not manufacture work or weaken verification to reach the sample. Until the minimum is reached, `efficiency:compare` must return `insufficient_evidence`.

- [ ] **Step 6: Evaluate and decide**

Run:

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run efficiency:compare -- \
  --baseline docs/autopilot/codex-efficiency-baseline-2026-07-15.json \
  --candidate /home/radek/.local/state/autopilot/efficiency/current.json \
  --json
```

Expected before enough data: `insufficient_evidence`. Expected for stage-one acceptance: `accepted`, reduction `>=30`, p90 `<150000`, no Critical/High escape, and first-pass degradation `<=2` points.

- [ ] **Step 7: Verify the complete foundation**

Run:

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run verify
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run cockpit:test
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run cockpit:build
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH npm run efficiency:report -- --sessions /home/radek/.codex/sessions --since 7d --json
git diff --check
```

Expected: repository gates PASS; report contains aggregates only.

- [ ] **Step 8: Independent review**

Request one independent review of the fixed diff and evidence. Permit one targeted re-review if actionable findings require changes. A third cycle requires the documented high-risk exception.

- [ ] **Step 9: Commit documentation and baseline**

```bash
git add docs/operations/codex-efficiency-runbook.md docs/autopilot/codex-efficiency-baseline-2026-07-15.json docs/projects/autopilot-control-plane/architecture.md docs/projects/autopilot-control-plane/work-log.md mesh/nodes/context_economy_policy.yaml mesh/nodes/model_spend_policy.yaml tests/scripts/codex-efficiency-documentation.test.ts
git commit -m "docs: establish Codex efficiency operating baseline"
```

- [ ] **Step 10: Open the separate routing design only after acceptance**

The routing design receives aggregate class outcomes, actual model/effort observations, null shadow fields, escalation triggers, and quality results. It must verify currently supported model IDs and reasoning levels, begin with shadow recommendations, and require non-inferiority before activating any class.

---

## Final verification checklist

- [ ] Node 24 succeeds and Node 18/25 refuse before application imports.
- [ ] Collector tests cover root, fork replay, resume, compaction, truncation, and missing counters.
- [ ] No generated aggregate contains prompt, response, secret, environment, or raw tool payload fields.
- [ ] Ordinary budgets are two subagents, depth one, two attempts, one review, and one targeted re-review.
- [ ] High-risk expansion requires all three override fields.
- [ ] Retry ownership cannot multiply two capture attempts by multiple supervisor attempts.
- [ ] One ordinary failed tool does not create an investigator; repeated or safety-relevant failure does.
- [ ] Automatic prompt selection rejects all candidate/draft entries.
- [ ] Personal profile changes neither model nor reasoning and has a tested CAS rollback.
- [ ] Fast mode is removed only after owner-visible plan output.
- [ ] Routing recommendation fields remain null/shadow-only.
- [ ] Complete Node 24 repository verification and independent review pass.
- [ ] The 30 percent claim is made only after the matched sample gate reports `accepted`.
