# Adoption Record

## Decision ID

adopt-2026-0617-claude-opus-orchestrator

## Date

2026-06-17

## What Was Proposed

Adopt Claude Opus through the owner's subscription-interactive Claude Code path
as the preferred Autopilot supervisor and orchestrator for architecture review,
handoff design, bounded worker assignment, correction-loop review, and final
quality gating. Codex remains the bounded implementation worker for scoped local
changes. Gemini remains advisory for long-context brainstorming and critique
when its subscription CLI path is available and its output is locally verified.

## Decision: adopted

## Who Decided

SirRadek (owner)

## Reason

The supervisor architecture plan v2 and the POC handoff spike established a
workable split of responsibilities:

- Claude Opus is the high-trust supervisor for broad repository review,
  orchestration decisions, and cross-agent critique after owner-scoped access.
- Codex is the implementation worker for bounded tasks with allowed files,
  forbidden actions, local tests, and structured worker output.
- Gemini is not skipped silently; capacity or provider errors become visible
  alerts, blocked states, or explicit tier decisions.
- Worker and reviewer outputs are validated by local JSON schemas before reuse.
- The Decision Mesh now records subscription worker boundaries, reuse checks,
  skill registry policy, and supervisor execution-loop failure modes.

This keeps the system practical without turning advisory model output into a
source of truth or adding an autonomous execution queue.

## What Was Changed (file paths)

- `output/supervisor-architecture-plan-v2.md`
- `output/codex-implementation-tasks.md`
- `docs/autopilot/adoption-record.schema.json`
- `docs/autopilot/adoption-records/2026-0617-claude-opus-orchestrator.md`
- `prompt-library/06-supervisor/claude-opus-supervisor.md`
- `prompt-library/01-gpt/codex-bounded-worker.md`
- `model-output-evals/worker-output.schema.json`
- `model-output-evals/reviewer-output.schema.json`
- `src/data/delivery-system/modelPolicy.ts`
- `src/data/delivery-system/modelOutputEvaluation.ts`
- `mesh/nodes/supervisor_execution_loop.yaml`
- `mesh/nodes/subscription_worker_boundary.yaml`

## Tests Or Evidence

- `npm.cmd run verify` passed after the Core POC work before Wave 4.
- `node scripts/validate-spike-artifacts.mjs worker ...` and reviewer validation
  passed for the POC handoff spike artifacts.
- Live Codex worker spike produced a strict-AJV-valid worker output object for
  `hp-20260617-live-codex-spike`.
- Wave 4 Set A targeted tests passed for subscription budget, model policy,
  model output evaluation, token efficiency, tool inventory, and dependency
  freshness.
- Wave 4 Set B targeted tests passed for fallback chains and supervisor routing.
