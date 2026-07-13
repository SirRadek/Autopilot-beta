# VM control-plane service

Install on the VM as the `radek` user:

```bash
mkdir -p ~/.config/autopilot ~/.local/state/autopilot
chmod 700 ~/.config/autopilot ~/.local/state/autopilot
printf 'CONTROL_PLANE_TOKEN=%s\n' "$(openssl rand -hex 32)" > ~/.config/autopilot/control-plane.env
printf 'CONTROL_PLANE_SECURE_COOKIES=true\n' >> ~/.config/autopilot/control-plane.env
chmod 600 ~/.config/autopilot/control-plane.env
mkdir -p ~/.config/systemd/user
cp ops/systemd/*.service ops/systemd/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now autopilot-control-plane.service
systemctl --user enable --now autopilot-control-plane-health.timer autopilot-state-maintenance.timer
```

The service binds only to `127.0.0.1`. Keep the environment file outside the repository.

The service starts the provider-quota scheduler with the same persistent state directory and
session registry. It polls only providers with active sessions, persists snapshots/events in
that directory, and stops polling cleanly on `SIGTERM`/`SIGINT` before systemd terminates it.

OpenRouter credentials are intentionally not included in this unit or repository. Without an
injected `OPENROUTER_API_KEY`, its quota snapshot is reported as `unavailable`; provision the
secret through the VM's user service environment/secret manager when API quota polling is wanted.
Provider CLI quota commands are likewise explicit capabilities and are unavailable unless the
runtime injects their command configuration.

`autopilot-control-plane-health.timer` checks the loopback `/health` endpoint every two minutes.
`autopilot-state-maintenance.timer` first checks private permissions and scans bounded head/tail
chunks for secret-like material. Only a clean preflight proceeds to an atomic bounded backup and
bounded JSONL rotation. The service deliberately keeps the host `/tmp` visible because Codex,
Claude, and AGY `/status` or `/usage` probes communicate with their existing tmux sessions through
the per-user tmux socket. Other hardening remains enabled; as a user service it starts without
privileged Linux capabilities.

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
systemctl --user restart autopilot-control-plane.service
systemctl --user is-active autopilot-control-plane.service
cd ~/autopilot-beta
npm run ops:health -- 8787
```

The expected health response is `{"ok":true}`. Record the revision, path, command output, service
state, and smoke correlation identifiers. Never report VM or service verification from host-only
results, and never run the smoke command against the persistent service state.
