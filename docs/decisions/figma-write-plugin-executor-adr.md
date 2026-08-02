# ADR: Figma write — plugin executor behind the approval queue (Stage 2)

**Date:** 2026-08-02 · **Status:** ACCEPTED (owner decision 2026-08-02: "potvrzuji"). This is the
"Stage 2 (write-to-canvas)" ADR that `figma-mcp-readonly-adr.md` explicitly deferred. Implementation
is authorized only after the governing mesh node (`figma_write_boundary`) is added; the phased MVP
plan follows.
**Author:** Claude (synthesis of a fable-5 / codex-gpt-5.6 / agy-gemini-3.6 brainstorm, 2026-08-02).

## Context

The read direction of the design↔AI loop already exists and is free/governance-neutral:
the 3-layer Design Brief JSON (`design/briefs/`), the free-tier REST reader (`scripts/figma-fetch.ts`,
personal access token, no Dev Mode), a read-only embed panel in the cockpit, and a token lint.
See `figma-ai-design-loop` and `figma-control-architecture` (owner memory).

The owner now wants to **control/write Figma from the app** ("something like an embedded browser").
Hard constraint: Figma **blocks embedding the full editor in an iframe** (`frame-ancestors`), so a
web iframe can only *view*, never *control*. Writing to Figma requires the Figma **Plugin API** (a
sanctioned, free mutation surface). This is a **new mutating connector**, which CLAUDE.md classifies
as a hard boundary — hence this ADR.

## Decision

### Chosen path: **B (Figma Plugin Bridge) as the write backbone.** A deferred, C rejected for Figma.

The plugin is **an executor of the approval queue, not a direct AI command channel.** AI workers
only produce proposals; they never talk to the plugin. This is the single property that makes a
Figma write path compatible with "every mutation goes through the control plane + approval + audit
+ rollback".

- **B — Figma Plugin Bridge (accepted):** a small first-party plugin runs inside the operator's open
  Figma document and pulls **approved** mutation batches from the control plane. Free, deterministic
  (Plugin API), auditable.
- **A — Tauri/Electron webview on figma.com (deferred):** a top-level webview window is not an iframe,
  so Figma runs fully; it gives the operator "one app" feel. Deferred: low delta versus opening Figma
  next to the cockpit, and it adds a desktop release/update surface (its own decision). Also, free
  manual editing inside a webview would bypass "every mutation via approval", so if adopted it is a
  read-only/navigation surface or an explicit, logged policy exception.
- **C — browser automation via chrome-devtools MCP (rejected for Figma):** the Figma canvas is
  WebGL/Wasm — there is no DOM to select or click, so automation is pixel-guessing that breaks on
  every release, and an AI driving a real logged-in session headfully is exactly what governance
  forbids. C remains available only for cockpit smoke-QA (already covered by `browser:qa`) and, at
  most, a narrow fallback to launch the plugin via Figma Quick Actions.

### Transaction protocol (governs every write)

```
proposal → policy validation → owner approval → one-time execution lease
        → execute (typed ops only) → post-write re-fetch verification → audit
```

- **Proposal (worker):** `{ fileKey, briefHash, expectedVersion, ops[], preview, rollbackPlan }`.
  A worker may ONLY create proposals. `ops[]` is a **closed, typed allowlist** — e.g.
  `createFrame`, `applyTokens`, `setText`, `addComment`, `createVariant`, `verificationFrame`.
  There is **no general "execute JavaScript"** operation. The vocabulary grows from real proposals,
  never speculatively.
- **Approval (owner):** the cockpit shows the ops + a diff/preview; the owner approves or rejects in
  the existing approval queue. Approval binds to the exact proposal hash and `expectedVersion`.
- **Execution lease:** on approval the control plane issues a **one-time, short-lived lease** bound to
  the proposal hash. The plugin claims it, verifies the document and preconditions (version match),
  applies only the allowlisted ops, and returns created/changed node IDs plus a result digest. On a
  version conflict the job stops and re-enters approval.
- **Post-write verification (anti-drift):** the control plane re-runs `figma-fetch`, regenerates the
  brief, and asserts the diff against the expected state is zero. **The plugin's narration is not
  proof; the re-fetch is.** This reuses the existing read machinery as an executor post-condition and
  closes the loop bidirectionally (code/tokens → brief-diff → proposal → apply → re-fetch → new brief
  digest).
- **Rollback (free):** before applying, the plugin calls
  `figma.saveVersionHistoryAsync("autopilot pre-batch <id>")` — a named checkpoint in Figma's own
  version history. Plus compensating ops: snapshot affected node properties, tag new nodes with the
  job ID, and route large changes into a new frame/page or `_archive/rollback_<id>`.

### Security

- **Plugin never receives the PAT.** It authenticates with a one-time short-lived token, paired via a
  code the owner generates in the cockpit. Transport is `127.0.0.1` (WS) with an HMAC handshake; the
  plugin manifest's `networkAccess.allowedDomains` lists only our origin. Batches carry an ID; replays
  are rejected. The plugin shows the active job and refuses any non-approved hash.
- **Webview (if/when A lands):** separate storage partition/profile, no IPC bridge between the cockpit
  webview and the figma.com webview, navigation restricted to Figma identity domains, no PAT injected,
  cookies confined to that profile.
- **Automation (C):** out of scope for Figma; if ever used narrowly, separate Chrome profile, headful,
  visible control indicator, domain allowlist, kill switch, and no session tokens/DOM dumps forwarded
  to workers.

## Data handling

- No PAT, control-plane token, file key, or session cookie is ever handed to a worker. Workers see the
  redacted proposal/brief only. The PAT lives only where `figma-fetch` runs (control plane / operator
  shell), per the read ADR.
- Proposals and briefs name designs by role ("run card", "hero"), never client identifiers; client-work
  crop rules from `figma-mcp-readonly-adr.md` still hold.

## Consequences

- The design↔AI loop becomes bidirectional with a **governed** write path — AI can propose Figma
  changes, but only the owner-approved, typed, verified, reversible subset ever lands.
- A new mutating surface exists. It is fully behind the approval queue and re-fetch verification, but it
  is still a new connector: it MUST be governed (see prerequisites).
- Fidelity/interaction ceiling: only the typed op allowlist is expressible; anything outside it stays a
  manual operator action in Figma. Accepted trade-off.

## Prerequisites before ANY implementation (governance gate)

1. **Owner acceptance** of this ADR (flips status to ACCEPTED with a dated owner decision line).
2. A **Decision Mesh node** (e.g. `figma_write_boundary`) with stop-conditions: worker performing a
   direct write, any op outside the allowlist, missing owner approval, missing version checkpoint,
   or missing post-write re-fetch. Wired into the changed-files gate like other mutating capabilities.
3. Only then a phased MVP plan.

## MVP scope (once accepted)

Figma plugin (~200 lines TS) with 3–5 typed ops · a control-plane approved-batch endpoint (poll/WS) ·
a "Pending Mutations" approval card in the cockpit · one-time-token pairing · version-history rollback
checkpoint · post-write re-fetch verification. The operator keeps Figma in a side window; Tauri and 3D
are later.

## Rejected / deferred alternatives

- **A (desktop webview):** deferred — low delta vs. opening Figma alongside; adds an update surface;
  its own decision when a "single application" UX is actually wanted.
- **C (browser automation for Figma):** rejected — WebGL canvas has no stable automation target;
  governance-incompatible for a real session.
- **Official Figma Dev Mode MCP write:** rejected for now — requires a paid seat; conflicts with the
  free constraint. The Plugin API delivers the same governed write for free.

## 3D (out of scope here)

three.js / React Three Fiber belongs in a cockpit SPA panel (local bundle, same-origin GLTF — passes
the strict CSP), never inside the Figma editor. Figma may receive only an approved PNG snapshot through
the same proposal queue. Tracked separately.
