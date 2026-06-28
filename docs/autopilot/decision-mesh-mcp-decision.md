# Decision Mesh MCP Decision

Date introduced: 2026-05-24
Status: phase-3 read-only context-router decision
Owner: Autopilot Control Plane

Decision: allow a local YAML/JSON Decision Mesh, pure TypeScript query library, deterministic generated graph artifact, and read-only stdio MCP server.

This decision does not approve connector calls, remote MCP transport, credentials, background jobs, durable workflows, deployments, product runtime code, or file-mutating MCP tools.

This decision covers Autopilot's own operational mesh only. Each supervised product/project needs a separate project-specific mesh created as part of project architecture onboarding.

Update on 2026-05-24: capability routing, context economy, model spend, and project-specific mesh seeds are approved as incremental improvements to the existing Decision Mesh path. This keeps the door open for a later parallel AI Production Studio, but such a system requires a separate architecture decision, interop or migration plan, and owner approval.

## Decision

Autopilot may add:

- `mesh/nodes/*.yaml`
- `mesh/edges.yaml`
- `mesh/rules.yaml`
- `mesh/schemas/*.schema.json`
- `mesh/generated/decision-mesh.json`
- `src/lib/decision-mesh/*.ts`
- `scripts/generate-decision-mesh.ts`
- `mcp/server.ts`
- `AGENTS.md`
- `GEMINI.md`
- Decision Mesh package scripts

Allowed purpose:

- store human-readable reasoning nodes and edges
- validate and query relevant subgraphs for agent context
- select capability modules before planning
- build compact role-specific agent packets
- enforce context economy and session reset policy
- keep model spend provider-neutral and local-first by default
- route strategic reasoning escalation separately from routine local worker tasks
- define the lifecycle rule for separate per-project meshes
- expose read-only local MCP tools over stdio
- generate deterministic JSON for future dashboard/viewer use
- instruct Codex and Gemini how to use the mesh safely

Forbidden purpose:

- no remote service mutation
- no connector clients
- no product repository reads through MCP
- no credentials or environment variable loaders
- no network calls
- no remote MCP transport
- no autonomous execution loop
- no file-mutating MCP tools
- no cloud/frontier model dependency for routine worker tasks
- no duplicate source of truth through an unapproved parallel system
- no 3D viewer in this slice

## Dependency Policy

New runtime dependencies:

- `@modelcontextprotocol/sdk`
- `yaml`
- `zod`

New development dependency:

- `tsx`

These are approved only for local Decision Mesh parsing, artifact generation, and stdio MCP serving.

Deferred dependencies:

- `3d-force-graph`
- `react-force-graph`
- database clients
- connector SDKs
- cloud SDKs

## MCP Tool Boundary

The MCP server exposes:

- `select_capabilities`
- `get_relevant_subgraph`
- `build_agent_packet`
- `build_project_mesh_packet`
- `explain_node`
- `find_required_agents`
- `find_risks`

Tools call the local query library and return JSON text. They do not expose raw filesystem reads. Project mesh tools are limited to safe project slugs under `docs/projects/<project-slug>/decision-mesh/`.

## Source-Of-Truth Rule

YAML under `mesh/` is the source of truth for root Decision Mesh content.

YAML under `docs/projects/<project-slug>/decision-mesh/` is the source of truth for each project-specific mesh.

Typed TypeScript capability routing is an executable mirror for routing and UI display. It must stay aligned with mesh node IDs; if it drifts from YAML, YAML wins and the mirror must be updated.

`mesh/generated/decision-mesh.json` is derived from YAML and must pass `npm run mesh:check`.

When YAML and generated JSON disagree, work must regenerate the artifact or stop before delivery.

## Project Mesh Rule

Autopilot's root `mesh/` is not a product mesh.

Each supervised project must have its own mesh at:

```text
docs/projects/<project-slug>/decision-mesh/
```

If a project does not have a mesh when architecture onboarding starts, the architecture task creates one before implementation planning continues.

After every meaningful completed work slice, the project's mesh must be updated or the work log must explicitly record why no mesh impact exists.

Current registered project meshes seeded on 2026-05-24:

- `docs/projects/autopilot-control-plane/decision-mesh/`
- `docs/projects/multi-agent-autonomous-delivery-system/decision-mesh/`
- `docs/projects/radeq/decision-mesh/`

## Capability And Context Rule

Autopilot should first improve the existing Decision Mesh, typed policy, and MCP path.

Before planning, route work through `select_capabilities` when a task may affect web builds, optimization, data, SEO, automation, recovery, documents, bots/RAG, or 3D. Then use relevant subgraph and agent packet tools to keep context small.

3D remains a premium add-on capability, not the default service direction.

A parallel AI Production Studio remains a valid future architecture option only if the existing mesh path is insufficient and a decision record defines source-of-truth ownership, interoperability, migration, and maintenance cost.

## Decision Ledger Entry

```yaml
decision_id: 2026-05-24-decision-mesh-mcp
type: architecture
context: Autopilot needs a machine-readable reasoning graph so Codex can request compact context instead of loading all governance docs.
decision: Add YAML Decision Mesh, pure TypeScript query layer, generated JSON artifact, and read-only stdio MCP server.
reasoning: Structured graph data plus MCP tools gives agents relevant subgraphs and agent packets while preserving local read-only boundaries.
alternatives:
  - keep Markdown-only governance
  - add 3D viewer first
  - add Neo4j or SQLite first
  - add connector-backed runtime first
impact: Adds a local context-router surface; does not approve execution runtime, connector mutation, remote transport, or dashboard visualization.
approved_by: user approval on 2026-05-24 after research-first design review
related_tasks:
  - docs/superpowers/specs/2026-05-24-decision-mesh-mvp-design.md
  - docs/superpowers/plans/2026-05-24-decision-mesh-mvp.md
```
