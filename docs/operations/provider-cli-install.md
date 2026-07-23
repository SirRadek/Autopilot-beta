# Provider CLI Install (Task 1)

Installs the three subscription provider CLI bundles (`codex`, `claude`, `agy`) into
`/opt/autopilot-providers/` in a single owner-approved `sudo` pass. Install completeness is
not activation — no probe is enabled and no CLI is logged in by this step. See
`docs/superpowers/plans/2026-07-23-vm-provider-cli-activation.md` for the full plan and
`docs/operations/provider-cli-activation-checklist.md` for per-provider probe/login steps.

## Manifest and guard

`ops/provider-cli/CHECKSUMS.md` lists the 4 real files (codex ships two: `codex` and
`codex-code-mode-host`; claude and agy ship one each) with their exact sha256 and size.
`ops/provider-cli/install-provider-cli.sh` reads that manifest and refuses to install unless
the staging directory contains exactly those 4 files as regular files (no symlinks, no extras,
no missing files) with matching sizes and hashes. All validation happens before any destination
directory or symlink is touched — a mismatch fails the whole run closed with no partial state.

## Running the install (production)

```bash
# 1. Owner stages all 4 files (host -> private VM staging dir, never a download):
#      /srv/provider-cli-staging/{codex,codex-code-mode-host,claude,agy}
# 2. One approved sudo pass installs all three providers:
sudo ops/provider-cli/install-provider-cli.sh
```

Defaults: manifest `ops/provider-cli/CHECKSUMS.md` (relative to the script), staging
`/srv/provider-cli-staging`. Override with `PROVIDER_CLI_MANIFEST` / `PROVIDER_CLI_STAGING` if
the owner stages elsewhere. The script requires real root (`EUID 0`) and writes into
`/opt/autopilot-providers/` unless the test-mode override below is used.

Each provider's files land at `/opt/autopilot-providers/<provider>/<version>/`
(root-owned, `0755`, no world-write), and `/opt/autopilot-providers/bin/{codex,claude,agy}`
are published as symlinks to the matching binary — only after every installed file re-hashes
correctly from disk. If a target version directory already exists, the script fails closed
unless every file in it already matches the manifest's identity exactly (idempotent re-run);
it never deletes or overwrites a version directory in place. If publishing the stable symlinks
fails partway through, the script itself rolls every symlink it touched back to its prior
target (or removes it, if none existed) and deletes any version directories it published in
this same run — no on-disk rollback log is written or needed for that in-process recovery.
For recovery beyond a single run (e.g. after a hand rollback of the owner's own change), rely
on the owner-recorded pre-install baseline of `/opt/autopilot-providers/bin/*` and the
preserved old version directories under `/opt/autopilot-providers/<provider>/<old-version>/`,
which the script never deletes.

## Test-mode override (no sudo, disposable root)

Tests exercise the same script logic against a disposable temp directory instead of
`/opt/autopilot-providers`, without ever running as root. This requires setting **both**
`AUTOPILOT_PROVIDER_CLI_TEST_MODE=1` and `AUTOPILOT_PROVIDER_CLI_TEST_ROOT=<temp-dir>` — either
one alone falls through to the production path (`/opt/autopilot-providers`, real-root required),
so a stray env var can never silently redirect a production install. See
`tests/scripts/provider-cli-install.test.ts`.

## PATH via EnvironmentFile

`PATH` is set as `PATH=/opt/autopilot-providers/bin:/usr/bin:/bin` inside
`~/.config/autopilot/control-plane.env` (the control-plane unit's existing
`EnvironmentFile=`), which overrides the unit's own `Environment=PATH=` per systemd
assignment-order precedence. The three canonical systemd units
(`autopilot-control-plane.service`, `autopilot-control-plane-health.service`,
`autopilot-state-maintenance.service`) are never edited. Back up the env file first:

```bash
cp -p ~/.config/autopilot/control-plane.env \
  ~/.local/state/autopilot/backups/control-plane.env.$(date -u +%Y%m%dT%H%M%SZ).bak
```

Also record the pre-change state of `/opt/autopilot-providers/bin/*` (absent) as the symlink
rollback baseline before the first install.
