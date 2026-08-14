# Configuration

[Back to the documentation index](../README.md)

## Paths and ports

| Setting | Default | Authority |
|---|---|---|
| Checkout | `/home/radek/autopilot-beta` | systemd `WorkingDirectory` |
| Managed state | `/home/radek/.local/state/autopilot` | unit argument and `AUTOPILOT_STATE_DIR` |
| Project root | `/home/radek/projects` | `AUTOPILOT_PROJECTS_DIR` |
| Protected runtime environment | `/home/radek/.config/autopilot/control-plane.env` | first `EnvironmentFile` |
| Nonsecret probe allowlist | `/etc/autopilot/control-plane-probes.env` | second `EnvironmentFile` |
| Control Plane | `127.0.0.1:8787` | unit command |
| Isolated acceptance | port `8877` | operator command only |

State and project directories must be mode `0700`; the protected environment file must be
`0600`. The required probe allowlist file is root-owned, nonsecret, and contains only
`CONTROL_PLANE_USAGE_PROBES`.
Admin credentials default to `~/.config/autopilot/admin-credentials.json` at mode
`0600`. Durable auth state lives at `<managed-state>/auth`, is mode-private, and
is excluded from managed-state backup and restore archives.

## Environment variables

### `AUTOPILOT_ADMIN_CREDENTIALS_PATH`

Optional override for the admin credential JSON path. The default is
`~/.config/autopilot/admin-credentials.json`. The configured path must resolve
outside the managed-state directory; otherwise startup fails and authentication
readiness reports `admin_credentials_in_managed_state`. Provision or rotate it
offline:

```bash
AUTOPILOT_ADMIN_USERNAME=admin \
AUTOPILOT_ADMIN_PASSWORD='a-password-of-at-least-12-characters' \
npm run control-plane:set-admin-password
```

Rotation increments `credential_generation` and invalidates all existing browser
sessions. The command prints no credential material.

### Service bearer

Issue the service bearer offline into the auth state root:

```bash
npm run control-plane:issue-service-token -- /home/radek/.local/state/autopilot
```

The command prints `SERVICE_TOKEN=<hex>` exactly once; capture the plaintext in
the root-held service secret. Only its SHA-256 digest is stored by Autopilot. Machine and
commissioning API calls authenticate with `Authorization: Bearer $SERVICE_TOKEN`; the retired
`CONTROL_PLANE_TOKEN` is not an operational bearer. Never expose the service bearer as a `VITE_*`
variable.

### `CONTROL_PLANE_SECURE_COOKIES`

Accepts only `false`, `true`, or empty/unset. Use `false` for loopback HTTP and `true` only behind the
reviewed same-origin TLS proxy. Any other non-empty value prevents startup.

### `CONTROL_PLANE_REQUIRE_SECURE_COOKIES`

Accepts only `false`, `true`, or empty/unset (any other value prevents startup). Independent fail-closed
policy: when `true`, readiness reports the `authentication` component `unavailable`
(`secure_cookies_required`) unless `CONTROL_PLANE_SECURE_COOKIES` is actually `true`. Kept separate from
`CONTROL_PLANE_SECURE_COOKIES` so a single flag cannot silently mask its own absence in a TLS-fronted
production deployment. Set both to `true` in production.

### `CONTROL_PLANE_USAGE_PROBES`

The required `/etc/autopilot/control-plane-probes.env` file contains only this nonsecret
setting. It is a comma-separated allowlist containing `codex`, `claude`, and/or `agy`; unset
or wholly empty disables all probes. Any unknown name or empty comma segment prevents startup
with `invalid_provider_usage_probe_configuration`. The value never accepts a command, path,
argument, or `*_cli` provider ID. Codex is queried with `/status`; Claude and AGY with `/usage`.

Configuration makes a provider eligible for probing but does not itself start a provider
process. An authenticated `POST /providers/probes/refresh` with one to three unique provider
IDs (`codex_cli`, `claude_cli`, `agy_cli`) requests a process-local lease of at most 10 minutes.
The response is `202` with `accepted`, `rejected`, and `expires_at`; unconfigured providers are
rejected. Requests within the 30-second per-provider cooldown do not stack work. Active sessions
and unexpired leases are demand sources, with at most one in-flight probe per provider. A restart
cancels leases, lease expiry stops lease-derived demand, and a later refresh must request a new
lease. Provider GET routes are read-only and never create or extend a lease.

### `AUTOPILOT_PROVIDER_CLI_BIN_DIR`

Production sets this to the normalized absolute directory
`/opt/autopilot-providers/bin` in the protected environment file. Once configured, every
provider invocation resolves only the fixed `codex`, `claude`, or `agy` basename beneath that
root-owned directory; missing, non-executable, or escaping targets fail closed with a bounded
provider error. There is no production fallback to `~/.local/bin` or ambient `PATH` lookup.

### `AUTOPILOT_PROJECTS_DIR`

Absolute root containing supervised project checkouts only. When changed, create a systemd drop-in
that clears and replaces `ReadWritePaths` with the exact same project root:

```ini
# /etc/systemd/system/autopilot-control-plane.service.d/projects-root.conf
[Service]
ReadWritePaths=
ReadWritePaths=/home/radek/.local/state/autopilot /home/radek/.local/state/.autopilot-incident-spool /home/radek/.local/state/.autopilot-runtime-tmp /srv/autopilot-projects
```

Then set `AUTOPILOT_PROJECTS_DIR=/srv/autopilot-projects` once in the environment file. Never add the
Autopilot installation directory to the writable list.

### `OPENROUTER_API_KEY`

Optional credential for the OpenRouter execution/quota lane. Without it, OpenRouter readiness is
`unavailable` with `missing_credential`. Its presence does not authorize spend; token and budget gates
still apply. Do not store the key in managed state or a backup.

## Project registry

`projects.json` is the execution allowlist. An enabled entry requires a stable `project_id`, display
name, absolute `cwd`, and `schema_version: v1`. Realpath containment is checked at use time. Disk
discovery, a session cwd, or a UI selection cannot authorize an unregistered path.

## Provider freshness

The quota scheduler polls only configured capabilities with active-session or unexpired-lease
demand. Snapshots and events are persisted under managed state. A five-minute success interval is
the operating target while demand remains, but the UI must still evaluate each snapshot timestamp,
health, and lease state. Stale evidence disables run preparation.

## Token policy

The gateway enforces bounded prompt input, output allowance, active reservations, terminal retention,
five-hour/weekly evidence, provider access tier, and OpenRouter spend policy. Budgets are configuration
decisions calibrated from telemetry; documentation does not assign a universal allowance.

## Same-origin proxy

The proxy must terminate TLS, redirect HTTP, preserve `Host`, `Origin`/`Referer`, `Set-Cookie`, and
`Cookie`, avoid caching auth/protected responses, and forward `/auth`, `/status`, `/sessions`,
`/approvals`, `/workers`, `/providers`, `/projects`, `/runs`, `/incidents`, and `/observability` to
loopback. Wildcard CORS and direct public Control Plane access are unsupported.
