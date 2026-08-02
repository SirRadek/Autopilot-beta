# Autopilot Figma executor (write MVP phase 2)

A small first-party Figma plugin that applies **owner-approved** mutation batches from
the Autopilot control plane. It is the executor end of the governed write path defined in
`docs/decisions/figma-write-plugin-executor-adr.md` and governed by the `figma_write_boundary`
mesh node. AI workers never talk to this plugin; they only produce proposals.

## Load (development)

1. Figma → **Plugins → Development → Import plugin from manifest…**
2. Select `figma-plugin/manifest.json`.
3. Run it from **Plugins → Development → Autopilot Executor**.

## Use (the governed loop)

1. In the cockpit, **approve** a pending mutation → the control plane returns a one-time **lease**.
2. Open the plugin. It auto-fills the **file key**. Paste:
   - **Control plane URL** (default `https://autopilot.local`),
   - **Service bearer token** (from the cockpit — `issue-service-token`),
   - the **lease** from step 1.
3. **Claim & Apply** →
   - the plugin `POST /figma/mutations/claim` (single-use lease, bound to this file),
   - takes a named **version-history checkpoint** (`saveVersionHistoryAsync`) — free rollback,
   - applies the typed ops via the Plugin API,
   - `POST /figma/mutations/{id}/result` with the created node ids.

## Guarantees

- Only **owner-approved** batches are claimable; the lease is **single-use**, short-lived, and
  bound to the file key. The plugin **never receives a PAT**.
- Rollback: undo via the named checkpoint in Figma's own version history.

## MVP notes / follow-ups

- Auth uses a **pasted service bearer** for now; the ADR's **one-time pairing code** is a refinement.
- Applied ops: `createFrame`, `setText`, `verificationFrame`, `addComment`. `applyTokens` records the
  referenced token names on the node (token **values** live in code, the source of truth).
  `createVariant` / `placeImage` are **deferred** (need a component definition / image bytes).
- Post-write **re-fetch verification** (diff == 0) runs on the control plane (phase 4), not here —
  the plugin's success is not the proof; the re-fetch is.
