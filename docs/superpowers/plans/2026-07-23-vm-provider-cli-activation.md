# VM Provider CLI Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is operations/activation work, not a source-code feature: tasks execute on the production VM `192.168.122.99`, not in this repository checkout.

**Goal:** Activate the three subscription provider CLIs (`codex`, `claude`, `agy`) natively inside the production VM, one owner-approved install checkpoint, incremental one-at-a-time probe enablement, no host SSH gateway, no credential copying, no silent routing/model/reasoning change.

**Verified starting facts (2026-07-23, VM `192.168.122.99`):**
- Node `v24.18.0`, `tmux` present; systemd service `PATH=/usr/bin:/bin` correct per `docs/operations/install-ubuntu-vm.md`.
- `codex`, `claude`, `agy` absent from VM; `CONTROL_PLANE_USAGE_PROBES` unset in `~/.config/autopilot/control-plane.env`.
- Control plane accepts `CONTROL_PLANE_USAGE_PROBES` values `codex`, `claude`, `agy` only — never `*_cli` suffixed values.
- Session creation (`/sessions` API, `tests/scripts/control-plane-server.test.ts:861`) uses `agent_command` values `codex_cli`, `claude_cli`, `agy_cli` — a different vocabulary than the probe env var; do not conflate the two.
- Host-staged exact artifacts, one version directory per provider:
  - `codex/0.144.5/`: `codex` sha256 `058d616bde049c0648b72d53a22a54bf428eeb3f10e76cb4d6d4d4f81b764600` size `298500144`; `codex-code-mode-host` sha256 `078eedb385d1c91453422fbc98d7e0f6fda45beeb8225f70b2dae4ef7dc831fd` size `46131096`.
  - `claude/2.1.216/`: sha256 `74deca45220b8080ec75ab099bd5a5980e41a2b5879846a008fb115d436de085` size `267353072`.
  - `agy/1.1.5/`: sha256 `e8f0c3e0bac2815e311d45f26b90c3ec149edecab4736f616990abcc09ed0baf` size `188830144`.

**Architecture:** All three immutable, versioned bundles install in **one** owner-approved `sudo` checkpoint (Task 1), verified against a single checksum manifest with an exact file-count (4) and total-size guard before any file is copied into `/opt/autopilot-providers/`. Provider **probes and logins stay strictly one-at-a-time** (Tasks 2–4): install completeness is not activation. The three canonical systemd units (`autopilot-control-plane.service`, `autopilot-control-plane-health.service`, `autopilot-state-maintenance.service`) are **never edited**; the fixed `PATH=/opt/autopilot-providers/bin:/usr/bin:/bin` is set in the existing backed-up `EnvironmentFile` (`~/.config/autopilot/control-plane.env`), whose value overrides the unit's own `Environment=PATH=` line per systemd precedence — verified post-restart via `systemctl show --property=Environment`. `CONTROL_PLANE_USAGE_PROBES` is edited incrementally: `codex` → `codex,claude` → `codex,claude,agy`, each change backed up first, each followed by a `*_cli` session create/resume to trigger the probe and a privacy-safe acceptance check (status/error-code/model-availability/freshness only, never raw usage). If a CLI invocation fails under `ProtectHome=read-only`, the response is to stop and diagnose (log the failing path, check whether it needs to live under an already-permitted directory) — never to broaden `ReadWritePaths=` automatically. Routing stays `shadow_only`/nullable throughout; Node stays 24.

**Tech Stack:** Ubuntu 24.04 VM, systemd, tmux, Node 24.18.0, existing `ops/*.ts`, `providerUsageProbe.ts`, `readiness.ts`, control-plane HTTP API — no new runtime component.

## Global Constraints

- No host-to-VM SSH gateway; no download step — artifacts move host → private VM staging directory → root-owned `/opt` only after checksum/count/size verification.
- No credential is ever read, copied, or transmitted by an agent; every CLI login is owner-performed interactively in a VM `tmux` session, one provider at a time.
- `CONTROL_PLANE_USAGE_PROBES` accepts only `codex`, `claude`, `agy` (comma-joined) — never `codex_cli`/`claude_cli`/`agy_cli`. Session `agent_command` uses `codex_cli`/`claude_cli`/`agy_cli` — never bare `codex`/`claude`/`agy`. Do not swap these vocabularies.
- Do not edit `autopilot-control-plane.service`, `autopilot-control-plane-health.service`, or `autopilot-state-maintenance.service`. `PATH` is fixed only via the backed-up `EnvironmentFile`.
- Do not enable more than one provider's probe at a time; each enable is its own backup + restart + gate + rollback-capable checkpoint.
- If a CLI fails under `ProtectHome=read-only`, stop and diagnose the exact failing path; do not widen `ReadWritePaths=` without an explicit separate owner decision.
- No paid/live provider call anywhere in this plan; the first real governed DEV smoke run is an explicit separate owner checkpoint outside this plan's scope, requiring its own token-count estimate and owner-approved budget at that time.
- No model, reasoning-effort, or routing change; `shadow_only`/nullable preserved everywhere.
- Every `sudo`, systemd-adjacent, or `.env`/symlink-mutating step ends with a recorded operator checkpoint.
- Estimated implementation budget: 15k–30k aggregate agent tokens across all 5 tasks.

---

### Task 1: Checksum Manifest, Staged Transfer, Single Sudo Install of All Three Bundles

**Files:**
- Create: `ops/provider-cli/CHECKSUMS.md` (single manifest, all 4 files, exact hashes/sizes above — no placeholders)
- Create: `ops/provider-cli/install-provider-cli.sh`
- Create: `docs/operations/provider-cli-install.md`

**Interfaces:**
- Produces: `/opt/autopilot-providers/<provider>/<version>/` (root-owned, `0755`/`0555`, no world-write) for all three providers, plus `/opt/autopilot-providers/bin/{codex,claude,agy}` symlinks, plus a backed-up `~/.config/autopilot/control-plane.env` carrying the fixed `PATH`.
- Consumes later: Tasks 2–4 (per-provider probe/login), Task 5 (verification).

- [ ] **Step 1: Write the manifest and guard**

`ops/provider-cli/CHECKSUMS.md` lists exactly 4 files with their real sha256/size from the facts above (no `<owner-computed-sha256>` placeholder — values are already known). Document the guard: install proceeds only if the staging directory contains exactly 4 files whose combined size equals the sum of the 4 recorded sizes and each individual sha256 matches.

- [ ] **Step 2: Write the install script**

`ops/provider-cli/install-provider-cli.sh`: reads the manifest, verifies file count (4) and total/individual size+checksum against staging (`/srv/provider-cli-staging/` or owner-specified path, never a download), then for each provider does `install -d -o root -g root -m 0755` + `install -o root -g root -m 0755` into `/opt/autopilot-providers/<provider>/<version>/`, then atomically symlinks `/opt/autopilot-providers/bin/<provider>`. Fails closed (non-zero exit, no partial symlink) on any mismatch. Covered locally (no sudo, no VM) by `tests/scripts/provider-cli-install.test.ts`, which drives the script against a disposable temp root via the explicit `AUTOPILOT_PROVIDER_CLI_TEST_MODE=1` + `AUTOPILOT_PROVIDER_CLI_TEST_ROOT=<dir>` override (production default stays `/opt/autopilot-providers` behind an `EUID 0` check) and asserts: rejects running without the test-mode flag; fails closed on missing/extra/tampered/symlinked staged files without touching the destination; installs all 4 files with correct symlinks on a valid staging set; preserves the prior symlink target on a version bump instead of deleting/overwriting in place; fails closed if a target version directory already exists with a different identity.

- [ ] **Step 3: Document PATH-via-EnvironmentFile and back it up**

In `docs/operations/provider-cli-install.md`, state: `PATH` is set as `PATH=/opt/autopilot-providers/bin:/usr/bin:/bin` inside `~/.config/autopilot/control-plane.env` (the unit's existing `EnvironmentFile=`), which overrides the unit's own `Environment=PATH=` per systemd assignment-order precedence — the three unit files are not touched. Back up the env file first: `cp -p ~/.config/autopilot/control-plane.env ~/.local/state/autopilot/backups/control-plane.env.$(date -u +%Y%m%dT%H%M%SZ).bak`. Also record the pre-change state of `/opt/autopilot-providers/bin/*` (absent) as the symlink rollback baseline.

- [ ] **Step 4: Operator checkpoint — one sudo pass installs all three bundles**

Owner stages all 4 files, then runs the install script once under `sudo` for all three providers (`codex`, `claude`, `agy`) in a single approved pass, and adds the `PATH=` line to `control-plane.env`. Confirm all three `/opt/autopilot-providers/bin/*` symlinks resolve and `codex --version` / `claude --version` / `agy --version` each succeed with `PATH=/opt/autopilot-providers/bin:/usr/bin:/bin` (no login yet — version/reachability only). Owner explicitly approves before Task 2. No provider probe is enabled and no CLI is logged in yet — install completeness is not activation.

```bash
sudo systemctl daemon-reload
sudo systemctl restart autopilot-control-plane.service
sudo systemctl is-active autopilot-control-plane.service
systemctl show autopilot-control-plane.service --property=Environment
npm run ops:health -- 8787
```

Expected: service active; `Environment=` output shows `PATH=/opt/autopilot-providers/bin:/usr/bin:/bin` (EnvironmentFile value in effect, not the unit default); health 200; readiness still shows all providers `probe_not_configured` (no probe enabled yet).

**Estimated tokens:** 4k–6k.

---

### Task 2: Codex — Login, Enable `CONTROL_PLANE_USAGE_PROBES=codex`, Session, Acceptance

**Files:**
- Create: `docs/operations/provider-cli-activation-checklist.md`

**Interfaces:**
- Consumes: Task 1 install/PATH.
- Produces: authenticated Codex CLI, `CONTROL_PLANE_USAGE_PROBES=codex` live, a `codex_cli` session, privacy-safe acceptance.

- [ ] **Step 1: Owner interactive login (no agent involvement)**

Owner opens `tmux` as the service user on the VM and runs Codex's own login flow. No agent process reads or stores output. If the CLI fails under `ProtectHome=read-only` (e.g., cannot write its config dir), stop and diagnose the exact path Codex is trying to write — do not broaden `ReadWritePaths=` without a separate owner decision.

- [ ] **Step 2: Backup, enable `codex`, restart, verify PATH**

```bash
cp -p ~/.config/autopilot/control-plane.env ~/.local/state/autopilot/backups/control-plane.env.$(date -u +%Y%m%dT%H%M%SZ).bak
# edit: CONTROL_PLANE_USAGE_PROBES=codex   (bare provider name, not codex_cli)
sudo systemctl restart autopilot-control-plane.service
systemctl show autopilot-control-plane.service --property=Environment
npm run ops:health -- 8787
npm run ops:ready -- 8787
```

Gate: if service fails active or health/ready fails, restore the backup, restart again, stop and report.

- [ ] **Step 3: Create/resume a `codex_cli` session to trigger the probe, then accept**

```bash
curl -s -X POST http://127.0.0.1:8787/sessions \
  -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" -H 'content-type: application/json' \
  -d '{"agent_command":"codex_cli","cwd":"<one of the 18 registered project paths>"}'
npm run ops:ready -- 8787
```

Record only: `components.providers.codex_cli.status` (expect `ready`), `.error_code` (expect `null`), model `available` booleans, snapshot freshness — never raw usage numbers. Update `docs/operations/provider-cli-activation-checklist.md` (Codex: login ✅, probe ✅, session ✅).

- [ ] **Step 4: Operator checkpoint**

Owner reviews the `.env` diff (one line), the session response, and acceptance fields, then approves before Task 3.

**Estimated tokens:** 4k–6k.

---

### Task 3: Claude — Login, Enable `CONTROL_PLANE_USAGE_PROBES=codex,claude`, Session, Acceptance

**Files:**
- Modify: `docs/operations/provider-cli-activation-checklist.md`

**Interfaces:**
- Consumes: Task 2 (Codex fully accepted).
- Produces: authenticated Claude CLI, `CONTROL_PLANE_USAGE_PROBES=codex,claude` live, a `claude_cli` session, acceptance.

- [ ] **Step 1: Owner interactive login for Claude**

Same procedure as Task 2 Step 1, for Claude Code `2.1.216`. Same `ProtectHome=read-only` stop-and-diagnose rule applies.

- [ ] **Step 2: Backup, set `codex,claude`, restart, verify**

```bash
cp -p ~/.config/autopilot/control-plane.env ~/.local/state/autopilot/backups/control-plane.env.$(date -u +%Y%m%dT%H%M%SZ).bak
# edit: CONTROL_PLANE_USAGE_PROBES=codex,claude
sudo systemctl restart autopilot-control-plane.service
systemctl show autopilot-control-plane.service --property=Environment
npm run ops:health -- 8787
npm run ops:ready -- 8787
```

Gate identical to Task 2 Step 2 (restore backup and stop on failure — do not proceed with Codex left in a broken state).

- [ ] **Step 3: Create/resume a `claude_cli` session, accept, checkpoint**

```bash
curl -s -X POST http://127.0.0.1:8787/sessions \
  -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" -H 'content-type: application/json' \
  -d '{"agent_command":"claude_cli","cwd":"<one of the 18 registered project paths>"}'
npm run ops:ready -- 8787
```

Record only `components.providers.claude_cli.status`/`.error_code`/model availability/freshness. Update the checklist. Owner reviews and approves before Task 4.

**Estimated tokens:** 3k–5k.

---

### Task 4: AGY — Login, Enable `CONTROL_PLANE_USAGE_PROBES=codex,claude,agy`, Session, Acceptance, Rollback Drill

**Files:**
- Modify: `docs/operations/provider-cli-activation-checklist.md`

**Interfaces:**
- Consumes: Task 3 (Claude fully accepted).
- Produces: authenticated AGY CLI, `CONTROL_PLANE_USAGE_PROBES=codex,claude,agy` live, an `agy_cli` session, acceptance, and a proven env/symlink rollback.

- [ ] **Step 1: Owner interactive login for AGY**

Same procedure, for AGY `1.1.5`. Same `ProtectHome=read-only` stop-and-diagnose rule applies.

- [ ] **Step 2: Backup, set `codex,claude,agy`, restart, verify, then session + accept**

```bash
cp -p ~/.config/autopilot/control-plane.env ~/.local/state/autopilot/backups/control-plane.env.$(date -u +%Y%m%dT%H%M%SZ).bak
# edit: CONTROL_PLANE_USAGE_PROBES=codex,claude,agy
sudo systemctl restart autopilot-control-plane.service
systemctl show autopilot-control-plane.service --property=Environment
npm run ops:health -- 8787
npm run ops:ready -- 8787
curl -s -X POST http://127.0.0.1:8787/sessions \
  -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" -H 'content-type: application/json' \
  -d '{"agent_command":"agy_cli","cwd":"<one of the 18 registered project paths>"}'
npm run ops:ready -- 8787
```

Record only `components.providers.agy_cli.status`/`.error_code`/model availability/freshness. Update the checklist (all three providers ✅).

- [ ] **Step 3: Prove env and symlink rollback**

Env: temporarily restore the Task 1 (pre-`PATH`) backup, restart, confirm all providers report `probe_not_configured`/PATH regression via `systemctl show --property=Environment`, then restore the latest (all-three-enabled) backup, restart, confirm `ready` returns for all three. Symlink: repoint `/opt/autopilot-providers/bin/codex` at a nonexistent path, confirm `ops:ready` reports `codex_cli` unavailable, repoint back to `0.144.5`, confirm recovery. Never delete a version directory during the drill.

- [ ] **Step 4: Operator checkpoint — full activation and rollback proven**

Owner confirms all three providers are enabled, accepted, and the live system ended in the fully-enabled state (not a rolled-back one).

**Estimated tokens:** 4k–7k.

---

### Task 5: `SessionPane` Stale-Route TDD Hint, Then Final Verification

**Files:**
- Read/Modify: `cockpit/src/features/sessions/SessionPane.tsx`
- Read/Modify: `cockpit/src/features/sessions/SessionPane.test.tsx`
- Modify: `docs/operations/install-ubuntu-vm.md` (cross-reference), `docs/README.md` (if it indexes operations docs)

**Interfaces:**
- Consumes: Task 4's readiness/freshness fields already exposed by `readiness.ts`.
- Produces: a read-only UI hint for stale provider-route freshness, plus a final green repository verification.

- [ ] **Step 1: RED — failing test for the stale-route hint**

In `SessionPane.test.tsx`: given a session bound to `codex_cli` and a freshness prop showing the provider's last-checked timestamp older than the session's `created_at`, the pane renders a visible, non-blocking hint (e.g. "route freshness unverified since activation") without altering `agent_command`, provider, model, or `reasoning_effort`.

```bash
npm run cockpit:test -- SessionPane
```

Expected: FAIL.

- [ ] **Step 2: GREEN — implement the read-only hint**

Add a derived boolean in `SessionPane.tsx` comparing the bound provider's freshness snapshot to the session's own timestamp; render the hint only — no control that changes provider/model/routing.

```bash
npm run cockpit:test -- SessionPane
npm run cockpit:build
```

- [ ] **Step 3: Commit and cross-link docs**

```bash
git add cockpit/src/features/sessions/SessionPane.tsx cockpit/src/features/sessions/SessionPane.test.tsx
git commit -m "feat: hint stale provider route freshness in SessionPane"
```

Add one-line cross-references from `docs/operations/install-ubuntu-vm.md` to `docs/operations/provider-cli-install.md` and `docs/operations/provider-cli-activation-checklist.md`.

- [ ] **Step 4: Final repository verification**

```bash
npm run typecheck
npm run verify
npm run cockpit:test
npm run cockpit:build
npm run docs:links
```

Expected: all green. Owner does a final checkpoint confirming no `.env`/symlink diff remains unapproved on the VM, and notes that the first real governed DEV smoke run (per provider) is a separate, later owner checkpoint requiring its own token-count estimate and budget approval — out of scope for this plan.

**Estimated tokens:** 4k–6k.

---

## Critical Path

Task 1 (single sudo install, all three bundles + PATH via EnvironmentFile) → Task 2 (Codex: login → `codex` probe → `codex_cli` session → accept) → Task 3 (Claude: login → `codex,claude` probe → `claude_cli` session → accept) → Task 4 (AGY: login → `codex,claude,agy` probe → `agy_cli` session → accept → rollback drill) → Task 5 (`SessionPane` TDD hint → final verification).

**PLAN_REVISED**
