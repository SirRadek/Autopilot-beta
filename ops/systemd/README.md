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
