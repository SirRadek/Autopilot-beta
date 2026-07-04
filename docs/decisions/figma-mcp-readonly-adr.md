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

## Consequences

- The Fáze-1 handoff (extract structured design context → supervisor packet → implementer)
  becomes available without violating the no-remote-mutation boundary.
- Stage 2 (write-to-canvas generation loops) stays blocked until its own ADR defines mutation
  scope, rollback, and audit trail.

## Ratification checklist (owner)

- [ ] Confirm official Figma remote MCP server + OAuth account to use.
- [ ] Confirm stage-1 tool allowlist above.
- [ ] First use recorded in the work log with a redaction note.
