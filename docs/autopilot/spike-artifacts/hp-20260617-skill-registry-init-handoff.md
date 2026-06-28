# Agent Handoff Packet

## Handoff ID

hp-20260617-skill-registry-init

Slug rules: lowercase ASCII, digits, hyphens, unique per task.

## Source Agent

claude-opus-supervisor

## Target Agent

codex-bounded-worker

## Project

autopilot-control-plane

## Mode

WRITE_ALLOWED

## Goal

Create the initial skill registry file at `docs/autopilot/skill-registry.json`
with `schemaVersion: "v1"` and empty arrays for skills, usageRecords, and
replacementCandidates. This seeds the file that the Wave 4 CX-15 TypeScript
module will later reference.

## Scope

Create exactly one new JSON file. No TypeScript changes. No test changes.
No edits to any existing file.

## Allowed Files Or Surfaces

- docs/autopilot/skill-registry.json (create)

## Forbidden Actions

- Edit TypeScript or test files
- Edit any existing file
- Run cloud or remote tools
- Add keys beyond: lastUpdatedAt, schemaVersion, skills, usageRecords, replacementCandidates
- Store raw prompts, raw commands, secrets, or customer data

## Verified Facts

- docs/autopilot/skill-registry.json does not exist (grep found no matches in docs/ or src/)
- CX-15 spec requires: lastUpdatedAt (ISO), schemaVersion: "v1", skills: [], usageRecords: [], replacementCandidates: []
- The file will be read by claude-opus-supervisor.md startup gate when it exists
- npm.cmd run verify currently passes with 214 tests

## Assumptions

- No JSON Schema file for skill-registry.json exists yet — TypeScript types come in CX-15 (Wave 4)
- contracts:validate does not validate docs/autopilot/ JSON files — confirmed from verify output

## Decisions Already Made

- File format: JSON (not YAML)
- Location: docs/autopilot/skill-registry.json
- Initial content: empty lists, schemaVersion: "v1"
- lastUpdatedAt: set to the moment of creation

## Open Questions

None.

## Risks

- If contracts:validate unexpectedly picks up the file: stop, set verify_result: fail, report in blocked_items

## Stop Conditions

- docs/autopilot/skill-registry.json already exists → report as no-op, do not overwrite

## Required Checks

- grep -rn "skill-registry.json" docs/ src/ (no-op check) before creating
- npm.cmd run verify after creation

## Expected Output

- docs/autopilot/skill-registry.json created
- verify_result: pass

## Reuse Check (required for bounded_coding tasks)

- Searched patterns: "skill-registry.json", "skill_registry", "SkillRegistry"
- Existing matches: none found in docs/ or src/
- Installed package matches: none
- Decision: implement_new
- Reuse target: none
- Token saving estimate: none

## Context Budget (required)

- Profile: caveman
- Max files: 1
- Max context lines: 50
- Included sections: goal, allowed_files_or_surfaces, expected_output, required_checks

## Learning Signal (optional)

- Based on eval records: no data for skill-registry creation tasks
- Recommended delta: no_change
- Confidence: no_data

## Evidence And Source Pointers

- CX-15 spec: output/codex-implementation-tasks.md
- Adoption record template: docs/autopilot/adoption-record-template.md
- Spike steps: docs/autopilot/spike-supervisor-handoff.md

## Progress Impact

Unblocks Wave 4 CX-15 TypeScript skill registry integration. Creates the
committed file that claude-opus-supervisor.md reads at startup.

## Next Action

Worker executes, returns hp-20260617-skill-registry-init-worker.json.
Supervisor validates output with validate-spike-artifacts.mjs, then reviews.
