# ADR — Autopilot v0.2: three-plane architecture (governance · discovery · learning)

**Date:** 2026-06-27 · **Status:** ACCEPTED (E0 decision anchor) · **Owner:** SirRadek
**Author:** Opus, reconciling a 3-round / 3-vendor brainstorm (codex GPT-5.5-xhigh +
agy Gemini-3.1-pro-high + Opus 4.8 ultracode workflows). Vendor-engagement runIds in
each round's log. Satisfies `CAP-PARALLEL-001` (explicit architecture decision before
any parallel/runtime scope) and `MESH-PROJECT-001`.

## Context
A comparison of the autopilot governance/mesh against `graphify` (safishamsi, ~72k★)
established (round 1) that the two are **orthogonal graph species**: autopilot is a
NORMATIVE governance/decision graph (~33 hand-authored YAML policy nodes, weighted
typed edges, `blocker|major` rules, read-only MCP, control-plane↔project separation);
graphify is a DESCRIPTIVE code-knowledge graph (Tree-sitter AST + LLM + Leiden →
`graph.json`). Autopilot is ahead on governance, behind on automatic structural
extraction/freshness/retrieval. Rounds 2–3 converged on the architecture and a staged,
falsifiably-gated execution plan, tuned end-to-end by all three vendors.

## Decision

### 1. Three planes
- **DISCOVERY (new substrate):** per-repo code-knowledge graph; AST-first, **no LLM by
  default** (LLM-semantic indexing of comments is a prompt-injection vector — keep the
  mesh a manual read-only "airlock"); VERIFIED/STALE/MISSING + provenance.
- **GOVERNANCE (existing mesh):** stays **hand-owned** (policy = owner intent, NOT
  auto-extracted). Its `related_files`/risk links resolve to discovery node IDs instead
  of rotting string hints.
- **LEARNING:** eval/tuning/fixes/learning on **measured** signals (not self-declaration).
  **Deferred** behind a measured-pain trigger.

### 2. Build vs adopt — HYBRID, not graphify
**Buy** a no-LLM AST parsing+ranking primitive (`@ast-grep/napi` or
aider-repomap/RepoMapper as fallback), **build only** the thin TS + storage layer keyed
to mesh node IDs. graphify rejected: Python sidecar + LLM injection surface + a schema
NOT keyed to our governance (we'd build the binding anyway) + exceeds the owner
complexity bar. Graphiti/Zep is a different axis (agent memory) → candidate for the
learning plane only, deferred.

### 3. Storage discipline — "no stored stale"
Graphs live **per-repo** (`<repo>/.autopilot/discovery/`); autopilot stores only
`{node_id, pointer, commit/hash, status, redacted summary}`, never raw graph content
(OBS-SCOPE-001 — a derived code graph is project data, treated like raw logs). Resolve
`related_files` **on demand** from `git diff`; persist nothing stale. Reconcile the
latency-vs-no-stored-state tension via a **git-blob-hash-keyed read-through cache**:
O(1) reads in the active tool loop, background indexing; a row whose `blob_hash` ≠
current is by definition not VERIFIED, so "stale" can never be stored.

### 4. Dual source-of-truth (NOT single, yet)
Canonical `autopilot` remains the **control-plane SoT** for mesh/MCP/governance.
`autopilot-beta` is the **product/design SoT**. The `vendor-manifest.json` hash gate is
the A↔B airlock. The full v0.2 cutover (collapsing beta siblings, moving mesh into beta)
is a **late, gated** step, not the first.

### 5. Execution mode — Y (fix-in-place-first)
> **Correction (2026-07-03):** the "verified fact" below is now STALE. `autopilot-beta`
> DOES have `mesh/`, `mcp/`, and `src/lib/decision-mesh/` (all git-tracked on main): the
> v0.2 consolidation landed governance into beta, which is now the self-contained source
> of truth (see `docs/decisions/brainstorm-2-briefing.md`). The "Y wins" decision was sound
> at the time, but do NOT cite this section for "where governance lives."

Verified fact (SUPERSEDED — see correction above): `autopilot-beta` has **no** `mesh/`, `mcp/`, or `src/lib/decision-mesh/`
— governance lives only in canonical `autopilot`. Therefore cutover-first (X) would
require migrating the whole governance into beta before the smallest fix — backwards.
**Y wins (2/3 vendors + the fact):** fix `load.ts` where it lives; the vendor-manifest
patch model carries it to beta cleanly later.

> **Update — superseded (consolidation done):** the v0.2 cutover has since landed.
> `autopilot-beta` now contains `mesh/`, `mcp/`, and `src/lib/decision-mesh/` as the single
> self-contained source of truth, and canonical `autopilot` is archived/dead. The section-5
> "Verified fact" describes the **pre-consolidation** state and is retained only as the decision's
> historical rationale — it is no longer current truth.
**Owner constraint (2026-06-27):** no direct writes to canonical `autopilot`; E1 runs in
a **git worktree of the canonical repo on a new branch** (canonical main untouched).

### 6. Three-concern isolation
- **(A) Supervised projects:** each its own git repo under `Projects/<slug>/`, project
  mesh beside project state (`.autopilot/decision-mesh/`). **Classify before mutating** —
  do NOT blanket-create `.git`/`.autopilot`; non-onboarded folders marked `not_onboarded`.
- **(B) Autopilot product:** `autopilot-beta` (v0.2), manifest airlock.
- **(C) Self-maintenance lane:** branch namespace `maint/*` + a new **static** mesh node
  `autopilot_self_maintenance_lane` (template: `subscription_worker_boundary`) +
  report-first lane/path hook. **Automation deferred to the learning plane (E7)** so it
  can't smuggle in a second governance system.

## Staged plan (falsifiably gated; LIGHT = codex+deterministic, FULL = 3-vendor)
E0 ADR(this) · **E0.5** preflight/backup/rollback/classify · E1 plumbing fix(load.ts +
rewrite stale tests) · E2 project hygiene(classify, not blanket) · E3 isolation(static
node+hook) · **E3.5** spike(falsify-the-need first, then pick primitive) · E4a
graph+resolver(STALE-flip) · E4b MCP surface(bind-point 1) · E5 bind-point 2 · E6 v0.2
consolidation(late) · **E7 deferred** learning + self-maint automation.

**Minimal slice (chosen 2026-06-27):** E0 → E1 → E3.5 falsify-probe. The STALE-flip thesis
may be demonstrable by a **stateless `git diff` + blob-hash comparison** against existing
mesh nodes — with no SQLite graph and no ast-grep. Falsify the need for the substrate
before building it.

## Frozen until cutover (no product-feature work)
`autopilot-beta-f1`, `-v5`, `-zednik`, `-preview`, `-variants` (collapse into branches at
E6 after a source audit). Product-feature work in canonical `autopilot` is frozen; only
control-plane (mesh/MCP) fixes proceed there.

## Consequences
- Governance rides on verified ground truth instead of rotting hints (codex measured
  ~29/111 `related_files` currently missing/placeholder — re-verified by the E3.5 probe).
- Top risk: derived-state rot / sidecar ops on idle Python projects → mitigated by
  "no stored stale" + on-demand resolution + classify-before-mutate.
- The two parts that most excited the owner (learning + self-maintenance automation) are
  exactly the parts that convert a hand-verifiable system into an unverifiable one →
  deferred behind a measured-pain trigger by design.
