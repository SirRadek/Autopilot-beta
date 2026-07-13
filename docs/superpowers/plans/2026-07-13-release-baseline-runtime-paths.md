# Runtime Paths and Managed Ledgers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one canonical project authority boundary, an idempotent registry bootstrap, managed OpenRouter ledgers, and matching systemd write permissions.

**Architecture:** A shared runtime-path resolver feeds Decision Mesh lookup, routing, registry validation, run dispatch, readiness, and systemd configuration. Registry checks canonicalize real paths immediately before dispatch. OpenRouter migration runs before any governed OpenRouter attempt and never deletes legacy evidence.

**Tech Stack:** TypeScript, Node filesystem/path APIs, Vitest, systemd user units, JSON/JSONL state.

## Global Constraints

- Use `AUTOPILOT_PROJECTS_DIR`; default to `~/projects`.
- Dispatch only canonical real paths that are strict children of the canonical root.
- Managed state and project root are the only writable service roots.
- OpenRouter ledger migration is bounded to 4 MiB and 20,000 non-empty records per file.
- Preserve legacy ledgers and fail closed on conflicts or malformed content.

---

### Task 1: Canonical project-root resolver

**Files:**
- Create: `src/data/delivery-system/runtimePaths.ts`
- Modify: `src/lib/decision-mesh/load.ts`
- Modify: `src/data/delivery-system/routingModes.ts`
- Test: `tests/decision-mesh/project-root.test.ts`
- Test: `tests/delivery-system/routing-modes.test.ts`

**Interfaces:**
- Produces: `resolveConfiguredProjectRoot(environment?, homeDirectory?): string` and `AUTOPILOT_PROJECTS_DIR_ENV`.
- Consumed by: registry, runtime, readiness, Decision Mesh resolution, and systemd documentation.

- [ ] **Step 1: Write failing resolver and integration tests**

```ts
expect(resolveConfiguredProjectRoot({}, "/home/radek")).toBe("/home/radek/projects");
expect(resolveConfiguredProjectRoot({ AUTOPILOT_PROJECTS_DIR: "/srv/autopilot-projects" }, "/home/radek"))
  .toBe("/srv/autopilot-projects");
expect(() => resolveConfiguredProjectRoot({ AUTOPILOT_PROJECTS_DIR: "relative" }, "/home/radek"))
  .toThrow("invalid_project_root");
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test -- tests/decision-mesh/project-root.test.ts tests/delivery-system/routing-modes.test.ts`

Expected: FAIL because `runtimePaths.ts` and the shared resolver do not exist.

- [ ] **Step 3: Implement the shared resolver and replace competing defaults**

```ts
export const AUTOPILOT_PROJECTS_DIR_ENV = "AUTOPILOT_PROJECTS_DIR";

export function resolveConfiguredProjectRoot(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  homeDirectory: string = homedir()
): string {
  const configured = environment[AUTOPILOT_PROJECTS_DIR_ENV] ?? join(homeDirectory, "projects");
  if (!isAbsolute(configured) || normalize(configured) !== configured) throw new Error("invalid_project_root");
  return configured;
}
```

Make `resolveProjectMeshRoot()` and `resolveSupervisedProjectsRoot()` consume this function.

- [ ] **Step 4: Run focused tests and refresh vendor provenance**

Run: `npm test -- tests/decision-mesh/project-root.test.ts tests/delivery-system/routing-modes.test.ts && npm run beta:vendor-manifest && npm run beta:vendor-check`

Expected: PASS and a vendor manifest containing only intentional tracked-file hash changes.

- [ ] **Step 5: Commit**

```bash
git add src/data/delivery-system/runtimePaths.ts src/lib/decision-mesh/load.ts src/data/delivery-system/routingModes.ts tests/decision-mesh/project-root.test.ts tests/delivery-system/routing-modes.test.ts vendor-manifest.json
git commit -m "feat: unify supervised project root"
```

### Task 2: Root-enforced registry and dispatch

**Files:**
- Modify: `src/data/delivery-system/projectRegistry.ts`
- Modify: `src/data/delivery-system/runStore.ts`
- Modify: `src/data/delivery-system/runOrchestrator.ts`
- Modify: `scripts/control-plane-runs.ts`
- Modify: `scripts/control-plane-server.ts`
- Modify: `scripts/smoke-cockpit-run.ts`
- Test: `tests/delivery-system/project-registry.test.ts`
- Test: `tests/delivery-system/run-store.test.ts`
- Test: `tests/delivery-system/run-orchestrator.test.ts`
- Test: `tests/scripts/control-plane-server.test.ts`
- Test: `tests/scripts/smoke-cockpit-run.test.ts`

**Interfaces:**
- Consumes: `resolveConfiguredProjectRoot()`.
- Produces: `ProjectRegistryOptions`, canonical `ProjectEntry.cwd`, root-aware run creation and dispatch.

- [ ] **Step 1: Add failing containment, symlink, and dispatch-recheck tests**

```ts
expect(resolveEnabledProject(stateDir, "inside", { projectRoot }).cwd).toBe(realpathSync(inside));
expect(() => resolveEnabledProject(stateDir, "outside", { projectRoot })).toThrow("project_path_outside_root");
expect(() => resolveEnabledProject(stateDir, "root", { projectRoot })).toThrow("project_path_outside_root");
expect(() => resolveEnabledProject(stateDir, "escaped-link", { projectRoot })).toThrow("project_path_outside_root");
```

Also retarget an allowed symlink after draft creation and assert `handoffFor()` refuses or dispatches only the newly verified canonical in-root path.

- [ ] **Step 2: Run targeted tests and confirm the unsafe cases fail**

Run: `npm test -- tests/delivery-system/project-registry.test.ts tests/delivery-system/run-store.test.ts tests/delivery-system/run-orchestrator.test.ts tests/scripts/control-plane-server.test.ts tests/scripts/smoke-cockpit-run.test.ts`

Expected: FAIL because registry operations accept any normalized absolute path.

- [ ] **Step 3: Add root-aware registry interfaces and thread them to dispatch**

```ts
export interface ProjectRegistryOptions { readonly projectRoot?: string }

export function resolveEnabledProject(
  stateDir: string,
  projectId: string,
  options: ProjectRegistryOptions = {}
): ProjectEntry;
```

Canonicalize root and entry with `realpathSync`, compute `relative(realRoot, realCwd)`, reject `""`, `".."`, `../...`, and absolute relatives, and return `{...entry, cwd: realCwd}`. Add final `registryOptions?` parameters to `createRunDraft()` and `reviseRunDraft()`. Add `projectRoot` to `createRunOrchestrator()`, `RevisionOperations`, and runtime options; recheck immediately before handoff.

- [ ] **Step 4: Run tests, typecheck, and provenance gate**

Run: `npm test -- tests/delivery-system/project-registry.test.ts tests/delivery-system/run-store.test.ts tests/delivery-system/run-orchestrator.test.ts tests/scripts/control-plane-server.test.ts tests/scripts/smoke-cockpit-run.test.ts && npm run typecheck && npm run beta:vendor-manifest && npm run beta:vendor-check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/delivery-system/projectRegistry.ts src/data/delivery-system/runStore.ts src/data/delivery-system/runOrchestrator.ts scripts/control-plane-runs.ts scripts/control-plane-server.ts scripts/smoke-cockpit-run.ts tests vendor-manifest.json
git commit -m "fix: enforce project root at dispatch"
```

### Task 3: Idempotent registry bootstrap

**Files:**
- Modify: `src/data/delivery-system/projectRegistry.ts`
- Create: `scripts/project-registry-init.ts`
- Modify: `package.json`
- Modify: `ops/config/projects.example.json`
- Test: `tests/delivery-system/project-registry.test.ts`
- Create: `tests/scripts/project-registry-init.test.ts`

**Interfaces:**
- Produces: `initializeProjectRegistry(stateDir, options?): ProjectRegistryInitialization` and `npm run projects:init -- STATE_DIR [PROJECT_ROOT]`.

- [ ] **Step 1: Write failing function and CLI tests**

```ts
const first = initializeProjectRegistry(stateDir, { projectRoot });
const bytes = readFileSync(join(stateDir, "projects.json"), "utf8");
const second = initializeProjectRegistry(stateDir, { projectRoot });
expect(second.registry_created).toBe(false);
expect(readFileSync(join(stateDir, "projects.json"), "utf8")).toBe(bytes);
expect(JSON.parse(bytes)).toEqual({ schema_version: "v1", projects: [] });
```

Add malformed-existing-file and no-auto-discovery assertions.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/delivery-system/project-registry.test.ts tests/scripts/project-registry-init.test.ts`

Expected: FAIL because initialization and CLI are absent.

- [ ] **Step 3: Implement atomic idempotent initialization**

```ts
export interface ProjectRegistryInitialization {
  readonly state_dir: string;
  readonly project_root: string;
  readonly state_dir_created: boolean;
  readonly project_root_created: boolean;
  readonly registry_created: boolean;
}
```

Create directories with `0700`; create `projects.json` with `0600`, a same-directory temporary file, and rename. Validate but never replace an existing file. Make the example registry empty.

- [ ] **Step 4: Run tests and a temporary CLI smoke**

Run: `npm test -- tests/delivery-system/project-registry.test.ts tests/scripts/project-registry-init.test.ts && tmp=$(mktemp -d) && npm run projects:init -- "$tmp/state" "$tmp/projects" && rm -rf "$tmp"`

Expected: tests pass and CLI prints a bounded JSON result without registering a project.

- [ ] **Step 5: Commit**

```bash
git add src/data/delivery-system/projectRegistry.ts scripts/project-registry-init.ts package.json ops/config/projects.example.json tests vendor-manifest.json
git commit -m "feat: initialize project registry safely"
```

### Task 4: Managed OpenRouter ledger migration

**Files:**
- Create: `src/data/delivery-system/openRouterLedgerMigration.ts`
- Modify: `src/data/delivery-system/cliWorkerCapture.ts`
- Modify: `src/data/delivery-system/cliWorker.ts`
- Create: `tests/delivery-system/openrouter-ledger-migration.test.ts`
- Modify: `tests/delivery-system/openrouter-stage1.test.ts`
- Modify: `tests/delivery-system/openrouter-spend-cap.test.ts`

**Interfaces:**
- Produces: `ensureOpenRouterLedgersMigrated(stateDir): OpenRouterLedgerMigrationResult`.

- [ ] **Step 1: Write failing path, migration, conflict, and bound tests**

```ts
expect(openRouterAttemptCounterPathForStateDir(stateDir)).toBe(join(stateDir, "openrouter-api-attempts.jsonl"));
expect(ensureOpenRouterLedgersMigrated(stateDir).status).toBe("migrated");
expect(readFileSync(legacyPath)).toBe(readFileSync(managedPath));
expect(() => ensureOpenRouterLedgersMigrated(conflictingStateDir)).toThrow("openrouter_ledger_migration_conflict");
```

Cover malformed JSONL, symlinks, files above 4 MiB, more than 20,000 records, partial migration, and proof that a failed migration performs no provider call.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/delivery-system/openrouter-ledger-migration.test.ts tests/delivery-system/openrouter-stage1.test.ts tests/delivery-system/openrouter-spend-cap.test.ts`

Expected: FAIL because paths escape `stateDir` and migration is absent.

- [ ] **Step 3: Implement bounded atomic migration and call it before budget checks**

```ts
export interface OpenRouterLedgerMigrationResult {
  readonly status: "not_needed" | "migrated" | "already_migrated";
  readonly migrated_files: readonly string[];
  readonly retained_legacy_files: readonly string[];
}
```

Validate every non-empty v1 JSONL record, reject non-regular/symlink sources, copy to a same-directory `wx` temporary file, set `0600`, fsync, compare byte count and SHA-256, and rename without overwriting. Call the migration at the start of the OpenRouter branch in `runCliWorker()`.

- [ ] **Step 4: Run OpenRouter and provenance gates**

Run: `npm test -- tests/delivery-system/openrouter-ledger-migration.test.ts tests/delivery-system/openrouter-stage0.test.ts tests/delivery-system/openrouter-stage1.test.ts tests/delivery-system/openrouter-spend-cap.test.ts && npm run typecheck && npm run beta:vendor-manifest && npm run beta:vendor-check`

Expected: PASS with no live API call.

- [ ] **Step 5: Commit**

```bash
git add src/data/delivery-system/openRouterLedgerMigration.ts src/data/delivery-system/cliWorkerCapture.ts src/data/delivery-system/cliWorker.ts tests vendor-manifest.json
git commit -m "fix: keep OpenRouter ledgers in managed state"
```

### Task 5: systemd writable boundaries

**Files:**
- Modify: `ops/systemd/autopilot-control-plane.service`
- Modify: `ops/systemd/autopilot-state-maintenance.service`
- Modify: `ops/systemd/README.md`
- Create: `tests/operations/systemd-units.test.ts`

**Interfaces:**
- Consumes: `%h/projects`, `%h/.local/state/autopilot`, and `AUTOPILOT_PROJECTS_DIR`.

- [ ] **Step 1: Write failing unit-policy tests**

```ts
expect(controlPlane).toContain("ProtectHome=read-only");
expect(controlPlane).toContain("ReadWritePaths=%h/.local/state/autopilot %h/projects");
expect(controlPlane).not.toMatch(/ReadWritePaths=.*autopilot-beta/);
expect(readme).toContain("ReadWritePaths=");
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/operations/systemd-units.test.ts`

Expected: FAIL because the project root is not writable and the custom-root drop-in is undocumented.

- [ ] **Step 3: Update the unit and documented override**

```ini
Environment=AUTOPILOT_PROJECTS_DIR=%h/projects
ReadWritePaths=%h/.local/state/autopilot %h/projects
```

Document that a custom root requires clearing and replacing `ReadWritePaths` in a reviewed drop-in. Keep the installation read-only. Point maintenance backup paths to `%h/.local/state/autopilot/backups`.

- [ ] **Step 4: Run unit tests and Ubuntu static verification**

Run: `npm test -- tests/operations/systemd-units.test.ts`

Run on Ubuntu: `systemd-analyze --user verify ops/systemd/*.service ops/systemd/*.timer`

Expected: tests pass; static verification reports no syntax or dependency errors.

- [ ] **Step 5: Commit**

```bash
git add ops/systemd tests/operations/systemd-units.test.ts
git commit -m "fix: constrain service project writes"
```

### Task 6: Runtime-path plan review gate

- [ ] Run the complete targeted command from this plan.
- [ ] Run `npm run typecheck` and `npm run beta:vendor-check`.
- [ ] Request a fresh code-quality review and a spec-compliance review.
- [ ] Resolve validated findings and rerun affected tests.
- [ ] Record the passing commit before starting the readiness plan.

