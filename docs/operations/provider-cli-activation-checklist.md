# Provider CLI commissioning checklist

This is a blank commissioning template, not evidence that any provider is active. Copy it for
each rollout and record only dates, revisions, fixed error codes, freshness, and pass/fail results.
Never record credentials, account identifiers, raw provider output, or raw quota/usage values.
Provider installation does not authorize live task execution; the first governed DEV smoke run
remains a separate owner-approved checkpoint with a token estimate.

## Commissioning record

- [ ] Date/time (UTC):
- [ ] Operator:
- [ ] Candidate revision:
- [ ] Owner approval reference:
- [ ] Prior probe allowlist and rollback file recorded:
- [ ] Routing, selected models, and reasoning effort recorded as unchanged:

## One-time prerequisites

- [ ] All three manifest-verified executables are installed beneath
  `/opt/autopilot-providers/bin`; no commissioning command uses `~/.local/bin` or a bare
  provider command.
- [ ] The protected `~/.config/autopilot/control-plane.env` contains
  `AUTOPILOT_PROVIDER_CLI_BIN_DIR=/opt/autopilot-providers/bin` and
  `PATH=/opt/autopilot-providers/bin:/usr/bin:/bin`, and contains no
  `CONTROL_PLANE_USAGE_PROBES` assignment.
- [ ] `/etc/autopilot/control-plane-probes.env` was installed root-owned from
  `ops/config/control-plane-probes.env.example`; it contains only
  `CONTROL_PLANE_USAGE_PROBES=` and no secret.
- [ ] A service bearer is provisioned as described in [Configuration](configuration.md), and is
  loaded into the commissioning shell without echoing it:

  ```bash
  read -rsp 'Service bearer: ' SERVICE_TOKEN
  printf '\n'
  export SERVICE_TOKEN
  ```

- [ ] The control plane is healthy before enabling the first provider.

Before every allowlist edit, preserve the root-owned probe file, edit it with `sudoedit`, restart
the service, and use the filtered MainPID environment check in the
[service runbook](service-runbook.md). A startup failure is a stop condition: restore the recorded
probe-file backup and diagnose the fixed error code instead of weakening the parser or service unit.

## Codex CLI

- [ ] Owner completed the supported interactive login as the `radek` service account using
  `/opt/autopilot-providers/bin/codex`; only the success/failure result was recorded.
- [ ] Set the dedicated probe file to exactly `CONTROL_PLANE_USAGE_PROBES=codex`, restarted the
  service, and verified the filtered live environment.
- [ ] Requested a bounded Codex probe lease with the service bearer:

  ```bash
  curl --fail-with-body --silent --show-error \
    --request POST http://127.0.0.1:8787/providers/probes/refresh \
    --header "Authorization: Bearer ${SERVICE_TOKEN}" \
    --header 'Content-Type: application/json' \
    --data '{"providers":["codex_cli"]}' \
    --write-out '\nHTTP %{http_code}\n'
  ```

- [ ] The response was HTTP 202, `accepted` contained only `codex_cli`, and `expires_at` was no
  more than 10 minutes ahead.
- [ ] `GET /providers/health` reported bounded Codex health, freshness, CLI version, error code,
  and lease state without exposing raw quota values:

  ```bash
  curl --fail-with-body --silent --show-error \
    --header "Authorization: Bearer ${SERVICE_TOKEN}" \
    http://127.0.0.1:8787/providers/health
  ```

- [ ] Owner accepted the privacy-safe result before Claude commissioning.

## Claude CLI

- [ ] Codex commissioning was accepted at an explicit owner checkpoint.
- [ ] Owner completed the supported interactive login as the `radek` service account using
  `/opt/autopilot-providers/bin/claude`; only the success/failure result was recorded.
- [ ] Set the dedicated probe file to exactly `CONTROL_PLANE_USAGE_PROBES=codex,claude`, restarted
  the service, and verified the filtered live environment.
- [ ] Requested a bounded Claude probe lease with the service bearer:

  ```bash
  curl --fail-with-body --silent --show-error \
    --request POST http://127.0.0.1:8787/providers/probes/refresh \
    --header "Authorization: Bearer ${SERVICE_TOKEN}" \
    --header 'Content-Type: application/json' \
    --data '{"providers":["claude_cli"]}' \
    --write-out '\nHTTP %{http_code}\n'
  ```

- [ ] The response was HTTP 202, `accepted` contained only `claude_cli`, and `expires_at` was no
  more than 10 minutes ahead.
- [ ] `GET /providers/health` reported bounded Claude health, freshness, CLI version, error code,
  and lease state; no raw quota value was copied into this record.
- [ ] Owner accepted the privacy-safe result before AGY commissioning.

## AGY CLI

- [ ] Claude commissioning was accepted at an explicit owner checkpoint.
- [ ] Owner completed the supported interactive login as the `radek` service account using
  `/opt/autopilot-providers/bin/agy`; only the success/failure result was recorded.
- [ ] Set the dedicated probe file to exactly `CONTROL_PLANE_USAGE_PROBES=codex,claude,agy`,
  restarted the service, and verified the filtered live environment.
- [ ] Requested a bounded AGY probe lease with the service bearer:

  ```bash
  curl --fail-with-body --silent --show-error \
    --request POST http://127.0.0.1:8787/providers/probes/refresh \
    --header "Authorization: Bearer ${SERVICE_TOKEN}" \
    --header 'Content-Type: application/json' \
    --data '{"providers":["agy_cli"]}' \
    --write-out '\nHTTP %{http_code}\n'
  ```

- [ ] The response was HTTP 202, `accepted` contained only `agy_cli`, and `expires_at` was no more
  than 10 minutes ahead.
- [ ] `GET /providers/health` reported bounded AGY health, freshness, CLI version, error code, and
  lease state; no raw quota value was copied into this record.
- [ ] The probe-file rollback was exercised, the approved final allowlist was restored, and the
  service restarted cleanly.

## Closeout

- [ ] After the last 10-minute lease expired, `/providers/health` reported `leased: false`; no GET
  request created or extended a lease.
- [ ] No provider, model, or reasoning route changed during commissioning.
- [ ] The first governed DEV smoke run remains unapproved and undispatched unless separately
  authorized by the owner.
- [ ] The commissioning shell credential was cleared with `unset SERVICE_TOKEN`.
