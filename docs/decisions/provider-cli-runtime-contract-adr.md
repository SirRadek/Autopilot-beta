# ADR: Provider CLI runtime contract — pinned root-owned binary dir, fail-closed resolver

**Date:** 2026-08-05 · **Status:** ACCEPTED (owner approved 2026-08-05).
**Author:** Claude (fable-5 orchestrator draft, cockpit-functional Phase 2).

## Context

The control plane on the VM cannot invoke any provider CLI. The systemd unit pins
`Environment=PATH=/usr/bin:/bin` (`ops/systemd/autopilot-control-plane.service:11`) while the
CLIs live in `~/.local/bin`, so every PATH-based resolution fails. All current invocation sites
resolve by bare name through the ambient PATH:

- `src/data/delivery-system/providerUsageProbe.ts:25-29` — tmux probes launch `codex`, `claude`, `agy` by name inside a tmux session that inherits the server environment.
- `src/data/delivery-system/cliWorkerCapture.ts:342-349` (`resolveAgyPath`: `command -v agy`, falling back to the bare string `"agy"`), `:351-376` (`resolveCodexCommand`), `:1016` (`spawnSync("claude", …)`); `buildVendorEnv` (`:386-404`) forwards PATH into vendor spawns.

The result is that every CLI provider snapshot degrades to `provider_unavailable` and the cockpit shows stale/unavailable quotas (freshness turns `stale` after 5 minutes, `providerQuota.ts:63-81`).

`docs/operations/provider-cli-install.md` already installs checksummed, root-owned CLIs at
`/opt/autopilot-providers/<provider>/<version>/` with published symlinks
`/opt/autopilot-providers/bin/{codex,claude,agy}` (`:32-44`), but activation relies on a PATH
prepend inside the env file (`:55-70`) — an implicit, unverifiable mechanism that has already
failed silently once (this diagnosis) and still allows any writable `~/.local/bin` entry to shadow
the audited binary if PATH ordering ever regresses.

## Decision

1. **Sole production executable source:** the root-owned, manifest-checksummed
   `/opt/autopilot-providers/bin/{codex,claude,agy}` (per `ops/provider-cli/CHECKSUMS.md` and
   `ops/provider-cli/install-provider-cli.sh`) is the only place production code may execute
   provider CLIs from.
2. **New env contract:** `AUTOPILOT_PROVIDER_CLI_BIN_DIR` names that directory explicitly
   (production value `/opt/autopilot-providers/bin`, set in the probe env file per ADR OG-3).
   Tests point it at a fixture dir — mirroring the existing dual-flag test-mode pattern in
   `provider-cli-install.md:46-53`.
3. **Fail-closed resolver:** a single shared resolver returns the absolute path
   `<BIN_DIR>/<cli>` only if it exists and is executable; otherwise it throws. **No fallback to
   `~/.local/bin`, no `command -v`, no bare-name PATH resolution in production.** All four call
   sites migrate to it: the tmux probe command table (`providerUsageProbe.ts:25-29`),
   `resolveAgyPath`/`resolveCodexCommand`/the `claude` spawn in `cliWorkerCapture.ts`. When
   `AUTOPILOT_PROVIDER_CLI_BIN_DIR` is unset, provider CLI execution is unavailable and reported
   as `provider_unavailable` — never silently resolved via PATH.

## Consequences

- **Security:** the provider-invocation trust boundary moves from "whatever PATH finds" (user-writable `~/.local/bin`, mutable by any process running as `radek`) to a root-owned, checksummed, `ProtectSystem=strict`-covered directory. A compromised user account can no longer swap the binary the control plane executes. Misconfiguration surfaces as an explicit resolver error instead of executing an unintended binary.
- **Deployment surface:** none of the systemd units change for this ADR (the env var rides the OG-3 env file), but the operational contract in `provider-cli-install.md:55-70` ("PATH via EnvironmentFile") is superseded and the doc must be rewritten.
- **Availability:** fail-closed means a missing symlink makes the provider unavailable rather than falling back to a working `~/.local/bin` copy. Accepted: unavailable-and-honest beats available-and-unaudited.
- Windows dev paths in `resolveCodexCommand` remain for local development only, gated behind the env var being unset outside production.

## Alternatives considered

- **Fix PATH ordering only (status quo of `provider-cli-install.md:55-70`):** rejected — it repairs today's symptom but keeps trust in PATH ordering, is invisible to review, and this incident proves it fails silently.
- **Per-CLI absolute-path env vars (`AUTOPILOT_CODEX_BIN`, …):** rejected — three vars to drift independently; a single directory contract matches the installer's published layout.
- **Copy CLIs into the repo / vendor them:** rejected — creates a second install/update surface competing with the owner-approved sudo installer.

## Hard boundary and why owner approval is required

CLAUDE.md forbids changing a **deployment surface** or creating a **provider gateway** without an explicit architecture decision. This ADR redefines the trust boundary for every production provider-CLI execution (probes and workers alike) and retires the documented PATH-prepend activation mechanism. Whether production may ever execute a provider binary from outside the checksummed root-owned tree is an owner-level trust decision, not an implementation detail.

