# Autopilot Beta

Autopilot Beta is a governed, single-operator control plane for approved Codex, Claude, AGY, and
OpenRouter work. It combines a loopback HTTP service, a browser Cockpit, project allowlisting,
owner approval, token reservations, a durable supervisor queue, Decision Mesh routing, bounded
worker-output handling, and operational recovery tooling.

The current branch is a release candidate for an Ubuntu 24.04 VM. Repository and isolated-VM
acceptance pass. The owner-approved live cutover completed on 2026-07-14; see the
[current status](docs/status/current-status.md) for the authoritative deployed revision and acceptance
evidence. The supported deployment uses root-managed systemd units whose processes run as the
unprivileged `radek` account. A fail-closed startup probe prevents service start when the installation
is writable from inside the service.

## Supported boundary

- One trusted operator on one Ubuntu VM.
- Control Plane and development Cockpit bind to loopback only.
- Managed state is under `~/.local/state/autopilot`.
- Executable projects must be explicitly registered beneath `~/projects` or a reviewed custom root.
- Credentials stay outside the repository and state backups.
- Codex, Claude, and AGY use trusted local CLI capabilities; OpenRouter is a separate API lane.
- Provider health, quota, model, and cost data are evidence for an owner decision, never authority
  to switch providers automatically.

This is not a public multi-user service. Browser sessions are process-local, visual artifact
production is not implemented, worker cancellation is not wired into the Cockpit, repair packets
are manual, and batch, scheduled, dependency-graph, and automatic multivendor orchestration remain
planned work.

## Quick verification

From the repository root with Node 24:

```bash
npm ci
npm run typecheck
npm run verify
npm run cockpit:test
npm run cockpit:build
npm run browser:qa
npm run smoke:cockpit-run -- --dry-run
```

The dry-run smoke creates temporary state, uses a deterministic injected worker, invokes no
provider, and removes its state when complete. Follow the Ubuntu installation guide before running
the persistent service.

## Governed run flow

```text
Cockpit or CLI -> Control Plane -> project/readiness checks -> owner approval
  -> token gateway -> supervisor queue -> Decision Mesh/dispatch -> provider
  -> redaction -> locked persistence -> observability and inspection
```

The operator prepares and revises a prompt, approves an exact revision, and only then permits the
supervisor to dispatch it. The token gateway reserves before execution and settles or releases at a
terminal outcome. Autopilot never treats a provider's self-report as proof that work succeeded.

## Documentation

- [Documentation index](docs/README.md)
- [Getting started](docs/getting-started.md)
- [Cockpit user guide](docs/user/cockpit-guide.md)
- [System architecture](docs/architecture/system-overview.md)
- [DEV and PROD Cockpit environments](docs/autopilot/dev-prod-environments.md)
- [Ubuntu VM installation](docs/operations/install-ubuntu-vm.md)
- [Configuration](docs/operations/configuration.md)
- [Service runbook](docs/operations/service-runbook.md)
- [State and recovery](docs/operations/state-and-recovery.md)
- [Troubleshooting](docs/operations/troubleshooting.md)
- [Current status](docs/status/current-status.md)

Historical plans, ADRs, audits, and work logs are evidence, not the current operational contract.
Use the pages above for current behavior.

## Provenance

The beta began from the pinned canonical Product & Design OS base
`599785fb710cc01100ae1d5028af433e8fcfabbd`. [`vendor-manifest.json`](vendor-manifest.json)
records byte-identical and intentionally patched files. `npm run beta:vendor-check` enforces that
provenance boundary.
