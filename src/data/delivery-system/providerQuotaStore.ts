import { join } from "node:path";

import { RUN_REASONING_EFFORTS, SUPPORTED_REASONING_EFFORTS, type RunReasoningEffort } from "./executionProfile";
import { readManagedStateTextFile } from "./managedStateFile";
import { isCanonicalModelId } from "./providerModelId";
import {
  normalizeProviderProbeFailure,
  normalizeQuotaWindow,
  type ProviderSnapshot,
  type ProviderErrorCode,
  type ProviderHealth,
  type ProviderModelCatalogSnapshot,
  type ProviderModelDiscovery,
  type ProviderQuotaSource
} from "./providerQuota";
import { appendStateFile, writeStateFileAtomically } from "./stateMaintenanceLock";

export const PROVIDER_QUOTA_SNAPSHOTS_FILE = "provider-quota-snapshots.json";
export const PROVIDER_QUOTA_EVENTS_FILE = "provider-quota-events.jsonl";

export interface ProviderQuotaStoreDocument {
  readonly schema_version: "v1";
  readonly snapshots: readonly ProviderSnapshot[];
}

export interface ProviderQuotaEvent {
  readonly provider: string;
  readonly observed_at: string;
  readonly status: "success" | "error";
  readonly changed_fields: readonly string[];
  readonly error_code: ProviderErrorCode | null;
  /** Accepted for adapter convenience but deliberately never persisted. */
  readonly raw_response?: unknown;
}

const MAX_PROVIDER_LENGTH = 100;
const MAX_FIELD_LENGTH = 200;
const MAX_CHANGED_FIELDS = 32;
const MAX_PROVIDER_QUOTA_STORE_BYTES = 2 * 1024 * 1024;
const SOURCES: readonly ProviderQuotaSource[] = ["cli", "api", "manual-fallback"];
const HEALTH: readonly ProviderHealth[] = ["healthy", "degraded", "unavailable"];
const DISCOVERIES: readonly ProviderModelDiscovery[] = ["usage_probe", "models_cache", "cli_list", "static"];
const ERRORS: readonly (ProviderErrorCode | null)[] = ["timeout", "missing_credential", "malformed_response", "provider_executable_missing", "provider_runtime_denied", "provider_unavailable", "provider_error", null];

export function readProviderQuotaStore(stateDir: string): ProviderQuotaStoreDocument {
  const path = join(stateDir, PROVIDER_QUOTA_SNAPSHOTS_FILE);
  let parsed: unknown;
  try {
    const file = readManagedStateTextFile(path, { maxBytes: MAX_PROVIDER_QUOTA_STORE_BYTES });
    if (file.status === "missing") return { schema_version: "v1", snapshots: [] };
    parsed = JSON.parse(file.text);
  } catch {
    throw new Error("invalid_provider_quota_store");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { schema_version?: unknown }).schema_version !== "v1" ||
    !Array.isArray((parsed as { snapshots?: unknown }).snapshots)
  ) {
    throw new Error("invalid_provider_quota_store");
  }
  const snapshots = (parsed as { snapshots: unknown[] }).snapshots.flatMap((value) => {
    const snapshot = sanitizeProviderSnapshot(value);
    return snapshot === null ? [] : [snapshot];
  });
  return { schema_version: "v1", snapshots };
}

export function writeProviderQuotaStore(stateDir: string, document: ProviderQuotaStoreDocument): void {
  if (document.schema_version !== "v1" || !Array.isArray(document.snapshots)) {
    throw new Error("invalid_provider_quota_store");
  }
  const snapshots = document.snapshots.flatMap((value) => {
    const snapshot = sanitizeProviderSnapshot(value);
    return snapshot === null ? [] : [snapshot];
  });
  const serialized = `${JSON.stringify({ schema_version: "v1", snapshots }, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROVIDER_QUOTA_STORE_BYTES) {
    throw new Error("provider_quota_store_limit");
  }
  const path = join(stateDir, PROVIDER_QUOTA_SNAPSHOTS_FILE);
  writeStateFileAtomically(stateDir, path, serialized);
}

/** Validates persisted data and strips unknown or credential-bearing fields. */
export function sanitizeProviderSnapshot(value: unknown): ProviderSnapshot | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const provider = row.provider;
  if (typeof provider !== "string" || provider.length === 0 || provider.length > MAX_PROVIDER_LENGTH) return null;
  if (!SOURCES.includes(row.source as ProviderQuotaSource) || !HEALTH.includes(row.health as ProviderHealth) || !ERRORS.includes(row.error_code as ProviderErrorCode | null)) return null;
  if (typeof row.fetched_at !== "string" || row.fetched_at.length > MAX_FIELD_LENGTH || typeof row.observed_at !== "string" || row.observed_at.length > MAX_FIELD_LENGTH) return null;
  if ((typeof row.api_spend === "number" && !Number.isFinite(row.api_spend)) || (typeof row.api_spend !== "number" && row.api_spend !== null)) return null;
  if (row.currency !== null && (typeof row.currency !== "string" || row.currency.length > 16)) return null;
  if (!Array.isArray(row.models)) return null;
  const models = row.models.slice(0, 256).flatMap((model) => {
    if (typeof model !== "object" || model === null || Array.isArray(model)) return [];
    const item = model as Record<string, unknown>;
    if (typeof item.model_id !== "string" || !isCanonicalModelId(item.model_id) || typeof item.available !== "boolean" || !HEALTH.includes(item.health as ProviderHealth) || !SOURCES.includes(item.source as ProviderQuotaSource)) return [];
    const discovery = DISCOVERIES.includes(item.discovery as ProviderModelDiscovery)
      ? item.discovery as ProviderModelDiscovery
      : "usage_probe";
    const reasoningEfforts = sanitizeReasoningEfforts(item.reasoning_efforts, provider);
    return [{
      model_id: item.model_id,
      available: item.available,
      health: item.health as ProviderHealth,
      source: item.source as ProviderQuotaSource,
      discovery,
      ...(reasoningEfforts === undefined ? {} : { reasoning_efforts: reasoningEfforts })
    }];
  });
  const window = (candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (!["limit", "used", "remaining"].every((key) => item[key] === null || (typeof item[key] === "number" && Number.isFinite(item[key])))) return null;
    if (item.resets_at !== null && (typeof item.resets_at !== "string" || item.resets_at.length > MAX_FIELD_LENGTH)) return null;
    return normalizeQuotaWindow({ limit: item.limit as number | null, used: item.used as number | null, remaining: item.remaining as number | null, resets_at: item.resets_at as string | null });
  };
  const five = window(row.five_hour);
  const weekly = window(row.weekly);
  if (five === null || weekly === null) return null;
  const cliVersion = row.cli_version === undefined ? undefined : sanitizeCliVersion(row.cli_version);
  const probeFailure = row.error_code === null ? null : normalizeProviderProbeFailure(row.probe_failure);
  const modelCatalog = sanitizeModelCatalog(row.model_catalog);
  return {
    provider,
    source: row.source as ProviderQuotaSource,
    fetched_at: row.fetched_at,
    observed_at: row.observed_at,
    five_hour: five,
    weekly,
    api_spend: row.api_spend as number | null,
    currency: row.currency as string | null,
    models,
    ...(cliVersion === undefined ? {} : { cli_version: cliVersion }),
    ...(modelCatalog === undefined ? {} : { model_catalog: modelCatalog }),
    health: row.health as ProviderHealth,
    error_code: row.error_code as ProviderErrorCode | null,
    ...(probeFailure === null ? {} : { probe_failure: probeFailure })
  };
}

function sanitizeModelCatalog(value: unknown): ProviderModelCatalogSnapshot | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (
    row.discovery !== "models_cache"
    || typeof row.fetched_at !== "string"
    || row.fetched_at.length === 0
    || row.fetched_at.length > MAX_FIELD_LENGTH
    || !Number.isFinite(Date.parse(row.fetched_at))
  ) return undefined;
  return { discovery: "models_cache", fetched_at: row.fetched_at };
}

function sanitizeReasoningEfforts(value: unknown, provider: string): readonly RunReasoningEffort[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  const supported = Object.hasOwn(SUPPORTED_REASONING_EFFORTS, provider)
    ? SUPPORTED_REASONING_EFFORTS[provider as keyof typeof SUPPORTED_REASONING_EFFORTS] as readonly RunReasoningEffort[]
    : [];
  const advertised = new Set<RunReasoningEffort>();
  for (const effort of value.slice(0, 32)) {
    if (typeof effort === "string" && supported.includes(effort as RunReasoningEffort)) {
      advertised.add(effort as RunReasoningEffort);
    }
  }
  return RUN_REASONING_EFFORTS.filter((effort) => advertised.has(effort));
}

function sanitizeCliVersion(value: unknown): string | null {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 100
    && /^[A-Za-z0-9 ._()/-]+$/.test(value)
    ? value
    : null;
}

export function appendProviderQuotaEvent(stateDir: string, event: ProviderQuotaEvent): void {
  const bounded = {
    provider: event.provider.slice(0, MAX_PROVIDER_LENGTH),
    observed_at: event.observed_at.slice(0, MAX_FIELD_LENGTH),
    status: event.status,
    changed_fields: [...new Set(event.changed_fields.map((field) => field.slice(0, MAX_FIELD_LENGTH)))].slice(0, MAX_CHANGED_FIELDS),
    error_code: event.error_code
  };
  appendStateFile(stateDir, join(stateDir, PROVIDER_QUOTA_EVENTS_FILE), `${JSON.stringify(bounded)}\n`);
}
