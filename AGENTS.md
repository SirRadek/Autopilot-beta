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
