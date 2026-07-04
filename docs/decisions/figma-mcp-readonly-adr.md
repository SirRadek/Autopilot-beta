# ADR: Figma MCP — read-only stage 1 (PROPOSED)

**Date:** 2026-07-04 · **Status:** PROPOSED (owner intent confirmed 2026-07-04: Figma will be used;
this ADR defines the governed way in — ratify before first connection). **Author:** Claude (Fable 5).

## Context

The design-director workflow benefits from structured design context (design tokens, node
structure, screenshots) extracted from Figma instead of prose descriptions. Figma exposes this via
its MCP server (remote, OAuth). However, the control plane's hard boundary forbids connector
clients and remote mutation without an explicit architecture decision — and several Figma MCP
tools (`use_figma`, asset upload, "Write to Canvas") MUTATE the design file remotely.

## Decision (stage 1 — read-only)

1. **Allowed tools (read-only only):** `get_design_context`, `get_variable_defs`, `get_metadata`,
   `get_screenshot`, `get_code_connect_map` (read). The connector is used exclusively by the
   Claude supervisor session — never wired into vendor lanes. agy/Gemini and codex receive
   extracted, redacted context inside normal input packets.
2. **Forbidden in stage 1:** `use_figma`, `generate_diagram` writes, `upload_assets`,
   any write/mutation tool, and any automation that edits the Figma file. "Write to Canvas"
   workflows require a separate stage-2 ADR with its own owner approval.
3. **Auth:** owner-performed OAuth on the official Figma remote MCP server only; no tokens stored
   in the repo; connector availability verified per session (no cached-plugin assumption —
   `skill_registry_policy` applies).
4. **Data handling:** Figma file content is client project data — redaction rules apply before
   any vendor handoff (no client names/identifiers to agy beyond what the packet needs; no raw
   node dumps into prompts; prefer `get_metadata` sparse form for large files).
5. **Provenance:** extracted design context is advisory input, not source of truth; acceptance
   still comes from the design contract + motion brief + deterministic gates.

## Workflow (stage 1, step by step)

1. **Owner shares a Figma file or frame** — link or frame reference handed to the Claude
   supervisor session in chat. The supervisor session is the ONLY MCP client; no vendor lane,
   script, or hook ever talks to Figma directly.
2. **Scope the extraction.** For anything beyond a single small frame, call `get_metadata`
   first — its sparse form (node ids, names, types, coarse geometry) is cheap and maps the file
   without pulling full structure. From that map, pick the specific node ids that matter.
3. **Targeted deep reads.** Call `get_design_context` per selected node (not per file), plus
   `get_variable_defs` for the token layer and `get_screenshot` where a visual reference is
   needed. `get_code_connect_map` only when the project has Code Connect mappings worth reusing.
4. **Normalize — never forward raw.** The supervisor turns extracted output into exactly two
   artifact kinds:
   - **(a) design-contract diff proposals** against
     `product-design-os/briefs/design-contract-template.md` — tokens, spacing, type scale,
     component inventory expressed in contract vocabulary, presented to the owner as a diff;
   - **(b) bounded implementer packets** using the `prompt-library/01-gpt/` contracts
     (e.g. `codex-bounded-worker.md`, `motion-implementer.md`) — allowed/forbidden edits,
     acceptance checks, and only the distilled design facts the task needs.
   Raw node dumps NEVER go into prompts — neither Claude-side plans nor vendor packets.
5. **Record evidence.** Each extraction gets a work-log entry (project work log) naming the
   frame/purpose with the file key redacted (see Data handling below).
6. **Proceed as normal.** From here the standard loop applies: owner reviews the contract diff,
   packets route through vendor routing, deterministic gates accept or reject the result.

## Tool allowlist (stage 1)

| Tool | Purpose | Typical output | Data-handling note |
|---|---|---|---|
| `get_design_context` | Deep read of one node: structure, layout, styles, component refs | Structured node tree + resolved styles (can be large) | Call per targeted node id, never whole-file on large files; output stays in the supervisor session, only normalized excerpts move on |
| `get_variable_defs` | Design tokens / variables (color, spacing, type) | Token name → value map per collection/mode | Safest output class; still strip client-identifying token names before vendor handoff |
| `get_metadata` | Sparse map of file/page: node ids, names, types, geometry | Compact id/name/type listing | Always the first call on large files; names may contain client terms — redact before reuse |
| `get_screenshot` | Rendered image of a node/frame | PNG/JPEG image | May flow to vendor lanes via the existing `runCliWorker` images plumbing; crop to the relevant frame, no full-page dumps of unrelated client work |
| `get_code_connect_map` | Node id → code-component mapping (Code Connect) | id → component/file mapping | Read-only; mappings reference the supervised project repo, verify paths before trusting them |

**Explicitly forbidden in stage 1:** `use_figma`, `upload_assets`, `generate_diagram` writes,
and any other mutation — anything that creates, edits, comments on, or uploads to the Figma file.
If a tool's read/write nature is unclear, it is forbidden until classified here.

## Data handling & redaction specifics

Figma file content is **client project data**. Concretely:

- **May flow to vendor lanes (agy/Gemini, codex)** — inside normal bounded packets only:
  - extracted structure summaries (component inventory, layout intent, states);
  - normalized tokens (colors, spacing, type scale) in contract vocabulary;
  - screenshots via the existing `runCliWorker` images plumbing (vendors visually see them),
    cropped to the frame under work.
  In all three: Figma file keys, node URLs, and client identifiers are stripped; the packet
  names the design by role ("hero section", "pricing card"), not by client account.
- **May never leave the supervisor session:**
  - raw `get_design_context` / `get_metadata` JSON dumps (in prompts, packets, or committed files);
  - Figma URLs containing file keys, and the file keys themselves;
  - OAuth tokens, cookies, or any Figma account/org identifiers.
- **Evidence rule:** every extraction is recorded in the project work log — date, frame purpose,
  which tools ran, what artifact (contract diff / packet) it fed — with the file key redacted
  (e.g. `figma:<redacted>#node 12:34 "hero"`). This is the audit trail the ratification
  checklist's first-use item verifies.

## Wiring

Stage 1 requires **zero control-plane code change**. The connector is configured in the Claude
session itself — via claude.ai connector settings, or `claude mcp` in an interactive session —
and currently needs a one-time OAuth authorization there before first use (non-interactive
sessions cannot complete the flow; the owner authorizes once interactively).

It must **NOT** be wired into:

- vendor lanes (`runCliWorker` / agy / codex invocations) — vendors get packets, not tools;
- git hooks or any `verify`/gate script — gates stay deterministic and offline;
- `mcp/server.ts` — the control plane's own MCP server stays a read-only command center and
  does not proxy or re-export Figma tools.

If any of those wirings ever looks necessary, that is by definition a new architecture decision,
not an extension of this one.

## Stage 2 preview (write-to-canvas — separate future ADR)

Stage 2 (generation loops that write back into Figma) stays blocked until its own ADR exists.
So the boundary reads as deliberate, that ADR must define at minimum:

- **Mutation scope allowlist** — exactly which write tools, on which file(s)/pages, for what
  task classes; everything else stays forbidden by default.
- **Dry-run mode** — a preview of intended mutations reviewable before anything touches canvas.
- **Rollback** — a Figma version-history checkpoint created before each write session, with a
  tested restore path.
- **Audit trail** — per-mutation logging (what changed, driven by which packet), same redaction
  rules as stage 1.
- **Owner approval per write session** — not a blanket grant; each write session is opened
  explicitly by the owner.

Nothing in stage 1 pre-authorizes any of the above.

## Consequences

- The Fáze-1 handoff (extract structured design context → supervisor packet → implementer)
  becomes available without violating the no-remote-mutation boundary.
- The supervisor session becomes the single choke point for Figma data — one place to enforce
  redaction, one place to audit.
- Stage 2 (write-to-canvas generation loops) stays blocked until its own ADR defines mutation
  scope, rollback, and audit trail (outline above).

## Ratification checklist (owner)

- [ ] Confirm official Figma remote MCP server + which OAuth account connects (client account vs
      owner account — decide and record).
- [ ] Confirm the stage-1 tool allowlist table above (5 read tools; everything else forbidden).
- [ ] Sign off the redaction rules (may-flow / may-never lists) as written, or amend them here
      before first connection.
- [ ] First use recorded in the project work log with the file key redacted — verify the entry
      matches the Evidence rule format.
- [ ] Set a revisit date (suggested: +60 days or at stage-2 proposal, whichever comes first) to
      re-check the tool list against Figma MCP changes.
