# Configuration

[Back to the documentation index](../README.md)

## Paths and ports

| Setting | Default | Authority |
|---|---|---|
| Checkout | `/home/radek/autopilot-beta` | systemd `WorkingDirectory` |
| Managed state | `/home/radek/.local/state/autopilot` | unit argument and `AUTOPILOT_STATE_DIR` |
| Project root | `/home/radek/projects` | `AUTOPILOT_PROJECTS_DIR` |
| Environment file | `/home/radek/.config/autopilot/control-plane.env` | `EnvironmentFile` |
| Control Plane | `127.0.0.1:8787` | unit command |
| Isolated acceptance | port `8877` | operator command only |

State and project directories must be mode `0700`; the environment file must be `0600`.

## Environment variables

### `CONTROL_PLANE_TOKEN`

Required non-empty shared operator secret. It authenticates bearer clients and creates browser
sessions through `POST /auth/login`. Never expose it as a `VITE_*` variable.

### `CONTROL_PLANE_SECURE_COOKIES`

Accepts only `false`, `true`, or empty/unset. Use `false` for loopback HTTP and `true` only behind the
reviewed same-origin TLS proxy. Any other non-empty value prevents startup.

### `CONTROL_PLANE_USAGE_PROBES`

Comma-separated allowlist containing only `codex`, `claude`, and/or `agy`. Unknown names are ignored;
the setting never accepts an arbitrary command, path, or argument. Keep it empty until trusted tmux
sessions exist. Codex is queried with `/status`; Claude and AGY with `/usage`.

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

The quota scheduler polls only configured capabilities with active sessions. Snapshots and events are
persisted under managed state. A five-minute active-session interval is the operating target, but the
UI must still evaluate each snapshot timestamp and health. Stale evidence disables run preparation.

## Token policy

The gateway enforces bounded prompt input, output allowance, active reservations, terminal retention,
five-hour/weekly evidence, provider access tier, and OpenRouter spend policy. Budgets are configuration
decisions calibrated from telemetry; documentation does not assign a universal allowance.

## Same-origin proxy

The proxy must terminate TLS, redirect HTTP, preserve `Host`, `Origin`/`Referer`, `Set-Cookie`, and
`Cookie`, avoid caching auth/protected responses, and forward `/auth`, `/status`, `/sessions`,
`/approvals`, `/workers`, `/providers`, `/projects`, `/runs`, `/incidents`, and `/observability` to
loopback. Wildcard CORS and direct public Control Plane access are unsupported.
