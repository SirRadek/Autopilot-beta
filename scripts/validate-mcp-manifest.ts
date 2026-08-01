import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateJsonSchema } from "../src/lib/delivery-system/validation";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = join(repoRoot, "ops", "mcp", "mcp-manifest.json");
const schemaPath = join(repoRoot, "ops", "mcp", "mcp-manifest.schema.json");

export type McpCli = "claude" | "codex" | "agy";

export interface McpServer {
  readonly id: string;
  readonly transport: "stdio" | "http";
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly readOnly: boolean;
  readonly toolAllowlist: readonly string[];
  readonly targets: readonly McpCli[];
  readonly secretRefs?: readonly string[];
}

export interface McpManifest {
  readonly version: string;
  readonly servers: readonly McpServer[];
}

export interface McpManifestReport {
  readonly ok: boolean;
  readonly serverCount: number;
  readonly errors: readonly string[];
}

/** Generate the per-CLI server config from the canonical manifest (no secrets resolved). */
export function renderForCli(manifest: McpManifest, cli: McpCli): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const server of manifest.servers) {
    if (!server.targets.includes(cli)) continue;
    out[server.id] = server.transport === "http"
      ? { type: "http", url: server.url, readOnly: server.readOnly, tools: server.toolAllowlist }
      : { type: "stdio", command: server.command, args: server.args ?? [], readOnly: server.readOnly, tools: server.toolAllowlist };
  }
  return out;
}

export function validateMcpManifest(): McpManifestReport {
  const errors: string[] = [];
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as unknown;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as McpManifest;
  for (const issue of validateJsonSchema(manifest, schema)) errors.push(`${issue.path}: ${issue.message}`);

  for (const server of manifest.servers ?? []) {
    // MVP boundary: every server must be read-only (mutation goes through the control plane).
    if (server.readOnly !== true) errors.push(`${server.id}: must be readOnly:true (mutation is not allowed via MCP)`);
    // Transport integrity.
    if (server.transport === "http" && !server.url) errors.push(`${server.id}: http transport needs a url`);
    if (server.transport === "stdio" && !server.command) errors.push(`${server.id}: stdio transport needs a command`);
    // No embedded secrets — only ${ENV} references (schema enforces the pattern; guard literal leaks in url/args).
    const literalHaystack = [server.url ?? "", ...(server.args ?? [])].join(" ");
    if (/(secret|token|key)\s*[:=]\s*\S/i.test(literalHaystack)) errors.push(`${server.id}: looks like an embedded secret; use secretRefs`);
  }

  return { ok: errors.length === 0, serverCount: manifest.servers?.length ?? 0, errors };
}

function main(): void {
  const report = validateMcpManifest();
  for (const error of report.errors) console.error(`✗ ${error}`);
  if (process.argv.includes("--render")) {
    const cli = (process.argv[process.argv.indexOf("--render") + 1] as McpCli) ?? "claude";
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as McpManifest;
    console.log(JSON.stringify(renderForCli(manifest, cli), null, 2));
    return;
  }
  console.log(`MCP manifest validation ${report.ok ? "passed" : "FAILED"}.`);
  console.log(`Servers: ${report.serverCount}`);
  console.log(`Errors: ${report.errors.length}`);
  if (!report.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
