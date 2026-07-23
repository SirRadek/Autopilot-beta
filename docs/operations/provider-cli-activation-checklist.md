# Provider CLI activation checklist

This checklist records privacy-safe activation gates. It never records credentials,
account identifiers, or raw quota/usage values. Provider installation does not
authorize live task execution; the first governed DEV smoke run remains a separate
owner-approved checkpoint with a token estimate.

## Codex CLI

- [x] Exact CLI bundle installed and reachable through the service `PATH`.
- [x] Owner completed interactive login; only the successful status exit was observed.
- [ ] `CONTROL_PLANE_USAGE_PROBES=codex` backed up, activated, and restart-verified.
- [ ] Temporary `codex_cli` status session produced a fresh healthy snapshot.
- [ ] Temporary session closed and verified closed.
- [ ] Owner accepted the privacy-safe result before Claude activation.

Run the owner checkpoint from the host:

```bash
autopilot-provider-codex-activate-task2
```

Expected terminal sentinel:

```text
CODEX_PROVIDER_TASK2_OK probes=codex session=closed routing=unchanged
```

The command may report provider status, error code, freshness, and model
availability booleans. It must not print quota values, tokens, credentials, or
project paths. On a post-edit failure it restores the complete backed-up
environment file and restarts the control plane before returning non-zero.

## Claude CLI

- [ ] Owner checkpoint after Codex accepted.
- [ ] Interactive login, incremental probe enablement, temporary status session,
  privacy-safe acceptance, and verified close.

## AGY CLI

- [ ] Owner checkpoint after Claude accepted.
- [ ] Interactive login, incremental probe enablement, temporary status session,
  privacy-safe acceptance, verified close, and rollback drill.

Routing, selected models, and reasoning effort remain unchanged throughout this
activation plan.
