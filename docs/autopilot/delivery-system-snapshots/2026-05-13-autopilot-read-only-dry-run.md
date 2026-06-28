# Autopilot Connector Snapshot Dry Run

Date: 2026-05-13
Status: accepted read-only evidence
Owner: Autopilot Control Plane
Scope: local repository and GitHub repository metadata

This dry run exercises `docs/autopilot/delivery-system-connector-snapshots.md` without remote mutation.

## Snapshot Envelope

```yaml
connector_snapshot:
  snapshot_id: 2026-05-13-autopilot-read-only-dry-run
  date: 2026-05-13
  requested_by: user
  connector: local_repository_and_github
  mode: READ_ONLY
  project_slug: autopilot-control-plane
  target: local checkout plus SirRadek/autopilot repository metadata
  fields_collected:
    - git branch and working tree state
    - git remote
    - tracked file inventory
    - docs-only runtime boundary scan
    - GitHub repository visibility and default branch
    - open GitHub PRs
    - open GitHub issues
    - recent GitHub Actions workflow runs
  redactions:
    - no secrets collected
    - no issue or PR bodies collected
    - no CI logs collected
    - no account IDs collected
  source_links:
    - https://github.com/SirRadek/autopilot
  summary: Local and GitHub evidence confirmed the Autopilot control-plane repository is private, on default branch main, and was being modified on feature branch codex/execute-delivery-system-plan. At collection time there were no open PRs, open issues, or workflow runs.
  risks:
    - GitHub snapshot only covers metadata available through gh CLI.
    - Linear, Vercel, Cloudflare, and Docket snapshots were not collected in this dry run.
    - Runtime boundary is expected to change only after the runtime/package decision record.
  next_action: Use this dry run as evidence that the snapshot procedure can be followed before adding typed governance contracts.
```

## Local Repository Snapshot

Command evidence:

- `git status --short --branch`: `## codex/execute-delivery-system-plan`
- `git remote -v`: origin fetch/push target is `https://github.com/SirRadek/autopilot.git`
- `rg --files`: repository contains `README.md` and `docs/` files only before typed-contract runtime setup
- runtime boundary scan:

```powershell
git ls-tree -r --name-only HEAD | rg "^(src|functions|migrations|public|tests|scripts|node_modules|dist|package(-lock)?\.json|astro\.config\.mjs|wrangler\.example\.toml|playwright\.config\.ts|vitest\.config\.ts|tsconfig\.json)(/|$)"
```

Result: no matches before the runtime/package decision.

## GitHub Snapshot

```yaml
github_snapshot:
  repo: SirRadek/autopilot
  target_ref: main
  item_type: repository
  item_id: repository_metadata
  state: private
  summary:
    default_branch: main
    local_branch: codex/execute-delivery-system-plan
    open_pull_requests_at_collection_time: 0
    open_issues: 0
    recent_workflow_runs: 0
    latest_release: null
  evidence:
    - gh repo view SirRadek/autopilot --json nameWithOwner,url,visibility,defaultBranchRef,isPrivate,latestRelease
    - gh pr list --repo SirRadek/autopilot --state open
    - gh issue list --repo SirRadek/autopilot --state open
    - gh run list --repo SirRadek/autopilot --limit 5
  redactions:
    - omitted OpenGraph image URL from decision records
    - no issue or PR body data requested
    - no workflow logs requested
  next_action: Proceed to runtime/package decision for typed governance contracts.
```

## Uncollected Connector Snapshots

Linear:

- Not collected.
- Reason: no workspace/team/project identifiers were provided for this dry run.

Vercel:

- Not collected.
- Reason: no Vercel project alias, team alias, deployment URL, or log window was needed for typed-contract setup.

Cloudflare:

- Not collected.
- Reason: no account alias, project, Worker, D1, Queue, Workflow, or binding target was needed for typed-contract setup.

Docket:

- Not collected.
- Reason: no callable Docket tooling surfaced in this session.

## Adoption Decision

This snapshot is sufficient to prove the phase-0 snapshot procedure can be followed for local and GitHub evidence. It is not sufficient for product deployment, connector mutation, runtime engine selection, or external project inventory decisions.

## Later State Change

After this snapshot was collected, draft PR `https://github.com/SirRadek/autopilot/pull/1` was opened from `codex/execute-delivery-system-plan` to `main`. Treat the `open_pull_requests_at_collection_time` value as historical evidence, not current GitHub state.
