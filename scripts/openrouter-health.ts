import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVE_FREE_MODELS,
  SUBSTITUTE_LADDERS,
  isEndpointUsable,
  type SubstituteCandidate,
  type SubstituteRole
} from "../src/data/delivery-system/openrouterSubstitutes";

const OPENROUTER_ENDPOINTS_BASE_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface EndpointEvaluation {
  readonly provider: string;
  readonly usable: boolean;
  readonly status: number | null;
  readonly up5m: number | null;
  readonly up30m: number | null;
  readonly up1d: number | null;
}

export interface ModelHealthEvaluation {
  readonly endpoints: readonly EndpointEvaluation[];
  readonly usable: boolean;
}

export interface ModelProbeReport extends ModelHealthEvaluation {
  readonly model_id: string;
  readonly error?: string;
}

export type EndpointVerdict = "USABLE" | "DOWN" | "GREY" | "UNKNOWN";

export type RoleRecommendation =
  | {
      readonly role: SubstituteRole;
      readonly primary_model_id: string;
      readonly recommendation: "primary_allowlisted";
      readonly message: string;
    }
  | {
      readonly role: SubstituteRole;
      readonly primary_model_id: string;
      readonly recommendation: "ladder_candidate";
      readonly candidate_model_id: string;
      readonly candidate_provider_slug: string;
      readonly quality: SubstituteCandidate["quality"];
      readonly message: string;
    }
  | {
      readonly role: SubstituteRole;
      readonly primary_model_id: string;
      readonly recommendation: "paid_subscription";
      readonly message: string;
    };

export interface OpenRouterHealthReport {
  readonly generated_at: string;
  readonly models: readonly ModelProbeReport[];
  readonly recommendations: readonly RoleRecommendation[];
}

export interface OpenRouterHealthFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type OpenRouterHealthFetch = (
  url: string,
  init: {
    readonly method: "GET";
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  }
) => Promise<OpenRouterHealthFetchResponse>;

const ACTIVE_PRIMARY_MODEL_BY_ROLE: Readonly<Record<SubstituteRole, string>> = {
  code_draft: ACTIVE_FREE_MODELS.qwen3_code_draft,
  planning: ACTIVE_FREE_MODELS.nemotron_planning
};

export function buildOpenRouterHealthProbeList(): readonly string[] {
  const ids = new Set<string>(Object.values(ACTIVE_FREE_MODELS));

  for (const candidate of Object.values(SUBSTITUTE_LADDERS).flat()) {
    ids.add(candidate.model_id);
  }

  return [...ids];
}

export function evaluateModelHealth(payloadJson: unknown): ModelHealthEvaluation {
  const record = asRecord(payloadJson);
  // Measured live 2026-07-06: the endpoints API wraps the model in a top-level `data` object
  // ({ data: { ..., endpoints: [...] } }); accept the bare shape too, defensively.
  const dataRecord = asRecord(record?.data) ?? record;
  const endpointsValue = dataRecord?.endpoints;
  if (!Array.isArray(endpointsValue)) {
    return {
      endpoints: [],
      usable: false
    };
  }

  const endpoints = endpointsValue.flatMap((value): EndpointEvaluation[] => {
    const endpoint = asRecord(value);
    if (endpoint === null) {
      return [];
    }

    const status = numberOrNull(endpoint.status);
    const up5m = numberOrNull(endpoint.uptime_last_5m);
    const up30m = numberOrNull(endpoint.uptime_last_30m);
    const up1d = numberOrNull(endpoint.uptime_last_1d);
    const usable = isEndpointUsable({
      status,
      uptime_last_5m: up5m,
      uptime_last_30m: up30m
    });

    return [
      {
        provider: providerName(endpoint),
        usable,
        status,
        up5m,
        up30m,
        up1d
      }
    ];
  });

  return {
    endpoints,
    usable: endpoints.some((endpoint) => endpoint.usable)
  };
}

export function endpointVerdict(endpoint: EndpointEvaluation): EndpointVerdict {
  if (endpoint.usable) {
    return "USABLE";
  }

  if (
    endpoint.status === null &&
    endpoint.up5m === null &&
    endpoint.up30m === null &&
    endpoint.up1d === null
  ) {
    return "UNKNOWN";
  }

  if (endpoint.up5m === null && endpoint.up30m === null && endpoint.up1d !== null && endpoint.up1d > 0) {
    return "GREY";
  }

  return "DOWN";
}

export async function probeOpenRouterModelHealth(input: {
  readonly modelId: string;
  readonly fetchImpl?: OpenRouterHealthFetch;
  readonly timeoutMs?: number;
}): Promise<ModelProbeReport> {
  const fetchImpl =
    input.fetchImpl ?? (typeof globalThis.fetch === "function" ? (globalThis.fetch as OpenRouterHealthFetch) : null);

  if (fetchImpl === null) {
    return unknownModel(input.modelId, "fetch_unavailable");
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(openRouterEndpointsUrl(input.modelId), {
      method: "GET",
      // Anti-footgun: this public health probe never sends OPENROUTER_API_KEY.
      // Model calls are not probes; they consume attempts/budget and remain dispatch-gated.
      headers: {
        accept: "application/json"
      },
      signal: controller.signal
    });
    const responseText = await response.text();

    if (!response.ok) {
      return unknownModel(input.modelId, `http_${response.status}`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText) as unknown;
    } catch {
      return unknownModel(input.modelId, "invalid_json");
    }

    return {
      model_id: input.modelId,
      ...evaluateModelHealth(payload)
    };
  } catch (error) {
    return unknownModel(input.modelId, error instanceof Error ? error.name || "fetch_error" : "fetch_error");
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function buildOpenRouterHealthReport(input: {
  readonly fetchImpl?: OpenRouterHealthFetch;
  readonly timeoutMs?: number;
  readonly now?: Date;
} = {}): Promise<OpenRouterHealthReport> {
  const models = await Promise.all(
    buildOpenRouterHealthProbeList().map((modelId) =>
      probeOpenRouterModelHealth({
        modelId,
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {})
      })
    )
  );

  return {
    generated_at: (input.now ?? new Date()).toISOString(),
    models,
    recommendations: buildRoleRecommendations(models)
  };
}

export function buildRoleRecommendations(models: readonly ModelProbeReport[]): readonly RoleRecommendation[] {
  const healthByModel = new Map(models.map((model) => [model.model_id, model]));

  return (Object.keys(SUBSTITUTE_LADDERS) as SubstituteRole[]).map((role) => {
    const primaryModelId = ACTIVE_PRIMARY_MODEL_BY_ROLE[role];
    const primary = healthByModel.get(primaryModelId);
    if (primary?.usable === true) {
      return {
        role,
        primary_model_id: primaryModelId,
        recommendation: "primary_allowlisted",
        message: `${role}: primary (allowlisted) usable -> use it (${primaryModelId})`
      };
    }

    const candidate = firstUsableLadderCandidate(role, healthByModel);
    if (candidate !== null) {
      return {
        role,
        primary_model_id: primaryModelId,
        recommendation: "ladder_candidate",
        candidate_model_id: candidate.model_id,
        candidate_provider_slug: candidate.provider_slug,
        quality: candidate.quality,
        message: `${role}: best usable ladder candidate = ${candidate.model_id} @ ${candidate.provider_slug} (quality=${candidate.quality} -> requires supervised smoke + eval before dispatch)`
      };
    }

    return {
      role,
      primary_model_id: primaryModelId,
      recommendation: "paid_subscription",
      message: `${role}: NO usable free lane -> use paid subscription lanes (codex/Claude), do not force a below-floor model`
    };
  });
}

export function formatOpenRouterHealthReport(report: OpenRouterHealthReport): string {
  const lines = [
    `OpenRouter free health (${report.generated_at})`,
    "Public endpoint probes only: no API key, no attempt cost, no automatic switching.",
    "model_id\tprovider\tstatus\tup5m\tup30m\tup1d\tverdict"
  ];

  for (const model of report.models) {
    if (model.endpoints.length === 0) {
      lines.push(`${model.model_id}\tUNKNOWN\tnull\tnull\tnull\tnull\tUNKNOWN`);
      continue;
    }

    for (const endpoint of model.endpoints) {
      lines.push(
        [
          model.model_id,
          endpoint.provider,
          nullable(endpoint.status),
          nullable(endpoint.up5m),
          nullable(endpoint.up30m),
          nullable(endpoint.up1d),
          endpointVerdict(endpoint)
        ].join("\t")
      );
    }
  }

  lines.push("", "Recommendations:");
  for (const recommendation of report.recommendations) {
    lines.push(recommendation.message);
  }
  lines.push("Reader recommends only; the supervisor decides. Never auto-switch mid-task.");

  return lines.join("\n");
}

function firstUsableLadderCandidate(
  role: SubstituteRole,
  healthByModel: ReadonlyMap<string, ModelProbeReport>
): SubstituteCandidate | null {
  for (const candidate of SUBSTITUTE_LADDERS[role]) {
    if (candidate.quality === "below_floor") {
      continue;
    }

    const report = healthByModel.get(candidate.model_id);
    const providerUsable =
      report?.endpoints.some(
        (endpoint) => endpoint.usable && providersMatch(endpoint.provider, candidate.provider_slug)
      ) ?? false;

    if (providerUsable) {
      return candidate;
    }
  }

  return null;
}

function openRouterEndpointsUrl(modelId: string): string {
  return `${OPENROUTER_ENDPOINTS_BASE_URL}/${modelId}/endpoints`;
}

function unknownModel(modelId: string, error: string): ModelProbeReport {
  return {
    model_id: modelId,
    endpoints: [],
    usable: false,
    error
  };
}

function parseCliArgs(args: readonly string[]): { readonly json: boolean } {
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return { json };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function providerName(endpoint: Record<string, unknown>): string {
  if (typeof endpoint.provider_name === "string" && endpoint.provider_name.trim().length > 0) {
    return endpoint.provider_name.trim();
  }

  if (typeof endpoint.name === "string" && endpoint.name.trim().length > 0) {
    return endpoint.name.trim();
  }

  return "UNKNOWN";
}

function providersMatch(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function nullable(value: number | null): string {
  return value === null ? "null" : String(value);
}

function realpathIfExists(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

const currentFile = realpathIfExists(fileURLToPath(import.meta.url));
const invokedFile = process.argv[1] ? realpathIfExists(process.argv[1]) : "";

if (invokedFile === currentFile) {
  let args: { readonly json: boolean };
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid openrouter:health arguments";
    console.error(`openrouter:health failed: ${message}`);
    process.exitCode = 1;
    args = { json: false };
  }

  if (process.exitCode !== 1) {
    buildOpenRouterHealthReport()
      .then((report) => {
        console.log(args.json ? JSON.stringify(report, null, 2) : formatOpenRouterHealthReport(report));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "unknown health reader failure";
        console.error(`openrouter:health advisory failure: ${message}`);
        process.exitCode = 0;
      });
  }
}
