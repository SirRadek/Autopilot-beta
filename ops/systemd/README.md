# VM control-plane service

> Canonical operator procedures: [Ubuntu VM installation](../../docs/operations/install-ubuntu-vm.md),
> [Configuration](../../docs/operations/configuration.md), and
> [Service runbook](../../docs/operations/service-runbook.md).

The supported VM runtime is Node `>=24 <25` installed at `/usr/bin/node`, with npm at
`/usr/bin/npm`. Verify the exact service runtime before installation:

```bash
test "$(command -v node)" = /usr/bin/node
test "$(command -v npm)" = /usr/bin/npm
/usr/bin/node --version
/usr/bin/npm --version
```

The Node command must report `v24.x`. User-local Node/npm shims are intentionally excluded from
the unit `PATH`; upgrade the system runtime instead of changing the service back to a home path.

Install on the VM for the `radek` runtime account. The units are managed by the privileged system
manager so filesystem namespaces remain enforceable on Ubuntu 24.04 when AppArmor restricts
unprivileged user namespaces; each process still drops to `User=radek` and `Group=radek`:

```bash
mkdir -p ~/.config/autopilot ~/.local/state/autopilot/backups ~/projects
chmod 700 ~/.config/autopilot ~/.local/state/autopilot ~/.local/state/autopilot/backups ~/projects
printf 'CONTROL_PLANE_TOKEN=%s\n' "$(openssl rand -hex 32)" > ~/.config/autopilot/control-plane.env
printf 'CONTROL_PLANE_SECURE_COOKIES=false\n' >> ~/.config/autopilot/control-plane.env
printf 'CONTROL_PLANE_USAGE_PROBES=\n' >> ~/.config/autopilot/control-plane.env
chmod 600 ~/.config/autopilot/control-plane.env
systemctl --user disable --now autopilot-control-plane.service \
  autopilot-control-plane-health.timer autopilot-state-maintenance.timer 2>/dev/null || true
sudo cp ops/systemd/*.service ops/systemd/*.timer /etc/systemd/system/
sudo install -m 0644 ops/systemd/autopilot-tmpfiles.conf /etc/tmpfiles.d/autopilot.conf
sudo systemd-tmpfiles --create /etc/tmpfiles.d/autopilot.conf
sudo systemctl daemon-reload
sudo systemctl enable --now autopilot-control-plane.service
sudo systemctl enable --now autopilot-control-plane-health.timer autopilot-state-maintenance.timer
```

The service binds only to `127.0.0.1`. Keep the environment file outside the repository.
The safe loopback default is `CONTROL_PLANE_SECURE_COOKIES=false`; change it to the only other
accepted value, `true`, only when the cockpit is served through the reviewed same-origin TLS
proxy. Any other non-empty value is invalid and prevents startup.

`CONTROL_PLANE_USAGE_PROBES` is an explicit comma-separated allowlist. The only accepted probe
names are `codex`, `claude`, and `agy`; unknown names are ignored and the value never accepts a
command, path, or arguments. Keep it empty until the corresponding trusted tmux sessions are
available. `ops/config/control-plane.env.example` intentionally contains neither
`CONTROL_PLANE_TOKEN` nor `OPENROUTER_API_KEY`; provision secrets outside the repository.

The control plane defaults `AUTOPILOT_PROJECTS_DIR` to `/home/radek/projects`. Root-managed units use
explicit `/home/radek` paths because `%h` resolves to the system manager's home (`/root`), not the
service account's home. `ProtectHome=read-only`
keeps the installation and the rest of the home directory read-only, while
`ReadWritePaths=/home/radek/.local/state/autopilot /home/radek/.local/state/.autopilot-incident-spool /home/radek/.local/state/.autopilot-runtime-tmp /home/radek/projects`
permits writes only to managed state, its lock-timeout incident spool, its private runtime temporary
directory, and supervised projects. `TMPDIR` points `tsx` and other temporary-file consumers at that
private runtime directory because `ProtectSystem=strict` keeps the shared host `/tmp` read-only.
The tmpfiles definition creates the private spool and runtime temporary directories at boot and
during installation, before systemd constructs the service filesystem namespace. The fixed
`ExecStartPre` commands then enforce their owner and mode on every start. A second unprivileged
`ExecStartPre` writes disposable markers to both managed roots and
must fail to write into the installation; the service does not start if containment is ineffective.
Maintenance backups stay inside managed state at `/home/radek/.local/state/autopilot/backups`.

A custom projects root uses the environment file as its one authoritative assignment. Edit
`~/.config/autopilot/control-plane.env` so it contains exactly one active custom-root assignment:

```dotenv
AUTOPILOT_PROJECTS_DIR=/srv/autopilot-projects
```

Because `EnvironmentFile=` overrides the unit's default `Environment=` assignment, the reviewed
drop-in only clears and replaces the writable-path allowlist:

```ini
# /etc/systemd/system/autopilot-control-plane.service.d/projects-root.conf
[Service]
ReadWritePaths=
ReadWritePaths=/home/radek/.local/state/autopilot /home/radek/.local/state/.autopilot-incident-spool /home/radek/.local/state/.autopilot-runtime-tmp /srv/autopilot-projects
```

Review the resolved paths before reloading the unit. The resolved `AUTOPILOT_PROJECTS_DIR` must
equal the custom projects path in `ReadWritePaths`. The custom root must contain only supervised
project checkouts; do not add the Autopilot installation directory to `ReadWritePaths`.

D3 acceptance requires target-VM positive/negative write proof after the reviewed units are
installed: a write beneath `/srv/autopilot-projects/fixture` must succeed, while writes to the
Autopilot installation and an unlisted home-directory path must fail. R5 does not perform that
proof because it would require installing and restarting the user units; static verification is
not a substitute for the target-VM namespace test.

D3 and any live cutover must also quiesce every legacy OpenRouter writer generation before the
new runtime is enabled. Stop the prior service units and processes, verify that none can still
append to the legacy ledgers directly under `dirname(stateDir)`, and only then start the revision
that writes managed ledgers. Migration revalidates each retained legacy source after publication
and fails if its identity or bytes changed, but there is no shared lock or generation protocol
with old writers. Consequently, code cannot exclude an append that occurs after its final check;
writer quiescence is an operational correctness requirement, not an optional precaution. Retain
the legacy files after cutover as migration evidence.

The service starts the provider-quota scheduler with the same persistent state directory and
session registry. It polls only providers with active sessions, persists snapshots/events in
that directory, and stops polling cleanly on `SIGTERM`/`SIGINT` before systemd terminates it.

OpenRouter credentials are intentionally not included in this unit or repository. Without an
injected `OPENROUTER_API_KEY`, its quota snapshot is reported as `unavailable`; provision the
secret through the VM's service environment/secret manager when API quota polling is wanted.
Provider CLI quota commands are likewise explicit capabilities and are unavailable unless the
runtime injects their command configuration.

`autopilot-control-plane-health.timer` checks the loopback `/health` endpoint every two minutes.
`autopilot-state-maintenance.timer` runs one locked transaction that checks private permissions,
scans bounded head/tail chunks for secret-like material, creates and validates an atomic bounded
backup, rotates bounded JSONL files, and only then prunes retained backups. The service deliberately
keeps the host `/tmp` visible but read-only because Codex, Claude, and AGY `/status` or `/usage`
probes communicate with their existing tmux sessions through the per-user tmux socket. Runtime
temporary files use the separately writable private `TMPDIR`. Other hardening remains enabled; service processes run as the
unprivileged `radek` account without privileged Linux capabilities.

## Governed cockpit dry run

Run the deterministic smoke harness from the exact revision being evaluated:

```bash
cd ~/autopilot-beta
npm run typecheck
npm test -- tests/delivery-system/project-registry.test.ts tests/delivery-system/run-store.test.ts tests/delivery-system/run-orchestrator.test.ts tests/delivery-system/incident-store.test.ts tests/scripts/control-plane-server.test.ts tests/scripts/smoke-cockpit-run.test.ts
npm --prefix cockpit test
npm --prefix cockpit run build
npm run browser:qa
npm run smoke:cockpit-run -- --dry-run
```

The harness creates and deletes its own directory under `/tmp`. It installs one temporary
allowlisted project, prepares and approves through the authenticated loopback Control Plane, and
then runs the durable supervisor task through the production orchestrator and token gateway. The
only injected component is a deterministic worker function that performs no provider call and
reads no provider credential. A successful report has exactly one approved revision, reservation,
supervisor task, worker result, and `settled` terminal reservation event, with matching run,
session, handoff, worker, task, and reservation identifiers. `--live` is rejected by design.

When validating an unmerged feature, sync it to a separate VM path such as
`~/autopilot-beta-governed-single-run` and run the commands there. Do not replace
`~/autopilot-beta`, its state directory, or its environment file merely to test a feature branch.
Only after the exact revision has passed and the operator has chosen to deploy it should the user
service be restarted:

```bash
sudo systemctl restart autopilot-control-plane.service
sudo systemctl is-active autopilot-control-plane.service
cd ~/autopilot-beta
npm run ops:health -- 8787
```

The expected health response is `{"ok":true}`. Record the revision, path, command output, service
state, and smoke correlation identifiers. Never report VM or service verification from host-only
results, and never run the smoke command against the persistent service state.
