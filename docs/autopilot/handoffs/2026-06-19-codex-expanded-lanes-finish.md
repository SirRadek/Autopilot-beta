# Agent Handoff Packet

## Handoff ID

2026-06-19-codex-expanded-lanes-finish

## Source Agent

Opus (architect, supervisor, decision analyst)

## Target Agent

Codex (implementation worker, logic analyst, technical opponent)

## Project

Autopilot control plane — expanded-domain prompt lanes

## Mode

WRITE_ALLOWED for `prompt-library/05-evaluation/`, the status/eval frontmatter of
the expanded-domain prompts, and the Autopilot control-plane work log.
INSPECT_ONLY for the operating-model documents and the rest of the repository.
No remote mutation, deployment, connector, or paid dependency is authorized.

## Goal

Finish the expanded-domain lanes (business, design, analysis, research,
copywriting) so their prompts are backed by real eval evidence, and complete the
Codex feasibility-opposition consult. Opus framed the scaffolding; Codex supplies
the worker logic and eval evidence.

## Scope

1. Run the feasibility consult in
   `docs/autopilot/handoffs/2026-06-19-codex-feasibility-opposition-consult.md`:
   answer its open questions, refine `08-business/feasibility-opposition.md`, and
   move it `draft -> candidate`.
2. Create eval fixtures under `prompt-library/05-evaluation/` for the design,
   analysis, research, and copywriting lanes, in the same shape as
   `05-evaluation/business-lane-cases.md` (representative cases plus good/bad
   reference outputs per role).
3. Wire each lane prompt's `evals:` to its new fixture and record real eval
   results. Keep `status: candidate`. Do NOT set `status: approved` — the
   validator blocks it on purpose (`validateCandidateStatus`). Promoting to
   `approved` is a separate governance decision to relax that guard, out of scope
   here.
4. Record the consult outcome and eval evidence in the Autopilot control-plane
   work log.

## Allowed Files Or Surfaces

- `prompt-library/05-evaluation/*` (new fixtures)
- `prompt-library/08-business/feasibility-opposition.md` (promote)
- `prompt-library/08-business/*`, `09-design/*`, `10-analysis/*`,
  `11-research/*`, `12-copywriting/*` (only `evals:` and recorded results)
- `docs/projects/autopilot-control-plane/work-log.md`
- read-only: `docs/autopilot/*-operating-model.md`, `scripts/validate-prompt-library.ts`

## Forbidden Actions

- setting `status: approved` (validator stop condition)
- changing the role taxonomy or operating-model decisions
- business/design direction decisions or delivery approval
- routing real private data to a free-cloud model
- treating model output as source of truth
- remote mutation, deployment, or paid dependencies

## Verified Facts

- Lanes 07-11 exist with prompts at `status: candidate`, except
  `08-business/feasibility-opposition.md` at `status: draft`.
- `prompt.schema.json` accepts `task_type: copywriting`; `status` enum is
  draft/candidate/approved but the validator rejects `approved`.
- Each lane has an operating model under `docs/autopilot/`.
- Current checks pass: `npm run prompt:validate` (46 files, 0 errors),
  `npx vitest run prompt` (12 tests), `npm run pdos:validate` (64, 0/0).

## Assumptions

- Eval fixtures use fully redacted, synthetic cases (no production private data).
- Relative cost-to-build sizing is more honest than absolute estimates without
  live repo context.

## Decisions Already Made

- Role taxonomy (Opus decider; Codex worker/logic/technical opponent; Gemini
  creative/strategic/SEO opponent redacted; Qwen local) is fixed.
- Prompts stay `candidate`; `approved` stays blocked.
- Output shapes follow each operating model's packet definitions.

## Open Questions (for Codex)

1. Feasibility role: which signals are reliable vs. low-confidence guesses, and
   what is the most honest cost-estimate method? (See the feasibility consult
   packet.)
2. For each lane, which representative cases are realistic, and what are the
   good/bad reference outputs?
3. Do any operating-model output packets need fields added or removed based on
   real runs? If so, propose the change for Opus/owner review rather than editing
   the operating model directly.

## Risks

- Superficial eval fixtures give false confidence; cases must be specific.
- Editing prompt frontmatter beyond `evals:` could break schema validation.

## Stop Conditions

- a prompt would need `status: approved` to satisfy the task
- a fixture would require real private data
- an operating-model decision would need to change
- `npm run prompt:validate` fails after a change

## Required Checks

- `npm run prompt:validate` passes
- `npx vitest run prompt` passes
- `npm run pdos:validate` passes
- `git diff --check` clean
- consult outcome and eval evidence recorded in the work log
- independent review (Opus or owner) before the work log marks the lanes done

## Expected Output

- `08-business/feasibility-opposition.md` at `status: candidate`
- eval fixtures for design, analysis, research, and copywriting lanes
- each lane prompt citing its fixture, with recorded eval results
- a work-log entry with consult outcome, eval evidence, and verification

## Evidence And Source Pointers

- `docs/autopilot/business-intelligence-operating-model.md`
- `docs/autopilot/design-intelligence-operating-model.md`
- `docs/autopilot/analysis-intelligence-operating-model.md`
- `docs/autopilot/research-intelligence-operating-model.md`
- `docs/autopilot/copywriting-operating-model.md`
- `docs/autopilot/handoffs/2026-06-19-codex-feasibility-opposition-consult.md`
- `prompt-library/05-evaluation/business-lane-cases.md` (fixture pattern)
- `scripts/validate-prompt-library.ts` (validation rules)

## Progress Impact

When complete, all expanded-domain lanes have real eval evidence, the feasibility
prompt is `candidate`, and the only remaining governance question is whether to
relax the `approved` guard.

## Next Action

Owner runs this packet with `codex_cli` from the repository root, reviews the
output, and Opus or the owner records the final work-log sign-off.
