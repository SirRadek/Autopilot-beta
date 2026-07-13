# Install on an Ubuntu VM

[Back to the documentation index](../README.md)

This procedure installs the supported single-operator, loopback-first deployment. Run commands in
the VM unless a step says operator host. Do not replace the live checkout while evaluating a
candidate; use an isolated checkout, state directory, project root, and port.

## Prerequisites

- Ubuntu 24.04 x86-64 with SSH key access.
- System Node `>=24 <25` at `/usr/bin/node` and npm at `/usr/bin/npm`.
- Git, curl, tmux, openssl, and systemd.
- Provider CLIs installed and authenticated only for lanes the operator intends to enable.
- Sudo for system Node installation and root-managed systemd units.

Verify the service runtime, not a shell shim:

```bash
test "$(command -v /usr/bin/node)" = /usr/bin/node
test "$(command -v /usr/bin/npm)" = /usr/bin/npm
/usr/bin/node --version
/usr/bin/npm --version
```

The Node output must be `v24.x`. Ubuntu's default package may not satisfy this requirement; use a
reviewed Node 24 system package or image. Do not point the persistent unit back to a user-writable
runtime merely to bypass this check.

For Playwright browser QA on Ubuntu 24.04, install the browser and its reported dependencies. If apt
asks for the ALSA provider, use `libasound2t64`, not the virtual `libasound2` name.

## Checkout and dependencies

```bash
git clone YOUR_REPOSITORY_URL ~/autopilot-beta
cd ~/autopilot-beta
npm ci
npm run typecheck
npm run verify
npm run cockpit:test
npm run cockpit:build
```

For an unmerged candidate, transfer one exact Git commit to
`~/autopilot-beta-release-baseline` and verify `git rev-parse HEAD`. Do not rsync a source tree without
`.git`, because provenance gates use tracked-file metadata.

## Initialize state and projects

```bash
cd ~/autopilot-beta
npm run projects:init -- ~/.local/state/autopilot ~/projects
chmod 700 ~/.local/state/autopilot ~/projects
```

Register only explicit project real paths below `~/projects`. A custom project root requires matching
environment and systemd writable-path configuration; see [Configuration](configuration.md).

## Configure secrets

```bash
mkdir -p ~/.config/autopilot ~/.local/state/autopilot/backups
chmod 700 ~/.config/autopilot ~/.local/state/autopilot/backups
printf 'CONTROL_PLANE_TOKEN=%s\n' "$(openssl rand -hex 32)" > ~/.config/autopilot/control-plane.env
printf 'CONTROL_PLANE_SECURE_COOKIES=false\n' >> ~/.config/autopilot/control-plane.env
printf 'CONTROL_PLANE_USAGE_PROBES=\n' >> ~/.config/autopilot/control-plane.env
chmod 600 ~/.config/autopilot/control-plane.env
```

Provision `OPENROUTER_API_KEY` through the same protected service environment only when the owner has
approved API-credit use. Never commit or echo it. The example environment intentionally omits tokens.

## Install the system service

Stop legacy user units first so two writer generations cannot run concurrently:

```bash
systemctl --user disable --now autopilot-control-plane.service \
  autopilot-control-plane-health.timer autopilot-state-maintenance.timer 2>/dev/null || true
cd ~/autopilot-beta
sudo cp ops/systemd/*.service ops/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now autopilot-control-plane.service
sudo systemctl enable --now autopilot-control-plane-health.timer autopilot-state-maintenance.timer
```

The units are owned by the system manager but run with `User=radek` and `Group=radek`. This is required
on the target Ubuntu 24.04 VM because AppArmor-restricted unprivileged user namespaces allowed the old
user manager to accept `ProtectHome` while leaving the checkout writable. The new startup probe fails
closed unless state and projects are writable and the installation is read-only. `loginctl
enable-linger` is not required for these system units.

## Cockpit

For loopback development:

```bash
cd ~/autopilot-beta
CONTROL_PLANE_PROXY_TARGET=http://127.0.0.1:8787 npm run cockpit:dev -- --host 127.0.0.1
```

Do not expose the Vite development server publicly. A production browser deployment must build the
Cockpit, serve its static files through a same-origin TLS proxy, forward every protected path to
`127.0.0.1:8787`, and set `CONTROL_PLANE_SECURE_COOKIES=true`. A production reverse-proxy unit is not
supplied by this release.

## Acceptance

```bash
sudo systemctl is-active autopilot-control-plane.service
npm run ops:health -- 8787
npm run ops:ready -- 8787
sudo journalctl -u autopilot-control-plane.service -n 100 --no-pager
npm run smoke:cockpit-run -- --dry-run
```

Acceptance requires:

- system Node 24 and the exact candidate SHA;
- service liveness 200 and core readiness true;
- explicit unavailable/degraded status for unconfigured providers;
- a startup boundary report with two managed writable roots and a read-only installation;
- a deterministic smoke with `provider_invoked: false` and settled reservation;
- no candidate process left on an alternate acceptance port;
- no mutation of the live state during isolated testing.

Do not enable a live provider merely to make readiness look green.
