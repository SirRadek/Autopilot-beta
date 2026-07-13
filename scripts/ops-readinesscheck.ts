const MAX_RESPONSE_BYTES = 64 * 1024;
const CORE_COMPONENTS = ["configuration", "managed_state", "project_registry", "supervisor", "token_gateway"] as const;
const PROVIDERS = ["codex_cli", "claude_cli", "agy_cli", "openrouter_api"] as const;
const STATUSES = new Set(["ready", "degraded", "unavailable"]);
const ERROR_CODES = new Set([
  "invalid_configuration", "state_unavailable", "invalid_state_schema",
  "project_registry_missing", "invalid_project_registry", "invalid_supervisor_state",
  "invalid_token_gateway_state", "probe_not_configured", "not_observed", "timeout",
  "missing_credential", "malformed_response", "provider_unavailable", "provider_error"
]);

interface ComponentPair {
  readonly status: "ready" | "degraded" | "unavailable";
  readonly error_code: string | null;
}

function componentPair(value: unknown): ComponentPair {
  if (!isRecord(value) || typeof value.status !== "string" || !STATUSES.has(value.status) ||
    value.error_code !== null && (typeof value.error_code !== "string" || !ERROR_CODES.has(value.error_code))) {
    throw new Error("invalid_response");
  }
  return { status: value.status as ComponentPair["status"], error_code: value.error_code };
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new Error("invalid_response");
  if (response.body === null) throw new Error("invalid_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("invalid_response");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function boundedComponents(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.components) || !isRecord(value.components.providers)) {
    throw new Error("invalid_response");
  }
  return {
    ...Object.fromEntries(CORE_COMPONENTS.map((name) => [name, componentPair(value.components[name])])),
    providers: Object.fromEntries(PROVIDERS.map((name) => [name, componentPair(value.components.providers[name])]))
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const port = Number(process.argv[2] ?? "8787");
try {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("invalid_port");
  const response = await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(5_000) });
  const body = await boundedJson(response);
  if (response.status !== 200 || !isRecord(body) || body.ready !== true) throw new Error("unready_response");
  console.log(JSON.stringify(boundedComponents(body)));
} catch (error) {
  const code = error instanceof Error && ["invalid_port", "invalid_response", "unready_response"].includes(error.message)
    ? error.message
    : "request_failed";
  console.error(`control_plane_readinesscheck_failed:${code}`);
  process.exitCode = 1;
}
