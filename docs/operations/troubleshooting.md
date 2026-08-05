# Troubleshooting

[Back to the documentation index](../README.md)

Diagnose from fixed codes, unit state, readiness components, correlation IDs, and bounded logs. Never
paste tokens, raw prompts, provider output, cookies, or full state files into a repair prompt.

## Service will not start

1. Run `sudo systemctl status autopilot-control-plane.service --no-pager`.
2. Confirm `/usr/bin/node` is Node 24 and `/usr/bin/npm` exists.
3. Validate the protected environment file exists at mode `0600`, and the required root-owned,
   nonsecret `/etc/autopilot/control-plane-probes.env` exists.
4. Look for `invalid_provider_usage_probe_configuration`,
   `installation_write_boundary_not_enforced`, or
   `managed_write_boundary_unavailable`.
5. Confirm units are root-managed system units, not legacy user units.

Never remove the boundary check. On Ubuntu 24.04, accepted `ProtectHome` directives in a user unit do
not prove that the mount namespace was enforced.

## Health works but readiness is 503

Inspect `npm run ops:ready -- 8787`. Fix only the failing core component:

- `invalid_configuration`: token, absolute paths, private modes, or project root.
- `state_unavailable` / `invalid_state_schema`: state permissions or malformed managed file.
- `project_registry_missing` / `invalid_project_registry`: initialize or validate `projects.json`.
- `invalid_supervisor_state`: stop and perform recovery validation; do not rewrite the queue blindly.
- `invalid_token_gateway_state`: inspect reservation state and backup before repair.

Provider-only unavailable/degraded components do not make core readiness false.

## Verify the live probe configuration safely

For a running service, read only `PATH` and `CONTROL_PLANE_USAGE_PROBES` from the MainPID:

```bash
main_pid="$(sudo /usr/bin/systemctl show \
  --property=MainPID --value autopilot-control-plane.service)"
test "$main_pid" -gt 0
sudo /usr/bin/awk '
  BEGIN { RS = "\0" }
  /^(PATH|CONTROL_PLANE_USAGE_PROBES)=/ { print }
' "/proc/${main_pid}/environ"
unset main_pid
```

Expect only `PATH=/opt/autopilot-providers/bin:/usr/bin:/bin` and the approved probe allowlist.
Do not print, copy, or transform the complete `/proc/<MainPID>/environ`, and do not use
`systemctl show --property=Environment`; the service environment can contain credentials. If the
allowlist is absent, edit the dedicated probe file and restart. If startup reports
`invalid_provider_usage_probe_configuration`, remove the unknown name or empty comma segment; do
not weaken validation.

## Login returns invalid credentials

Confirm the service loaded the expected environment file, then restart after changing the token. Do
not print the token. A restart invalidates existing browser sessions.

## Cookie login works but mutations return 403

The proxy is not preserving a same-origin `Origin`/`Referer` and public `Host`, or the page is being
served cross-origin. Fix proxy routing; do not disable CSRF validation.

## Provider quota is stale or unavailable

Confirm the provider name is present in `CONTROL_PLANE_USAGE_PROBES`, its executable resolves beneath
`/opt/autopilot-providers/bin`, and active-session or unexpired 10-minute lease demand exists. Inspect
the bounded lease state through `GET /providers/health`. If the lease expired, request a new one with
the service-bearer procedure in the
[provider CLI commissioning checklist](provider-cli-activation-checklist.md); a GET must never start
a probe. Confirm the isolated tmux probe cleaned up and the provider still supports `/status` or
`/usage`. For OpenRouter, confirm credential presence without disclosure. Do not infer remaining
quota from an old snapshot.

## Run preparation is disabled

Check project enabled state, quota/model freshness, model intersection, provider health, prompt review
acknowledgement, and estimated tokens. The UI intentionally blocks stale or unavailable routes.

## Approved run does not dispatch

Compare the approved revision, current revision, supervisor task, token reservation, routing mode,
task-package provenance, access tier, and provider capability. A refusal is evidence to repair the
precondition; do not bypass owner approval or token policy.

## Worker narrated progress but no result exists

Treat the run as failed. Check exit code, bounded worker output, `error_reason`, process registry, and
the correlated incident. Provider narration without a persisted final artifact is not completion.

## State lock timeout

Identify the owner process and concurrent maintenance. Do not delete `.state-maintenance.lock` by age
alone. If the owner is live, wait or stop the correct service. If persistence timed out, inspect the
private incident spool and run maintenance after contention clears.

## Maintenance reports a secret

Rotation has stopped safely. Locate the named state file from the bounded finding, remove the secret
through a reviewed repair, rotate the credential outside state, rerun dry-run maintenance, then apply.
Do not commit the contaminated file or archive.

## Backup or recovery drill fails

Keep live state unchanged. Validate archive size, schema, paths, manifest, payload checksums, staging
emptiness, project root, and readiness. Use another known-valid archive or repair current state before
creating a new backup. Never apply a partially validated archive.

## OpenRouter migration conflict

Stop every legacy writer. Preserve both source and managed files. Compare bounded checksums and use
the fixed migration error code (`conflict`, `source_changed`, `malformed`, `unsafe_file`, or size/count
limit) to choose a repair. Never merge spend ledgers by hand during live writes.

## Browser QA cannot find the login heading

Confirm both Control Plane and Vite proxy ports, proxy target, browser dependencies, and that no stale
process owns the test ports. Inspect Playwright trace/screenshot without exposing credentials. On
Ubuntu 24.04 use `libasound2t64` when apt rejects the virtual `libasound2` package.

## Prepare a safe incident report

Record revision, environment label, unit state, exact command, exit code, fixed error code, affected
component, bounded correlation IDs, and whether live state changed. Exclude secrets, raw provider logs,
absolute host-only secret paths, and unredacted output.
