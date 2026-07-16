# Codex efficiency shadow rollout

This runbook governs stage one of the Codex efficiency rollout. It measures and
limits orchestration without changing the active provider, model, or reasoning
effort. Model routing remains disabled: routing remains shadow-only, and
`recommended_model` plus `recommended_reasoning_effort` remain `null`.

## Work-unit lifecycle

At work-unit start, record a unique ID, class, risk (`ordinary` or `high`), the
accepted scope, required deterministic checks, and the rollout source basename.
The source-to-work-unit map must be explicit. Never infer a work unit by reading
conversation content, and never create artificial work to satisfy a sample gate.

At completion, record completed or incomplete status, first-pass acceptance,
retry exhaustion, and any escaped finding severity. A completed record is
comparable only when its source has aggregate counter coverage and a verified
class/risk assignment.

Ordinary work permits at most two direct subagents at depth one, two total
attempts with a concrete delta before attempt two, one primary review, and one
targeted re-review. A third review cycle is allowed only for a new Critical or
High finding, a changed trust boundary, contradictory deterministic evidence,
or explicit owner approval.

High-risk work keeps the existing deterministic evidence and independent-review
quality. Any budget override records the risk trigger, expected added assurance,
and stopping condition. The override does not authorize weaker verification.

At a 150k input-context estimate, write a bounded checkpoint containing only
accepted state, evidence pointers, blockers, and the next action. Continue in a
fresh session when the work cannot remain below that soft limit.

## Reporting

The collector reads historical rollout files but emits aggregates only. Reports
must set `contains_raw_content` to `false` and must exclude conversation text,
credentials, configuration values, and raw tool data. Historical sources remain
unchanged.

Every daily report requires an explicit work-unit map:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH \
  npm run efficiency:report -- \
  --sessions /home/radek/.codex/sessions \
  --work-units /home/radek/.local/state/autopilot/efficiency/work-units.json \
  --since 7d --json
```

If the map, counters, completed records, or comparable sample are missing, the
result is `insufficient_evidence`. Missing evidence is never interpreted as a
saving.

## Acceptance gate

Stage one is accepted only when one matched baseline/candidate comparison shows:

- at least 30 percent median replay-adjusted token reduction;
- context p90 below 150k input tokens;
- at least 20 ordinary and 5 high-risk comparable completed work units in both
  windows;
- first-pass acceptance degradation no greater than two percentage points;
- no escaped Critical or High finding;
- no increase in retry exhaustion or incomplete work.

Until all conditions are evidenced, the decision remains
`insufficient_evidence`; no 30 percent saving may be claimed.

The committed baseline is a diagnostic initial record. It proves the fail-closed
zero-sample state. It must not be used as the stage-one acceptance comparator.

After natural work produces a verified matched baseline and candidate with at
least 20 ordinary and 5 high-risk samples in each window, store them as new
immutable aggregate files and run:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH \
  npm run efficiency:compare -- \
  --baseline <matched-baseline.json> \
  --candidate <matched-candidate.json> \
  --json
```

## Rollback and routing handoff

For a quality regression, rollback only the responsible retry, instruction, or
personal-profile guardrail and preserve aggregate evidence. The personal profile
rollback uses the recorded backup:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH \
  node scripts/codex-efficiency-profile.mjs rollback \
  --home /home/radek/.codex \
  --backup /home/radek/.codex/config.toml.autopilot-efficiency-2026-07-16T09-24-36-764Z.bak
```

The later routing design may consume aggregate class outcomes, actual
model/effort observations, escalation triggers, and quality results. During this
stage, routing remains shadow-only, both recommendation fields remain `null`,
and no model or reasoning switch is automatic.
