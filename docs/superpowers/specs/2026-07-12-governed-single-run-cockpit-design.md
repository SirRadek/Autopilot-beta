# Governed single-run cockpit design

Date: 2026-07-12
Status: approved in conversation; awaiting written-spec review

## Purpose

Deliver the first usable vertical slice of advanced automation: an operator prepares one run in
the cockpit, explicitly approves its immutable revision, observes its governed execution, and can
inspect bounded evidence from prompt to provider result. The system never silently changes the
approved project, provider, model, or prompt.

## Scope

This slice includes one governed run at a time, an allowlisted project selector, live provider and
model availability, a prompt composer, token estimate, optional visual-output expectation, draft
revision and approval, token reservation, supervisor dispatch, bounded live output and artifacts,
a split run inspector, incident reporting, and an exportable Autopilot repair packet.

Multivendor brainstorming, the learning loop, scheduled jobs, batch jobs, and parallel dispatch of
multiple approved drafts are separate follow-up slices. A live provider invocation remains an
explicit operator action; automated tests use dry-run or controlled fixtures.

## Safety invariants

- A browser request cannot supply an arbitrary working directory. Projects come from an
  administrator-managed allowlist in the VM.
- Preparing a run does not execute it. Execution requires a separate operator approval.
- Approval binds an immutable run revision: project, prompt, provider, model, estimated budget,
  requested artifact kinds, and relevant governance metadata.
- Editing any bound field creates a new revision and invalidates approval of the previous content.
- The supervisor cannot silently switch provider or model. A retry remains on the approved route
  and appears in the timeline.
- Token reservation occurs after approval and before dispatch. A rejected reservation cannot reach
  a worker.
- All persisted and displayed payloads are bounded. Secrets and credential-shaped values are
  redacted before entering cockpit-facing incident or artifact records.
- Autopilot never attempts to repair itself from this workflow.

## Run flow

1. The cockpit loads allowlisted projects and fresh provider/model availability.
2. The operator selects a project, provider and available model, writes a prompt, and optionally
   requests visual proposals.
3. `Prepare run` creates an immutable `RunDraft` revision and an approval record. It does not invoke
   a worker.
4. The cockpit displays the exact revision, estimated tokens, quota windows, known API spend, and
   governance warnings.
5. `Approve and run` records the operator decision. A stale or unavailable provider is blocked by
   default and needs a distinct exceptional confirmation if that capability is added later; this
   first slice does not provide the override.
6. The token gateway reserves the approved budget and the supervisor queues the revision.
7. The supervisor dispatches one worker on the approved route. State changes and retries are
   correlated and persisted.
8. Worker output and artifacts stream into bounded records. Settlement releases or settles the
   token reservation on every terminal path.
9. The cockpit renders the result, cost/token evidence, timeline, artifacts, and any error.

## Cockpit layout

Use the approved split-control-room layout.

The left work area contains the project selector, provider/model selectors with five-hour and
weekly quota context plus API spend, prompt editor, estimated tokens, the optional visual-proposal
request, prepare/approve controls, live bounded output, and artifacts.

The right inspector is collapsible and contains summary, exact approved input, correlated timeline,
tokens/cost/retries, artifacts and visual proposals, errors, and incidents. At narrow viewport
widths it moves below the work area. Full details means complete governance-relevant evidence, not
unbounded raw logs; oversized output is truncated with an explicit marker and a reference to its
bounded persisted artifact.

## Data and API boundaries

Introduce explicit versioned records rather than extending session creation with loosely typed
fields:

- `ProjectEntry`: stable ID, display name, canonical VM path, enabled state.
- `RunDraft`: ID, revision, project ID, prompt body or bounded artifact reference, provider, model,
  token estimate, requested artifact kinds, creation time, and status.
- `RunApproval`: draft ID and revision, decision, operator identity, decision time, and warnings
  acknowledged.
- `RunView`: current state, supervisor/worker correlation IDs, bounded output summary, artifacts,
  token/cost totals, and terminal reason.
- `AutopilotIncident`: stable ID, severity, subsystem/stage, correlation IDs, redacted summary,
  impact, retry count, event references, state, and timestamps.
- `RepairPacket`: incident ID, reproduction steps, expected and actual behavior, bounded redacted
  evidence, environment metadata, and suggested verification commands.

Control Plane endpoints must validate body size, enum values, project membership, draft revision,
auth/CSRF rules, and legal state transitions. Concurrent approval of the same revision is
idempotent. Approval of a superseded revision returns a conflict. Worker launch remains behind the
existing token gateway and supervisor queue rather than being implemented in the HTTP handler.

## Errors and incidents

Task/provider failures remain attached to their run. Governance refusals identify the gate that
stopped execution. Internal orchestration, persistence, API-contract, or cockpit-contract failures
create an Autopilot incident.

Detailed bounded diagnostics are logged in the background. The cockpit receives only redacted
incident details: severity, failing stage, correlation ID, impact, retry count, and links to related
events. An Autopilot incident remains open until the operator acknowledges it.

`Prepare repair packet` is a read-only export action. It produces a redacted packet for manual use
in a separate Codex, Claude, or AGY maintenance session outside Autopilot. It does not enqueue a
task, execute a command, edit the repository, or resolve the incident automatically.

## Visual artifacts

Visual proposals are optional. The draft records that they were requested, and the worker may
return bounded artifact metadata for supported image or HTML outputs. Unsupported providers report
the artifact request as unavailable without failing an otherwise valid text run. The cockpit never
interprets raw model text as a trusted file path or executable visual artifact.

## Verification

- Domain tests cover draft revision immutability, legal state transitions, idempotent approval,
  superseded revision conflicts, allowlisted projects, and bounded records.
- Control Plane tests cover authentication, CSRF, body caps, invalid provider/model/project input,
  stale provider blocking, token-gate refusal, and supervisor handoff.
- Redaction tests use representative secrets and prove that cockpit records and repair packets do
  not expose them.
- Cockpit tests cover editing, prepare versus execute separation, quota/model states, approval,
  responsive split layout, bounded output, visual-artifact availability, incident acknowledgement,
  and repair-packet export.
- Browser QA covers prepare → inspect → approve → queued → running → terminal result, plus a
  simulated Autopilot incident.
- A governed end-to-end dry run in the VM proves correlation from UI action through token gateway,
  supervisor, worker result, and observability. Any live provider run requires an explicit operator
  action.

## Follow-up order

After this slice is verified, add multivendor brainstorming, then the evidence-backed learning loop,
then scheduled/batch execution. Each follow-up reuses immutable drafts, approval revisions, token
reservations, incidents, and observability rather than adding a second execution path.
