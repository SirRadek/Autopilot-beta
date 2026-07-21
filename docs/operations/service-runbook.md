# Service runbook

[Back to the documentation index](../README.md)

All commands run in the VM. Persistent units are system units; do not substitute `systemctl --user`.

## Deploy

1. Verify the candidate SHA, Node 24, clean worktree, and passing repository gate.
2. Back up and validate live state.
3. Stop legacy user units and the current system service.
4. Place the exact candidate at `/home/radek/autopilot-beta` with `npm ci` complete.
5. Copy reviewed units to `/etc/systemd/system`, daemon-reload, then start.
6. Run liveness, readiness, boundary, and Cockpit smoke checks before declaring success.

Never deploy by copying an uncommitted source directory over the live checkout.

## Start

```bash
sudo systemctl start autopilot-control-plane.service
sudo systemctl start autopilot-control-plane-health.timer autopilot-state-maintenance.timer
```

Start fails when the environment, runtime, state, or write boundary is invalid. Fix the cause; do not
remove an `ExecStartPre` probe.

## Stop

```bash
sudo systemctl stop autopilot-control-plane.service
```

The process stops quota polling and drains the active supervisor poll within a bound. Stop the service
before state restore, checkout swap, or legacy OpenRouter migration cutover.

## Restart

```bash
sudo systemctl restart autopilot-control-plane.service
```

Restart invalidates process-local browser sessions. Operators must log in again.

## Status

```bash
sudo systemctl status autopilot-control-plane.service --no-pager
sudo systemctl list-timers 'autopilot-*'
```

## Logs

```bash
sudo journalctl -u autopilot-control-plane.service -n 200 --no-pager
sudo journalctl -u autopilot-state-maintenance.service -n 100 --no-pager
```

Do not paste raw journals into prompts. Extract fixed error codes, timestamps, unit state, and bounded
correlation IDs; redact credentials and provider output.

## Liveness

```bash
npm run ops:health -- 8787
```

Expected body: `{"ok":true}`. Liveness does not prove state or provider readiness.

## Readiness

```bash
npm run ops:ready -- 8787
```

Core components must be ready. Optional providers may be explicitly degraded/unavailable. A 503 means
configuration or managed core state is not safe for work.

## Upgrade

1. Build and verify a separate candidate checkout.
2. Record candidate and rollback SHAs.
3. Run isolated VM acceptance without provider spend.
4. Back up live state and validate the archive.
5. Stop the service, atomically switch the checkout, run `npm ci`, and copy changed units.
6. Start and repeat acceptance. Retain the previous checkout and backup.

## Cockpit static release update (second and later)

The first production proxy cutover uses `ops/cockpit-proxy/live-cutover.sh`, which is deliberately
initial-only: it refuses unless Caddy is masked/inactive and the firewall is absent. Once the proxy is
live (Caddy active/enabled, firewall active, `CONTROL_PLANE_SECURE_COOKIES=true`,
`current -> releases/<sha>`), advance the static Cockpit to a newly staged release with the follow-on
operator instead. It never re-runs the initial cutover.

The follow-on operator (`ops/cockpit-proxy/release-update.sh`) executes **only** from the fixed,
root-owned trusted path `/usr/local/libexec/autopilot-cockpit-release-update`; run as root it refuses
any other `$0`. `bash ops/cockpit-proxy/release-update.sh …` is therefore not a supported production
invocation — the worker is published by the image-provisioning root channel and then invoked from its
installed path. `sudo npm` and sudo'd checkout scripts remain prohibited (see
`ops/cockpit-proxy/trusted-bootstrap-contract.json`); running the installed, root-owned,
integrity-verified worker under `sudo` is the trusted path itself, not a checkout script.

0. **Install/refresh the worker (provisioning root channel, once per reviewed SHA).** From the image
   provisioning root channel — not via `sudo npm` — run
   `npm run ops:cockpit-proxy:release-update:install` (equivalently `bash
   ops/cockpit-proxy/install-release-update.sh`). It integrity-pins the worker bytes against
   `ops/cockpit-proxy/release-update.provenance.json` and atomically installs
   `/usr/local/libexec/autopilot-cockpit-release-update` as `root:root 0755`, printing
   `RELEASE_UPDATE_WORKER_INSTALLED <sha256>` (or `…_ALREADY_INSTALLED` when current). It refuses to
   install worker bytes that do not match the pinned provenance.
1. Build the candidate from one exact clean SHA on `origin` with Node 24 and stage it immutably with
   `npm run ops:cockpit-proxy:stage -- <checkout> /srv/autopilot-cockpit`.
2. As root, invoke the installed trusted worker:
   `sudo /usr/local/libexec/autopilot-cockpit-release-update <checkout> /srv/autopilot-cockpit <sha>`.
   The worker fails closed on every SHA/checkout/origin/ownership/symlink/manifest/current-release/
   service/firewall/Caddy/port invariant (the manifest check binds the served release to the checkout
   `cockpit/dist` bytes, not just entry names), then makes its **only** production change: atomically
   replacing the root-owned `current` symlink. Because Caddy resolves that symlink per request, no
   Caddy reload, config, firewall, environment, or Control Plane change occurs, and managed state
   content, provider, model, and reasoning boundaries are untouched. Preflight does write one additive
   artifact — a fresh backup archive under `~/.local/state/autopilot/backups` captured as a recovery
   point (managed state itself is not modified). If `current` already targets the accepted SHA it
   reports `RELEASE_UPDATE_ALREADY_CURRENT` and exits without mutating.
3. On `RELEASE_UPDATE_WAITING_FOR_HOST_ACCEPTANCE ACK_ID=<id>`, run the host acceptance suite
   (`ops/cockpit-proxy/host-acceptance.sh`) from Victus against `https://autopilot.local`. If it
   passes within the window, acknowledge with
   `sudo /usr/local/libexec/autopilot-cockpit-release-update --accept <id>`; the worker then prints
   `RELEASE_UPDATE_OK`.
4. Any failed check, a timed-out or absent acknowledgement, or an interruption automatically restores
   the previous `current` symlink (`ROLLBACK_OK`) and retains the failed candidate under its SHA. A
   rollback finalizes its journal even under repeated `Ctrl-C`/stop signals. A transaction interrupted
   before acknowledgement is reconciled with
   `sudo /usr/local/libexec/autopilot-cockpit-release-update --recover` (restoration refuses, reporting
   `ROLLBACK_FAILED`, if the prior release directory is missing or a symlink).

Design authority: [Production Cockpit TLS Proxy Design](../superpowers/specs/2026-07-14-production-cockpit-tls-proxy-design.md).

## Rollback

Stop the service, restore the retained checkout revision, restore its reviewed unit files, and start.
Do not restore an older state snapshot merely because code rolled back; first verify schema
compatibility. If state rollback is required, use the offline staged process in
[State and recovery](state-and-recovery.md).

## Provider Failure

Confirm whether the failure is execution, authentication, quota probe, model availability, or stale
evidence. Do not auto-switch mid-task. Close or pause the affected session, preserve correlation IDs,
and let the owner select another fresh allowed route.

## Personal Codex Efficiency Profile

The personal profile removes only the exact `service_tier = "fast"` line and disables the reviewed
skill set from `ops/codex-efficiency/default-skill-profile.json`. It does not edit the configured
model or reasoning effort.

Always inspect the read-only plan first with Node 24:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH \
  node scripts/codex-efficiency-profile.mjs plan --home /home/radek/.codex
```

Apply only after the owner reviews the hashes, disabled-skill count, and backup destination:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH \
  node scripts/codex-efficiency-profile.mjs apply --home /home/radek/.codex
```

The apply writes a mode-0600 backup and hash metadata, uses an atomic compare-and-swap update, and
reports `restart_required: true`. Start a fresh Codex session before evaluating the reduced catalog.
Rollback also uses compare-and-swap and refuses a live config changed after apply:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH \
  node scripts/codex-efficiency-profile.mjs rollback --home /home/radek/.codex \
  --backup /home/radek/.codex/config.toml.autopilot-efficiency-<timestamp>.bak
```

Do not bypass `codex_version_unavailable`, `codex_version_too_old`, ambiguous/missing skill paths,
ownership checks, symlink checks, duplicate Fast lines, existing profile markers, or CAS mismatch.

## State Lock

For `state_lock_timeout`, check service and maintenance processes. Never delete a lock based only on
age. Reclamation requires verified stale owner identity. Lock-timeout incidents may appear in the
external private spool and are ingested by maintenance.

## Registry Failure

Stop dispatch, validate `projects.json`, permissions, and realpaths. Re-run `projects:init` only to
create missing empty state; it does not repair malformed or unauthorized entries.

## Cookie/Login Failure

Check token presence, cookie secure mode versus HTTP/TLS, proxy `Host`/origin preservation, and recent
restart. Never weaken CSRF or expose the bearer token in browser assets.

## Quota Stale

Check the active session, configured probe allowlist, trusted tmux target, scheduler logs, and snapshot
timestamp. Stale data is a refusal condition for preparing a run, not permission to guess.

## Incident Repair Packet

Prepare the bounded packet in the Cockpit, copy it to a separate Autopilot repair workflow, reproduce,
fix, and verify outside the affected run. The packet is manual and cannot execute itself.

## Uninstall

```bash
sudo systemctl disable --now autopilot-control-plane.service \
  autopilot-control-plane-health.timer autopilot-state-maintenance.timer
sudo rm -f /etc/systemd/system/autopilot-control-plane.service \
  /etc/systemd/system/autopilot-control-plane-health.service \
  /etc/systemd/system/autopilot-control-plane-health.timer \
  /etc/systemd/system/autopilot-state-maintenance.service \
  /etc/systemd/system/autopilot-state-maintenance.timer
sudo systemctl daemon-reload
```

Uninstall does not delete state, projects, configuration, backups, or checkouts. Review and remove
those separately only after retention requirements are satisfied.
