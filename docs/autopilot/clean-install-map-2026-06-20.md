# Autopilot Control-Plane — Clean-Install Map (Phase A, final)

Date: 2026-06-20 · Status: **Phase A complete (read-only, nothing deleted)** · Repo: `SirRadek/autopilot` (PUBLIC)

Three independent passes per the context-sharing protocol — **Opus** (structure/truth-map), **Codex** (deterministic scan, read-only), **Gemini** (blind-spot critique). Awaiting **owner approval (Phase B)** before any deletion.

---

## 1. What this repo is (orientation for a newcomer)

The **Autopilot control plane**: governance + orchestration for supervised project delivery. Does **not** own product runtime code. Stack: Astro + TypeScript, vitest, zod, MCP SDK. **359 tracked files.**

**Three distinct entry docs:** [README.md](../../README.md) (human overview) · [AGENTS.md](../../AGENTS.md) (agent → Decision Mesh protocol) · [GEMINI.md](../../GEMINI.md) (Gemini advisory-lane rules).

| Subsystem | Role |
|---|---|
| `mesh/` (nodes + rules.yaml + edges.yaml + schemas) | Autopilot operational Decision Mesh — **canonical source** |
| `mesh/generated/decision-mesh.json` | **Derived** graph (`mesh:check` keeps it in sync) |
| `src/data/delivery-system/*.ts` | Typed governance policies; `capabilities.ts` is an **enforced mirror** of mesh capability nodes |
| `src/lib/decision-mesh`, `mcp/` | Mesh loader/query + read-only MCP server |
| `prompt-library/` | Versioned prompt packs + schema + validator |
| `product-design-os/` | Phase-1 product/design governance layer (105 files) |
| `docs/projects/<slug>/` | Per-project governance records (3 slugs) |
| `docs/autopilot/` | Operating-model docs, decision records, templates, media |
| `docs/superpowers/` | Historical planning/spec artifacts (2026-05) |

---

## 2. Truth-map

| Area | Role | Status |
|---|---|---|
| `mesh/` source + `mesh/generated/` | canonical → derived | **KEEP** |
| `capabilities.ts` ↔ mesh nodes | enforced mirror (drift-checked) | **KEEP** |
| `docs/projects/radeq/` | supervised-project record | **KEEP** (project off-limits) |
| `docs/projects/autopilot-control-plane/decision-mesh/` | control-plane-as-project mesh (mirrors root concepts) | **CLARIFY** (overlaps root mesh) |
| `docs/projects/multi-agent-autonomous-delivery-system/` | older "delivery-system" conception | **CLARIFY** (likely superseded; review overdue 2026-06-07) |
| README / AGENTS / GEMINI | 3 distinct entry docs | **KEEP** (cross-link in Phase D) |
| `docs/autopilot/*-operating-model.md` | prose rationale per concept | **KEEP** but de-dup vs mesh/ts (see §3.C) |
| `docs/autopilot/` media (36) | radeq/cat-mascot/model-candidates assets | **AUDIT** (18 orphaned) |

---

## 3. Three-model findings

### A. Stale / untrue (delete or archive)
- **`docs/autopilot/repository-audit.md`** — stale **untruth**: dated 2026-05-09, describes an *empty pre-git workspace* ("Git: not initialized", "Source files: none") at `Documents\Autopilot`. Contradicts the 359-file repo. *[Opus + Codex confirm orphan]*

### B. Orphans (Codex deterministic scan)
- **6 stale markdown orphans**: `cloudflare-pages.md`, `repository-audit.md`, and 4 under `docs/superpowers/` (radeq-style-matrix plan, autopilot-v3-command-center plan, custom-cat-mascot impl plan + design spec). *(review each — orphan = unlinked, not always deletable; some prose may be sole rationale → Gemini caution.)*
- **18 orphaned media (~5.7 MB)**: `radeq-*` exploration PNGs + 2 webm. **`page@9db21d7a….webm` and `radeq-motion-preview.webm` are byte-identical (717,684 B) → duplicate.**
- *(My own new files `clean-install-map-2026-06-20.md` + `handoffs/2026-06-19-…md` show as orphans too — expected; they get linked from the index in Phase D.)*

### C. Duplication / overlap (the core issue)
Every governance concept appears in **3–5 places**: a `*-operating-model.md` (prose) + a `mesh/nodes/*.yaml` + a boundary node in the `autopilot-control-plane` project mesh + a `*.ts` policy — and several also in the `multi-agent-autonomous-delivery-system` project mesh. → **Three overlapping mesh representations of the same self-governance.** Some layering is intentional (prose=rationale, yaml=routing, ts=typed/tested); the question is *consistent vs drifted/redundant*.

### D. Broken references — DO NOT "fix" (Codex + Gemini)
**20 broken refs, all `related_files` in generic mesh capability/risk nodes** (`auth_required`, `file_upload`, `payments_checkout`, `public_api`, `qa_upload_tests`, `security_upload`, `storage_provider`, `user_profile`, `frontend_form`) → `src/api`, `src/billing`, `tests/e2e`, etc. These point at a **product-repo structure by design** (the mesh routes work in supervised product repos). **Not broken links.** Action: leave as-is; optionally document intent. *(verify no validator asserts their existence.)*

### E. Gemini blind spots (third angle)
- 🔴 **Public-repo git history**: `git rm` removes from the tree, **not from history** — deleted content stays public. Confirm nothing sensitive is in the deleted set; history-rewrite is a separate, heavier decision.
- 🟠 **CI / validator dependencies**: before deleting, confirm `verify.yml`, `prompt:validate`, `pdos:validate`, `mesh:check` don't reference the targets.
- 🟠 **Sole-rationale prose**: don't delete a doc that is the only record of a decision — migrate the rationale first.
- 🟠 **Mesh de-dup**: verify which mesh layer is *operational* (root `mesh/` is — it feeds the MCP + generated graph) before consolidating the project meshes.

---

## 4. Cleanup ledger — Phase B decision menu (NOTHING deleted yet)

| # | Item | Action | Confidence | Risk |
|---|---|---|---|---|
| 1 | `repository-audit.md` (stale untruth) | delete or archive | high | low |
| 2 | 8 git branches merged into `main` | delete remote branches | high | low (merged) |
| 3 | 18 orphaned media (~5.7 MB) incl. 1 dup webm | archive or delete | high | low (public-history caveat) |
| 4 | `docs/superpowers/` historical plans/specs | archive directory | med | low (sole-rationale check) |
| 5 | other md orphans (`cloudflare-pages.md`) | review individually | med | med (may be needed) |
| 6 | `.gitignore` → add `.claude/` | fix (security) | high | low |
| 7 | doc path inconsistencies (3 different roots) | fix | med | low |
| 8 | 20 mesh "broken refs" | KEEP (by-design) — maybe document | n/a | — |
| 9 | 3 overlapping meshes + "delivery-system" naming | **architecture decision** (consolidate vs keep layered) | — | high (drift/merge) |
| 10 | 3 not-merged branches (`bold-bhaskara`, `jovial-chaum`, `codex/autopilot-safe-move`) | owner: keep or delete | — | med |

---

## 5. Cleanup guardrails (Phase C)
Projects untouched · per-category bounded Codex handoffs · each batch = own commit on a cleanup branch, reviewable diff, `npm run verify` green · **no force-push to `main`** · public-repo history caveat acknowledged · CI/validator dependency check before each delete · sole-rationale prose migrated before deletion.

**Mesh consolidation (§4 #9), if approved:** keep the prose/yaml/ts **layering** (intentional); only consolidate the redundant *project meshes*; do a structural diff `multi-agent-autonomous-delivery-system` ↔ `autopilot-control-plane` first (no policy regression); and **add a project-mesh ↔ root-mesh sync test** — none exists today, so consolidating without it is a regression risk. *(Gemini)*

## 6. Next
**Owner approves Phase B** (which ledger rows + the §4#9 architecture call) → Codex write-lane executes per category (Phase C) → index/README consolidation (Phase D).

---

## 7. Phase-B verification (Codex, read-only — 2026-06-20)
Verified candidates against 282 tracked files + CI/validator surfaces. No writes.

| # | Verdict | Evidence |
|---|---|---|
| 1 repository-audit.md | **SAFE** | no tracked basename refs |
| 2 merged branches | **SAFE** | 8 refs merged into `origin/main` |
| 3 18 orphaned media | **SAFE** | no tracked refs to any basename |
| 4 docs/superpowers | **NEEDS-ATTENTION** | only the **4 orphans** are safe; 6 other superpowers files ARE referenced (autopilot-run-log, decision-mesh-mcp-decision, project work-logs, `mesh/nodes/three_d_experience_addon.yaml`) → archive selectively, not whole dir |
| 5 cloudflare-pages.md | **SAFE** | no tracked basename refs |
| 6 .gitignore += .claude/ | **SAFE** | `.claude/` not present; low-risk |
| 7 path inconsistencies | **NEEDS-ATTENTION** | needs a separate scoped fix plan |
| 8 20 broken refs | **SAFE to leave** | schema only checks array-of-strings; `load.ts`/`query.ts` never stat the paths; `tests/decision-mesh/query.test.ts` explicitly expects `src/auth/session.ts`-style strings → by-design metadata |
| 9 mesh consolidation | **NEEDS-ATTENTION** | `multi-agent-autonomous-delivery-system` has **4 unique nodes** (delivery_observability_boundary, governance_pipeline, model_routing_boundary, worker_boundary) + **4 unique rules** (MAS-GOV-001/WORKER-001/OBS-001/MODEL-001) absent from control-plane → migrate or explicitly retire before any merge. Root `mesh/` is the operational default (MCP + generate load it), but project meshes are code-loadable on demand (`build_project_mesh_packet`) → both are live |
| 10 unmerged branches | **NEEDS-ATTENTION** | `bold-bhaskara`, `jovial-chaum`, `codex/autopilot-safe-move` not merged → owner decision |

**Safe-to-execute now (verified + reversible):** rows 1, 2, 3, 5, 6 + the 4 superpowers orphans from #4.
