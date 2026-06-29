# Autopilot — Next-Session Continuation Plan

**Date:** 2026-06-28 · **Handoff after:** the v0.2 consolidation + origin/main reconciliation session.
**State at handoff:** `origin/main` = `f356c7a`, all gates green (`npm run verify`, 283 tests).

## Where we are (one paragraph)
`autopilot-beta` is now the **single self-contained, portable source of truth**, pushed to
`origin/main`. **Canonical `autopilot` is archived/dead** (`_backups/autopilot-DEAD-archived-2026-06-28`)
— do not touch it. The Decision Mesh + MCP server + query engine + governance docs all live in beta. The
**bind-point ① `related_files` gate** ships and is wired into `verify` (`mesh:gate:ci`, ratchet — rot may
only shrink). **scrapeflow** is the first live project onboarded (its own `.autopilot/decision-mesh`). The
**zednik showcase site** is extracted to `Projects/zednik-hero`; the autopilot example is **genericized to
`local-bricklayer`** (per the naming rule). `runCliWorker` plumbs `cwd/images/addDirs` for real vendor
access. Remote `main` is reconciled with the **point-cloud-background** pattern (PR #5).

## Done (the arcs)
- **v0.2 consolidation (Tier 1+2):** `mesh/`, `src/lib/decision-mesh/`, `mcp/server.ts`, the used
  `src/data/delivery-system/*` modules, `docs/autopilot/`, `prompt-library/`, `docs/projects/` (incl. a
  created `radeq` mesh) → brought into beta. Deps added: `yaml`, `zod`, `@modelcontextprotocol/sdk`.
- **bind-point ① gate:** `src/lib/mesh-tools/related-files-status.ts` + CLI + ratchet baseline
  (`mesh/related-files-baseline.json`) wired into `verify`. Stateless (git blob hash + existsSync) — the
  falsify-probe proved the heavy discovery substrate is an optimization, not a prerequisite.
- **E1 closed:** `loadProjectDecisionMeshFromRoot` resolves repo-local `<repo>/.autopilot/decision-mesh`.
- **scrapeflow onboarded**, **canonical archived**, **siblings collapsed** (bundles in
  `_backups/sibling-bundles/`), **zednik site extracted + example genericized**, **runCliWorker plumbing**,
  **merge with origin/main + push**, **mobile responsive rules R1–R10** (`docs/autopilot/`).

## Etapa backbone status
- **Done:** E0 (ADR), E0.5 (classify), E1 (plumbing), E4a (gate), E4b (ratchet), E6 (consolidation — done
  broader than the original "collapse siblings" plan).
- **E3.5 (discovery primitive spike):** falsify-probe **PASSED** → substrate (ast-grep/SQLite/graphify) NOT
  needed yet; deferred behind measured pain.
- **Grounded & ready:** **E5** (bind-point ②).
- **Deferred (no measured need):** E2 (git-init dormant projects), E3 (self-maint lane), E7 (learning plane).

## Recommended next-session sequence
1. **E5 — bind-point ② (changed-file → auto capability activation).** Grounded, builds on the shipped
   bind-point ①, pure beta. On a set of changed files, resolve each to the mesh node(s) whose
   `related_files` include it, and auto-surface that node's `stop_conditions` / blocker context — **no LLM
   classification**. *Falsifiable test:* editing a `file_upload`-related file surfaces
   `escalates_when_combined` + the blocker rule without any tool call.
2. ✅ **DONE (2026-06-29) — E5 + mobile rules operationalized + components measured clean.** R2/R3/R4/R5/R7/R8
   are enforced static fit-safety checks; R1 (fluid mechanism + container-query collapse) + R5/R6 runtime
   checks (`fluid_floor_overflow` / `fluid_floor_clipped_text` / `touch_target_below_44px` at 320/360) shipped;
   320/360/414 viewports added; gates wired into git pre-commit/pre-push hooks (dogfooded). A REAL Playwright
   browser measurement @320/360/390/414 found the 6 components CLEAN — no overflow, tap ≥ 44, CTA above fold,
   main reading column 226–265px — so **R1b/R6/R9 component rewrites are NOT needed** (the @media 540–960
   collapses them to single-column before phone widths). R1 was reframed: `transform: scale()` rejected for
   interactive/content (WCAG zoom + tap-target). 3-vendor design (codex/agy/Opus, proposal-only); codex
   implemented, Opus reviewed + applied. `origin/main` `7b61a11`.
3. **Only behind measured pain:** E7 learning plane (thin append-only eval-store keyed to
   `{mesh_node_id, discovery_subgraph_rev}`), then E3 self-maint lane (static node + deny-test only).

## Open loose ends
- R1–R10 are enforced (static + runtime + git hooks) and the 6 components measured clean on real phones —
  no component fixes needed; the runtime checks catch future regressions. (R9 cumulative-padding is a
  runtime-only concern, covered by the browser probe — no static check.)
- The 22 inherent generic-hint `MISSING` in the mesh are ratchet-frozen (gate stays green). Optional cleanup:
  repoint those nodes at real autopilot files, or mark them generic.
- `Projects/` git-init only when actually onboarding a project (E2 is low-value until then).
- `git push` after each session if working on `main`.

## Hard constraints to remember (also in persistent memory)
- **Canonical `autopilot` is DEAD** — archived; never work in it.
- **Examples/patterns/templates are named generically by kind**, never after the client site
  (zednik → local-bricklayer). The actual client site lives in its own repo (`Projects/zednik-hero`).
- **Discovery substrate: no stored derived state** — recompute on demand, key to git blob hashes.
- **Vendors via `runCliWorker`** (now `cwd/images/addDirs`-capable), real CLIs only, never roleplay.
- **New `src/` or `product-design-os/` files must be registered in `vendor-manifest.json` `beta_authored`**
  or `beta:vendor-check` fails. `mesh/`, `mcp/`, `docs/`, `scripts/` are not vendor-scanned.
- Portability: copy the `autopilot-beta` folder + `npm install` on the target (native deps rebuild).
