# Autopilot Git Hooks

Committed Git hooks install through local Git config:

```powershell
npm.cmd run hooks:install
```

`npm install` also runs the same installer through `prepare`.

## Gates

`pre-commit` keeps the fast gates local:

- `npm run mesh:gate:ci` (bind-point 1 — related_files ratchet)
- staged file list piped to `npm run mesh:changed -- --root . --fail-on-blocker`
  (bind-point 2 — blocks a commit touching a blocker-governed mesh node)

`pre-push` checks committed push ranges and heavier local gates:

- `npm run mesh:changed -- --root . --since <range> --fail-on-blocker`
- `npm run baseline:waiver-check -- --range <range>` (report-first, per pushed range)
- `npm run beta:vendor-check`
- `npm run typecheck`
- `npm run test`
- `npm run pdos:fit-safety-lint -- --no-pages`

## Boundaries

These hooks are local deterministic guardrails. They do not call the network,
mutate remotes, deploy, spawn agents, or store raw logs. They block only when an
existing local npm gate exits nonzero.

Rollback:

```powershell
git config --unset core.hooksPath
```
