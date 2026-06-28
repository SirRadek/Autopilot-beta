# Adoption Record

## Decision ID

adopt-2026-0617-supervisor-handoff-spike

## Date

2026-06-17

## What Was Proposed

Adopt Claude Opus (subscription) as the preferred Autopilot supervisor orchestrator,
replacing Codex-as-primary for orchestration, review, and handoff design. The proposal
covered four categories:

1. **Typed handoff contracts** — JSON Schema 2020-12 for worker and reviewer outputs,
   branded `HandoffId`, `checkCompletionMatrix.ts` with completion-matrix enforcement.
2. **Session state** — `session.json` + `history.jsonl` + `worker.lock` (atomic `wx`)
   in `docs/autopilot/session-state/`, gitignored at runtime, readable by Opus.
3. **Hook bridge extensions** — Gemini capacity detection (reads both `input.result`
   and `input.tool_response`), 200ms timeout on session writes, atomic lock on
   SubagentStart/SubagentStop, history trim to max 50 entries.
4. **Prompts** — `claude-opus-supervisor.md` (reads `session.json`, no `codex_app`
   tools) and `codex-bounded-worker.md` (structured output, verify failure handling).

## Decision: adopted

## Who Decided

SirRadek (owner)

## Reason

The POC spike (hp-20260617-skill-registry-init) demonstrated the full loop:

- Opus created a valid handoff packet with all required sections per the extended
  template (Handoff ID, Reuse Check, Context Budget, Learning Signal).
- The bounded task (`docs/autopilot/skill-registry.json` creation) was executed.
- Worker output validated: `node scripts/validate-spike-artifacts.mjs worker` → exit 0.
- Reviewer output validated: `node scripts/validate-spike-artifacts.mjs reviewer` → exit 0.
- `handoff_id hp-20260617-skill-registry-init` confirmed identical across handoff
  packet, worker output, and reviewer output.
- `npm.cmd run verify` passed: 214/214 unit tests, 35 test files, 4 Playwright e2e.

The governance constraints from CLAUDE.md were respected throughout: no secrets
logged, no product runtime code added, no self-approval, no raw prompts stored.

**Spike execution note:** The spike task was executed in supervisor-assisted mode
(Claude Opus acting as bounded worker for spike demonstration). The worker output
uses `worker_id: "openai_gpt"` per schema contract — the enum represents the target
worker type for production delegation. In real Wave 4 execution, this task would be
delegated to Codex via the Codex App by the owner.

## What Was Changed (file paths)

Wave 1 — Schemas + enforcement gate:
- `model-output-evals/worker-output.schema.json` (CX-01)
- `model-output-evals/reviewer-output.schema.json` (CX-01)
- `model-output-evals/examples/valid-worker-output.json` (CX-01)
- `model-output-evals/examples/invalid-worker-output.json` (CX-01)
- `model-output-evals/examples/valid-reviewer-output.json` (CX-01)
- `src/data/delivery-system/checkCompletionMatrix.ts` (CX-02)
- `tests/delivery-system/check-completion-matrix.test.ts` (CX-02)

Wave 2 — Session state + hook bridge:
- `src/data/delivery-system/supervisorAlerts.ts` (CX-03)
- `tests/delivery-system/supervisor-alerts.test.ts` (CX-03)
- `src/data/delivery-system/sessionState.ts` (CX-04)
- `tests/delivery-system/session-state.test.ts` (CX-04)
- `docs/autopilot/session-state/.gitignore` (CX-04)
- `.codex/hooks/autopilot-hook.mjs` (CX-05)
- `tests/codex-hooks.test.ts` (CX-05)

Wave 3 — Prompts + spike:
- `docs/autopilot/agent-handoff-packet-template.md` (CX-06)
- `prompt-library/06-supervisor/claude-opus-supervisor.md` (CX-07)
- `prompt-library/01-gpt/codex-bounded-worker.md` (CX-07)
- `scripts/validate-spike-artifacts.mjs` (CX-08a)
- `docs/autopilot/spike-supervisor-handoff.md` (CX-08a)
- `docs/autopilot/adoption-record-template.md` (CX-08a)
- `docs/autopilot/spike-artifacts/hp-20260617-skill-registry-init-handoff.md` (CX-08 spike)
- `docs/autopilot/spike-artifacts/hp-20260617-skill-registry-init-worker.json` (CX-08 spike)
- `docs/autopilot/spike-artifacts/hp-20260617-skill-registry-init-reviewer.json` (CX-08 spike)
- `docs/autopilot/skill-registry.json` (CX-08 spike task output — seeds Wave 4 CX-15)
- `docs/autopilot/adoption-records/2026-0617-supervisor-handoff-spike.md` (this file)

## Tests Or Evidence

- `npm.cmd run verify`: exit 0 — mesh, prompts, model-output, PDOS, contracts, diff,
  typecheck, 214 unit tests (35 test files), build, 4 Playwright e2e tests
- `node scripts/validate-spike-artifacts.mjs worker docs/autopilot/spike-artifacts/hp-20260617-skill-registry-init-worker.json`: exit 0
- `node scripts/validate-spike-artifacts.mjs reviewer docs/autopilot/spike-artifacts/hp-20260617-skill-registry-init-reviewer.json`: exit 0
- `handoff_id` grep confirmed identical value across all three spike artifacts
