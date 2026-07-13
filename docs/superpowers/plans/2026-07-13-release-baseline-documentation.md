# VM Acceptance and Canonical Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the repaired revision in the Ubuntu VM, publish a complete clickable English documentation set from that evidence, and independently review the full baseline.

**Architecture:** Verification uses an isolated VM checkout, isolated state, alternate port, and no-cost deterministic provider paths before any live cutover. Canonical Markdown is organized by user intent and validated by a deterministic local-link checker. Historical evidence remains but cannot compete with current authority.

**Tech Stack:** SSH, rsync/git, Node 24, npm, systemd user units, Playwright, Markdown, Vitest.

## Global Constraints

- Do not replace or mutate the live `~/autopilot-beta` checkout during acceptance.
- Do not use `~/.local/state/autopilot` during isolated tests.
- Do not call a paid provider or consume OpenRouter credits.
- Do not claim VM verification from host-only evidence.
- English Markdown is canonical and every canonical page is reachable from both indexes.
- Document deployed evidence, limitations, and non-guarantees precisely.

---

### Task 1: Deterministic documentation-link gate

**Files:**
- Create: `scripts/check-documentation-links.ts`
- Create: `tests/scripts/check-documentation-links.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `checkDocumentationLinks(root, canonicalDocuments): DocumentationLinkReport` and `npm run docs:links`.

- [ ] **Step 1: Write failing valid, broken, orphan, anchor, and external-link tests**

```ts
export interface DocumentationLinkReport {
  readonly checked_files: readonly string[];
  readonly errors: readonly string[];
}
expect(checkDocumentationLinks(root, canonical).errors).toEqual([]);
expect(checkDocumentationLinks(brokenRoot, canonical).errors).toContain("broken_local_link:README.md:docs/missing.md");
expect(checkDocumentationLinks(orphanRoot, canonical).errors).toContain("canonical_document_not_linked:docs/status/current-status.md");
```

Require every canonical path in both `README.md` and `docs/README.md`, except that an index is not required to link to itself; validate relative targets and local anchors; ignore `https:`, `mailto:`, and fenced-code examples.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/scripts/check-documentation-links.test.ts`

Expected: FAIL because the checker is absent.

- [ ] **Step 3: Implement the bounded Markdown link scanner and CLI**

```ts
export const CANONICAL_DOCUMENTS = [
  "README.md",
  "docs/README.md",
  "docs/getting-started.md",
  "docs/user/cockpit-guide.md",
  "docs/architecture/system-overview.md",
  "docs/operations/install-ubuntu-vm.md",
  "docs/operations/configuration.md",
  "docs/operations/service-runbook.md",
  "docs/operations/state-and-recovery.md",
  "docs/operations/troubleshooting.md",
  "docs/status/current-status.md"
] as const;
```

Return sorted deterministic errors, cap scanned file size at 1 MiB, and exit nonzero on errors. Add `docs:links` to `verify` only after all canonical files exist in Task 5.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- tests/scripts/check-documentation-links.test.ts && npm run typecheck`

Expected: PASS for fixtures; repository CLI may still report missing planned documents until Task 5.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-documentation-links.ts tests/scripts/check-documentation-links.test.ts package.json
git commit -m "test: validate canonical documentation links"
```

### Task 2: Host repository verification under Node 24

**Files:**
- No source changes expected.
- Evidence target: `docs/status/current-status.md` in Task 5.

- [ ] **Step 1: Confirm the runtime and clean worktree**

Run: `node --version && npm --version && git status --short`

Expected: Node v24.x, npm available, and no uncommitted implementation changes.

- [ ] **Step 2: Run targeted repair tests**

Run every targeted command from the runtime-path, readiness, and state-safety plans.

Expected: PASS.

- [ ] **Step 3: Run frontend and browser gates**

Run: `npm run cockpit:test && npm run cockpit:build && npm run browser:qa`

Expected: Cockpit tests/build pass and all Playwright Cockpit cases pass.

- [ ] **Step 4: Run complete repository verification**

Run: `npm run verify && git diff --check`

Expected: PASS and no formatting errors.

- [ ] **Step 5: Record the exact candidate revision**

Run: `git rev-parse HEAD`

Expected: one immutable candidate SHA to use for every VM acceptance command.

### Task 3: Isolated Ubuntu VM acceptance

**Files:**
- No repository edits during test execution.
- VM checkout: `/home/radek/autopilot-beta-release-baseline`
- VM state: `/home/radek/.local/state/autopilot-release-baseline`
- VM project root: `/home/radek/projects-release-baseline`
- VM port: `8877`

**Interfaces:**
- Operator host environment: `AUTOPILOT_VM_HOST=radek@192.168.122.99` and `AUTOPILOT_VM_KEY=/tmp/autopilot-vm_ed25519`.

- [ ] **Step 1: Transfer the exact candidate without touching the live checkout**

Run on host:

```bash
export AUTOPILOT_VM_HOST=radek@192.168.122.99
export AUTOPILOT_VM_KEY=/tmp/autopilot-vm_ed25519
rsync -a --delete --exclude node_modules --exclude .git \
  -e "ssh -i $AUTOPILOT_VM_KEY" ./ "$AUTOPILOT_VM_HOST:/home/radek/autopilot-beta-release-baseline/"
```

Expected: only the isolated checkout is synchronized.

- [ ] **Step 2: Install and verify under Node 24**

Run:

```bash
ssh -i "$AUTOPILOT_VM_KEY" "$AUTOPILOT_VM_HOST" \
  'cd ~/autopilot-beta-release-baseline && node --version && npm ci && npm run typecheck && npm run verify'
```

Expected: Node v24.x, install without engine warnings, all gates pass.

- [ ] **Step 3: Initialize isolated state and project registry**

Run:

```bash
ssh -i "$AUTOPILOT_VM_KEY" "$AUTOPILOT_VM_HOST" \
  'cd ~/autopilot-beta-release-baseline && rm -rf ~/.local/state/autopilot-release-baseline ~/projects-release-baseline && npm run projects:init -- ~/.local/state/autopilot-release-baseline ~/projects-release-baseline'
```

Expected: valid empty registry, private permissions, and no live-state mutation.

- [ ] **Step 4: Prove sandbox and managed-ledger boundaries**

Run the repository's systemd boundary tests and a transient user unit mirroring `ProtectHome=read-only` plus the two `ReadWritePaths`. Assert a file can be created inside `~/projects-release-baseline/fixture`, cannot be created in `~/autopilot-beta-release-baseline`, and deterministic OpenRouter migration tests write only beneath isolated state.

Expected: allowed write succeeds; installation/out-of-root write fails; no API request occurs.

- [ ] **Step 5: Run readiness, maintenance, recovery, and Cockpit smoke**

Run:

```bash
ssh -i "$AUTOPILOT_VM_KEY" "$AUTOPILOT_VM_HOST" \
  'cd ~/autopilot-beta-release-baseline && npm run smoke:cockpit-run -- --dry-run && npm run ops:maintenance -- ~/.local/state/autopilot-release-baseline ~/.config/autopilot/control-plane.env ~/.local/state/autopilot-release-baseline/backups --apply && npm run ops:recovery-drill -- "$(ls -1t ~/.local/state/autopilot-release-baseline/backups/*.apbackup.json | head -1)"'
```

Expected: deterministic run settles, backup validates before rotation, drill succeeds in temporary staging, and live state sentinel remains unchanged.

- [ ] **Step 6: Run isolated HTTP/Cockpit acceptance on port 8877**

Start the candidate with an isolated token/state on loopback port 8877, verify `/health`, `/ready`, login cookie behavior, provider degradation, and browser QA through the same-origin development proxy. Stop it cleanly and confirm no candidate process remains.

Expected: liveness 200, core readiness 200, optional providers explicitly degraded/unavailable, and Cockpit workflow passes.

- [ ] **Step 7: Save bounded evidence**

Record candidate SHA, commands, exit codes, service state, state/project paths, readiness component codes, smoke correlation IDs, and recovery result. Do not record tokens, raw output, absolute host-only secret paths, or provider credentials.

### Task 4: Canonical entry, architecture, status, and user documents

**Files:**
- Replace: `README.md`
- Create: `docs/README.md`
- Create: `docs/getting-started.md`
- Create: `docs/user/cockpit-guide.md`
- Create: `docs/architecture/system-overview.md`
- Create: `docs/status/current-status.md`

- [ ] **Step 1: Write the root and documentation indexes with the complete canonical link set**

```markdown
# Autopilot Beta

Autopilot Beta is a governed, single-operator Ubuntu VM control plane for approved Codex, Claude, AGY, and OpenRouter worker runs.

## Documentation

- [Getting started](docs/getting-started.md)
- [Cockpit user guide](docs/user/cockpit-guide.md)
- [System architecture](docs/architecture/system-overview.md)
- [Ubuntu VM installation](docs/operations/install-ubuntu-vm.md)
- [Configuration](docs/operations/configuration.md)
- [Service runbook](docs/operations/service-runbook.md)
- [State and recovery](docs/operations/state-and-recovery.md)
- [Troubleshooting](docs/operations/troubleshooting.md)
- [Current status](docs/status/current-status.md)
```

The README must distinguish supported, tested, VM-verified, partial, and planned behavior.

- [ ] **Step 2: Write getting-started and Cockpit happy path from VM evidence**

Use exact headings: Prerequisites; Install; Initialize State; Register a Project; Start; Check Liveness and Readiness; Login; Create/Resume Session; Inspect Quotas; Prepare; Revise; Approve; Run; Inspect; Cancel; Incident Repair Packet; Known UI Limits.

- [ ] **Step 3: Write the current architecture and trust boundaries**

Include the exact flow Cockpit/CLI → Control Plane → registry/readiness → approval → token gate → supervisor → mesh/dispatch → provider → redaction → locked persistence → observability. Document state files, authentication, provider trust tiers, MCP read-only boundary, project isolation, and non-goals.

- [ ] **Step 4: Write current status from recorded evidence**

Use a table with columns `Capability`, `Repository-tested`, `VM-verified`, `Runtime configuration`, `Limitations`, and `Next step`. Explicitly list single-user/process-local auth, manual repair packets, unavailable UI worker cancellation, text-only artifacts, and absent batch/scheduled/multivendor automation.

- [ ] **Step 5: Run link and content checks**

Run: `npm run docs:links && rg -n 'C:\\|SirRadek/autopilot$|not an execution engine|src/pages/autopilot\.astro' README.md docs/README.md docs/getting-started.md docs/user docs/architecture docs/status`

Expected: link checker passes and stale current-state claims are absent.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/README.md docs/getting-started.md docs/user docs/architecture docs/status
git commit -m "docs: publish Autopilot user and architecture guide"
```

### Task 5: Canonical operations documentation and verify integration

**Files:**
- Create: `docs/operations/install-ubuntu-vm.md`
- Create: `docs/operations/configuration.md`
- Create: `docs/operations/service-runbook.md`
- Create: `docs/operations/state-and-recovery.md`
- Create: `docs/operations/troubleshooting.md`
- Modify: `package.json`
- Modify: `ops/systemd/README.md`
- Modify: `docs/operations/autopilot-recovery-runbook.md`
- Modify: `docs/operations/cockpit-production-auth.md`

- [ ] **Step 1: Write installation and configuration from verified commands**

Document Node 24, npm, tmux, provider CLIs, checkout, `npm ci`, state/project initialization, secrets, systemd units, `loginctl enable-linger`, same-origin proxy boundary, provider probes, OpenRouter credential injection, readiness, and acceptance.

- [ ] **Step 2: Write service and troubleshooting runbooks**

Use exact operation headings: Deploy; Start; Stop; Restart; Status; Logs; Liveness; Readiness; Upgrade; Rollback; Provider Failure; State Lock; Registry Failure; Cookie/Login Failure; Quota Stale; Incident Repair Packet; Uninstall.

- [ ] **Step 3: Write state/retention/recovery guarantees**

List each state file, owner, sensitivity, bounds, rotation, backup inclusion, and migration. State that backups are local, unencrypted, non-zero-RPO, and not off-host. Include offline staged restore and the automated temporary drill.

- [ ] **Step 4: Supersede the two old runbooks and integrate the gate**

Add a prominent superseded notice and link to the canonical replacement where old pages compete. Add `npm run docs:links` to `verify` after all canonical documents exist.

- [ ] **Step 5: Run documentation and repository gates**

Run: `npm run docs:links && npm run typecheck && npm test -- tests/scripts/check-documentation-links.test.ts && npm run verify`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/operations package.json ops/systemd/README.md tests/scripts/check-documentation-links.test.ts
git commit -m "docs: publish Ubuntu service and recovery manuals"
```

### Task 6: Mark stale competing authority

**Files:**
- Modify: `docs/projects/autopilot-control-plane/architecture.md`
- Modify: `docs/projects/autopilot-control-plane/work-log.md`
- Modify: `docs/projects/multi-agent-autonomous-delivery-system/architecture.md`
- Modify: `docs/autopilot/project-architecture-registry.md`
- Modify: `docs/autopilot/workstream-plan.md`
- Modify: `docs/autopilot/decision-mesh-mcp-decision.md`
- Modify: `CLAUDE.md`
- Modify: `GEMINI.md` only if it contains a verified current-runtime contradiction.
- Modify: `scripts/git-hooks/README.md`

- [ ] **Step 1: Add explicit authority banners instead of rewriting history**

```markdown
> **Historical/superseded:** This document records an earlier architecture phase and is not the current operational contract. See [System architecture](../../architecture/system-overview.md) and [Current status](../../status/current-status.md).
```

- [ ] **Step 2: Correct active agent and hook instructions**

Remove Windows-only current commands, document Ubuntu/Node 24, and accurately distinguish pre-commit, commit-msg, pre-push, and CI enforcement. Preserve historical evidence sections.

- [ ] **Step 3: Update the project work log with the repair evidence**

Record scope, commits, tests, VM revision, bounded results, remaining limitations, Decision Mesh impact, and next stage. Do not copy raw provider logs.

- [ ] **Step 4: Run stale-claim and link checks**

Run: `npm run docs:links && rg -n 'Canonical local root: C:|Local workspace: C:|npm\.cmd|no execution runtime|static read-only command center' CLAUDE.md GEMINI.md scripts/git-hooks/README.md docs/projects docs/autopilot/project-architecture-registry.md`

Expected: active authority is corrected; intentional historical matches are explicitly labeled.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md GEMINI.md scripts/git-hooks/README.md docs/projects docs/autopilot/project-architecture-registry.md docs/autopilot/workstream-plan.md docs/autopilot/decision-mesh-mcp-decision.md
git commit -m "docs: retire stale Autopilot authority"
```

### Task 7: Independent review and final verification

- [ ] Dispatch fresh internal architecture, operations/security, and user-workflow reviewers against the full diff.
- [ ] Run Claude read-only review with exact repo-relative evidence requirements.
- [ ] Run AGY read-only review in a fresh project; reject the result if it contains narration without a final cited report.
- [ ] Normalize reports into verified facts, assumptions, risks, and actionable findings.
- [ ] Fix validated findings one bounded commit at a time and rerun affected tests.
- [ ] Run `npm run docs:links`, browser QA, full `npm run verify`, and Ubuntu systemd static verification.
- [ ] Re-run isolated VM acceptance for any runtime-affecting fix.
- [ ] Update `docs/status/current-status.md` with the final passing SHA.
- [ ] Commit the final evidence update.

### Task 8: Live cutover decision gate

- [ ] Present the final diff, test evidence, VM evidence, limitations, rollback revision, and state migration effect to the owner.
- [ ] Do not restart or replace the live service until the owner explicitly approves cutover.
- [ ] After approval, back up and validate live state, deploy the exact passing revision, restart, run liveness/readiness/Cockpit smoke, and retain the previous checkout/state for rollback.
