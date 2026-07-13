# Getting started

[Back to the documentation index](README.md)

## Prerequisites

- Ubuntu 24.04 VM with SSH access.
- Node `>=24 <25` and npm installed as the system runtime for persistent services.
- Git, tmux, curl, and the provider CLIs you intend to enable.
- A clean Autopilot checkout and a separate project root.
- One trusted operator. Public or multi-user deployment is unsupported.

## Install

Use the complete [Ubuntu VM installation](operations/install-ubuntu-vm.md). At minimum, from the VM
repository root:

```bash
node --version
npm ci
npm run typecheck
npm run verify
```

The Node command must report `v24.x`. Do not run persistent acceptance from a Windows mount or from
the live checkout while evaluating an unmerged candidate.

## Initialize State

For the supported persistent paths:

```bash
npm run projects:init -- ~/.local/state/autopilot ~/projects
```

The command is idempotent, creates private directories, and writes an empty `projects.json` when no
registry exists. It does not discover or authorize projects automatically.

## Register a Project

Create or clone the project beneath `~/projects`, then add one enabled entry to
`~/.local/state/autopilot/projects.json`. Each entry has `schema_version`, `project_id`, `name`,
`cwd`, and `enabled`. The real path must remain beneath the configured project root; traversal,
symlinks escaping the root, missing paths, and unregistered IDs fail closed.

Back up the registry before a manual edit. There is not yet a canonical project-registration UI.

## Start

Install the reviewed system units as described in the [service runbook](operations/service-runbook.md),
then start the service:

```bash
sudo systemctl enable --now autopilot-control-plane.service
sudo systemctl enable --now autopilot-control-plane-health.timer autopilot-state-maintenance.timer
```

The startup boundary probe must report a writable state/project root and a read-only installation.
If it fails, diagnose the unit; never remove the probe.

## Check Liveness and Readiness

```bash
npm run ops:health -- 8787
npm run ops:ready -- 8787
```

Liveness answers whether the process serves HTTP. Readiness separately validates configuration,
managed state, project registry, supervisor state, token-gateway state, and provider capabilities.
Optional providers may be degraded or unavailable while core readiness remains true.

## Login

Open the loopback Cockpit or the reviewed same-origin proxy. Enter the Control Plane token and select
`Přihlásit`. The browser receives an HttpOnly process-local session cookie. Restarting the Control
Plane invalidates the browser session.

## Create/Resume Session

Open Sessions and create a record for the intended working directory. Resume a closed record only
when its project and provider context are still valid. Session records organize operator work; they
do not themselves authorize project execution.

## Inspect Quotas

Open Providers before preparing work. Check freshness, health, five-hour and weekly windows, API
spend, and available models. Missing CLI probes or an absent OpenRouter credential are displayed as
unavailable. Autopilot does not auto-switch a run because another provider appears healthier.

## Prepare

Open Runs, select an enabled project, a fresh available provider/model, enter the prompt, estimate,
and requested artifact types, then select `Připravit běh`. Prompts above the review threshold require
an explicit acknowledgement. Preparing persists a draft; it does not dispatch.

## Revise

Review the exact stored prompt and token estimate. Edit and prepare a new revision when needed. Every
revision remains distinct so approval cannot silently move to newer text.

## Approve

Approve the exact revision as the operator. Approval is a state transition, not a suggestion. A
missing, stale, or mismatched approval prevents dispatch.

## Run

The durable supervisor reserves tokens, queues the approved handoff, applies routing and provider
guards, and records the terminal outcome. Do not run a paid or credentialed lane merely to verify
installation; use the deterministic smoke command instead:

```bash
npm run smoke:cockpit-run -- --dry-run
```

## Inspect

Inspect the approved input, reservation lifecycle, supervisor/worker identifiers, bounded redacted
output, artifacts, retry accounting, cost evidence, and observability timeline. Treat missing output
or a provider error as a failed run even if a CLI narrated progress.

## Cancel

Sessions can be closed from the Cockpit. Worker-process cancellation exists as an operator CLI but
is not wired into the current Cockpit; its button is intentionally unavailable. Use the
[service runbook](operations/service-runbook.md) and confirm the exact worker ID before any CLI cancel.

## Incident Repair Packet

Operational failures create bounded incidents with fixed codes and correlation IDs. The Cockpit can
prepare and copy a manual repair packet labeled `external_autopilot_repair`. It never executes that
packet. Apply fixes outside the governed project run and acknowledge the incident only after proof.

## Known UI Limits

- UI labels are currently partly Czech although canonical documentation is English.
- Browser authentication is single-user and process-local.
- Worker cancellation is not connected to the Cockpit.
- Visual requests are recorded, but only text artifacts are currently produced.
- Repair packets are manual and do not modify Autopilot.
- Batch, scheduling, dependency graphs, and automatic multivendor brainstorming are not implemented.
