# ADR - agy (Gemini) lane access to the supervised-projects directory

**Status:** ACCEPTED (owner, 2026-07-07). Directs how the agy/Gemini worker lanes may be
granted filesystem read access to the sibling supervised-projects root so Gemini can review
real project code (e.g. `Crypto_Analyzer`) instead of reasoning from a hand-copied packet.

## Context

The agy (Gemini) lanes run through `captureAgyResponse` (src/data/delivery-system/cliWorkerCapture.ts)
with `--sandbox` forced ON by default and `--add-dir` grants kept independent of the
`--dangerously-skip-permissions` bypass. Until now a governed agy dispatch had no explicit
directory access, so a project review meant pasting facts into the prompt — the reviewer could
not open files, which weakens the review (measured 2026-07-07: Gemini's project review ran
prompt-only because the sandbox had no project dir and the local `.cjs` driver's bypass flag was
correctly refused by the auto-mode classifier).

Supervised project repos live as SIBLINGS of the control plane at `<ProjectsRoot>/<slug>`, where
`ProjectsRoot` defaults to `../Projects` and is overridable via `AUTOPILOT_PROJECTS_DIR`
(mirrors `resolveProjectMeshRoot`, src/lib/decision-mesh/load.ts). On this host that resolves to
`C:\Programování\Projects`.

## Decision

1. The agy lanes (`agy_fast`, `agy_deep`, `agy_gpt_oss_120b`, `agy_claude_sonnet_4_6`) MAY receive
   `--add-dir` grants into the supervised-projects tree. Codified as
   `AGY_PROJECTS_ACCESS_LANES` and `resolveSupervisedProjectsRoot(controlPlaneRoot, override?)`
   in `src/data/delivery-system/routingModes.ts`.
2. **The sandbox stays ON.** This grant is read access via `--add-dir` only; it NEVER implies
   `--dangerously-skip-permissions`. The two remain mutually exclusive at the argv builder
   (`buildAgyArgs`).
3. **Narrowest useful grant.** Prefer `<ProjectsRoot>/<slug>` (a single project) over the whole
   `<ProjectsRoot>`. The full root is reserved for explicitly cross-project work and named as such
   on the handoff.
4. **Env stays out of governed-core.** `resolveSupervisedProjectsRoot` takes the override as a
   parameter; call sites read `AUTOPILOT_PROJECTS_DIR` and pass it in. The delivery-system module
   never touches `process.env`, honoring the Phase-3 boundary wall.

## Non-goals / guardrails

- No write access, no bypass, no auto-grant. A grant is explicit per handoff via `addDirs`.
- Never grant the control-plane repo itself or `.env`/credential directories.
- codex lanes are unaffected (codex works in its `cwd`; `addDirs` is recorded for parity only).

## Verification

- `resolveSupervisedProjectsRoot` unit tests (default sibling + explicit override + empty-input
  refusal) in `tests/delivery-system/routing-modes.test.ts`.
- `buildAgyArgs` already has coverage that `--add-dir` accompanies `--sandbox` and is absent under
  the bypass path.
