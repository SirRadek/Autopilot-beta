# Repository Separation Policy

Date introduced: 2026-05-13

## Rule

Autopilot is a standalone control-plane project. It creates, supervises, audits, and coordinates other projects, but it is not a product runtime and must not share a product repository as its long-term home.

Every project must have:

- its own root directory
- its own Git repository
- its own architecture record
- its own work log
- its own verification gates
- its own deployment and environment boundary

## Target Repository Layout

Local workspace roots should follow this separation:

```text
C:\Programování\Codex\
  # Autopilot control plane only.
  # Registry, templates, governance, ledgers, sanitized snapshots, dashboard.

C:\Users\sirok\Documents\Projects\radeq\
  # Radeq.cz product runtime only.

C:\Users\sirok\Documents\Projects\<project-slug>\
  # One product, tool, service, or client project per repository.
```

Remote repositories should follow the same rule:

```text
SirRadek/autopilot
SirRadek/radeq
SirRadek/<project-slug>
```

## What Belongs In Autopilot

Autopilot may contain:

- project registry
- architecture and governance standards
- reusable templates
- role catalogs
- gate definitions
- decision and issue ledger schemas
- sanitized project snapshots
- connector snapshot procedures
- read-only dashboard code
- automation definitions that monitor or review work

Autopilot must not contain:

- product runtime source code
- product deployment configuration as the canonical source
- product database migrations as the canonical source
- product secrets or environment files
- product assets except redacted/sanitized references
- direct copies of private issue bodies, customer data, or internal client content

## What Belongs In Product Repositories

Each product repository owns:

- source code
- tests
- local dev scripts
- deployment configuration
- migrations and schema
- product-specific documentation
- product-specific architecture record and work log
- product-specific incidents and verification evidence

Autopilot may index or mirror a sanitized summary, but the product repository remains the source of truth for implementation.

## Cross-Project References

Autopilot references projects through registry rows:

```text
project_slug:
local_root:
remote_repo:
architecture_record:
work_log:
status:
last_architecture_update:
next_review:
```

If a project has not yet been split into its own repository, the registry must mark it as:

```text
separation_status: split_required
```

Implementation work on a split-required project should be limited to migration, documentation, or explicitly approved emergency fixes until separation is completed.

## Governance Gate

Before implementation starts on any project, the supervisor must check:

```text
1. Project has a unique local root.
2. Project has a unique remote repository or is explicitly marked `split_required`.
3. Project architecture lives with the project or has a temporary Autopilot mirror with a split plan.
4. Work log lives with the project or has a temporary Autopilot mirror with a split plan.
5. Autopilot changes do not modify product runtime files unless the handoff explicitly targets that product repository.
```

## Current Migration State

The local and remote split is established for Autopilot and Radeq: `C:\Programování\Codex` is the current Autopilot control-plane root for this workspace, `C:\Users\sirok\Documents\Projects\radeq` is the Radeq product root, `SirRadek/autopilot` is the Autopilot repository, and `SirRadek/radeq` is the Radeq repository. Historical notes may still mention the previous `C:\Users\sirok\Documents\Autopilot` checkout as migration evidence.

Completed migration evidence:

- Autopilot governance was pushed to the dedicated `SirRadek/autopilot` repository.
- Legacy Autopilot governance files were removed from the Radeq default branch through reviewed cleanup PR `https://github.com/SirRadek/radeq/pull/1`, merged as `ef7053c`.
- Each future product/project gets its own repository and root directory.
