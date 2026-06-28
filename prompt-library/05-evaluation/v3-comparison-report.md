# V3 Prompt Pack Comparison Report

Date: 2026-06-03
Scope: compare `docs/autopilot/v3-prompt-pack.md` with `prompt-library/`.

## Summary

The V3 prompt pack remains the historical operating manual for supervised bot
assignments and write-scope discipline. The new prompt library should not
replace it wholesale. It should extract reusable prompt contracts from V3 over
time, add metadata/evals, and route them through the Decision Mesh.

## Strong Rules Kept From V3

- Role and scope must be explicit.
- No Git init, commit, push, deploy, or remote mutation without approval.
- Do not revert user changes.
- Use local files as source of truth for repository claims.
- Use Context7 or official docs for current library, SDK, API, CLI, and cloud
  facts.
- Treat Gemini and free/no-cost cloud reasoning as advisory only.
- Use Decision Mesh before planning or editing for capability-sensitive work.
- Apply context economy and token efficiency.
- Use project-specific meshes for supervised projects.
- Every handoff needs role, mode, scope, evidence, architecture impact, ledger
  impact, and next action.

## New Prompt-Library Coverage

- Source catalog for official provider docs and prompt-management references.
- Prompt metadata schema.
- Model-family prompt folders for GPT, Gemini, Claude, and Qwen/local workers.
- Common rules for hallucination control, citations, output validation, and
  Autopilot global routing.
- Typed policy in `src/data/delivery-system/promptLibrary.ts`.
- Decision Mesh boundaries: `prompt_library_policy` and
  `prompt_library_boundary`.

## Gaps Found And Light Adjustments

Role prompts:

- V3 has strong role discipline, but the first prompt-library pass did not make
  role/scope a required prompt check.
- Added `role_scope_declared` and `role_without_scope`.
- Added `00-rules/autopilot-global-routing.md`.

Token efficiency:

- V3 and the token-efficiency model require Caveman/compact routing.
- Added `token_efficiency_route_selected` to prompt-library required checks.
- Prompt-library now says reusable prompts should reduce repeated context.

Plugins/MCP:

- V3 says named tools/plugins must report availability and use safe fallback.
- Added `plugin_capability_verified` and
  `plugin_invoked_without_availability_check`.
- Prompt-library now treats plugins/connectors/MCP as capabilities, not prompt
  authority.

Libraries and assets:

- Graphic Agent policy already covers asset/source/license/performance gates.
- Prompt-library now requires `asset_or_library_source_verified`.
- Added stop condition `asset_or_library_without_source_review`.

GitHub:

- GitHub Control Surface says issues and PRs expose work, blockers, review
  requests, and decisions, but they are not raw prompts.
- Added `github_task_normalized` and `raw_github_issue_used_as_prompt`.
- Prompt-library now requires GitHub inputs to become bounded task contracts.

## Migration Rule

Do not bulk-convert V3 into prompt-library files. Convert one reusable prompt at
a time when it has:

- stable role and scope
- metadata
- source authority
- eval/checklist coverage
- expected output
- rollback path
- mesh/work-log impact

## Next Recommended Work

1. Add deterministic prompt metadata validation.
2. Add eval fixtures for the new `autopilot-global-routing` rule.
3. Convert V3 role prompts one at a time into `prompt-library/06-roles/`.
4. Add a prompt selector only after validation exists.
5. Keep GitHub issue/PR comments as task inputs, never as raw prompts.
