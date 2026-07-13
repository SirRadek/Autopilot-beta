# Ubuntu-only Autopilot runtime and CI design

## Decision

Autopilot's control plane, provider CLIs, supervisor loop, persistence, and operational tooling are supported on Ubuntu in the managed VM. Windows is an operator host for the browser cockpit, SSH, and VM management; running the Autopilot backend or CLI workers directly on Windows is outside the supported runtime contract.

The GitHub `verify` workflow will therefore run on `ubuntu-latest`. This aligns the delivery gate with the production operating system instead of maintaining accidental Windows-runtime compatibility.

## Scope

- Change the single `verify` job from `windows-latest` to `ubuntu-latest`.
- Preserve Node setup, dependency installation, Playwright browser installation, visual QA, and the complete `npm run verify` gate.
- Keep the vendor provenance fix and fail-closed pre-push regression test already added to the pull request.
- Record the Ubuntu runtime contract in this specification.

## Non-goals

- No Windows-specific path, permission, line-ending, CLI discovery, or timing workarounds.
- No new CI matrix or additional operating-system jobs.
- No change to browser access from Windows or to VM connectivity.
- No weakening, skipping, or removal of existing verification commands.

## Verification

1. Validate the workflow diff contains only the runner change.
2. Run `npm run verify` under Node 24 on Ubuntu.
3. Push the branch and wait for both `push` and `pull_request` workflow runs to complete.
4. Require both runs to finish successfully before reporting the CI repair complete.

## Risks and rollback

This decision intentionally removes direct Windows-runtime coverage. A future requirement to run the control plane natively on Windows must be treated as a new platform-support project with explicit path, permission, process, shell, line-ending, and performance contracts.

Rollback is a one-line runner change, but must not occur without first restoring and verifying the Windows support contract.
