# Delivery System Connector Snapshots

Date introduced: 2026-05-13
Status: phase-0 evidence procedure
Owner: Autopilot Control Plane

Connector snapshots are reviewed evidence inputs. They are not automatic source of truth, not approval, and not permission to mutate remote systems.

## Snapshot Principles

- Read-only first.
- Collect only the fields needed for the current workflow gate.
- Redact secrets, tokens, account IDs, private customer data, and unrelated issue bodies.
- Store summaries and references, not raw dumps, unless raw evidence is explicitly approved.
- Cross-check connector output against local repository state when the task concerns code.
- Remote writes require explicit `REMOTE_MUTATION_APPROVED` scope and a work-log entry.

## Observability Ownership

Before collecting logs, traces, metrics, or CI/deploy evidence, classify the symptom owner:

- `autopilot_control_plane`: MCP, mesh, command-center, governance tests, architecture/work-log process, or local control-plane tooling.
- `project_runtime`: a supervised project's website, API, database, deployment, automation, worker, model route, or user-facing behavior.

Autopilot may store redacted summaries, source pointers, time windows, correlation IDs, suspected layer, and verification results. Raw project runtime logs, CI logs, deployment logs, traces, and metrics remain in the affected project or source system unless an explicit owner decision approves a bounded artifact.

If ownership is ambiguous, stop and resolve `ambiguous_problem_owner` before diagnosing or planning a fix.

## Snapshot Envelope

```yaml
connector_snapshot:
  snapshot_id:
  date:
  requested_by:
  connector:
  mode:
  project_slug:
  target:
  fields_collected:
  redactions:
  source_links:
  summary:
  risks:
  next_action:
```

Allowed `mode` values:

- `READ_ONLY`
- `INSPECT_ONLY`
- `REMOTE_MUTATION_APPROVED`

## GitHub Snapshot Procedure

Use for repositories, branches, commits, pull requests, issues, review comments, GitHub Actions workflow runs, CI job summaries, and CI logs.

Required identifiers:

- repository in `owner/name` form
- branch, PR number, issue number, commit SHA, or workflow run ID when relevant

Read-only fields:

- repository name and default branch
- current branch
- PR title, state, base, head, mergeability, review state
- issue title, state, labels, assignees, milestone
- workflow run status, conclusion, job names, failed steps
- commit hash and author metadata when needed for audit

Rules:

- Prefer local `git` for current checkout facts.
- Prefer GitHub connector or `gh` for PR, issue, branch, and workflow state.
- Do not copy full private issue bodies unless the workflow explicitly needs them.
- Do not re-run workflows, edit issues, add comments, push branches, or merge PRs without `REMOTE_MUTATION_APPROVED`.
- CI logs may contain secrets or account IDs; summarize relevant failing lines instead of storing full logs by default.

Minimum output:

```yaml
github_snapshot:
  repo:
  target_ref:
  item_type:
  item_id:
  state:
  summary:
  evidence:
  redactions:
  next_action:
```

## Linear Snapshot Procedure

Use for issue state, project state, team/cycle context, roadmap alignment, and acceptance criteria references.

Required identifiers before reading:

- workspace or organization context
- team key or team ID
- project ID or issue ID when relevant
- explicit purpose for the snapshot

Rules:

- Do not search broadly across private workspaces without a named team, project, or issue target.
- Do not create, update, assign, label, or comment on issues without `REMOTE_MUTATION_APPROVED`.
- Store only issue keys, titles, status summaries, and acceptance criteria needed for the gate.
- Redact private customer names and internal commercial details unless explicitly approved.

Minimum output:

```yaml
linear_snapshot:
  workspace_alias:
  team:
  project_or_issue:
  state:
  summary:
  acceptance_criteria:
  redactions:
  next_action:
```

## Vercel Snapshot Procedure

Use for project inventory, deployments, build status, environment names, runtime logs, and workflow/runtime research.

Required identifiers:

- Vercel team or project alias
- project name or deployment URL
- environment name when relevant
- time window for logs

Rules:

- Do not expose environment variable values.
- Environment names may be recorded; secret names may be recorded only when needed and without values.
- Deployment logs must be summarized and redacted before ledger storage.
- Do not deploy, promote, roll back, change environment variables, or create workflows without `REMOTE_MUTATION_APPROVED`.
- Treat Workflow and Workflow DevKit facts as unstable and recheck official Vercel docs before implementation decisions.

Minimum output:

```yaml
vercel_snapshot:
  project_alias:
  deployment:
  environment:
  status:
  log_summary:
  redactions:
  next_action:
```

## Cloudflare Snapshot Procedure

Use for Pages projects, Workers, D1 databases, bindings, Workflows, Queues, Durable Objects, Agents, deployments, and runtime logs.

Required identifiers:

- account alias, not raw account ID, unless explicitly approved
- project or Worker name
- environment name
- binding name when relevant
- time window for logs

Rules:

- Do not store account IDs, API tokens, database IDs, or secret values in committed files.
- Binding names may be recorded; binding values must be redacted.
- D1 schema summaries may be recorded; private data rows must not be copied.
- Do not deploy, change bindings, create databases, create queues, create workflows, or mutate Workers without `REMOTE_MUTATION_APPROVED`.
- Treat Cloudflare product facts as unstable and recheck official Cloudflare docs before implementation decisions.

Minimum output:

```yaml
cloudflare_snapshot:
  account_alias:
  product:
  project_or_worker:
  environment:
  bindings:
  status:
  log_summary:
  redactions:
  next_action:
```

## Docket Snapshot Procedure

Docket is a future product knowledge source for sales, product positioning, proposals, and customer-facing context when callable tools are available.

Rules:

- Do not assume Docket connector availability.
- Do not copy customer-sensitive sales content into public docs.
- Use Docket outputs as product-context evidence only after supervisor review.
- Docket context cannot approve scope, architecture, delivery, or governance gates.

Minimum output:

```yaml
docket_snapshot:
  source_alias:
  topic:
  summary:
  confidence:
  redactions:
  next_action:
```

## Local Repository Snapshot Procedure

Use for file inventory, current branch, working tree state, test/build scripts, architecture records, and work logs.

Required checks:

```powershell
git status --short --branch
git remote -v
rg --files
```

For Autopilot, verify that product runtime, deployment, and connector-execution files are not reintroduced. A minimal TypeScript/Vitest governance-contract package is allowed only when covered by `docs/autopilot/delivery-system-runtime-package-decision.md`.

```powershell
git ls-tree -r --name-only HEAD | rg "^(functions|migrations|public|scripts|node_modules|dist|astro\.config\.mjs|wrangler(\.example)?\.toml|playwright\.config\.ts)(/|$)"
```

Expected: no matches unless a later architecture decision explicitly changes the Autopilot deployment/runtime surface.

## Review And Adoption

Before a snapshot can influence a workflow decision:

1. Supervisor checks scope and redactions.
2. Snapshot is summarized into the relevant work log or ledger.
3. Architecture impact is evaluated.
4. Gate owner decides whether the snapshot is sufficient evidence.
5. Any missing evidence is recorded as an issue or open question.

Snapshots are discarded or re-collected when target identifiers were wrong, redaction failed, connector state is stale, local repository state contradicts connector state, or the snapshot would require unapproved remote mutation.
