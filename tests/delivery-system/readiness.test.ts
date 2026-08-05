import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildReadiness,
  type BuildReadinessOptions
} from "../../src/data/delivery-system/readiness";
import {
  ADMIN_CREDENTIALS_VERSION,
  writeAdminCredentials
} from "../../src/data/delivery-system/adminCredentials";
import {
  AuthSessionRegistry,
  authStateRoot
} from "../../src/data/delivery-system/authSessionRegistry";
import { projectRegistryPath, writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";
import { normalizeQuotaWindow, type ProviderSnapshot } from "../../src/data/delivery-system/providerQuota";
import { writeProviderQuotaStore } from "../../src/data/delivery-system/providerQuotaStore";

const NOW = "2026-07-13T12:00:00.000Z";
const PROVIDERS = ["codex_cli", "claude_cli", "agy_cli", "openrouter_api"] as const;
const PROVIDER_COMMANDS = {
  codex_cli: { kind: "tmux_usage", executable: "codex" },
  claude_cli: { kind: "tmux_usage", executable: "claude" },
  agy_cli: { kind: "tmux_usage", executable: "agy" }
} as const;

function snapshot(provider: typeof PROVIDERS[number]): ProviderSnapshot {
  return {
    provider,
    source: provider === "openrouter_api" ? "api" : "cli",
    fetched_at: NOW,
    observed_at: NOW,
    five_hour: normalizeQuotaWindow({}),
    weekly: normalizeQuotaWindow({}),
    api_spend: null,
    currency: null,
    models: [],
    health: "healthy",
    error_code: null
  };
}

function fixture(options: { readonly observations?: boolean } = {}): BuildReadinessOptions {
  const root = mkdtempSync(join(tmpdir(), "readiness-"));
  const stateDir = join(root, "state");
  const projectRoot = join(root, "projects");
  mkdirSync(stateDir, { mode: 0o700 });
  mkdirSync(projectRoot, { mode: 0o700 });
  writeProjectRegistry(stateDir, { schema_version: "v1", projects: [] });
  const adminCredentialsPath = join(root, "admin-credentials.json");
  writeAdminCredentials(adminCredentialsPath, {
    version: ADMIN_CREDENTIALS_VERSION,
    username: "admin",
    salt: "11".repeat(32),
    params: { N: 2 ** 15, r: 8, p: 1, keylen: 64 },
    hash: "22".repeat(64),
    credential_generation: 1
  });
  const authRegistry = new AuthSessionRegistry(authStateRoot(stateDir));
  authRegistry.storeServiceToken("33".repeat(32), Date.parse(NOW));
  if (options.observations !== false) {
    writeProviderQuotaStore(stateDir, {
      schema_version: "v1",
      snapshots: PROVIDERS.map(snapshot)
    });
  }
  return {
    stateDir,
    projectRoot,
    adminCredentialsPath,
    serviceTokenDigest: () => authRegistry.serviceTokenDigest(),
    secureCookies: false,
    secureCookiesRequired: false,
    providerCommands: PROVIDER_COMMANDS,
    openRouterConfigured: true,
    now: NOW
  };
}

function persistedFiles(stateDir: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    readdirSync(stateDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
      .map((name) => [name, readFileSync(join(stateDir, name), "utf8")])
  );
}

describe("buildReadiness", () => {
  it("reports a fully observed healthy core and provider set as ready", () => {
    const report = buildReadiness(fixture());

    expect(report).toEqual({
      ready: true,
      status: "ready",
      checked_at: NOW,
      components: {
        configuration: { status: "ready", error_code: null },
        authentication: { status: "ready", error_code: null },
        managed_state: { status: "ready", error_code: null },
        project_registry: { status: "ready", error_code: null },
        supervisor: { status: "ready", error_code: null },
        token_gateway: { status: "ready", error_code: null },
        providers: Object.fromEntries(PROVIDERS.map((provider) => [provider, { status: "ready", error_code: null }]))
      }
    });
  });

  it("treats an initialized empty project registry as core-ready", () => {
    expect(buildReadiness(fixture())).toMatchObject({
      ready: true,
      components: { project_registry: { status: "ready", error_code: null } }
    });
  });

  it("keeps the core ready but degrades when optional probes are not configured", () => {
    const options = fixture();
    const report = buildReadiness({ ...options, providerCommands: {} });

    expect(report).toMatchObject({ ready: true, status: "degraded" });
    expect(report.components.providers).toMatchObject({
      codex_cli: { status: "unavailable", error_code: "probe_not_configured" },
      claude_cli: { status: "unavailable", error_code: "probe_not_configured" },
      agy_cli: { status: "unavailable", error_code: "probe_not_configured" },
      openrouter_api: { status: "ready", error_code: null }
    });
  });

  it("reports an enabled but missing provider executable before consulting a healthy snapshot", () => {
    const options = fixture();
    const report = buildReadiness({
      ...options,
      providerCommands: {
        ...PROVIDER_COMMANDS,
        codex_cli: { kind: "unavailable", error_code: "provider_executable_missing" }
      }
    });

    expect(report).toMatchObject({ ready: true, status: "degraded" });
    expect(report.components.providers.codex_cli).toEqual({
      status: "unavailable",
      error_code: "provider_executable_missing"
    });
  });

  it("distinguishes configured but unobserved providers from missing credentials", () => {
    const options = fixture({ observations: false });
    const report = buildReadiness({ ...options, openRouterConfigured: false });

    expect(report).toMatchObject({ ready: true, status: "degraded" });
    expect(report.components.providers).toEqual({
      codex_cli: { status: "degraded", error_code: "not_observed" },
      claude_cli: { status: "degraded", error_code: "not_observed" },
      agy_cli: { status: "degraded", error_code: "not_observed" },
      openrouter_api: { status: "unavailable", error_code: "missing_credential" }
    });
  });

  it("fails core readiness when the registry is missing", () => {
    const options = fixture();
    unlinkSync(projectRegistryPath(options.stateDir));

    expect(buildReadiness(options)).toMatchObject({
      ready: false,
      status: "unavailable",
      components: { project_registry: { status: "unavailable", error_code: "project_registry_missing" } }
    });
  });

  it("reports the distinct authentication component without repurposing configuration or token gateway", () => {
    const missingAdmin = fixture();
    unlinkSync(missingAdmin.adminCredentialsPath);
    expect(buildReadiness(missingAdmin)).toMatchObject({
      ready: false,
      components: {
        configuration: { status: "ready", error_code: null },
        authentication: { status: "unavailable", error_code: "admin_credentials_missing" },
        token_gateway: { status: "ready", error_code: null }
      }
    });

    const missingService = fixture();
    expect(buildReadiness({ ...missingService, serviceTokenDigest: () => null })).toMatchObject({
      ready: false,
      components: {
        authentication: { status: "unavailable", error_code: "service_token_missing" }
      }
    });

    const insecure = fixture();
    expect(buildReadiness({ ...insecure, secureCookiesRequired: true, secureCookies: false })).toMatchObject({
      ready: false,
      components: {
        authentication: { status: "unavailable", error_code: "secure_cookies_required" }
      }
    });
  });

  it("rejects admin credentials stored inside managed state", () => {
    const options = fixture();
    const managedCredentialsPath = join(options.stateDir, "admin-credentials.json");
    writeFileSync(managedCredentialsPath, readFileSync(options.adminCredentialsPath), { mode: 0o600 });

    expect(buildReadiness({ ...options, adminCredentialsPath: managedCredentialsPath })).toMatchObject({
      ready: false,
      components: {
        authentication: {
          status: "unavailable",
          error_code: "admin_credentials_in_managed_state"
        }
      }
    });
  });

  it("reports malformed registry, supervisor, and gateway state with fixed codes", () => {
    const malformedRegistry = fixture();
    writeFileSync(projectRegistryPath(malformedRegistry.stateDir), "not-json", "utf8");
    expect(buildReadiness(malformedRegistry).components.project_registry).toEqual({
      status: "unavailable",
      error_code: "invalid_project_registry"
    });

    const malformedSupervisor = fixture();
    writeFileSync(join(malformedSupervisor.stateDir, "supervisor-queue.json"), "not-json", "utf8");
    expect(buildReadiness(malformedSupervisor).components.supervisor).toEqual({
      status: "unavailable",
      error_code: "invalid_supervisor_state"
    });

    const malformedGateway = fixture();
    writeFileSync(join(malformedGateway.stateDir, "token-gateway-state.json"), "not-json", "utf8");
    expect(buildReadiness(malformedGateway).components.token_gateway).toEqual({
      status: "unavailable",
      error_code: "invalid_token_gateway_state"
    });
  });

  it.runIf(process.platform !== "win32")("rejects unsafe managed-state file types through each read-only validator", () => {
    const cases = [
      ["supervisor-queue.json", { schema_version: "v1", tasks: [] }],
      ["token-gateway-state.json", { used: {}, reservations: {}, terminal: {} }],
      ["provider-quota-snapshots.json", { schema_version: "v1", snapshots: [] }]
    ] as const;
    for (const [fileName, document] of cases) {
      const options = fixture();
      rmSync(join(options.stateDir, fileName), { force: true });
      const target = join(options.stateDir, `${fileName}.target`);
      writeFileSync(target, `${JSON.stringify(document)}\n`);
      symlinkSync(target, join(options.stateDir, fileName), "file");
      expect(buildReadiness(options).ready).toBe(false);
    }
  });

  it("rejects an enabled registry entry outside the configured project root", () => {
    const options = fixture();
    const outside = join(options.stateDir, "outside-project");
    mkdirSync(outside);
    writeProjectRegistry(options.stateDir, {
      schema_version: "v1",
      projects: [{
        schema_version: "v1",
        project_id: "outside",
        name: "Outside",
        cwd: outside,
        enabled: true
      }]
    });

    expect(buildReadiness(options)).toMatchObject({
      ready: false,
      components: {
        project_registry: { status: "unavailable", error_code: "invalid_project_registry" }
      }
    });
  });

  it("fails closed for missing authentication and insecure managed-state permissions", () => {
    const missingCredential = fixture();
    expect(buildReadiness({ ...missingCredential, adminCredentialsPath: `${missingCredential.adminCredentialsPath}.missing` })).toMatchObject({
      ready: false,
      components: { authentication: { status: "unavailable", error_code: "admin_credentials_missing" } }
    });

    const invalidRoot = fixture();
    expect(buildReadiness({
      ...invalidRoot,
      projectRoot: `${invalidRoot.projectRoot}/../projects`
    })).toMatchObject({
      ready: false,
      components: { configuration: { status: "unavailable", error_code: "invalid_configuration" } }
    });

    const nonNormalizedState = fixture();
    expect(buildReadiness({
      ...nonNormalizedState,
      stateDir: `${nonNormalizedState.stateDir}/../state`
    }).components.configuration).toEqual({ status: "unavailable", error_code: "invalid_configuration" });

    if (process.platform !== "win32") {
      const insecureState = fixture();
      chmodSync(insecureState.stateDir, 0o755);
      expect(statSync(insecureState.stateDir).mode & 0o077).not.toBe(0);
      expect(buildReadiness(insecureState)).toMatchObject({
        ready: false,
        components: { managed_state: { status: "unavailable", error_code: "state_unavailable" } }
      });

      const readOnlyState = fixture();
      chmodSync(readOnlyState.stateDir, 0o500);
      expect(buildReadiness(readOnlyState).components.managed_state).toEqual({
        status: "unavailable",
        error_code: "state_unavailable"
      });

      const insecureProjectRoot = fixture();
      chmodSync(insecureProjectRoot.projectRoot, 0o755);
      expect(buildReadiness(insecureProjectRoot).components.configuration).toEqual({
        status: "unavailable",
        error_code: "invalid_configuration"
      });
    }
  });

  it.runIf(process.platform !== "win32")("rejects symlinked state and project roots", () => {
    const stateOptions = fixture();
    const stateLink = `${stateOptions.stateDir}-link`;
    symlinkSync(stateOptions.stateDir, stateLink, "dir");
    expect(buildReadiness({ ...stateOptions, stateDir: stateLink }).components.managed_state).toEqual({
      status: "unavailable",
      error_code: "state_unavailable"
    });

    const projectOptions = fixture();
    const projectLink = `${projectOptions.projectRoot}-link`;
    symlinkSync(projectOptions.projectRoot, projectLink, "dir");
    expect(buildReadiness({ ...projectOptions, projectRoot: projectLink }).components.configuration).toEqual({
      status: "unavailable",
      error_code: "invalid_configuration"
    });
  });

  it.runIf(process.platform !== "win32")("classifies a dangling registry symlink as malformed, not missing", () => {
    const options = fixture();
    const path = projectRegistryPath(options.stateDir);
    rmSync(path);
    symlinkSync(join(options.stateDir, "missing-target.json"), path, "file");

    expect(buildReadiness(options).components.project_registry).toEqual({
      status: "unavailable",
      error_code: "invalid_project_registry"
    });
  });

  it("does not expose credentials, paths, exception text, or mutate persisted state", () => {
    const options = fixture();
    const redactionSecret = "readiness-redaction-probe-secret";
    writeFileSync(join(options.stateDir, "supervisor-queue.json"), `malformed ${redactionSecret}`, "utf8");
    const before = persistedFiles(options.stateDir);

    const serialized = JSON.stringify(buildReadiness(options));

    expect(serialized).not.toContain(redactionSecret);
    expect(serialized).not.toContain(options.stateDir);
    expect(serialized).not.toContain(options.projectRoot);
    expect(serialized).not.toContain("malformed");
    expect(persistedFiles(options.stateDir)).toEqual(before);
  });
});
