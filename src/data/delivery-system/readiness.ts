import { accessSync, constants, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

import {
  projectRegistryPath,
  readProjectRegistry,
  resolveEnabledProject
} from "./projectRegistry";
import type { ProviderErrorCode, ProviderSnapshot } from "./providerQuota";
import { readProviderQuotaStore } from "./providerQuotaStore";
import type { ProviderCliCapability } from "./providerQuotaAdapters";
import type { UsageProbeProvider } from "./providerUsageProbe";
import { resolveConfiguredProjectRoot } from "./runtimePaths";
import { validateSupervisorState } from "./supervisorQueue";
import { validateTokenGatewayState } from "./tokenGateway";
import {
  adminCredentialsPathIsOutsideState,
  AdminCredentialsError,
  loadAdminCredentials
} from "./adminCredentials";

export type ReadinessStatus = "ready" | "degraded" | "unavailable";
export type ProviderId = UsageProbeProvider | "openrouter_api";
export type ReadinessErrorCode =
  | "invalid_configuration"
  | "state_unavailable"
  | "invalid_state_schema"
  | "project_registry_missing"
  | "invalid_project_registry"
  | "invalid_supervisor_state"
  | "invalid_token_gateway_state"
  | "admin_credentials_missing"
  | "invalid_admin_credentials"
  | "admin_credentials_in_managed_state"
  | "service_token_missing"
  | "invalid_service_token"
  | "secure_cookies_required"
  | "probe_not_configured"
  | "not_observed"
  | ProviderErrorCode;

export interface ReadinessComponent {
  readonly status: ReadinessStatus;
  readonly error_code: ReadinessErrorCode | null;
}

export interface ReadinessComponents {
  readonly configuration: ReadinessComponent;
  readonly authentication: ReadinessComponent;
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
  readonly adminCredentialsPath: string;
  readonly serviceTokenDigest: () => string | null;
  readonly secureCookies: boolean;
  readonly secureCookiesRequired: boolean;
  readonly providerCommands: Partial<Record<UsageProbeProvider, ProviderCliCapability>>;
  readonly openRouterConfigured: boolean;
  readonly now?: string;
}

const PROVIDERS: readonly ProviderId[] = ["codex_cli", "claude_cli", "agy_cli", "openrouter_api"];
const READY: ReadinessComponent = { status: "ready", error_code: null };

/** Builds a bounded readiness view without creating, recovering, or rewriting managed state. */
export function buildReadiness(options: BuildReadinessOptions): ReadinessReport {
  const checkedAt = validTimestamp(options.now) ? options.now : new Date().toISOString();
  const configuration = configurationReadiness(options);
  const authentication = authenticationReadiness(options);
  const managedState = managedStateReadiness(options.stateDir);
  const projectRegistry = projectRegistryReadiness(options.stateDir, options.projectRoot);
  const supervisor = fixedValidation(
    () => validateSupervisorState(options.stateDir),
    "invalid_supervisor_state"
  );
  const tokenGateway = fixedValidation(
    () => validateTokenGatewayState(options.stateDir),
    "invalid_token_gateway_state"
  );
  const providerState = providerSnapshots(options.stateDir);
  const providers = Object.fromEntries(PROVIDERS.map((provider) => [
    provider,
    providerReadiness(provider, options, providerState.snapshots)
  ])) as Record<ProviderId, ReadinessComponent>;
  const effectiveManagedState = managedState.status === "ready" ? providerState.managedState : managedState;
  const core = [configuration, authentication, effectiveManagedState, projectRegistry, supervisor, tokenGateway];
  const ready = core.every((component) => component.status === "ready");
  const status: ReadinessStatus = !ready
    ? "unavailable"
    : Object.values(providers).some((component) => component.status !== "ready")
      ? "degraded"
      : "ready";

  return {
    ready,
    status,
    checked_at: checkedAt,
    components: {
      configuration,
      authentication,
      managed_state: effectiveManagedState,
      project_registry: projectRegistry,
      supervisor,
      token_gateway: tokenGateway,
      providers
    }
  };
}

function authenticationReadiness(options: BuildReadinessOptions): ReadinessComponent {
  if (!adminCredentialsPathIsOutsideState(options.stateDir, options.adminCredentialsPath)) {
    return unavailable("admin_credentials_in_managed_state");
  }
  try {
    loadAdminCredentials(options.adminCredentialsPath);
  } catch (error) {
    if (error instanceof AdminCredentialsError && error.code === "admin_credentials_missing") {
      return unavailable("admin_credentials_missing");
    }
    return unavailable("invalid_admin_credentials");
  }
  let digest: string | null;
  try {
    digest = options.serviceTokenDigest();
  } catch {
    return unavailable("invalid_service_token");
  }
  if (digest === null) return unavailable("service_token_missing");
  if (!/^[a-f0-9]{64}$/.test(digest)) return unavailable("invalid_service_token");
  if (options.secureCookiesRequired && !options.secureCookies) return unavailable("secure_cookies_required");
  return READY;
}

function configurationReadiness(options: BuildReadinessOptions): ReadinessComponent {
  if (!isNonEmpty(options.stateDir) || !isAbsolute(options.stateDir) || normalize(options.stateDir) !== options.stateDir ||
    !isNonEmpty(options.projectRoot) || !isAbsolute(options.projectRoot) ||
    !isNonEmpty(options.authToken) ||
    (options.now !== undefined && !validTimestamp(options.now))) {
    return unavailable("invalid_configuration");
  }
  try {
    resolveConfiguredProjectRoot({ AUTOPILOT_PROJECTS_DIR: options.projectRoot });
    if (!isPrivateAccessibleDirectory(options.projectRoot)) return unavailable("invalid_configuration");
  } catch {
    return unavailable("invalid_configuration");
  }
  return READY;
}

function managedStateReadiness(stateDir: string): ReadinessComponent {
  try {
    return isPrivateAccessibleDirectory(stateDir) ? READY : unavailable("state_unavailable");
  } catch {
    return unavailable("state_unavailable");
  }
}

function projectRegistryReadiness(stateDir: string, projectRoot: string): ReadinessComponent {
  const path = projectRegistryPath(stateDir);
  try {
    if (!lstatSync(path).isFile()) return unavailable("invalid_project_registry");
  } catch (error) {
    return nodeErrorCode(error) === "ENOENT"
      ? unavailable("project_registry_missing")
      : unavailable("invalid_project_registry");
  }
  try {
    const registry = readProjectRegistry(stateDir);
    for (const project of registry.projects) {
      if (project.enabled) resolveEnabledProject(stateDir, project.project_id, { projectRoot });
    }
    if (!lstatSync(path).isFile()) return unavailable("invalid_project_registry");
    return READY;
  } catch {
    return unavailable("invalid_project_registry");
  }
}

function providerSnapshots(stateDir: string): {
  readonly snapshots: readonly ProviderSnapshot[];
  readonly managedState: ReadinessComponent;
} {
  try {
    return { snapshots: readProviderQuotaStore(stateDir).snapshots, managedState: READY };
  } catch {
    return { snapshots: [], managedState: unavailable("invalid_state_schema") };
  }
}

function providerReadiness(
  provider: ProviderId,
  options: BuildReadinessOptions,
  snapshots: readonly ProviderSnapshot[]
): ReadinessComponent {
  if (provider === "openrouter_api") {
    if (!options.openRouterConfigured) return unavailable("missing_credential");
  } else if (options.providerCommands[provider] === undefined) {
    return unavailable("probe_not_configured");
  }
  const snapshot = snapshots.find((candidate) => candidate.provider === provider);
  if (snapshot === undefined) return { status: "degraded", error_code: "not_observed" };
  if (snapshot.health === "healthy") return READY;
  return {
    status: snapshot.health,
    error_code: snapshot.error_code ?? "provider_error"
  };
}

function fixedValidation(validate: () => void, errorCode: ReadinessErrorCode): ReadinessComponent {
  try {
    validate();
    return READY;
  } catch {
    return unavailable(errorCode);
  }
}

function unavailable(errorCode: ReadinessErrorCode): ReadinessComponent {
  return { status: "unavailable", error_code: errorCode };
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validTimestamp(value: string | undefined): value is string {
  if (value === undefined || value.length > 64) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isPrivateAccessibleDirectory(path: string): boolean {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(path) !== path) return false;
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) return false;
  accessSync(path, constants.R_OK | constants.W_OK | constants.X_OK);
  return true;
}

function nodeErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "";
}
