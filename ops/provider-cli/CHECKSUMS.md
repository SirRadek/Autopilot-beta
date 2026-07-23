# Provider CLI Install Manifest

Single manifest for the Task 1 one-sudo-pass install of all three subscription provider CLI
bundles (`codex`, `claude`, `agy`). Consumed by `ops/provider-cli/install-provider-cli.sh`.

## Guard

`install-provider-cli.sh` proceeds only if the staging directory contains **exactly 4 regular
files** (no symlinks, no extra files, no missing files), whose individual sizes and sha256
digests match every row below, and whose combined size equals the sum of the 4 sizes below
(`800814456` bytes). Any mismatch — wrong count, wrong size, wrong hash, a symlink, a non-regular
file, or an extra/missing file — fails the install closed before any destination directory or
symlink is touched.

## Files

| provider | version | file | sha256 | size (bytes) |
|---|---|---|---|---|
| codex | 0.144.5 | codex | 058d616bde049c0648b72d53a22a54bf428eeb3f10e76cb4d6d4d4f81b764600 | 298500144 |
| codex | 0.144.5 | codex-code-mode-host | 078eedb385d1c91453422fbc98d7e0f6fda45beeb8225f70b2dae4ef7dc831fd | 46131096 |
| claude | 2.1.216 | claude | 74deca45220b8080ec75ab099bd5a5980e41a2b5879846a008fb115d436de085 | 267353072 |
| agy | 1.1.5 | agy | e8f0c3e0bac2815e311d45f26b90c3ec149edecab4736f616990abcc09ed0baf | 188830144 |

Source: `docs/superpowers/plans/2026-07-23-vm-provider-cli-activation.md` (Task 1, "Verified
starting facts"). Codex ships two files in its version directory (`codex`,
`codex-code-mode-host`); only `codex` is symlinked into `/opt/autopilot-providers/bin/`.
`claude` and `agy` each ship a single file, symlinked under their own provider name.
