# Spike: Manual Supervisor To Worker Handoff

## Goal

Prove the end-to-end loop: Claude Opus creates a bounded handoff packet, Codex
executes it, and Claude reviews the structured output. The worker and reviewer
artifacts must validate before Part 2 automation starts.

## Preconditions

- [ ] Tasks 01-07 complete.
- [ ] `model-output-evals/worker-output.schema.json` exists.
- [ ] `model-output-evals/reviewer-output.schema.json` exists.
- [ ] The handoff template has Handoff ID, Reuse Check, and Context Budget sections.
- [ ] `prompt-library/06-supervisor/claude-opus-supervisor.md` passes prompt validation.
- [ ] `prompt-library/01-gpt/codex-bounded-worker.md` passes prompt validation.

## Steps

1. In Claude Code, use `prompt-library/06-supervisor/claude-opus-supervisor.md` with a small bounded task.
2. Claude creates a handoff packet with a valid `handoff_id` slug: `hp-YYYYMMDD-*`.
3. Check the packet with `validateHandoffPacket()`; it must return `valid: true`.
4. Open Codex and provide `prompt-library/01-gpt/codex-bounded-worker.md` plus the handoff packet.
5. Codex executes the bounded task and returns structured output matching `worker-output.schema.json`.
6. Validate worker output:
   `node scripts/validate-spike-artifacts.mjs worker <worker-output.json>`.
7. Return to Claude with the worker output and `reviewer-output.schema.json`.
8. Claude returns reviewer output.
9. Validate reviewer output:
   `node scripts/validate-spike-artifacts.mjs reviewer <reviewer-output.json>`.
10. Confirm the same `handoff_id` appears in the handoff packet, worker output, and reviewer output.

## Success Criteria

- Worker artifact validation exits 0.
- Reviewer artifact validation exits 0.
- `handoff_id` is identical across all artifacts.
- `verify_result` is present and is either `pass` or `skipped` with `verify_skip_reason`.
- No raw prompts, raw logs, secrets, credentials, or customer data appear in artifacts.

## Record Result

Fill `docs/autopilot/adoption-record-template.md` and save the result as:

`docs/autopilot/adoption-records/2026-MMDD-supervisor-handoff-spike.md`
