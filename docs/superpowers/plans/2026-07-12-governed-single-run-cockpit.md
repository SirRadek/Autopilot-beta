# Governed Single-Run Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one operator-approved cockpit workflow from allowlisted project and immutable prompt revision through token-gated supervisor dispatch, bounded evidence, and externally repairable Autopilot incidents.

**Architecture:** Add focused persisted domain stores for projects, run revisions, and incidents; compose existing approval, token gateway, supervisor, dispatch, quota, and observability services behind explicit Control Plane endpoints. The React cockpit renders the approved split work-area/inspector layout and never invokes a worker directly.

**Tech Stack:** TypeScript, Node.js HTTP server, React 18, Vitest/Testing Library, Playwright, JSON state files, existing governed-core dispatch and systemd VM deployment.

## Global Constraints

- A run executes only after a separate explicit operator approval of its exact immutable revision.
- Browser-supplied filesystem paths are forbidden; only enabled project IDs from the VM allowlist resolve to working directories.
- Provider/model/project/prompt cannot change after approval; retries remain on the approved route.
- No automatic provider fallback or model switching.
- All request bodies, output, artifacts, logs, incidents, and repair packets have hard size/count caps and redact secrets.
- Autopilot repair packets are read-only exports for a separate external Codex, Claude, or AGY maintenance session; they never enqueue work.
- Live provider execution is not part of automated verification and requires an explicit operator action.

---

### Task 1: Allowlisted project registry

**Files:**
- Create: `src/data/delivery-system/projectRegistry.ts`
- Create: `tests/delivery-system/project-registry.test.ts`
- Create: `ops/config/projects.example.json`

**Interfaces:**
- Produces: `ProjectEntry`, `readProjectRegistry(stateDir)`, `writeProjectRegistry(stateDir, document)`, and `resolveEnabledProject(stateDir, projectId)`.
- Persistence: `projects.json`, schema `v1`, maximum 64 entries; IDs maximum 80 characters and canonical absolute paths maximum 1,024 characters.

- [ ] **Step 1: Write the failing domain tests**

```ts
it("resolves only an enabled registered project", () => {
  writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: "/home/radek/autopilot-beta", enabled: true }] });
  expect(resolveEnabledProject(stateDir, "autopilot-beta")).toEqual({ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: "/home/radek/autopilot-beta", enabled: true });
  expect(() => resolveEnabledProject(stateDir, "/tmp/escape")).toThrow("project_not_found");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/delivery-system/project-registry.test.ts`
Expected: FAIL because `projectRegistry.ts` does not exist.

- [ ] **Step 3: Implement bounded validation and atomic persistence**

```ts
export interface ProjectEntry { readonly schema_version: "v1"; readonly project_id: string; readonly name: string; readonly cwd: string; readonly enabled: boolean }
export interface ProjectRegistryDocument { readonly schema_version: "v1"; readonly projects: readonly ProjectEntry[] }
export function resolveEnabledProject(stateDir: string, projectId: string): ProjectEntry {
  const project = readProjectRegistry(stateDir).projects.find((entry) => entry.project_id === projectId && entry.enabled);
  if (project === undefined) throw new Error("project_not_found");
  return project;
}
```

Validate IDs with `/^[a-z0-9][a-z0-9._-]{0,79}$/`, require `isAbsolute(cwd)`, reject duplicate IDs and more than 64 entries, and persist with temporary-file plus `renameSync`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- tests/delivery-system/project-registry.test.ts && npm run typecheck`
Expected: all project-registry tests pass and TypeScript exits 0.

```bash
git add src/data/delivery-system/projectRegistry.ts tests/delivery-system/project-registry.test.ts ops/config/projects.example.json
git commit -m "feat: add allowlisted project registry"
```

### Task 2: Immutable run revisions and bounded artifacts

**Files:**
- Create: `src/data/delivery-system/runStore.ts`
- Create: `tests/delivery-system/run-store.test.ts`

**Interfaces:**
- Consumes: `ProjectEntry.project_id` from Task 1.
- Produces: `RunDraft`, `RunRecord`, `RunArtifact`, `createRunDraft`, `reviseRunDraft`, `approveRunRevision`, `transitionRun`, `appendRunArtifact`, `readRunStore`.
- Persistence: `runs.json`, maximum 256 runs, 20 revisions/run, prompt 32,000 characters, 32 artifacts/run, artifact preview 32,000 characters.

- [ ] **Step 1: Write failing state-machine tests**

```ts
it("approves one immutable revision and rejects a superseded revision", () => {
  const first = store.createRunDraft(input, "2026-07-12T10:00:00.000Z");
  const second = store.reviseRunDraft(first.run_id, first.revision, { ...input, prompt: "revised" }, "2026-07-12T10:01:00.000Z");
  expect(() => store.approveRunRevision(first.run_id, first.revision, "owner", "2026-07-12T10:02:00.000Z")).toThrow("run_revision_conflict");
  expect(store.approveRunRevision(second.run_id, second.revision, "owner", "2026-07-12T10:02:00.000Z").status).toBe("approved");
});
```

Also test deep equality for idempotent approval, invalid transitions, prompt/artifact caps, and reload persistence.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/delivery-system/run-store.test.ts`
Expected: FAIL because `RunStore` is missing.

- [ ] **Step 3: Implement the explicit state model**

```ts
export type RunStatus = "draft" | "approved" | "queued" | "running" | "completed" | "failed" | "cancelled";
export interface RunDraft { readonly run_id: string; readonly revision: number; readonly project_id: string; readonly prompt: string; readonly provider: "codex_cli" | "claude_cli" | "agy_cli" | "openrouter_api"; readonly model: string | null; readonly estimated_tokens: number; readonly requested_artifacts: readonly ("text" | "visual")[]; readonly created_at: string }
export interface RunRecord { readonly schema_version: "v1"; readonly current: RunDraft; readonly revisions: readonly RunDraft[]; readonly status: RunStatus; readonly approved_revision: number | null; readonly approved_by: string | null; readonly approved_at: string | null; readonly supervisor_task_id: string | null; readonly worker_run_id: string | null; readonly terminal_reason: string | null; readonly artifacts: readonly RunArtifact[]; readonly updated_at: string }
```

Use an exhaustive legal-transition map. Re-approving the same revision by the same operator returns the existing record; approving any non-current revision throws `run_revision_conflict`.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- tests/delivery-system/run-store.test.ts && npm run typecheck`
Expected: run-store tests and typecheck pass.

```bash
git add src/data/delivery-system/runStore.ts tests/delivery-system/run-store.test.ts
git commit -m "feat: persist immutable governed runs"
```

### Task 3: Governed run orchestration service

**Files:**
- Create: `src/data/delivery-system/runOrchestrator.ts`
- Create: `tests/delivery-system/run-orchestrator.test.ts`
- Modify: `src/data/delivery-system/approvalQueue.ts`

**Interfaces:**
- Consumes: project resolution, `RunStore`, `createApprovalRecord`, `TokenGateway`, `SupervisorQueue`, and governed dispatch.
- Produces: `prepareRun(input)`, `approveAndQueueRun(runId, revision, operator)`, `runSupervisorOnce()`, and `cancelRun(runId)`.

- [ ] **Step 1: Write failing integration-style tests with injected fakes**

```ts
it("does not reserve or enqueue before approval", () => {
  const run = orchestrator.prepareRun(input);
  expect(run.status).toBe("draft");
  expect(tokenGateway.reserve).not.toHaveBeenCalled();
  expect(supervisor.enqueue).not.toHaveBeenCalled();
});

it("binds approval, reservation and handoff to the same route", () => {
  const queued = orchestrator.approveAndQueueRun(runId, 1, "owner");
  expect(tokenGateway.reserve).toHaveBeenCalledWith(expect.objectContaining({ provider: "codex_cli", model: "gpt-5", sessionId: runId }));
  expect(supervisor.enqueue).toHaveBeenCalledWith(expect.objectContaining({ taskId: queued.supervisor_task_id, requiresApproval: true, approvalGranted: true }));
});
```

Test gateway refusal, stale revision, enqueue failure releasing reservation, terminal settlement, same-route retry, and unsupported visual artifacts without failing text output.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/delivery-system/run-orchestrator.test.ts`
Expected: FAIL because the orchestrator is missing.

- [ ] **Step 3: Implement orchestration without a second dispatch path**

`prepareRun` resolves `project_id`, validates a currently available provider/model snapshot, writes the draft, and creates an approval record containing `run_id` and `revision`. `approveAndQueueRun` approves that exact revision, reserves its estimated token budget, constructs one existing `GovernedHandoff`, and enqueues it in `SupervisorQueue`. `runSupervisorOnce` calls the existing governed dispatcher and maps its terminal result back into `RunStore`; every throw/refusal settles or releases the reservation exactly once.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- tests/delivery-system/run-orchestrator.test.ts tests/delivery-system/token-gateway.test.ts tests/delivery-system/supervisor-queue.test.ts`
Expected: all focused orchestration/gateway/supervisor tests pass.

```bash
git add src/data/delivery-system/runOrchestrator.ts src/data/delivery-system/approvalQueue.ts tests/delivery-system/run-orchestrator.test.ts
git commit -m "feat: orchestrate approved cockpit runs"
```

### Task 4: Autopilot incidents and external repair packets

**Files:**
- Create: `src/data/delivery-system/incidentStore.ts`
- Create: `src/data/delivery-system/telemetryRedaction.ts`
- Modify: `src/data/delivery-system/observability.ts`
- Create: `tests/delivery-system/incident-store.test.ts`

**Interfaces:**
- Produces: `recordAutopilotIncident`, `acknowledgeIncident`, `prepareRepairPacket`, `readIncidentStore`.
- Caps: 256 incidents, summary 2,000 characters, 32 event references, 20 reproduction steps, repair packet JSON 64 KiB.

- [ ] **Step 1: Write failing redaction and lifecycle tests**

```ts
it("exports a redacted packet without enqueueing work", () => {
  const incident = store.recordAutopilotIncident({ severity: "high", stage: "dispatch", summary: "Authorization: Bearer secret-value", correlation_ids: { run_id: "run-1" }, impact: "run failed", retry_count: 1, event_refs: ["event-1"] });
  const packet = store.prepareRepairPacket(incident.incident_id, { expected: "queued", actual: "failed", verification_commands: ["npm test -- tests/delivery-system/run-orchestrator.test.ts"] });
  expect(JSON.stringify(packet)).not.toContain("secret-value");
  expect(packet.intent).toBe("external_autopilot_repair");
  expect(store.acknowledgeIncident(incident.incident_id, "owner").status).toBe("acknowledged");
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/delivery-system/incident-store.test.ts`
Expected: FAIL because incident storage is missing.

- [ ] **Step 3: Implement bounded redaction-first persistence**

Move the private `redact` implementation from `observability.ts` into exported
`redactTelemetryText(value: string, maxChars = 2_000): string` in
`telemetryRedaction.ts`; update observability to call it. Persist only redacted fields.
`prepareRepairPacket` performs no process execution and exposes no callback capable of dispatch.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- tests/delivery-system/incident-store.test.ts tests/delivery-system/observability.test.ts`
Expected: incident and observability tests pass.

```bash
git add src/data/delivery-system/incidentStore.ts src/data/delivery-system/telemetryRedaction.ts tests/delivery-system/incident-store.test.ts tests/delivery-system/observability.test.ts
git commit -m "feat: add autopilot incident repair packets"
```

### Task 5: Control Plane run, project, and incident API

**Files:**
- Modify: `scripts/control-plane-server.ts`
- Create: `scripts/control-plane-runs.ts`
- Modify: `tests/scripts/control-plane-server.test.ts`

**Interfaces:**
- Adds: `GET /projects`, `POST /runs`, `GET /runs`, `GET /runs/:id`, `POST /runs/:id/revisions`, `POST /runs/:id/approve`, `POST /runs/:id/cancel`, `GET /incidents`, `POST /incidents/:id/acknowledge`, `POST /incidents/:id/repair-packet`.
- Mutation bodies are JSON, maximum 64 KiB, authenticated, and covered by existing same-origin cookie mutation protection.

- [ ] **Step 1: Write failing HTTP contract tests**

```ts
it("prepares but does not execute a run", async () => {
  const response = await request("POST", "/runs", { project_id: "autopilot-beta", prompt: "Inspect status", provider: "codex_cli", model: null, requested_artifacts: ["text"] });
  expect(response.status).toBe(201);
  expect(response.json.status).toBe("draft");
  expect(readSupervisorTasks()).toEqual([]);
});
```

Add tests for arbitrary path rejection, oversized body `413`, stale revision `409`, unavailable model `409`, unauthenticated `401`, cross-origin cookie mutation `403`, idempotent approval, incident acknowledgement, and redacted repair packet.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/scripts/control-plane-server.test.ts`
Expected: new endpoint assertions fail with `404`.

- [ ] **Step 3: Add a focused route module instead of growing the server**

Create `scripts/control-plane-runs.ts` unconditionally. It owns all project, run, and incident
route matching and handlers; `control-plane-server.ts` only delegates matching requests. Handlers
parse capped bodies, call domain services, and translate known domain codes to `400/404/409/413`;
unknown internal errors record an incident and return a stable
`500 {"error":"autopilot_internal_error","incident_id":"..."}`.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- tests/scripts/control-plane-server.test.ts tests/delivery-system/run-orchestrator.test.ts && npm run typecheck`
Expected: all focused API/domain tests and typecheck pass.

```bash
git add scripts/control-plane-server.ts scripts/control-plane-runs.ts tests/scripts/control-plane-server.test.ts
git commit -m "feat: expose governed run control plane api"
```

### Task 6: Typed cockpit client and run composer

**Files:**
- Modify: `cockpit/src/types/controlPlane.ts`
- Modify: `cockpit/src/api/controlPlaneClient.ts`
- Modify: `cockpit/src/api/controlPlaneClient.test.ts`
- Create: `cockpit/src/features/runs/RunComposer.tsx`
- Create: `cockpit/src/features/runs/RunComposer.test.tsx`

**Interfaces:**
- Produces typed methods matching Task 5 and `RunComposer` callbacks `onPrepare` and `onApprove`.

- [ ] **Step 1: Write failing client and composer tests**

```tsx
render(<RunComposer projects={projects} quotas={quotas} models={models} onPrepare={onPrepare} onApprove={onApprove} />);
await user.selectOptions(screen.getByLabelText("Projekt"), "autopilot-beta");
await user.type(screen.getByLabelText("Prompt"), "Inspect status");
await user.click(screen.getByRole("button", { name: "Připravit běh" }));
expect(onPrepare).toHaveBeenCalledTimes(1);
expect(onApprove).not.toHaveBeenCalled();
```

Test disabled unavailable/stale routes, quota/spend display, token estimate, visual checkbox, revision invalidation after editing, and distinct approve action.

- [ ] **Step 2: Run RED**

Run: `npm --prefix cockpit test -- src/api/controlPlaneClient.test.ts src/features/runs/RunComposer.test.tsx`
Expected: FAIL because run types/client/component are missing.

- [ ] **Step 3: Implement controlled fields and exact API payloads**

Keep provider/model options derived from `ProviderQuota` and `ProviderModels`; do not accept a free-form project path. Render an explicit warning when freshness is not `fresh`, and keep `Approve and run` disabled unless the displayed revision equals the server-returned current revision.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm --prefix cockpit test -- src/api/controlPlaneClient.test.ts src/features/runs/RunComposer.test.tsx && npm --prefix cockpit run build`
Expected: focused tests and production build pass.

```bash
git add cockpit/src/types/controlPlane.ts cockpit/src/api/controlPlaneClient.ts cockpit/src/api/controlPlaneClient.test.ts cockpit/src/features/runs
git commit -m "feat: add governed run composer"
```

### Task 7: Split run inspector, incidents, and responsive cockpit integration

**Files:**
- Create: `cockpit/src/features/runs/RunInspector.tsx`
- Create: `cockpit/src/features/runs/RunInspector.test.tsx`
- Create: `cockpit/src/features/incidents/IncidentPane.tsx`
- Create: `cockpit/src/features/incidents/IncidentPane.test.tsx`
- Modify: `cockpit/src/app/App.tsx`
- Modify: `cockpit/src/app/AppShell.tsx`
- Modify: `cockpit/src/app/app.css`
- Modify: `cockpit/src/app/AppShell.test.tsx`
- Modify: `cockpit/src/app/useCockpitData.ts`

**Interfaces:**
- Consumes Task 6 client methods and run/incident types.
- Produces the approved collapsible split layout; narrow view places inspector below work area.

- [ ] **Step 1: Write failing UI behavior and accessibility tests**

```tsx
expect(screen.getByRole("region", { name: "Pracovní plocha běhu" })).toBeVisible();
expect(screen.getByRole("complementary", { name: "Inspektor běhu" })).toBeVisible();
await user.click(screen.getByRole("tab", { name: "Chyby" }));
expect(screen.getByText("autopilot_internal_error")).toBeVisible();
await user.click(screen.getByRole("button", { name: "Připravit balíček pro opravu" }));
expect(onPrepareRepairPacket).toHaveBeenCalledWith("incident-1");
```

Test all run states, exact approved input, timeline/tokens/cost/retry, truncation marker, visual artifact unavailable state, incident acknowledgement, keyboard tabs, and responsive DOM order.

- [ ] **Step 2: Run RED**

Run: `npm --prefix cockpit test -- src/features/runs/RunInspector.test.tsx src/features/incidents/IncidentPane.test.tsx src/app/AppShell.test.tsx`
Expected: FAIL because inspector and incident UI are absent.

- [ ] **Step 3: Implement the approved layout without unbounded rendering**

Keep each feature in its own module. Fetch lists through `useCockpitData`, select one run by route state, and render capped server fields. Repair packet is displayed/copied as JSON/text for manual external use; no UI callback may dispatch it.

- [ ] **Step 4: Run the full cockpit suite, accessibility checks, build, and commit**

Run: `npm --prefix cockpit test && npm --prefix cockpit run build`
Expected: all cockpit tests pass with zero test failures and Vite build exits 0.

```bash
git add cockpit/src/features/runs cockpit/src/features/incidents cockpit/src/app cockpit/src/api cockpit/src/types
git commit -m "feat: integrate governed run control room"
```

### Task 8: Browser QA, VM dry run, and operational handoff

**Files:**
- Modify: `tests/browser/cockpit.spec.ts`
- Create: `scripts/smoke-cockpit-run.ts`
- Create: `tests/scripts/smoke-cockpit-run.test.ts`
- Modify: `package.json`
- Modify: `ops/systemd/README.md`
- Create: `.superpowers/sdd/phase8-single-run-report.md`

**Interfaces:**
- Adds `npm run smoke:cockpit-run -- --dry-run` and a deterministic fixture-backed worker route.

- [ ] **Step 1: Add failing browser and smoke tests**

Browser workflow: login → select allowlisted project/provider/model → compose → prepare → verify no worker → approve → queued/running/completed → inspect timeline/artifact. A second scenario injects an internal error, verifies persistent incident, exports a redacted repair packet, and acknowledges it.

- [ ] **Step 2: Run RED**

Run: `npm run browser:qa && npm test -- tests/scripts/smoke-cockpit-run.test.ts`
Expected: new workflows fail until integration and deterministic dry-run wiring are complete.

- [ ] **Step 3: Implement the bounded dry-run harness and document VM setup**

The harness creates temporary state, installs one allowlisted temporary project, injects a deterministic non-network worker, runs the real Control Plane/orchestrator/token gateway/supervisor path, asserts correlation IDs and terminal settlement, then removes temporary state. It must reject `--live`; live execution remains a separate manual operator action.

- [ ] **Step 4: Verify host and VM**

Run on the VM:

```bash
cd ~/autopilot-beta
npm run typecheck
npm test -- tests/delivery-system/project-registry.test.ts tests/delivery-system/run-store.test.ts tests/delivery-system/run-orchestrator.test.ts tests/delivery-system/incident-store.test.ts tests/scripts/control-plane-server.test.ts tests/scripts/smoke-cockpit-run.test.ts
npm --prefix cockpit test
npm --prefix cockpit run build
npm run browser:qa
npm run smoke:cockpit-run -- --dry-run
```

Expected: zero failures; smoke output contains one approved revision, one reservation, one supervisor task, one worker result, matching correlation IDs, and a settled reservation. Restart the user service and verify `npm run ops:health -- 8787` returns `{"ok":true}`.

- [ ] **Step 5: Record evidence and commit**

Document exact test counts, service state, dry-run IDs, redaction result, and the fact that no live provider was invoked.

```bash
git add tests/browser/cockpit.spec.ts scripts/smoke-cockpit-run.ts tests/scripts/smoke-cockpit-run.test.ts package.json package-lock.json ops/systemd/README.md .superpowers/sdd/phase8-single-run-report.md
git commit -m "test: verify governed cockpit run end to end"
```

## Final review gate

- Run `git diff --check` and inspect every changed file for unrelated dirty-tree overlap.
- Run focused backend tests, the full cockpit suite/build, browser QA, and the VM dry run from Task 8 with fresh output.
- Confirm the project registry contains IDs, not browser-controlled paths.
- Confirm no approved field can mutate without a new revision.
- Confirm every reservation reaches exactly one settle/release terminal event.
- Confirm repair packets contain no dispatch capability and representative credentials are redacted.
- Confirm provider/model switches do not occur during a run or retry.
- Update `.superpowers/sdd/progress.md` only after all evidence passes.
