# State Safety and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent live writers from racing maintenance, sanitize provider output before persistence, broaden safe incident capture, validate before rotation, and make restore/drill failure-atomic.

**Architecture:** A focused cross-process lock module serializes individual state writes and full maintenance transactions. A single output policy sanitizes all persisted and served provider text. Backup and maintenance split into focused modules, while `operationalHardening.ts` remains a compatibility export. Restore materializes into temporary staging before atomic publication.

**Tech Stack:** TypeScript, Node filesystem/process APIs, Vitest child-process tests, JSON/JSONL persistence, systemd maintenance units.

## Global Constraints

- Never hold the state lock across a provider call.
- Never delete a live, malformed, foreign-host, or permission-denied lock owner.
- A lock timeout cannot bypass the lock to write an incident into protected state.
- Persist no unredacted provider output or parsed object derived from unredacted output.
- Backup must validate before rotation or retention pruning.
- Backup input excludes `backups/`, lock metadata, temporary/quarantine files, and pending incident spool files.
- Restore never writes directly into the live state directory.

---

### Task 1: Cross-process state-maintenance lock

**Files:**
- Create: `src/data/delivery-system/stateMaintenanceLock.ts`
- Create: `tests/delivery-system/state-maintenance-lock.test.ts`
- Modify: `src/data/delivery-system/operationalHardening.ts`

**Interfaces:**
- Produces: `acquireStateMaintenanceLock()`, `withStateMaintenanceLock()`, `StateMaintenanceLease`, and `StateMaintenanceLockError`.

- [ ] **Step 1: Write failing ownership, contention, stale, and reentrancy tests**

```ts
expect(() => acquireStateMaintenanceLock(stateDir, { timeoutMs: 10 })).toThrow("state_lock_timeout");
expect(readFileSync(ownerPath, "utf8")).toBe(activeOwnerBytes);
expect(withStateMaintenanceLock(stateDir, () => withStateMaintenanceLock(stateDir, () => "ok"))).toBe("ok");
```

Cover dead same-host replacement, malformed/foreign retention, `EPERM` as alive, token-mismatch release, callback failure release, and a real child process holding the lock.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/delivery-system/state-maintenance-lock.test.ts`

Expected: FAIL because the lock module is absent.

- [ ] **Step 3: Implement bounded owner metadata and token-safe release**

```ts
export interface StateMaintenanceLease {
  readonly token: string;
  readonly path: string;
  release(): void;
}

export class StateMaintenanceLockError extends Error {
  constructor(readonly code: "state_lock_timeout" | "state_lock_invalid") { super(code); }
}
```

Acquire by atomic directory creation, store bounded v1 `{token,pid,hostname,acquired_at}`, and support synchronous same-process reentrancy. Replace only a valid old same-host owner whose PID is provably dead. Release only when the token still matches.

- [ ] **Step 4: Run lock tests and typecheck**

Run: `npm test -- tests/delivery-system/state-maintenance-lock.test.ts && npm run typecheck && npm run beta:vendor-manifest && npm run beta:vendor-check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/delivery-system/stateMaintenanceLock.ts src/data/delivery-system/operationalHardening.ts tests/delivery-system/state-maintenance-lock.test.ts vendor-manifest.json
git commit -m "feat: coordinate persistent state writers"
```

### Task 2: Adopt the lock at persistent write boundaries

**Files:**
- Modify: `src/data/delivery-system/approvalQueue.ts`
- Modify: `src/data/delivery-system/sessionRegistry.ts`
- Modify: `src/data/delivery-system/projectRegistry.ts`
- Modify: `src/data/delivery-system/providerQuotaStore.ts`
- Modify: `src/data/delivery-system/supervisorQueue.ts`
- Modify: `src/data/delivery-system/tokenGateway.ts`
- Modify: `src/data/delivery-system/runStore.ts`
- Modify: `src/data/delivery-system/incidentStore.ts`
- Modify: `src/data/delivery-system/subagentEvidence.ts`
- Modify: `src/data/delivery-system/supervisorAlerts.ts`
- Modify: `src/data/delivery-system/cliWorker.ts`
- Modify: `src/data/delivery-system/cliWorkerCapture.ts`
- Modify: `scripts/control-plane-server.ts`
- Modify: `scripts/worker-cancel.ts`
- Modify: `scripts/worker-cleanup.ts`
- Test: existing store tests plus `tests/delivery-system/state-maintenance-lock.test.ts`

**Interfaces:**
- Consumes: `withStateMaintenanceLock()`.
- Produces: lock-coordinated atomic JSON replacement and JSONL append paths.

- [ ] **Step 1: Add failing writer-contention and atomic-replacement tests**

```ts
expect(readFileSync(sessionRegistrySource, "utf8")).toContain("withStateMaintenanceLock");
writeSessionRegistry(stateDir, document);
expect(readSessionRegistry(stateDir)).toEqual(document);
expect(globSync(join(stateDir, "*.tmp-*"))).toEqual([]);
```

Use representative JSON and JSONL writers, then assert every remaining state write symbol is covered by the shared primitive through a source inventory test.

- [ ] **Step 2: Run the state-store test set and confirm failure**

Run: `npm test -- tests/delivery-system/state-maintenance-lock.test.ts tests/delivery-system/session-registry.test.ts tests/delivery-system/token-gateway.test.ts tests/delivery-system/run-store.test.ts tests/delivery-system/incident-store.test.ts`

Expected: FAIL because writers ignore the maintenance lease.

- [ ] **Step 3: Wrap lowest write/append boundaries and make JSON writes atomic**

Use same-directory `wx` temporary files, `0600`, fsync, rename, and directory fsync. Keep lock scope around filesystem mutation only. Do not nest provider execution or network requests inside `withStateMaintenanceLock()`.

- [ ] **Step 4: Run all affected store tests and provenance**

Run: `npm test -- tests/delivery-system/approval-queue.test.ts tests/delivery-system/session-registry.test.ts tests/delivery-system/project-registry.test.ts tests/delivery-system/provider-quota-store.test.ts tests/delivery-system/supervisor-queue.test.ts tests/delivery-system/token-gateway.test.ts tests/delivery-system/run-store.test.ts tests/delivery-system/incident-store.test.ts tests/delivery-system/state-maintenance-lock.test.ts && npm run typecheck && npm run beta:vendor-manifest && npm run beta:vendor-check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/delivery-system scripts/control-plane-server.ts scripts/worker-cancel.ts scripts/worker-cleanup.ts tests vendor-manifest.json
git commit -m "fix: lock persistent state mutations"
```

### Task 3: Centralized worker-output policy

**Files:**
- Create: `src/data/delivery-system/workerOutputPolicy.ts`
- Modify: `src/data/delivery-system/cliWorker.ts`
- Modify: `src/data/delivery-system/cliWorkerCapture.ts`
- Modify: `src/data/delivery-system/runOrchestrator.ts`
- Modify: `scripts/control-plane-server.ts`
- Create: `tests/delivery-system/worker-output-policy.test.ts`
- Modify: `tests/delivery-system/cli-worker-safety.test.ts`
- Modify: `tests/delivery-system/run-orchestrator.test.ts`
- Modify: `tests/scripts/control-plane-server.test.ts`

**Interfaces:**
- Produces: `sanitizeWorkerOutput()`, `sanitizeWorkerError()`, and `parseSanitizedWorkerJson()`.

- [ ] **Step 1: Write failing secret, Unicode, JSON, and artifact tests**

```ts
expect(sanitizeWorkerOutput("Bearer secret-token")).not.toContain("secret-token");
expect(sanitizeWorkerOutput("🔐".repeat(40_000)).length).toBeLessThanOrEqual(32_000);
expect(sanitizeWorkerOutput(sanitizeWorkerOutput(secretFixture))).toBe(sanitizeWorkerOutput(secretFixture));
expect(readFileSync(workerArtifact, "utf8")).not.toMatch(secretPattern);
```

Cover API keys, cookies, passwords, private keys, sanitized parsed JSON, injected dispatch output, Codex prompt/output temp cleanup, and fail-closed redactor failure.

- [ ] **Step 2: Run tests and confirm raw persistence failures**

Run: `npm test -- tests/delivery-system/worker-output-policy.test.ts tests/delivery-system/cli-worker-safety.test.ts tests/delivery-system/run-orchestrator.test.ts tests/scripts/control-plane-server.test.ts`

Expected: FAIL because early branch writes and the weaker `/workers` regex remain.

- [ ] **Step 3: Implement and adopt one output policy**

```ts
export const MAX_PERSISTED_WORKER_OUTPUT_CHARS = 32_000;
export function sanitizeWorkerOutput(value: string, maxChars = MAX_PERSISTED_WORKER_OUTPUT_CHARS): string;
export function sanitizeWorkerError(value: string | null, maxChars = 2_000): string | null;
export function parseSanitizedWorkerJson(value: string): unknown | null;
```

Use `redactTelemetryText()` as the single regex authority. Sanitize once before any artifact, telemetry, returned field, parsed JSON, run result, or API response. Remove early branch writes and unlink Codex prompt/output capture files in `finally` after governed ingestion.

- [ ] **Step 4: Run safety tests, typecheck, and provenance**

Run: `npm test -- tests/delivery-system/worker-output-policy.test.ts tests/delivery-system/cli-worker-safety.test.ts tests/delivery-system/run-orchestrator.test.ts tests/scripts/control-plane-server.test.ts && npm run typecheck && npm run beta:vendor-manifest && npm run beta:vendor-check`

Expected: PASS with no raw provider artifact retained.

- [ ] **Step 5: Commit**

```bash
git add src/data/delivery-system/workerOutputPolicy.ts src/data/delivery-system/cliWorker.ts src/data/delivery-system/cliWorkerCapture.ts src/data/delivery-system/runOrchestrator.ts scripts/control-plane-server.ts tests vendor-manifest.json
git commit -m "fix: sanitize worker output before persistence"
```

### Task 4: Bounded operational incidents

**Files:**
- Create: `src/data/delivery-system/operationalIncidents.ts`
- Modify: `scripts/control-plane-server.ts`
- Modify: `scripts/control-plane-runs.ts`
- Modify: `src/data/delivery-system/providerQuotaScheduler.ts`
- Modify: `src/data/delivery-system/cliWorker.ts`
- Modify: `src/data/delivery-system/incidentStore.ts`
- Test: `tests/delivery-system/incident-store.test.ts`
- Test: `tests/delivery-system/provider-quota-scheduler.test.ts`
- Test: `tests/scripts/control-plane-server.test.ts`

**Interfaces:**
- Produces: `recordOperationalIncident(stateDir, input)` with fixed stage/summary/impact codes and provider scheduler `onPollFailure` callback.

- [ ] **Step 1: Write failing route, supervisor, scheduler, and redaction tests**

```ts
expect(failedResponse.body).toMatchObject({ error: "autopilot_internal_error" });
expect(failedResponse.body.incident_id).toBeTruthy();
expect(JSON.stringify(failedResponse.body)).not.toContain("injected-secret");
expect(onPollFailure).toHaveBeenCalledTimes(1);
```

Inject failures into status, sessions, workers, providers, observability, approvals, supervisor polling, and repeated provider polling.

- [ ] **Step 2: Run tests and confirm uncovered failures**

Run: `npm test -- tests/delivery-system/incident-store.test.ts tests/delivery-system/provider-quota-scheduler.test.ts tests/scripts/control-plane-server.test.ts`

Expected: FAIL because only the run router catches and records incidents.

- [ ] **Step 3: Implement fixed-code incidents and one outer route boundary**

```ts
export type OperationalIncidentStage =
  | "control_plane_status" | "control_plane_sessions" | "control_plane_workers"
  | "control_plane_providers" | "control_plane_observability" | "supervisor_loop"
  | "provider_poll" | "worker_output" | "state_maintenance" | "state_recovery";
```

Never pass raw exception text. Return fixed HTTP errors with incident/request IDs. Provider polling records only the first/transition failure, not every retry. Lock timeout writes a fixed unique spool entry; successful maintenance later ingests it under the lock.

- [ ] **Step 4: Run incident and runtime tests**

Run: `npm test -- tests/delivery-system/incident-store.test.ts tests/delivery-system/provider-quota-scheduler.test.ts tests/scripts/control-plane-server.test.ts && npm run typecheck && npm run beta:vendor-manifest && npm run beta:vendor-check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/delivery-system/operationalIncidents.ts src/data/delivery-system/incidentStore.ts src/data/delivery-system/providerQuotaScheduler.ts src/data/delivery-system/cliWorker.ts scripts/control-plane-server.ts scripts/control-plane-runs.ts tests vendor-manifest.json
git commit -m "feat: capture bounded operational incidents"
```

### Task 5: Validated maintenance transaction

**Files:**
- Create: `src/data/delivery-system/stateBackup.ts`
- Create: `src/data/delivery-system/stateMaintenance.ts`
- Modify: `src/data/delivery-system/operationalHardening.ts`
- Modify: `scripts/ops-backup.ts`
- Modify: `scripts/ops-maintenance.ts`
- Modify: `ops/systemd/autopilot-state-maintenance.service`
- Create: `tests/delivery-system/state-maintenance.test.ts`
- Modify: `tests/delivery-system/operational-hardening.test.ts`
- Create: `tests/scripts/ops-maintenance.test.ts`

**Interfaces:**
- Produces: `performStateMaintenance(options): StateMaintenanceResult`; preserves compatibility exports.

- [ ] **Step 1: Write failing operation-order and fail-closed tests**

```ts
expect(events).toEqual(["scan", "backup", "validate", "rotate", "prune"]);
expect(failedValidation.rotated).toEqual([]);
expect(existingBackups).toEqual(beforeBackups);
expect(sourceJsonl).toBe(beforeJsonl);
```

Cover preflight findings, backup failure, validation mismatch, name collision, lock contention, exclusion paths, quarantine, permissions, and no pruning before validation.

- [ ] **Step 2: Run maintenance tests and confirm current unsafe ordering**

Run: `npm test -- tests/delivery-system/state-maintenance.test.ts tests/delivery-system/operational-hardening.test.ts tests/scripts/ops-maintenance.test.ts`

Expected: FAIL because create currently prunes and systemd uses three unlocked processes.

- [ ] **Step 3: Split modules and implement one locked apply transaction**

```ts
export function performStateMaintenance(options: {
  readonly stateDirectory: string;
  readonly backupDirectory: string;
  readonly environmentFile: string;
  readonly mode: "dry_run" | "apply";
}): StateMaintenanceResult;

export interface StateMaintenanceResult {
  readonly ok: boolean;
  readonly mode: "dry_run" | "apply";
  readonly findings: readonly string[];
  readonly backup: null | { readonly path: string; readonly valid: boolean };
  readonly rotated: readonly string[];
  readonly incident_id: string | null;
}
```

Run scan → create/fsync → validate/count match → rotate → prune under one lease. Invalid archives are retained with a quarantine suffix; mutation stops. Make `ops:backup` create and immediately validate before retention. Replace the unit's three `ExecStart` lines with one apply command.

- [ ] **Step 4: Run maintenance and static unit tests**

Run: `npm test -- tests/delivery-system/state-maintenance.test.ts tests/delivery-system/operational-hardening.test.ts tests/scripts/ops-maintenance.test.ts tests/operations/systemd-units.test.ts && npm run typecheck && npm run beta:vendor-manifest && npm run beta:vendor-check`

Run on Ubuntu: `systemd-analyze --user verify ops/systemd/autopilot-state-maintenance.service ops/systemd/autopilot-state-maintenance.timer`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/delivery-system/stateBackup.ts src/data/delivery-system/stateMaintenance.ts src/data/delivery-system/operationalHardening.ts scripts/ops-backup.ts scripts/ops-maintenance.ts ops/systemd/autopilot-state-maintenance.service tests vendor-manifest.json
git commit -m "fix: validate state before rotation"
```

### Task 6: Failure-atomic restore and recovery drill

**Files:**
- Modify: `src/data/delivery-system/stateBackup.ts`
- Create: `src/data/delivery-system/stateRecovery.ts`
- Create: `scripts/ops-recovery-drill.ts`
- Modify: `package.json`
- Modify: `tests/delivery-system/operational-hardening.test.ts`
- Create: `tests/scripts/ops-recovery-drill.test.ts`

**Interfaces:**
- Produces: failure-atomic `restoreStateBackup()` and `drillStateRecovery()`; CLI accepts only an archive path.

- [ ] **Step 1: Write failing restore atomicity and live-state isolation tests**

```ts
expect(() => restoreStateBackup(archive, symlinkTarget, { apply: true })).toThrow("unsafe_restore_target");
expect(() => restoreStateBackup(archive, nonEmptyTarget, { apply: true })).toThrow("restore_target_not_empty");
expect(readFileSync(liveSentinel, "utf8")).toBe(liveBytes);
expect(existsSync(partialStaging)).toBe(false);
```

Cover canonical base64, duplicate paths, simulated mid-write failure, valid drill, corrupt archive, reconciliation/readiness validation, and cleanup.

- [ ] **Step 2: Run restore/drill tests and confirm failure**

Run: `npm test -- tests/delivery-system/operational-hardening.test.ts tests/scripts/ops-recovery-drill.test.ts`

Expected: FAIL because restore writes directly and no drill exists.

- [ ] **Step 3: Implement temporary materialization and deterministic drill**

```ts
export interface RecoveryValidation {
  readonly ready: boolean;
  readonly reconciled: boolean;
  readonly errors: readonly string[];
}
export interface RecoveryDrillResult {
  readonly ok: boolean;
  readonly validation: RecoveryValidation;
  readonly restored_file_count: number;
}
export function drillStateRecovery(
  archivePath: string,
  options: { readonly validateRestoredState: (stateDir: string) => RecoveryValidation; readonly temporaryRoot?: string }
): RecoveryDrillResult;
```

Materialize to a random sibling directory with `0700`/`0600`, fsync, then rename only after success. The drill owns its temporary root, invokes pure readiness and restart reconciliation, cleans it, and exposes no live-state argument.

- [ ] **Step 4: Run recovery tests and typecheck**

Run: `npm test -- tests/delivery-system/operational-hardening.test.ts tests/scripts/ops-recovery-drill.test.ts && npm run typecheck && npm run beta:vendor-manifest && npm run beta:vendor-check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/delivery-system/stateBackup.ts src/data/delivery-system/stateRecovery.ts scripts/ops-recovery-drill.ts package.json tests vendor-manifest.json
git commit -m "feat: add failure-atomic recovery drill"
```

### Task 7: State-safety review gate

- [ ] Run the full targeted state-safety command listed in the approved design.
- [ ] Run `npm run typecheck`, `npm run beta:vendor-check`, and the governed dry-run smoke.
- [ ] Request security/operations spec review and code-quality review.
- [ ] Resolve findings and rerun affected tests.
- [ ] Record the passing commit before VM acceptance and documentation.
