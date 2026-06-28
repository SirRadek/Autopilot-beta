# Agent Handoff Packet Template

Status: template

Use this when one agent output becomes input for another agent.

```md
# Agent Handoff Packet

## Handoff ID

hp-YYYYMMDD-<task-slug>

Slug rules: lowercase ASCII, digits, hyphens, unique per task.

## Source Agent

## Target Agent

## Project

## Mode

DRY_RUN | INSPECT_ONLY | WRITE_ALLOWED | REMOTE_MUTATION_APPROVED

## Goal

## Scope

## Allowed Files Or Surfaces

## Forbidden Actions

## Verified Facts

## Assumptions

## Decisions Already Made

## Open Questions

## Risks

## Stop Conditions

## Required Checks

## Expected Output

## Reuse Check (required for bounded_coding tasks)

- Searched patterns: [rg patterns used, for example "functionName", "ComponentName"]
- Existing matches: [file:line or "none found"]
- Installed package matches: [package names or "none"]
- Decision: implement_new | reuse_existing | extend_existing
- Reuse target: [file:line if applicable]
- Token saving estimate: high | medium | low | none

## Context Budget (required)

- Profile: caveman | standard_compact | review_compact | research_compact
- Max files: [N]
- Max context lines: [N]
- Included sections: [list from ContextWidthSpec.requiredSections]

## Learning Signal (optional)

- Based on eval records: [task_type + provider pattern or "no data"]
- Recommended delta: tighten_allowed_files | decompose_task | switch_to_qwen | no_change
- Confidence: eval_records | single_observation | no_data

## Evidence And Source Pointers

## Progress Impact

## Next Action
```

Do not paste raw agent output as the next prompt. Extract only verified facts,
assumptions, risks, open questions, and the bounded task contract.
