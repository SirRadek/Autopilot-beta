# State and recovery

[Back to the documentation index](../README.md)

## State boundary

Managed state lives at `~/.local/state/autopilot`, mode `0700`. Regular state files are private and
bounded. The environment file and provider credentials are outside this directory and are never
included in state backups.

The `auth/` child is a separate, mode-private auth state root. It stores only
session and service-token digests and is explicitly excluded from backup file
selection. Archive validation also rejects `auth/` entries, so restore cannot
resurrect a logged-out session or stale service digest.

## Principal files

| File | Owner/purpose | Sensitivity and bounds | Backup/retention |
|---|---|---|---|
| `projects.json` | Explicit project allowlist | Paths; schema validated | Included |
| `session-registry.json` | Operator session records | IDs, cwd, timestamps; bounded | Included |
| `approval-queue.json` | Exact approval decisions | Prompts/IDs may be sensitive; bounded | Included |
| `runs.json` | Revisions, results, artifacts | Redacted/bounded output; bounded records | Included |
| `supervisor-queue.json` | Durable tasks/reconciliation | Bounded prompts and task count | Included |
| `token-gateway-state.json` | Active/terminal reservations | Bounded maps; terminal entries pruned | Included |
| `token-gateway-telemetry.jsonl` | Reservation lifecycle | Bounded append log; maintenance rotation | Included before rotation |
| `provider-quota-snapshots.json` | Latest provider evidence | No credentials; bounded snapshots | Included |
| `provider-quota-events.jsonl` | Quota history | Bounded append log; maintenance rotation | Included before rotation |
| `openrouter-api-attempts.jsonl` | API attempt evidence | No key; bounded lines | Included before rotation |
| `openrouter-api-spend.jsonl` | Observed API spend | Cost metadata; bounded lines | Included before rotation |
| `autopilot-incidents.json` | Operational incidents | Max 256; bounded text/correlations | Included |
| `control-plane-audit.jsonl` | Operator mutations | Bounded append log; maintenance rotation | Included before rotation |
| `cli-call-telemetry.jsonl` | Worker call evidence | Redacted/bounded; maintenance rotation | Included before rotation |
| `vendor-process-registry.jsonl` | Worker process ownership | PIDs/IDs; operationally sensitive | Included before rotation |
| `agent-registry.jsonl` | Worker registry evidence | Bounded operational metadata | Included before rotation |
| `auth/sessions.json` and `auth/service-token.json` | Durable browser sessions and service bearer digest | Token digests only; max 256 sessions | Excluded; never restored |

The external `~/.local/state/.autopilot-incident-spool` is a private lock-timeout fallback, capped at
256 files of 16 KiB. Maintenance ingests valid records; it is intentionally outside the main state
lease and backup.

## Locking and atomicity

Persistent writers share `.state-maintenance.lock`. The owner record and reclaim marker are validated
before stale reclamation. JSON stores publish atomically where supported. A backup is a valid
restart-safe snapshot, not a zero-RPO multi-file database transaction; supervisor reconciliation must
handle legitimate intermediate workflow state.

## Maintenance

```bash
npm run ops:maintenance -- ~/.local/state/autopilot \
  ~/.local/state/autopilot/backups ~/.config/autopilot/control-plane.env
```

This is dry-run by default. `--apply` holds one lease across permission/secret checks, incident-spool
ingestion, backup creation, immediate archive validation, JSONL rotation, and retention pruning.
The secret scan skips only canonical `autopilot-state-*.apbackup.json` snapshots; it scans every
other regular file in the backup directory, including legacy environment copies. Rotation never
runs after a failed lock, backup, or validation.

Backup safety defaults cap an individual file at 4 MiB, the total payload at 32 MiB, and file count at
2,000. Operational retention keeps seven recent state snapshots and zero legacy environment copies
by default because the protected environment is regenerated rather than restored. Oversize state
fails closed rather than being silently omitted.

## Create and validate

```bash
npm run ops:backup -- ~/.local/state/autopilot ~/.local/state/autopilot/backups
npm run ops:restore -- ~/.local/state/autopilot/backups/FILE.apbackup.json \
  /tmp/autopilot-restore-check
```

Without `--apply`, restore validates schema, size, safe relative paths, base64 payloads, and SHA-256
checksums without writing the target.

## Automated recovery drill

```bash
AUTOPILOT_STATE_DIR=~/.local/state/autopilot \
AUTOPILOT_PROJECTS_DIR=~/projects \
  npm run ops:recovery-drill -- ~/.local/state/autopilot/backups/FILE.apbackup.json
```

The drill restores to an owned temporary directory, reconciles the supervisor, runs pure readiness
validation, reports bounded results, and removes staging. It never mutates live state.

## Offline staged recovery

1. Stop the Control Plane.
2. Validate the selected archive without `--apply`.
3. Choose an empty staging directory outside live state.
4. Apply into staging:

   ```bash
   npm run ops:restore -- ~/.local/state/autopilot/backups/FILE.apbackup.json \
     ~/.local/state/autopilot-restore-staging --apply
   ```

5. Check mode `0700`, schemas, supervisor reconciliation, and readiness against staging.
6. Rename live state to a timestamped quarantine path; rename staging to `autopilot`.
7. Start the service and verify health, readiness, sessions, approvals, workers, providers, audit, and
   Cockpit login.
8. Roll back by stopping, quarantining the failed restored state, and restoring the retained live
   directory.

No repository command performs the live directory swap automatically.

## OpenRouter migration

Legacy attempt/spend ledgers directly beside the state directory are migrated once into managed state
using validated bounded reads, atomic no-overwrite publication, byte verification, and source
revalidation. Stop all legacy writer generations first. The source is retained as evidence and is
never deleted automatically.

## Guarantees and non-guarantees

Backups are checksum-validated, bounded, private local files and are created before rotation. They are
not encrypted at rest, not automatically copied off-host, not zero-RPO, not an environment/credential
backup, and not a substitute for an operator-owned disaster-recovery policy.
