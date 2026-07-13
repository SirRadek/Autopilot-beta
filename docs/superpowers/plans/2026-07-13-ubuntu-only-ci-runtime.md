# Ubuntu-only CI Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the Autopilot verification workflow with its supported Ubuntu VM runtime and obtain successful `push` and `pull_request` checks.

**Architecture:** Keep the existing single-job workflow and every verification step unchanged. Replace only its Windows runner with GitHub's Ubuntu runner, then verify locally and through both remote workflow triggers.

**Tech Stack:** GitHub Actions, Ubuntu, Node.js 22 in CI, Node.js 24 for local verification, npm, Playwright, Vitest

## Global Constraints

- Autopilot's control plane, provider CLIs, supervisor loop, persistence, and operational tooling are supported on Ubuntu in the managed VM.
- Windows is an operator host for the browser cockpit, SSH, and VM management, not a supported backend runtime.
- Preserve Node setup, dependency installation, Playwright installation, visual QA, and the complete `npm run verify` gate.
- Do not add Windows workarounds, an operating-system matrix, skipped checks, or weaker failure behavior.
- Require both GitHub workflow runs to finish successfully before reporting completion.

---

### Task 1: Move the verification runner to Ubuntu

**Files:**
- Modify: `.github/workflows/verify.yml:9`

**Interfaces:**
- Consumes: the existing `verify` job and its unchanged sequence of npm and Playwright commands
- Produces: the same fail-closed workflow running on `ubuntu-latest`

- [ ] **Step 1: Capture the current failing platform contract**

Run:

```bash
rg -n "runs-on|npm run verify|pdos:visual-qa-browser" .github/workflows/verify.yml
```

Expected: `runs-on: windows-latest` followed by the existing visual QA and full verify commands.

- [ ] **Step 2: Change only the runner**

Replace:

```yaml
    runs-on: windows-latest
```

with:

```yaml
    runs-on: ubuntu-latest
```

- [ ] **Step 3: Prove the workflow diff is restricted to the runner**

Run:

```bash
git diff --check
git diff -- .github/workflows/verify.yml
```

Expected: no whitespace errors and exactly one changed line, from `windows-latest` to `ubuntu-latest`.

- [ ] **Step 4: Run the complete local gate on Ubuntu**

Run:

```bash
export PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH
npm run verify
```

Expected: exit code `0`, vendor provenance passes, all Vitest tests pass, all PDOS validations pass, and the Mesh ratchet reports no new stale or unsnapshotted entries.

- [ ] **Step 5: Commit the workflow change**

Run:

```bash
git add .github/workflows/verify.yml
git commit -m "ci: verify on Ubuntu runtime"
```

Expected: commit hooks pass and a commit containing only `.github/workflows/verify.yml` is created.

### Task 2: Deliver and verify both workflow triggers

**Files:**
- No repository file changes

**Interfaces:**
- Consumes: the Task 1 commit on `feature/governed-single-run`
- Produces: terminal GitHub Actions evidence for both `push` and `pull_request`

- [ ] **Step 1: Push through the local fail-closed gates**

Run:

```bash
export PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH
git push origin feature/governed-single-run
```

Expected: vendor provenance, typecheck, all tests, and PDOS fit-safety pre-push gates pass before the remote branch updates.

- [ ] **Step 2: Identify both runs for the new head commit**

Run:

```bash
head_sha=$(git rev-parse HEAD)
gh run list --repo SirRadek/Autopilot-beta --commit "$head_sha" --limit 10 --json databaseId,event,status,conclusion,url,workflowName
```

Expected: one `verify` run for `push` and one for `pull_request`.

- [ ] **Step 3: Wait for both runs without cancelling them**

Run `gh run watch --exit-status` for each database ID returned by Step 2.

Expected: both runs reach `completed` with conclusion `success`. If either fails, preserve its logs and return to diagnosis instead of reporting completion.

- [ ] **Step 4: Confirm the branch and PR state**

Run:

```bash
git status --short
gh pr checks 16 --repo SirRadek/Autopilot-beta
```

Expected: the worktree is clean and all required PR checks pass.
