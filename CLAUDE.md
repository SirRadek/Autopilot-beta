# Claude Code Instructions

This repository is the Autopilot control plane. It is a governance, prompt,
Decision Mesh, and read-only command-center project, not a product runtime.

Before planning or editing:

- Follow `AGENTS.md` and the relevant Decision Mesh/project mesh packet.
- Use `rg` before opening files and keep context narrow.
- Read only the files required by the active task plus direct dependencies.
- Keep routine worker loops local by default; Claude is not the default worker.
- Treat Claude output as advisory or implementation draft until local tests,
  source files, docs, and owner decisions verify it.

Hard boundaries:

- Do not add product runtime code, multi-provider gateways, connector clients,
  deployments, background queues, or remote mutation unless an explicit
  architecture decision and owner approval exist.
- Do not print, store, or summarize secrets, credentials, auth tokens, raw
  prompts, raw logs, customer data, or private account identifiers.
- Do not treat model output as source-of-truth evidence.
- Do not approve your own work or bypass verification gates.
- For supervised project work, use that project's architecture record and
  `docs/projects/<project-slug>/decision-mesh/` before implementation planning.

Useful local checks (all verified to exist in `package.json`):

- `npm.cmd run verify` (aggregate gate: vendor-check + typecheck + tests + pdos:validate + renderability + buildability-floor + fit-safety + model-output:validate + mesh:gate:ci)
- `npm.cmd run mesh:gate:ci` (bind-point ① related_files ratchet)
- `npm.cmd run mesh:changed -- --since origin/main --fail-on-blocker --fail-on-ungoverned` (bind-point ② changed-file governance; `--fail-on-blocker` alone is fail-open on files no node maps — `--fail-on-ungoverned` adds the AF3 newly-added-sensitive deny that the pre-commit hook also enforces)
- `npm.cmd run pdos:validate`
- `npm.cmd run typecheck`
- `npm.cmd test -- <target>`

Use `npm.cmd`, not `npm`, from PowerShell in this Windows environment because
PowerShell script execution policy may block `npm.ps1`.
