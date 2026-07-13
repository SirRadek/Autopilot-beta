# Autopilot Release Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the audited Ubuntu VM operational blockers, prove the exact revision in an isolated VM deployment, and publish a clickable canonical English documentation set from verified evidence.

**Architecture:** Four independently reviewable plans execute in dependency order. Runtime paths establish authority and storage boundaries; readiness/configuration consumes those boundaries; state safety/recovery then protects all writers and maintenance; documentation is written last from repository and VM evidence.

**Tech Stack:** TypeScript 6, Node 24, Vitest, React/Vite Cockpit, Playwright, systemd user units, Markdown, Codex/Claude/AGY CLI adapters, OpenRouter HTTP adapter.

## Global Constraints

- Supported runtime: Ubuntu VM with Node `>=24 <25`, `/usr/bin/node`, and `/usr/bin/npm`.
- Canonical project-root variable: `AUTOPILOT_PROJECTS_DIR`; default `%h/projects` in systemd and `~/projects` in Node.
- Registered executable projects must resolve to strict children of the configured project root.
- Writable service roots: configured projects root and `~/.local/state/autopilot` only.
- Credentials remain outside the repository and state backups.
- `/health` remains liveness; public `/ready` exposes bounded component codes only.
- Optional unavailable providers degrade readiness but do not make the core unready.
- All persistent provider output is bounded and centrally redacted.
- Backup, validation, rotation, and persistent writers share the state-maintenance lock.
- Restore remains offline, staging-only, validation-first, and failure-atomic.
- English Markdown is canonical; every canonical document is linked from `README.md` and `docs/README.md`.
- Historical ADRs remain immutable; stale competing pages receive explicit superseded markers.
- Preserve the owner's dirty checkout; work only in the clean feature worktree.
- Update `vendor-manifest.json` whenever a tracked `src/` file changes.
- No paid provider calls are permitted for verification.

---

## Plan Set and Order

1. [Runtime paths and managed ledgers](2026-07-13-release-baseline-runtime-paths.md)
2. [Readiness and runtime configuration](2026-07-13-release-baseline-readiness-configuration.md)
3. [State safety and recovery](2026-07-13-release-baseline-state-safety-recovery.md)
4. [VM acceptance and canonical documentation](2026-07-13-release-baseline-documentation.md)

Do not begin a later plan until the preceding plan's targeted tests, typecheck, review, and commit gates pass. VM live-service cutover occurs only in Plan 4 after isolated-state acceptance.

## Frozen Decisions

- Reuse `AUTOPILOT_PROJECTS_DIR`; do not introduce a synonym.
- A missing `projects.json` is unready; an initialized, schema-valid empty registry is ready.
- Resolve registered paths to canonical real paths before dispatch. A registered path may contain an in-root symlink, but the canonical dispatched `cwd` must remain a strict child of the canonical project root.
- OpenRouter migration bounds are 4 MiB and 20,000 non-empty JSONL records per ledger.
- Keep legacy OpenRouter ledgers indefinitely until explicit operator archival; automatic migration never deletes them.
- Store backups in `~/.local/state/autopilot/backups` and exclude that directory, lock metadata, temporary files, and pending incident spool files from snapshot input.
- `/ready` is unauthenticated but returns only fixed component names, status enums, fixed error codes, and a timestamp—never paths, exception text, counts, prompts, logs, or credentials.
- Unconfigured CLI probes and missing OpenRouter credentials are `unavailable`; configured providers with no observation are `degraded/not_observed`.
- A lock-timeout failure writes only a fixed safe journal record plus a bounded unique pending-incident spool record. The next successful lock holder ingests that record into the incident store.

## Final Delivery Gate

- [ ] Run all targeted tests named in the four plans under Node 24.
- [ ] Run `npm run typecheck`, `npm run cockpit:test`, `npm run cockpit:build`, and `npm run browser:qa`.
- [ ] Run `npm run verify` and require success.
- [ ] Run static systemd verification on Ubuntu.
- [ ] Deploy the exact candidate revision to an isolated VM checkout and isolated state directory.
- [ ] Complete project-write denial/allow tests, readiness scenarios, no-cost OpenRouter path test, maintenance transaction, restore, recovery drill, and Cockpit dry run.
- [ ] Perform internal architecture, operations/security, and user-flow reviews.
- [ ] Request read-only Claude and AGY reviews; reject narration-only or uncited output.
- [ ] Run `npm run docs:links` after final documentation changes.
- [ ] Record the exact revision and evidence in `docs/status/current-status.md` before any live cutover.

