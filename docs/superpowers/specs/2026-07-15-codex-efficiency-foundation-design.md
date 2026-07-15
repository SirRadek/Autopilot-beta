# Codex efficiency foundation — design

Date: 2026-07-15
Status: owner-approved design
Scope: conservative efficiency foundation before model/reasoning routing

## 1. Decision

Reduce median token consumption per completed, like-for-like work unit by at least 30 percent without changing the default model, reasoning effort, provider, required deterministic verification, or high-risk review standard.

The first stage is guardrails-first. It removes orchestration waste, enforces Node 24, narrows always-on instructions and skills, and produces trustworthy efficiency telemetry. Model and reasoning routing is a separate follow-up design that may begin only after the first stage has enough quality and cost evidence.

No experimental provider, unverified model identifier, automatic model switch, or speculative fallback belongs in this stage.

## 2. Evidence and problem statement

The 2026-07-10 through 2026-07-15 local Codex audit found:

- 172 rollout files associated with five long root-session families and 167 subagent rollouts;
- approximately 1.462 billion replay-adjusted input-plus-output tokens across recorded usage events;
- 97.1 percent of input tokens reported as cached input;
- input context p50 approximately 106k, p90 approximately 210k, and p99 approximately 293k tokens;
- 11,481 recorded tool calls, including 2,499 polling/wait calls;
- 16 repeated Task 4 review/fix/re-review sessions in addition to the main implementation session;
- a global Codex default of `service_tier = "fast"`, `gpt-5.6-sol`, and `model_reasoning_effort = "medium"`;
- 25 installed plugin bundles and 261 skill documents, with roughly 157 skills advertised in the active session;
- a 1,829-word repository `AGENTS.md`, plus overlapping mesh, prompt, hook, skill, and operating-model policy;
- no usable project `cli-call-telemetry.jsonl` or `dispatch-decisions.jsonl`, despite code paths and a summary schema that expect them.

The token total is an analytical estimate, not a billing total. Forked rollout files inherit and replay parent history, so raw cumulative counters double-count. The audit excluded the initial replay burst and aggregated recorded per-call usage. Provider price and credit consumption cannot be reconstructed because provider telemetry is absent.

The primary failure mode is orchestration amplification: long-lived near-full contexts, excessive fan-out, repeated whole-diff reviews, duplicated instructions, and uncoordinated retry layers. Output verbosity is secondary.

## 3. Goals

1. Enforce Node major version 24 before repository or production JavaScript executes.
2. Establish replay-aware, privacy-preserving efficiency telemetry.
3. Bound ordinary context growth, subagent fan-out, retries, and review loops.
4. Keep high-risk release, security, authentication, persistence, payment, and rollback work fully protected.
5. Reduce always-advertised skills and always-loaded repository instructions.
6. Achieve at least a 30 percent median token reduction within comparable work classes.
7. Preserve a stable data seam for later model and reasoning routing.

## 4. Non-goals

- Changing the default Codex model or reasoning effort.
- Introducing a new model, provider, API, entitlement, or automatic fallback.
- Enforcing the currently advisory Autopilot model policy as a live router.
- Deleting historical sessions, prompts, evidence, or review artifacts.
- Weakening deterministic tests, release acceptance, or security review.
- Treating cached tokens as free or ignoring them in efficiency measurement.
- Replacing a proven high-risk review with a small model.

## 5. Work-unit taxonomy

Every measured operation has a `work_unit_id` and one class:

| Class | Examples | Default supervision |
| --- | --- | --- |
| `deterministic_check` | `rg`, schema validation, typecheck, tests, build, diff check | tools only; model only for ambiguous failure analysis |
| `mechanical_change` | narrow fixture, DTO, typo, bounded documentation edit | one implementer context and deterministic verification |
| `bounded_implementation` | small multi-file feature or refactor | one implementer; optional one reviewer when risk triggers match |
| `research_or_design` | source-backed research, architecture choices, design specification | one synthesis thread; bounded independent perspectives only when materially distinct |
| `review` | correctness, regression, or acceptance review | one fixed review package and one decision-producing reviewer |
| `high_risk` | auth, payment, security, privacy, persistence, release, cutover, rollback | strongest existing trusted workflow, deterministic evidence, independent review |

The taxonomy measures like with like. A typo is never used as the baseline for a transactional release boundary.

## 6. Components

### 6.1 Node 24 gate

One deterministic version checker requires `>=24 <25` and prints the actual executable and version on refusal. It is reused by:

- install and dependency lifecycle;
- test, typecheck, build, and verify entrypoints;
- Git hooks that invoke JavaScript;
- local operational scripts;
- persistent service and trusted production preflight.

The repository already declares `engines.node = ">=24 <25"` and `.nvmrc = 24`; the new gate makes the contract executable. Production remains pinned to root-owned `/usr/bin/node`. Local development may use another explicit trusted Node 24 binary. Wrong-major execution must fail before application imports or hook logic.

### 6.2 Efficiency collector

A local read-only collector parses Codex rollout JSONL and optional Autopilot telemetry. It emits aggregate JSON and Markdown without copying prompt, response, secret, or raw tool-output content.

Required aggregate fields:

- schema version, window, and coverage limitations;
- `work_unit_id`, class, status, and risk tier;
- model and reasoning identifiers when recorded, without changing them;
- input, cached input, uncached input, output, and reasoning-output tokens;
- model-call, tool-call, subagent, retry, review, re-review, and compaction counts;
- prompt/context p50 and p90;
- active, tool, polling, and total wall time;
- deterministic gate result and first-pass acceptance;
- override codes and rollback events.

Fork-aware aggregation must exclude inherited replay bursts and must label estimates separately from provider-authoritative telemetry. Missing telemetry yields `insufficient_evidence`; it never yields a favorable efficiency verdict.

### 6.3 Workflow budget

The ordinary default budget is:

- at most two direct subagents, only for genuinely independent work;
- no recursive fan-out;
- at most one primary review and one targeted re-review;
- at most two total attempts across transport retry and semantic correction;
- the second attempt requires a recorded input or strategy delta;
- a soft context checkpoint before p90 reaches 150k tokens;
- a new root session after the current work unit is checkpointed when the soft bound cannot be maintained;
- deterministic commands batched where their outputs are independent and safely separable.

A high-risk work unit may exceed a budget only with a short structured override containing the matched risk trigger, the added assurance expected, and the narrower stopping condition. An override is evidence, not blanket permission for unlimited fan-out.

### 6.4 Review protocol

A review receives a fixed package containing the accepted brief, relevant design/plan, base and head commits, bounded diff, and declared test evidence. It does not inherit the full implementation conversation.

The primary reviewer reports actionable findings by severity. If fixes are required, the re-review is limited to the fixed head plus necessary surrounding invariants. A third review cycle requires one of:

- a new Critical or High finding;
- a materially changed trust boundary;
- contradictory deterministic evidence;
- explicit owner approval.

Finding more theoretical strictness in the same already-accepted dimension is not sufficient by itself to create an unbounded review loop.

### 6.5 Instruction and skill surface

The default profile keeps universal safety, file-editing boundaries, verification, actual-failure debugging, and behavior-change TDD. Long-tail domain plugins are on demand and enabled only by explicit user intent or matching workspace profile.

Repository `AGENTS.md` becomes a compact index of sources of truth, risk triggers, required commands, and routing pointers. Detailed rationale remains in runbooks and mesh `must_read` references. A prompt contains role, bounded inputs, output contract, and task-specific checks; it does not repeat global safety or the complete repository governance model.

Candidate or draft prompt-library entries are never automatic defaults. Universal planning/brainstorming chains do not apply to trivial deterministic or mechanical work. Specialized workflows remain available for explicit use.

### 6.6 Routing seam for stage two

Telemetry and work-unit records reserve these fields:

- `recommended_model` and `recommended_reasoning_effort`;
- `actual_model` and `actual_reasoning_effort`;
- recommendation reason and confidence;
- escalation trigger;
- owner override;
- quality and cost outcome.

During stage one, recommendation fields are absent or shadow-only. They cannot alter dispatch. Stage two will define a separately approved routing matrix, evaluate current supported models, and activate classes gradually.

## 7. Metrics and acceptance gates

Primary KPI: median replay-adjusted total tokens per completed work unit within the same class.

Stage-one acceptance requires:

- at least 30 percent reduction in the primary KPI;
- context p90 below 150k input tokens;
- at least 20 comparable ordinary work units and 5 high-risk work units;
- first-pass acceptance no worse by more than two percentage points;
- no new escaped Critical or High finding;
- unchanged mandatory deterministic checks for each class;
- no increase in retry exhaustion or incomplete-work rate;
- complete reporting of overrides and insufficient-evidence cases.

Secondary metrics include uncached tokens, cached-token share, output tokens, calls per completion, tool calls, poll calls, subagents, review loops, active wall time, first-pass acceptance, and defects found after completion.

Savings estimates overlap and must not be added. The collector reports observed results rather than presenting overlapping projections as a total.

## 8. Rollout

### Phase A — establish measurement

Implement and test the collector, replay fixtures, work-unit schema, and baseline report. Preserve raw sources unchanged.

### Phase B — deterministic runtime contract

Enforce Node 24 across repository and production entrypoints. Prove Node 24 success and wrong-major early refusal.

### Phase C — shadow budgets

Calculate context, fan-out, review, and retry violations without blocking. Correct classification and false positives before enforcement.

### Phase D — conservative enforcement

Switch Fast mode to standard, apply ordinary workflow budgets, reduce the default skill/instruction surface, and retain high-risk overrides.

### Phase E — evaluation

Collect the minimum matched sample and publish a baseline-versus-current report. Roll back only the guardrail associated with a quality regression. Retain independently proven savings.

### Phase F — routing design

Begin a separate, owner-approved model/reasoning routing design using stage-one telemetry. Start with shadow recommendations, current supported model verification, and non-inferiority evals. No routing activation is implied by this design.

## 9. Failure handling and rollback

- Missing or malformed telemetry: fail the report as `insufficient_evidence`; do not block safe work and do not claim savings.
- Wrong Node major: refuse immediately with remediation and detected path/version.
- Misclassified high-risk task: fail closed to the high-risk workflow.
- Budget false positive: use a recorded bounded override and add a regression fixture.
- Quality regression: revert the responsible budget/profile change, preserve telemetry, and analyze the matched class.
- Skill unavailable after narrowing: explicitly enable the known installed plugin; do not silently substitute a different workflow.
- Review contradiction: preserve both reports and escalate once to an owner decision or one stronger bounded reviewer.
- Collector exposure risk: abort output generation if raw prompt/response fields would be serialized.

All configuration changes must have a documented previous value and a reversible application step.

## 10. Verification strategy

### Node gate

- Node 24 positive path;
- Node 18 and 25 negative paths;
- local explicit binary path;
- npm lifecycle, Git hook, service, and trusted production preflight coverage;
- refusal before application imports.

### Collector

- root, fork, resumed thread, inherited replay, compaction, and missing-token fixtures;
- no double counting of the initial replay burst;
- deterministic aggregates and percentiles;
- no raw prompt, response, environment secret, or tool payload in output;
- malformed/truncated JSONL remains bounded and reports coverage loss.

### Workflow budgets

- ordinary two-subagent ceiling and high-risk override;
- no recursive fan-out;
- shared two-attempt budget across retry layers;
- required delta before attempt two;
- primary review plus targeted re-review;
- checkpoint generation and fresh-session continuation packet.

### Instruction and skill profile

- active/default plugin and skill inventory snapshot;
- required verification/debugging/TDD workflows remain discoverable;
- long-tail domains require explicit activation;
- candidate/draft prompts cannot become defaults;
- compact `AGENTS.md` still covers every critical risk trigger and required command.

### Acceptance evaluation

- matched-class baseline comparison;
- quality non-inferiority and escaped-severity checks;
- rollback drill for each changed configuration surface;
- report clearly separates measured, estimated, inferred, and unavailable data.

## 11. Later routing principles

The follow-up routing stage will retain these constraints:

1. Deterministic tools before models.
2. Existing verified models before newly advertised models.
3. Shadow recommendation before enforced routing.
4. Lower effort for proven routine classes, explicit escalation for ambiguity or failure.
5. Strongest trusted workflow for high-risk boundaries.
6. One owner-visible route decision, one shared retry budget, and no silent provider switch.
7. Non-inferiority evaluation before each class is activated.

This seam allows later selection of model and reasoning by task class without coupling stage-one efficiency gains to unverified model behavior.
