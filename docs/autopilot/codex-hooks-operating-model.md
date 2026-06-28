# Codex Hooks Operating Model

Date introduced: 2026-06-06
Status: phase-1 report-first local guardrail
Owner: Autopilot Control Plane

## Purpose

Codex lifecycle hooks provide fast deterministic checks around the agent loop.
They extend Decision Mesh, Protective Supervision, and project work logs. They
do not replace those sources, approve work, or create another execution queue.

Official behavior reference:

- https://developers.openai.com/codex/hooks

## Configuration

Project-local configuration:

```text
.codex/hooks.json
```

Shared handler:

```text
.codex/hooks/autopilot-hook.mjs
```

Runtime-only redacted state:

```text
.codex/state/events.jsonl
.codex/state/continuity.json
.codex/state/investigation-queue.jsonl
```

The state directory is ignored by Git. It stores event names, hashed session
and turn identifiers, tool names, risk classifications, result classes, and
input fingerprints. It must not store raw prompts, commands, tool responses,
transcripts, credentials, project logs, or customer data.

`investigation-queue.jsonl` stores a redacted handoff record when `PostToolUse`
observes an unsuccessful tool result. It includes only hashed input/response
fingerprints, failure class, scope, required checks, forbidden actions, and the
recommended `INSPECT_ONLY` investigator target. It is evidence for Protective
Supervision; hooks do not spawn agents or retry tools automatically.

For failures involving an affected running process, the handoff required checks
must force a supervisor-controlled repair sequence: reproduce or record the
failure pointer, identify the affected process, checkpoint progress, stop or
drain the process before applying the fix, restart or refresh the session after
the fix, update continuity/progress, and resume from the last verified state.
Hooks record this requirement only; they do not kill, restart, retry, or patch
processes.

## Active Events

- `SessionStart`: inject the control-plane boundary and verify required sources.
- `SubagentStart`: remind workers that their output is a bounded draft.
- `UserPromptSubmit`: flag sensitive input, currentness needs, and external scope.
- `PreToolUse`: report destructive, remote, deployment, credential, cloud, and
  governance surfaces before execution.
- `PostToolUse`: record redacted evidence, flag failed verification, and write
  a redacted investigator handoff for unsuccessful tool results.
- `PreCompact`: save a compact continuity record.
- `PostCompact`: require a fresh `AGENTS.md` and Decision Mesh pass.
- `SubagentStop`: record bounded worker completion.
- `Stop`: report unresolved failures and required governance impact checks.

## Enforcement Level

Phase 1 is report-first:

- warnings and model-visible context are allowed
- high-risk activity is classified and recorded in redacted form
- hooks do not automatically approve, deny, rewrite, deploy, push, merge, or
  call external models
- hooks do not automatically spawn investigator agents; the supervisor reads
  redacted evidence and assigns a bounded investigator when useful
- hooks do not automatically stop, drain, restart, retry, or patch running
  processes
- full tests are not run on every lifecycle event
- hook output is evidence, not delivery approval

A future blocking phase requires observed false-positive data, explicit owner
approval, tests for every deny rule, and a rollback path.

## Boundaries

Hooks must not:

- become a second Decision Mesh or progress queue
- copy raw supervised-project logs into Autopilot
- store prompt, command, response, transcript, credential, or customer content
- call Gemini, OpenAI APIs, paid tools, connectors, or deployment systems
- automatically update architecture, work logs, GitHub, or project runtimes
- apply fixes to live running processes or continue after a restart without
  continuity evidence
- claim complete enforcement because `PreToolUse` does not intercept every
  possible tool path

## Trust And Startup

Project-local hooks run only after the project `.codex` layer and the exact hook
definition are trusted. Changed command hooks require review again.

## Runner Findings 2026-06-17

The repo-local `.codex/hooks.json` is a Codex lifecycle configuration. It is
loaded by the Codex CLI/App runtime from active config layers after the project
`.codex` layer and exact hook definitions are trusted. It is not a Claude Code
hook configuration by itself, and the in-chat `multi_agent_v1.spawn_agent` tool
has not been observed to trigger this repo-local Codex hook lifecycle in the
parent workspace.

On this Windows machine, `codex` resolves first to the npm PowerShell shim
`C:\Users\sirok\AppData\Roaming\npm\codex.ps1`, which is blocked by the local
PowerShell execution policy. Use `codex.cmd` for CLI inspection and tests. The
installed CLI reported `codex-cli 0.106.0`; the Codex desktop config exposed app
version `26.611.61753` and trusted hashes for this repo's hook definitions.
The observed `codex.cmd --help` and `codex.cmd exec --help` output did not show
a `--metadata` option, so prompt stdin must not be treated as structured hook
payload metadata.

The current `.codex/hooks.json` Windows runner is `commandWindows`:

```text
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=(git rev-parse --show-toplevel); & node (Join-Path $root '.codex/hooks/autopilot-hook.mjs')"
```

Codex supplies one JSON object on stdin to that process. Manual PowerShell
pipeline tests such as `$payload | node .codex/hooks/autopilot-hook.mjs` can
produce invalid JSON in this environment; mechanical smoke tests should use an
explicit UTF-8 stdin writer such as Node `spawnSync(..., { input:
JSON.stringify(payload), encoding: "utf8" })`.

Official Codex hook schemas document `SubagentStart` fields such as `turn_id`,
`agent_id`, `agent_type`, and `permission_mode`; `handoff_id` is not documented
as a native field. Therefore serial worker enforcement through
`getHandoffId(input)` is proven only for synthetic top-level `handoff_id`
payloads until a real Codex lifecycle subagent run shows that the runner can
pass custom top-level metadata. If that cannot be made true through the runner,
the next reviewed design choice is either to bind the lock to Codex's native
`agent_id` or to add an explicitly approved text fallback for `handoff_id`.

After adding or changing hooks:

1. Restart or refresh the Codex session.
2. Review the hook source and command definitions.
3. Trust the exact current hook definitions through the supported Codex hook
   review surface, such as `/hooks` in the CLI.
4. Start a new thread or resume the project.
5. Confirm a `SessionStart` record appears in `.codex/state/events.jsonl`.

Do not use `--dangerously-bypass-hook-trust` as the normal Autopilot path.

## Verification

```powershell
npm.cmd test -- codex-hooks
npm.cmd run mesh:check
npm.cmd run typecheck
git diff --check
```

Runtime verification remains separate from file and test verification. Do not
claim the active Codex App host loaded the hooks until a new or refreshed
trusted session produces lifecycle evidence.
