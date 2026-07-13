# Autopilot documentation

This index is the current documentation authority for Autopilot Beta. Canonical pages describe the
tested release candidate; dated plans, audits, ADRs, and work logs preserve historical context but
do not override these pages.

## Start and operate

- [Getting started](getting-started.md) — shortest path from checkout to an inspected governed run.
- [Cockpit user guide](user/cockpit-guide.md) — operator workflow, quotas, approvals, runs, and incidents.
- [Ubuntu VM installation](operations/install-ubuntu-vm.md) — Node 24, state, projects, systemd, and acceptance.
- [Configuration](operations/configuration.md) — paths, environment, auth, providers, and secrets.
- [Service runbook](operations/service-runbook.md) — deploy, start, stop, upgrade, rollback, and logs.
- [State and recovery](operations/state-and-recovery.md) — persistence, backup, restore, and guarantees.
- [Troubleshooting](operations/troubleshooting.md) — evidence-first diagnosis by symptom.

## Understand the system

- [System architecture](architecture/system-overview.md) — components, data flow, and trust boundaries.
- [Current status](status/current-status.md) — what is repository-tested, VM-verified, partial, or planned.

## Complete canonical set

- [Repository overview](../README.md)
- [Documentation index](README.md)
- [Getting started](getting-started.md)
- [Cockpit user guide](user/cockpit-guide.md)
- [System architecture](architecture/system-overview.md)
- [Ubuntu VM installation](operations/install-ubuntu-vm.md)
- [Configuration](operations/configuration.md)
- [Service runbook](operations/service-runbook.md)
- [State and recovery](operations/state-and-recovery.md)
- [Troubleshooting](operations/troubleshooting.md)
- [Current status](status/current-status.md)

## Evidence labels

- **Repository-tested** means deterministic tests passed at the stated revision.
- **VM-verified** means the behavior ran in the isolated Ubuntu VM, not only on the host.
- **Runtime-configured** means behavior depends on an installed unit, credential, CLI, tmux session,
  or proxy that is not supplied by the repository alone.
- **Partial** means a real path exists but an operator-facing or production boundary is incomplete.
- **Planned** means no supported implementation should be inferred from a design or mockup.

Report contradictions against these labels as an Autopilot documentation incident. Do not resolve a
conflict by copying an older command into the live VM.
