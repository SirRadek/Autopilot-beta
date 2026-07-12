# Autopilot VM recovery runbook

## Safety invariants

- The live state directory is `~/.local/state/autopilot` and must be mode `0700`.
- `~/.config/autopilot/control-plane.env` must be mode `0600` and is never included in state backups.
- Restore is validation-only unless `--apply` is present.
- Apply refuses a non-empty target. Never restore directly over the live state directory.
- Stop the Control Plane before a recovery cutover and retain the old directory until verification passes.

## Routine checks

```bash
systemctl --user status autopilot-control-plane.service
systemctl --user list-timers 'autopilot-*'
npm run ops:health -- 8787
npm run ops:maintenance -- ~/.local/state/autopilot ~/.config/autopilot/control-plane.env
```

The maintenance command is a dry run unless `--apply-rotation` is supplied. Findings contain only
file names and rule identifiers, never secret values.

Maintenance writes and validates the backup before rotation. Rotation retains only a bounded recent
archive plus a bounded current JSONL file; older history remains in that pre-rotation backup. If a
state file exceeds the backup safety cap, maintenance stops instead of rotating away unbacked data.

## Create and validate a backup

```bash
npm run ops:backup -- ~/.local/state/autopilot ~/.local/state/autopilot-backups
npm run ops:restore -- ~/.local/state/autopilot-backups/FILE.apbackup.json /tmp/autopilot-restore-check
```

The second command validates schema, safe relative paths, sizes, and SHA-256 checksums. It writes
nothing in validation mode.

## Recovery drill or real recovery

1. Validate the selected backup using the command above.
2. Choose a new empty staging directory; do not select the live state directory.
3. Apply into staging:

   ```bash
   npm run ops:restore -- ~/.local/state/autopilot-backups/FILE.apbackup.json ~/.local/state/autopilot-restore-staging --apply
   ```

4. Inspect staged permissions and run read-only status commands against it.
5. For a real cutover, stop `autopilot-control-plane.service`, rename the live directory to a
   timestamped quarantine name, rename staging to `autopilot`, and start the service.
6. Verify `/health`, sessions, approvals, workers, provider snapshots, and audit continuity.
7. Roll back by stopping the service and restoring the quarantined directory if any check fails.

This repository's automated drill never performs steps 5–7 against the live VM.
