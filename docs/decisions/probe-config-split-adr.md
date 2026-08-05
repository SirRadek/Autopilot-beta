# ADR: Probe config split — second EnvironmentFile + fail-closed `CONTROL_PLANE_USAGE_PROBES` parsing

**Date:** 2026-08-05 · **Status:** ACCEPTED (owner approved 2026-08-05).
**Author:** Claude (fable-5 orchestrator draft, cockpit-functional Phase 2).

## Context

Two configuration failures combined into the Phase 2 outage. First, `CONTROL_PLANE_USAGE_PROBES`
is present in the env file but absent from the running process environment, so
`providerUsageCommandsFromEnvironment` (`scripts/control-plane-server.ts:83-92`, wired at
`:638-639`) returns `{}`, every CLI adapter short-circuits to `provider_unavailable`
(`providerQuotaAdapters.ts:59-62`), and the cockpit shows stale/unavailable snapshots. Second,
the parser is **silently lenient**: it splits on commas and keeps only tokens matching
`codex|claude|agy` — a typo (`caude`), a wrong separator (`codex claude`), or an unset variable
all yield a quietly reduced (or empty) probe set with zero startup signal. The service runs
"healthy" while its probe configuration is dead.

Structurally, probe enablement today lives in `~/.config/autopilot/control-plane.env`
(`autopilot-control-plane.service:15`) — the same file that carries secrets — inside the
operator's home, where `ProtectHome=read-only` (`:30`) is the only shield and where nonsecret
operational toggles are invisible to review and mixed with credentials.

## Decision

1. **Config split — second EnvironmentFile:** add
   `EnvironmentFile=/etc/autopilot/control-plane-probes.env` to
   `ops/systemd/autopilot-control-plane.service` (after the existing `:15` line; systemd
   assignment-order precedence lets it override the unit's `Environment=` lines). The new file is
   root-owned, world-readable, **nonsecret by contract**: it carries only the probe allowlist
   (`CONTROL_PLANE_USAGE_PROBES=codex,claude,agy`) and `AUTOPILOT_PROVIDER_CLI_BIN_DIR`
   (ADR OG-1). Secrets stay in the existing `~/.config/autopilot/control-plane.env`, which no
   longer carries probe/PATH policy. The unit ships in-repo, so the change is reviewable and
   deployed via the normal release path.
2. **Fail-closed parsing:** `providerUsageCommandsFromEnvironment` becomes strict — the value is
   split on commas, trimmed, lowercased, and **any token outside `{codex, claude, agy}` (or an
   empty token from a dangling comma) throws at startup**, failing the service before it binds,
   exactly like the existing `secureCookiesFromEnvironment` precedent
   (`control-plane-server.ts:94-101`, `invalid_secure_cookie_configuration`). Unset or empty
   remains a valid, explicit "no probes" state (the loopback dev default). A startup log line
   states the resolved probe set so "no probes" is observable, not inferred.

## Consequences

- **Security:** secrets and operational policy separate cleanly; the probe allowlist moves out of the secret-bearing home-dir file into a root-owned `/etc` file that the `radek` user (and thus a compromised control-plane process) cannot edit. Review of "which providers may be probed" becomes a root-gated, diffable file change.
- **Deployment surface:** this **edits the reviewed systemd unit** — the first change to `autopilot-control-plane.service` since the hardening review, and it supersedes the explicit operational rule in `docs/operations/provider-cli-install.md:60-61` that "the three canonical systemd units are never edited." Rollout requires the owner's sudo pass: install the new env file, `systemctl daemon-reload`, restart; rollback is removing one line plus the file. The health and state-maintenance units stay untouched.
- **Availability trade-off:** a typo in the probe list now stops the whole control plane at startup instead of silently dropping a probe. Accepted deliberately: the service refuses to start in a misconfigured state rather than running with invisible degradation — `Restart=on-failure` (`:20`) makes the failure loud in `systemctl status`, and this ADR exists because the silent variant already cost a diagnosis cycle.
- Startup-error paths need coverage in `tests/scripts/control-plane-server.test.ts`.

## Alternatives considered

- **Strict parsing only, keep single env file:** rejected — fixes silent misconfiguration but leaves nonsecret policy inside the secret file in `$HOME`, still user-writable and unreviewable, and leaves OG-1's env var without a reviewable home.
- **`Environment=` lines directly in the unit:** rejected — every probe-set change would be a unit edit + daemon-reload; a dedicated env file changes policy without touching the reviewed unit again.
- **Drop-in unit (`/etc/systemd/system/….service.d/probes.conf`):** viable, but rejected as primary — drop-ins live outside the repo and escape review; an in-repo unit edit keeps the whole deployment surface diffable in one place.
- **Warn-and-continue on unknown tokens:** rejected — a warning in a journal nobody tails is how this outage happened; fail-closed matches the repo's `invalid_secure_cookie_configuration` precedent.

## Hard boundary and why owner approval is required

CLAUDE.md forbids changing a **deployment surface** without an explicit architecture decision and owner approval. This ADR modifies the security-reviewed systemd unit, introduces a new root-owned config file in `/etc`, revokes a documented operational invariant ("units are never edited"), and changes startup failure semantics for the production service. Each of those is an owner-visible operational commitment requiring the owner's sudo to land and the owner's sign-off to be legitimate.

---

