# ADR: Figma design intake — lightweight no-MCP workflows (v2)

**Date:** 2026-07-04 · **Status:** ACCEPTED (owner decision 2026-07-04; supersedes the v1
read-only Figma MCP proposal — the MCP path is preserved below as a deferred option).
**Author:** Claude (Fable 5).

## Context

v1 of this ADR proposed the official Figma MCP connector (read-only stage 1). The owner rejected
that path: it requires paid Figma tiers and OAuth plumbing, while today's models are visually
capable enough that three lightweight workflows deliver the same design-intake value with **zero
cost, zero OAuth, and zero new connector surface**. The no-connector hard boundary stays
untouched; the Claude supervisor session remains the single intake point for design material.

## Decision — three intake workflows

### 1. Screenshot & Prompt (default, fastest)

The owner sketches a rough visual concept in Figma — grey boxes, text, basic placement suffice —
and screenshots the Frame. The screenshot goes to the supervisor session with intent ("build this
component in React + Tailwind per the screenshot; keep the layout and logic").

Why it works: current models have strong spatial perception — from an image they infer layout,
hierarchy, and purpose better than from raw design-API data.

Repo wiring (all existing machinery):

- Screenshots flow to vendor lanes via the **existing `runCliWorker` images plumbing** (vendors
  verifiably see images) inside bounded implementer packets (`prompt-library/01-gpt/` contracts).
- Extracted design facts (tokens, spacing, type, component inventory) land as **design-contract
  diff proposals** (`product-design-os/briefs/design-contract-template.md`), reviewed by the owner.
- Acceptance comes from the standard gates (`pdos:validate`, fit-safety, visual-qa) — a screenshot
  is design INTENT, never source of truth.

### 2. Copy as SVG (exact shapes)

For icons, complex elements, or a specific layout that must replicate precisely: Figma right-click
→ `Copy/Paste as → Copy as SVG`, paste the SVG as context with "convert this SVG structure into a
clean HTML/CSS component".

- The SVG is the owner's own design → provenance internal; it enters the repo as a normal project
  asset under the asset rules.
- Large SVGs respect the vendor prompt-size bound (`maxPromptChars`, fail-fast — no silent
  truncation). If an SVG exceeds it, crop/split in Figma rather than raising the bound.

### 3. Community plugins (code/JSON export)

Free Figma Community plugins (e.g. Anima, Locofy, or similar) can export a design to code or a
JSON structure, which is then supplied to the model as context.

Governance — this is the one workflow with external-code risk:

- Plugin OUTPUT is externally generated code → it enters as **DRAFT ONLY** through
  `product-design-os/rules/source-and-license-gates.md`: verify the plugin's license/terms before
  first use; exported code never lands unreviewed (codex review + tests, like any free-worker
  draft).
- An adopted plugin is recorded as a `tool` entry in the library source catalog with license
  evidence. Choose the first plugin when actually needed — not speculatively.

## Data handling

Simpler than v1 (no account/API surface at all — that is the point), but client-work rules still
hold:

- Screenshots/SVGs of client work are cropped to the frame under work — no unrelated client
  material, no client identifiers in vendor packets (name designs by role: "hero section",
  "pricing card").
- No Figma credentials, tokens, or file keys exist anywhere in this model.
- Each intake that feeds a contract diff or implementer packet is a normal work-log line
  (what was handed in, what artifact it produced).

## Consequences

- Design intake works today with zero new infrastructure: paste a screenshot, paste an SVG, or
  paste a plugin export — all three route through existing packets, contracts, and gates.
- The no-gateway/no-connector hard boundary is untouched; nothing to audit beyond normal packet
  redaction.
- Fidelity ceiling: pixel-exact token extraction is manual (owner reads values off Figma when
  precision matters). Accepted trade-off; revisit only if measured pain appears.

## Deferred option: official Figma MCP (from v1, revivable by a future ADR)

If measured pain ever justifies it: stage 1 = read-only remote MCP in the Claude supervisor
session only (`get_metadata` sparse-first → targeted `get_design_context` / `get_variable_defs` /
`get_screenshot`; raw dumps never forwarded; file keys redacted; zero control-plane code change;
never wired into vendor lanes, hooks, or `mcp/server.ts`). Stage 2 (write-to-canvas) would need
its own ADR defining a mutation allowlist, dry-run mode, Figma version-history rollback
checkpoints, per-mutation audit trail, and per-session owner approval. Nothing here
pre-authorizes either stage; both require a new owner decision and OAuth setup.

## Decided (owner, 2026-07-04)

- [x] No official MCP connection; the three workflows above are the intake path.
- [x] Screenshots as design intent through existing images plumbing; gates decide acceptance.
- [x] Plugin exports draft-only through source/license gates.
- [ ] Open: which community plugin (if any) gets license-gated first — decide at first need.
