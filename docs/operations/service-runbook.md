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

## Rollback

Stop the service, restore the retained checkout revision, restore its reviewed unit files, and start.
Do not restore an older state snapshot merely because code rolled back; first verify schema
compatibility. If state rollback is required, use the offline staged process in
[State and recovery](state-and-recovery.md).

## Provider Failure

Confirm whether the failure is execution, authentication, quota probe, model availability, or stale
evidence. Do not auto-switch mid-task. Close or pause the affected session, preserve correlation IDs,
and let the owner select another fresh allowed route.

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
