# Delivery System Ledgers

Date introduced: 2026-05-13
Status: phase-0 ledger contract
Owner: Autopilot Control Plane

This document defines the durable evidence ledgers used by the Multi-Agent Autonomous Delivery System. Ledgers are the source of accountability for decisions, issues, gates, incidents, lessons, and workflow history.

Ledgers may start as Markdown or YAML blocks. Typed storage may be added later only after a decision record updates the architecture.

## Ledger Principles

- Every meaningful decision is recorded.
- Every problem is recorded.
- Every gate result is recorded before delivery.
- Every incident has a root-cause and recovery trail.
- Every workflow run links to project architecture and work-log evidence.
- Historical entries are append-only unless a correction entry explains the change.
- Connector snapshots are evidence inputs, not automatic source of truth.

## Decision Ledger

Purpose: record why a business, architecture, workflow, model, tool, or delivery decision was made.

Required schema:

```yaml
decision_id:
type:
context:
decision:
reasoning:
alternatives:
impact:
approved_by:
related_tasks:
```

Required field rules:

| Field | Rule |
| --- | --- |
| `decision_id` | stable unique ID, date-prefixed when possible |
| `type` | one of `business`, `architecture`, `workflow`, `model`, `tooling`, `security`, `delivery`, `exception` |
| `context` | source request and constraints |
| `decision` | concrete selected path |
| `reasoning` | why the selected path is acceptable |
| `alternatives` | rejected options or explicit none |
| `impact` | architecture, scope, cost, risk, or delivery impact |
| `approved_by` | role or human approval source; cannot be same worker that authored the work |
| `related_tasks` | issue IDs, PRs, commits, work-log entries, or project slugs |

Example:

```yaml
decision_id: 2026-05-13-repo-split
type: architecture
context: Autopilot and Radeq were previously co-located in one checkout.
decision: Split Autopilot into SirRadek/autopilot and Radeq into SirRadek/radeq.
reasoning: Control-plane governance must not share canonical product runtime code.
alternatives:
  - Keep docs inside Radeq and mark them transitional.
  - Move all product runtime into Autopilot.
impact: Reduced repository boundary risk and made future project supervision explicit.
approved_by: user
related_tasks:
  - docs/projects/autopilot-control-plane/work-log.md
  - docs/projects/radeq/work-log.md
```

## Issue Ledger

Purpose: record bugs, governance failures, scope drift, missing evidence, incidents, security concerns, and unresolved risks.

Required schema:

```yaml
issue_id:
severity:
found_by:
related_agent:
description:
expected:
actual:
decision:
fix_owner:
status:
lesson_learned:
```

Allowed `severity` values:

- `blocker`
- `major`
- `minor`
- `cosmetic`

Allowed `status` values:

- `open`
- `investigating`
- `rework_assigned`
- `fixed_pending_verification`
- `verified`
- `accepted_risk`
- `closed`

Required field rules:

| Field | Rule |
| --- | --- |
| `issue_id` | stable unique ID, date-prefixed when possible |
| `severity` | mapped to the governance decision matrix |
| `found_by` | role, tool, test, reviewer, or supervisor |
| `related_agent` | responsible role or `none` |
| `description` | concise problem statement |
| `expected` | intended behavior or governance rule |
| `actual` | observed behavior or missing evidence |
| `decision` | rework, inline fix, accepted risk, defer, or escalate |
| `fix_owner` | role or person responsible for resolution |
| `status` | current lifecycle state |
| `lesson_learned` | prevention note or explicit none yet |

## Gate Result Ledger

Purpose: record every delivery gate decision.

Required schema:

```yaml
gate_result:
  status:
  checked_against:
  issues:
  decision_reason:
  next_action:
```

Extended fields:

```yaml
gate_result:
  gate_id:
  project_slug:
  run_id:
  owner_role:
  status:
  checked_against:
  evidence:
  issues:
  decision_reason:
  next_action:
  approved_by:
  timestamp:
```

Gate result rules:

- `approved_by` cannot be the same role that authored the work under review.
- `blocked` and `rework_required` must link to issue ledger entries.
- `conditional_inline_fix` must include evidence and work-log update.
- `pass` requires all mandatory evidence fields.

## Workflow Run Ledger

Purpose: record the movement of a request through states.

Required schema:

```yaml
workflow_run:
  run_id:
  project_slug:
  request_summary:
  current_state:
  state_history:
  owners:
  architecture_record:
  work_log:
  decision_entries:
  issue_entries:
  gate_results:
  verification:
  final_status:
```

Allowed `final_status` values:

- `completed`
- `completed_with_notes`
- `blocked`
- `cancelled`
- `escalated`
- `superseded`

## Incident Ledger

Purpose: record failures detected by Autopilot monitoring and recovery.

Required schema:

```yaml
incident:
  incident_id:
  detected_by:
  detected_at:
  project_slug:
  workflow_run:
  symptom:
  impact:
  root_cause:
  recovery_options:
  selected_recovery:
  fix_owner:
  verification:
  status:
  lesson_learned:
```

Incident rules:

- Autopilot may investigate and propose recovery.
- Autopilot may not approve delivery after recovery.
- Recovery that changes scope requires a decision ledger entry.
- Repeated incidents must create a lessons entry and architecture review task.

## Lessons Ledger

Purpose: prevent repeated mistakes and context drift.

Required schema:

```yaml
lesson:
  lesson_id:
  source_issue:
  source_decision:
  project_slug:
  pattern:
  prevention_rule:
  affected_docs:
  review_date:
```

## Memory Types

| Memory | Purpose | Canonical Location |
| --- | --- | --- |
| Project memory | current state and risks | project architecture record |
| Decision memory | why choices were made | decision ledger |
| Issue memory | defects and governance failures | issue ledger |
| Architecture memory | boundaries and contracts | architecture record |
| Workflow memory | state history and run artifacts | workflow run ledger |
| Lessons memory | prevention rules | lessons ledger |

## Evidence Requirements

Every ledger entry must prefer concrete evidence:

- commit hash
- PR or issue URL
- test command and result
- file path
- architecture record path
- work-log entry
- connector snapshot reference
- human approval statement

When evidence cannot be collected, the ledger must state the limitation explicitly.

## Redaction Rules

Do not store:

- secrets or tokens
- private customer data
- unapproved private repository bodies
- private Docket or Linear content without an approved snapshot
- cloud account IDs unless explicitly approved
- local absolute paths in public exports

Use redacted aliases for external review.
