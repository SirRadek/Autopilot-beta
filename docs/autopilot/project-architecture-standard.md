# Project Architecture And Work Log Standard

Date introduced: 2026-05-13

## Purpose

Every project must have a current written architecture record and a work log. The architecture record explains how the project is shaped now. The work log explains what changed, why it changed, what was verified, and what follow-up work remains.

This standard applies to local projects, GitHub projects, future `/autopilot` inventory entries, and any project supervised through Autopilot.

## Strict Project Separation

Autopilot is a standalone control-plane project. It creates, supervises, audits, and coordinates other projects, but it is not a product runtime and must not share a product repository as its long-term home.

Each supervised project must have a separate local root directory and a separate Git repository. Autopilot may keep registry rows, templates, governance rules, ledgers, sanitized snapshots, and dashboard summaries, but product runtime code belongs in that product's repository.

See `docs/autopilot/repository-separation-policy.md` for the binding separation rule.

## Required Files

Each project gets this file pair:

```text
docs/projects/<project-slug>/architecture.md
docs/projects/<project-slug>/work-log.md
```

Each project must also have a project-specific Decision Mesh:

```text
docs/projects/<project-slug>/decision-mesh/
```

The project mesh lives with that project's architecture record. If the canonical architecture record is in the product repository, create the mesh there. If Autopilot only has a control-plane mirror under `docs/projects/<project-slug>/`, keep the mirror mesh there until the project repository owns its own architecture records.

Autopilot's root `mesh/` is only Autopilot's operational mesh. It describes how Autopilot routes, governs, reviews, and reasons about work. It must not be reused as the product or project mesh for supervised projects.

The central registry lives at:

```text
docs/autopilot/project-architecture-registry.md
```

## Architecture Record Contract

Each `architecture.md` must include:

- Project identity: name, slug, owner or steward, visibility, status, repositories, runtime surfaces, and last update date.
- Repository boundary: canonical local root, canonical remote repository, separation status, and whether any Autopilot record is only a temporary mirror.
- Purpose and scope: what the project is for and what is explicitly out of scope.
- System boundary: what belongs to this project and what is external.
- Runtime architecture: routes, components, services, storage, background jobs, agents, and execution surfaces.
- Data flows: source, validation, transformation, storage, export, and deletion paths.
- Decision Mesh: path to the project-specific mesh, whether it exists, what project surfaces it covers, and what stop conditions are currently known.
- Integrations: GitHub, Cloudflare, Vercel, Linear, Docket, databases, mail, LLM providers, or other services.
- Deployment and environments: local, preview, production, CI, and known environment variables or bindings without secrets.
- Security and privacy controls: secrets handling, private data boundaries, public disclosure rules, auth, validation, and headers.
- Verification gates: commands, browser checks, external proof, and owner for each gate.
- Known gaps and risks: stale facts, missing tests, manual steps, performance debt, provider uncertainty, or deployment caveats.
- Architecture change triggers: the conditions that require this file to be updated.

## Work Log Contract

Each `work-log.md` entry must include:

```text
Date:
Request or trigger:
Mode: DRY_RUN | INSPECT_ONLY | WRITE_ALLOWED | REMOTE_MUTATION_APPROVED
Scope:
Files changed:
Architecture impact:
Decisions:
Verification:
Risks:
Follow-up:
```

If the architecture did not change, the entry must say:

```text
Architecture impact: none, existing architecture reviewed.
```

## Update Rules

- Update `work-log.md` after every meaningful work slice, even when no files changed.
- Update `architecture.md` whenever runtime boundaries, data flows, integrations, storage, deployment, security posture, verification gates, or project scope change.
- Create the project-specific Decision Mesh when project architecture starts if it does not already exist.
- Update the project-specific Decision Mesh after every meaningful completed work slice, or record explicitly why there is no mesh impact.
- Use Autopilot capability routing before implementation planning when the task touches web builds, optimization, data, SEO, automation, recovery, documents, bots/RAG, or 3D.
- Keep any parallel production-studio system behind an explicit architecture decision with source-of-truth and interop rules.
- Active projects must be reviewed at least weekly. If there were no architecture changes, add a work-log entry saying the architecture was reviewed and remains current.
- Inactive projects must be reviewed before new implementation starts.
- Production, deployment, remote mutation, credential, billing, or database work cannot proceed unless the architecture record is current for that project.
- No final handoff may claim completion unless the work log contains the verification evidence and an architecture impact statement.

## Review Cadence

Active project:

```text
Review after every implementation slice.
Weekly architecture freshness review.
```

Paused project:

```text
Review before restarting work.
Monthly review only if it still has a live production surface.
```

Archived project:

```text
Keep final architecture and final work-log summary.
No recurring review unless the project is reactivated.
```

## Registry Rules

The central registry must list each project with:

- project slug
- architecture record path
- work log path
- status
- runtime surface
- deployment surface
- last architecture update
- next review date
- current risks
- separation status

If a project appears in GitHub, Linear, Docket, Cloudflare, Vercel, or local workspace inventory, it must either have a registry row or be explicitly marked as `not yet onboarded`.

## Supervisor Gate

Before a worker starts implementation, the supervisor checks:

```text
1. Project has a registry row.
2. Architecture record exists.
3. Work log exists.
4. Project-specific Decision Mesh exists, or the first architecture task creates it.
5. Architecture is current enough for the requested change.
6. The requested change names expected architecture impact and expected mesh impact.
7. Project has a unique local root and remote repository, or the registry marks it as `split_required`.
8. Autopilot changes do not modify product runtime files unless the handoff explicitly targets that product repository.
9. The final handoff includes verification, architecture log update evidence, and project mesh update evidence.
```
