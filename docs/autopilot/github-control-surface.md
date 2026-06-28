# GitHub Control Surface

GitHub is the human-visible control surface for Autopilot work. It is not the
Decision Mesh and it is not the runtime queue authority.

## Authority Split

- Decision Mesh owns routing, capability selection, stop conditions, and policy.
- Autopilot owns runtime execution, verification contracts, and result envelopes.
- GitHub Issues expose planned work, blockers, review requests, and decisions.
- GitHub Pull Requests expose code review, verification, and audit history.
- GitHub Projects can group and filter issues, but must not become a second queue
  authority.

## Issue Types

- Agent task: a bounded work request that still needs Decision Mesh routing.
- Blocker: a human-visible stop condition or missing decision.
- Review request: a request for defect-focused review of a patch, PR, or result.

Issue comments are never raw agent prompts. They must be normalized into a
bounded task contract before execution.

## Suggested Labels

- `autopilot`
- `agent-task`
- `blocked`
- `needs-review`
- `status:ready`
- `status:running`
- `status:done`
- `role:orchestrator`
- `role:architect`
- `role:automation`
- `role:backend`
- `role:frontend`
- `role:qa`
- `role:security`
- `worker:qwen`
- `profile:micro-patch`
- `profile:component-bundle`

## Project Board Views

Use one GitHub Project for the Autopilot control plane with these views:

- Queue: grouped by status.
- Blockers: filtered to `blocked`.
- Reviews: filtered to `needs-review`.
- By role: grouped by role label.
- By delivery profile: grouped by profile label.

## Safe Sync Rules

Inbound GitHub changes may request priority changes, approval, block, resume, or
review. They must not directly mutate the runtime queue without validation.

Outbound Autopilot sync may update issue status, comments, verification results,
PR links, and blocker evidence.

When GitHub and Autopilot disagree, Autopilot and Decision Mesh win. Record the
disagreement as a blocker or review request instead of silently overwriting the
runtime state.
