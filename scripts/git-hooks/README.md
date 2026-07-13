# Autopilot Git hooks

Install the committed hooks from the Ubuntu repository root:

```bash
npm run hooks:install
```

`npm install` and `npm ci` invoke the same installer through `prepare`. The installer configures the
relative `core.hooksPath=scripts/git-hooks`, preserves a foreign hooks path instead of overwriting it,
and installs `pre-commit`, `commit-msg`, and `pre-push`.

## Pre-commit

- Runs `mesh:gate:ci` for related-file drift.
- Checks newly added files under sensitive roots with `mesh:changed --fail-on-ungoverned`.
- Does not evaluate blocker acknowledgement because the commit message does not exist yet.

## Commit-msg

- Evaluates all staged files with `mesh:changed --fail-on-blocker`.
- Reads auditable `Mesh-Ack: <node-id> — <reason>` trailers.
- An acknowledgement suppresses a blocker only when every activated node to which that blocker
  applies is acknowledged; the rule remains visible in output.

## Pre-push

For each pushed commit range, the hook:

- runs changed-file blocker governance with acknowledgements collected from commit messages;
- reports baseline-waiver growth without blocking;
- checks vendor provenance, TypeScript, the full Vitest suite, and Product & Design OS fit safety.

CI remains authoritative and may run a broader matrix. Local hooks never call providers, mutate
remotes, deploy, spawn agents, or persist raw logs.

## Rollback

```bash
git config --unset core.hooksPath
```

Disabling hooks does not waive CI or review requirements. Record why a local hook was disabled before
continuing work.
