# Protective Supervision Operating Model

Date introduced: 2026-06-04
Status: phase-0 read-only guardrail
Owner: Autopilot Control Plane

Protective Supervision is the "guard hand" above agent work. It watches for
stale assumptions, converts reviewed agent outputs into bounded next-agent
inputs, and keeps progress visible without becoming a second runtime queue.

## Scope

Protective Supervision may:

- run currentness sentinel reviews
- summarize verified updates from official docs, Context7 when connected,
  GitHub source pointers, local files, and tests
- normalize agent outputs into next-agent handoff packets
- update or propose project progress ledger entries
- track model-output eval states, repeated failure patterns, and weekly prompt
  tuning candidates
- identify blockers, waiting states, owner decisions, and next actions
- record source pointers and verification gaps

Protective Supervision must not:

- mutate GitHub, Cloudflare, Vercel, Linear, Docket, or project runtimes without
  explicit approval
- copy raw project logs into Autopilot
- use model output as source of truth
- create a duplicate queue authority beside Decision Mesh, GitHub, and project
  work logs
- adopt paid or cloud-only tooling as a requirement
- approve delivery or approve its own work

## Lanes

Currentness Sentinel:

- checks whether prompt, mesh, library, SDK, CLI, cloud, SEO, accessibility, or
  provider claims need current-source review
- uses Context7 when connected, otherwise official docs or local source evidence
- reports source, date checked, confidence, and adoption recommendation
- does not silently change defaults

Handoff Compiler:

- reads a reviewed agent output or source pointer
- extracts verified facts, assumptions, decisions, risks, and open questions
- creates a next-agent packet with role, scope, allowed files/surfaces,
  forbidden actions, expected output, required checks, and stop conditions
- rejects raw agent output as the next prompt

Progress Ledger:

- tracks project state as `not_started`, `ready`, `in_progress`,
  `needs_review`, `blocked`, `waiting_owner`, `waiting_external`, `done`, or
  `cancelled`
- records what is done, what is missing, what waits on what, and the next
  sequence
- tracks accepted, retry, route-review, blocked, and weekly-tuning states for
  model-output evaluation when those affect prompts or handoffs
- points to the project work log, architecture record, project mesh, tests, and
  evidence instead of duplicating source artifacts

Blocker Review:

- identifies stop conditions and missing owner decisions
- names the owner or source needed to unblock work
- prevents loops when agents repeatedly produce proposals without verified
  progress

Failure Repair Supervision:

- applies when work investigates a broken, failed, or stuck running process,
  worker, dev server, scan job, session, or supervised runtime
- requires reproduction evidence or a source pointer before changing files
- identifies the affected process/session and whether it belongs to Autopilot
  control plane or to a supervised project
- checkpoints progress, source pointers, and next resume state before the fix
- stops or drains the affected running process before applying the repair; if
  it cannot be stopped safely, the state becomes `blocked` or `waiting_owner`
- applies the scoped fix only after the process is stopped, drained, or covered
  by an explicit owner-approved live-patch exception
- restarts or refreshes the affected session after the fix
- updates continuity/progress evidence and resumes from the last verified state
- records verification evidence that the failure no longer reproduces and that
  related behavior still works

## Source Authority

For Autopilot control-plane work:

1. `AGENTS.md`
2. Decision Mesh packet
3. project architecture record
4. project work log
5. local tests and generated artifacts
6. official docs or Context7 for unstable external facts
7. GitHub issue/PR/project-card source pointers

For supervised project work, use that project's architecture record and project
mesh first.

## Handoff Rule

Agent output is never passed raw as the next agent prompt. It must be compiled
into the template in `docs/autopilot/agent-handoff-packet-template.md`.

## Progress Rule

Project state is recorded in the affected project work log or an explicit
progress ledger using `docs/autopilot/project-progress-ledger-template.md`.

Progress entries must answer:

- what is already done
- what is missing
- what is blocked
- what is waiting on owner/external/tooling
- what depends on what
- what should happen next
- what evidence proves the current state

## Recurring Sentinel

Default cadence: weekly.

The weekly sentinel is report-first. It may recommend prompt-library, mesh,
architecture, or source-catalog updates, but it must not make remote mutations
or adopt new tools by itself.

Weekly prompt/input tuning recommendations must cite collected model-output
eval records, repeated failure patterns, and source-grounded provider guidance.
Do not recommend prompt changes from anecdotes alone.

## Definition Of Done

A protective supervision pass is done when it returns:

- currentness report or "no currentness check needed" reason
- normalized handoff packet or "no handoff needed" reason
- progress state delta or "no progress impact" reason
- blocker/waiting-state summary
- next action sequence
- source pointers
- verification gaps
- for failed-process repair, stop/drain evidence, restart evidence, continuity
  update, and resumed-state pointer
