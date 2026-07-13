# Readiness and Runtime Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe core readiness, explicit provider capability reporting, strict cookie configuration, and one Node 24 Ubuntu runtime contract.

**Architecture:** A pure readiness module reads and validates state without mutation or provider calls. The public `/ready` route exposes only fixed component statuses and codes. Provider capabilities remain optional. Runtime metadata, CI, systemd, and installation all use Node 24 from `/usr/bin`.

**Tech Stack:** TypeScript, Node HTTP/filesystem APIs, Vitest, systemd, GitHub Actions, npm workspaces.

## Global Constraints

- `/health` stays exact liveness and never depends on state.
- `/ready` is public, bounded, non-sensitive, and read-only.
- Missing `projects.json` is core-unready; an initialized empty registry is core-ready.
- Provider absence degrades but never fails core readiness.
- Secure cookies are false for loopback HTTP and true only behind same-origin TLS.
- Supported Node contract is `>=24 <25`; CI uses Node 24; units use `/usr/bin/npm`.

---

### Task 1: Pure readiness report

**Files:**
- Create: `src/data/delivery-system/readiness.ts`
- Modify: `src/data/delivery-system/projectRegistry.ts`
- Modify: `src/data/delivery-system/supervisorQueue.ts`
- Modify: `src/data/delivery-system/tokenGateway.ts`
- Test: `tests/delivery-system/readiness.test.ts`

**Interfaces:**
- Consumes: configured state and project roots, provider command capabilities, OpenRouter configuration.
- Produces: `buildReadiness(options): ReadinessReport`, read-only state validators, and `projectRegistryPath(stateDir)`.

- [ ] **Step 1: Write failing readiness matrix tests**

```ts
expect(buildReadiness(healthy).ready).toBe(true);
expect(buildReadiness(healthy).status).toBe("ready");
expect(buildReadiness({ ...healthy, providerCommands: {} })).toMatchObject({ ready: true, status: "degraded" });
expect(buildReadiness(missingRegistry)).toMatchObject({ ready: false, status: "unavailable" });
expect(JSON.stringify(buildReadiness(secretFixture))).not.toContain(secretFixture.authToken);
```

Add malformed supervisor/gateway, invalid state permissions, empty valid registry, missing credential, and configured-but-unobserved provider cases.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/delivery-system/readiness.test.ts`

Expected: FAIL because the readiness module and read-only validators do not exist.

- [ ] **Step 3: Implement fixed readiness types and non-mutating validators**

```ts
export type ReadinessStatus = "ready" | "degraded" | "unavailable";
export type ReadinessErrorCode =
  | "invalid_configuration" | "state_unavailable" | "invalid_state_schema"
  | "project_registry_missing" | "invalid_project_registry"
  | "invalid_supervisor_state" | "invalid_token_gateway_state"
  | "probe_not_configured" | "not_observed" | ProviderErrorCode;
export interface ReadinessComponent {
  readonly status: ReadinessStatus;
  readonly error_code: ReadinessErrorCode | null;
}
export interface ReadinessComponents {
  readonly configuration: ReadinessComponent;
  readonly managed_state: ReadinessComponent;
  readonly project_registry: ReadinessComponent;
  readonly supervisor: ReadinessComponent;
  readonly token_gateway: ReadinessComponent;
  readonly providers: Readonly<Record<ProviderId, ReadinessComponent>>;
}
export interface ReadinessReport {
  readonly ready: boolean;
  readonly status: ReadinessStatus;
  readonly checked_at: string;
  readonly components: ReadinessComponents;
}
export interface BuildReadinessOptions {
  readonly stateDir: string;
  readonly projectRoot: string;
  readonly authToken: string | undefined;
  readonly providerCommands: Partial<Record<UsageProbeProvider, ProviderCliCapability>>;
  readonly openRouterConfigured: boolean;
  readonly now?: string;
}
```

Core components are configuration, managed state, project registry, supervisor, and token gateway. Use read-only validators that do not construct or recover mutable queues. Map optional provider snapshots to fixed statuses and codes only.

- [ ] **Step 4: Run readiness tests, typecheck, and provenance**

Run: `npm test -- tests/delivery-system/readiness.test.ts tests/delivery-system/project-registry.test.ts tests/delivery-system/supervisor-queue.test.ts tests/delivery-system/token-gateway.test.ts tests/delivery-system/provider-quota-store.test.ts && npm run typecheck && npm run beta:vendor-manifest && npm run beta:vendor-check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/delivery-system/readiness.ts src/data/delivery-system/projectRegistry.ts src/data/delivery-system/supervisorQueue.ts src/data/delivery-system/tokenGateway.ts tests vendor-manifest.json
git commit -m "feat: report control plane readiness"
```

### Task 2: Public `/ready` and readiness CLI

**Files:**
- Modify: `scripts/control-plane-server.ts`
- Create: `scripts/ops-readinesscheck.ts`
- Modify: `package.json`
- Test: `tests/scripts/control-plane-server.test.ts`
- Create: `tests/scripts/ops-readinesscheck.test.ts`

**Interfaces:**
- Consumes: `buildReadiness()`.
- Produces: `GET /ready` and `npm run ops:ready -- PORT`.

- [ ] **Step 1: Add failing HTTP and CLI tests**

```ts
expect(await get("/health")).toEqual({ status: 200, body: { ok: true } });
expect(await get("/ready", healthyRuntime)).toMatchObject({ status: 200, body: { ready: true } });
expect(await get("/ready", brokenCore)).toMatchObject({ status: 503, body: { ready: false } });
expect(JSON.stringify(await get("/ready", secretFailure))).not.toContain("secret-value");
```

Assert readiness exceptions return a fixed 503 report while `/health` still returns 200.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/scripts/control-plane-server.test.ts tests/scripts/ops-readinesscheck.test.ts`

Expected: FAIL because `/ready` and `ops:ready` are absent.

- [ ] **Step 3: Wire a bounded readiness callback and CLI**

```ts
export interface ControlPlaneServerOptions {
  readonly secureCookies?: boolean;
  readonly readiness?: () => ReadinessReport;
}
```

Route `/ready` immediately after `/health`. Return 200 only when `report.ready`; otherwise 503. The CLI uses a 5-second timeout, requires HTTP 200 and `ready === true`, and prints only component status/code pairs.

- [ ] **Step 4: Run route and adjacent runtime tests**

Run: `npm test -- tests/scripts/control-plane-server.test.ts tests/scripts/ops-readinesscheck.test.ts tests/delivery-system/readiness.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/control-plane-server.ts scripts/ops-readinesscheck.ts package.json tests vendor-manifest.json
git commit -m "feat: expose bounded readiness"
```

### Task 3: Strict cookie and provider-probe configuration

**Files:**
- Modify: `scripts/control-plane-server.ts`
- Create: `ops/config/control-plane.env.example`
- Modify: `ops/systemd/README.md`
- Modify: `docs/operations/cockpit-production-auth.md`
- Test: `tests/scripts/control-plane-server.test.ts`

**Interfaces:**
- Produces: `secureCookiesFromEnvironment(environment): boolean`.
- Preserves: `providerUsageCommandsFromEnvironment()` fixed allowlist.

- [ ] **Step 1: Write failing cookie parser and response tests**

```ts
expect(secureCookiesFromEnvironment({})).toBe(false);
expect(secureCookiesFromEnvironment({ CONTROL_PLANE_SECURE_COOKIES: "true" })).toBe(true);
expect(() => secureCookiesFromEnvironment({ CONTROL_PLANE_SECURE_COOKIES: "maybe" }))
  .toThrow("invalid_secure_cookie_configuration");
expect(loopbackLogin.headers["set-cookie"]).not.toContain("Secure");
expect(tlsLogin.headers["set-cookie"]).toContain("Secure");
```

- [ ] **Step 2: Run server tests and confirm invalid values are currently accepted**

Run: `npm test -- tests/scripts/control-plane-server.test.ts`

Expected: FAIL on strict parsing and explicit loopback cookie assertions.

- [ ] **Step 3: Implement strict parsing and the safe example env**

```dotenv
CONTROL_PLANE_SECURE_COOKIES=false
CONTROL_PLANE_USAGE_PROBES=
```

Document accepted probe names `codex,claude,agy`; do not permit arbitrary commands. Document that TLS proxy setup changes the cookie value to true. Keep `OPENROUTER_API_KEY` out of the example.

- [ ] **Step 4: Run auth/provider tests**

Run: `npm test -- tests/scripts/control-plane-server.test.ts tests/delivery-system/provider-quota-adapters.test.ts tests/delivery-system/provider-usage-probe.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/control-plane-server.ts ops/config/control-plane.env.example ops/systemd/README.md docs/operations/cockpit-production-auth.md tests vendor-manifest.json
git commit -m "fix: make provider and cookie config explicit"
```

### Task 4: Node 24 Ubuntu runtime contract

**Files:**
- Create: `.nvmrc`
- Modify: `package.json`
- Modify: `cockpit/package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/verify.yml`
- Modify: `ops/systemd/*.service`
- Modify: `ops/systemd/README.md`
- Test: `tests/operations/systemd-units.test.ts`

**Interfaces:**
- Produces: one Node/npm/runtime path contract.

- [ ] **Step 1: Add failing metadata and unit tests**

```ts
expect(rootPackage.engines.node).toBe(">=24 <25");
expect(cockpitPackage.engines.node).toBe(">=24 <25");
expect(readFileSync(".nvmrc", "utf8").trim()).toBe("24");
expect(workflow).toContain("node-version: '24'");
expect(controlPlaneUnit).toContain("ExecStart=/usr/bin/npm ");
```

- [ ] **Step 2: Run tests and confirm current Node 22/private npm drift**

Run: `npm test -- tests/operations/systemd-units.test.ts`

Expected: FAIL.

- [ ] **Step 3: Update runtime metadata, CI, units, and lockfile under Node 24**

```json
"engines": { "node": ">=24 <25" }
```

Set `.nvmrc` to `24`, CI to Node 24, and unit `ExecStart` paths to `/usr/bin/npm`. Regenerate the root workspace lock using Node 24 npm; do not hand-edit lock metadata.

- [ ] **Step 4: Verify from a Node 24 shell**

Run: `node --version && npm --version && npm install --package-lock-only && npm ci && npm test -- tests/operations/systemd-units.test.ts && npm run typecheck`

Expected: Node reports v24.x; install has no engine warning; tests and typecheck pass.

Run on Ubuntu: `systemd-analyze --user verify ops/systemd/*.service ops/systemd/*.timer`

- [ ] **Step 5: Commit**

```bash
git add .nvmrc package.json cockpit/package.json package-lock.json .github/workflows/verify.yml ops/systemd ops/systemd/README.md tests/operations/systemd-units.test.ts
git commit -m "build: align runtime on Node 24"
```

### Task 5: Readiness/configuration review gate

- [ ] Run all targeted readiness, provider, auth, registry, queue, gateway, and systemd tests.
- [ ] Run `npm run typecheck`, `npm run cockpit:test`, and `npm run cockpit:build` under Node 24.
- [ ] Request separate spec-compliance and code-quality reviews.
- [ ] Resolve findings and rerun affected checks.
- [ ] Record the passing commit before state-safety work begins.
