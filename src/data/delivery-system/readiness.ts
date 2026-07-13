import { accessSync, constants, existsSync, lstatSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

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
  | "probe_not_configured"
  | "not_observed"
  | ProviderErrorCode;

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

const PROVIDERS: readonly ProviderId[] = ["codex_cli", "claude_cli", "agy_cli", "openrouter_api"];
const READY: ReadinessComponent = { status: "ready", error_code: null };

/** Builds a bounded readiness view without creating, recovering, or rewriting managed state. */
export function buildReadiness(options: BuildReadinessOptions): ReadinessReport {
  const checkedAt = validTimestamp(options.now) ? options.now : new Date().toISOString();
  const configuration = configurationReadiness(options);
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
  const core = [configuration, effectiveManagedState, projectRegistry, supervisor, tokenGateway];
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
      managed_state: effectiveManagedState,
      project_registry: projectRegistry,
      supervisor,
      token_gateway: tokenGateway,
      providers
    }
  };
}

function configurationReadiness(options: BuildReadinessOptions): ReadinessComponent {
  if (!isNonEmpty(options.stateDir) || !isAbsolute(options.stateDir) ||
    !isNonEmpty(options.projectRoot) || !isAbsolute(options.projectRoot) ||
    !isNonEmpty(options.authToken) ||
    (options.now !== undefined && !validTimestamp(options.now))) {
    return unavailable("invalid_configuration");
  }
  try {
    resolveConfiguredProjectRoot({ AUTOPILOT_PROJECTS_DIR: options.projectRoot });
    if (!statSync(options.projectRoot).isDirectory()) return unavailable("invalid_configuration");
  } catch {
    return unavailable("invalid_configuration");
  }
  return READY;
}

function managedStateReadiness(stateDir: string): ReadinessComponent {
  try {
    const metadata = lstatSync(stateDir);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return unavailable("state_unavailable");
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      return unavailable("state_unavailable");
    }
    accessSync(stateDir, constants.R_OK | constants.X_OK);
    return READY;
  } catch {
    return unavailable("state_unavailable");
  }
}

function projectRegistryReadiness(stateDir: string, projectRoot: string): ReadinessComponent {
  const path = projectRegistryPath(stateDir);
  if (!existsSync(path)) return unavailable("project_registry_missing");
  try {
    if (!lstatSync(path).isFile()) return unavailable("invalid_project_registry");
    const registry = readProjectRegistry(stateDir);
    for (const project of registry.projects) {
      if (project.enabled) resolveEnabledProject(stateDir, project.project_id, { projectRoot });
    }
    if (!lstatSync(path).isFile()) return unavailable("invalid_project_registry");
    return READY;
  } catch {
    return existsSync(path)
      ? unavailable("invalid_project_registry")
      : unavailable("project_registry_missing");
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
