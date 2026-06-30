# ADR — Vendor chokepoint: governed-core dispatch + thin front door

**Date:** 2026-06-30 · **Status:** accepted (owner-approved 2026-06-30) · **Supersedes:** the
implicit "runCliWorker is the vendor lane" convention.

## Context (the master audit finding)

The 2-round audit's deepest finding: the governed vendor lane is **dead at runtime**.
- `runCliWorker` (`src/data/delivery-system/cliWorker.ts`) has **no programmatic caller**; the path the
  owner actually runs is a raw `codex`/`agy` CLI invocation (the out-of-tree `radeq_tmp/.autopilot/*.cjs`),
  which skips the env-scrub, the locks, the telemetry, and the evidence ledger entirely.
- `runCliWorker` never consults `buildSupervisorRoutingDecision` (`modelPolicy.ts`), so routing / budget /
  circuit-breaker policy is **execution-dead-code**; `tierId` is hard-coded `null`.
- The lane asserts its own provenance with a **string literal** `lock_source: "supervisor_spawn"` — a
  self-claim, not a checked fact.
- The 18 MCP tools are read-only **by implementation, not by runtime** (the SDK does not enforce
  `readOnlyHint`); nothing structurally stops a future caller from reaching the spawn path.

A naive "front door" that talks to an LLM/CLI directly is exactly the ungoverned path the whole system
exists to prevent. The fix must make a bypass **structurally impossible (by construction)**, not merely
discouraged (by convention) — the audit's recurring theme.

## Decision — two processes, one governed dispatch

### Process A — governed-core (lives IN autopilot-beta)
Sole owner of the vendor spawn. Its **only** public entry is:

```
dispatchHandoff(handoff) -> CliWorkerResult
```

`dispatchHandoff` is the single gate every vendor call passes through. It MUST, in order:
1. **Verify mesh-packet provenance.** Recompute the agent packet from the live Decision Mesh for the
   handoff's `{task, agent}` (`buildAgentPacket` / `buildProjectMeshPacket`) and compare a stable hash
   against the `packet_hash` the caller submitted. Reject if it cannot reproduce the route — a caller
   cannot forge a governed route it never requested through the read-only mesh tools.
2. **Consult routing/budget policy.** Call `buildSupervisorRoutingDecision` and refuse on a
   budget-exhausted / open-circuit / disallowed-route decision (closes the model-policy-deadcode finding).
   Stamp the resolved `tier_id` into telemetry instead of `null`.
3. **Require gate state.** Refuse to spawn unless the handoff carries the `required_checks` /
   verify-gate context for its task.
4. **Spawn via the existing hardened lane** (`runCliWorker` → env-scrub + codex read-only sandbox +
   agy `--sandbox` + locks + telemetry + evidence) and replace the self-asserted
   `lock_source: "supervisor_spawn"` string with the **verified provenance** computed in step 1.

The spawn surface (`runCliWorker`, `captureCodexResponse`, `captureAgyResponse`, `buildCodexBashCommand`,
`buildAgyArgs`) becomes **internal**: it is NOT re-exported from any package-public index, and a
dependency-boundary check (a test + dependency-cruiser rule) fails the build if any module **outside**
`src/governed-core/` imports the spawn lane. So "dispatch is the sole entry" is enforced by construction.

A thin IPC shim (local stdio / unix-domain socket, no network) exposes `dispatchHandoff` to Process B.

### Process B — front-door console (NEW repo: `C:\Programování\Projects\autopilot-console`)
A thin display+input shell — the "one contained front door" the owner wants. It may ONLY:
- call the **read-only MCP server** (`mcp/server.ts`) for packets / risks / agents / scoring / previews, and
- send a **handoff** to the governed-core IPC (which returns the governed result + evidence pointers).

It is a **separate package** with NO dependency on autopilot-beta's spawn code — the import edge from the
UI to `cliWorker.ts` literally cannot exist (different module graph). The UI cannot spawn a vendor; it can
only ask the governed core to, and only with a route the core can reproduce.

## Bypass-prevention — by construction, three layers
1. **Missing dependency edge** — the UI process has no import path to the spawn lane (separate package +
   spawn surface unexported), so it cannot call a vendor directly.
2. **Unforgeable provenance** — the governed core recomputes the mesh route and rejects any handoff whose
   packet it cannot reproduce, so the UI cannot smuggle an ungoverned task in.
3. **Verified `lock_source`** — the provenance claim is checked, not self-asserted.

What is still by-convention (and out of scope here): the owner's interactive raw-CLI / `.cjs` habit. That
lane is closed only by **routing the owner's supervisor session through `dispatchHandoff`** instead of raw
CLIs — a behavioral change this ADR enables but does not force.

## Phasing
- **Phase 1 (this session, in autopilot-beta):** `src/governed-core/dispatch.ts` (`dispatchHandoff` +
  provenance + routing/budget wiring + verified `lock_source`), make the spawn surface internal, add the
  dependency-boundary test, unit-test dispatch (reject forged route / budget refusal / happy path). No UI.
- **Phase 2 (next, new repo):** scaffold `autopilot-console` (read-only MCP client + governed-core IPC
  client), the stdio IPC shim in governed-core, and the module-boundary by repo separation.

## Consequences
- Closes the model-policy-deadcode finding and turns `lock_source` into a checked fact.
- Gives the owner one governed front door without re-creating what Claude Code already provides
  (transcript / workflows tree / preview) — the console is a thin shell over the governed core.
- Cost: a real process boundary + IPC. Justified: it is the only thing that makes the bypass the audit
  named *structurally* impossible rather than merely discouraged.
