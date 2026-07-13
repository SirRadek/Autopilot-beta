import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const servers: ReturnType<typeof createServer>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function runCli(status: number, body: unknown) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing address");
  try {
    const result = await execFileAsync(process.execPath, ["--import", "tsx", "scripts/ops-readinesscheck.ts", String(address.port)], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 8_000
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string };
    return { exitCode: result.code ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }
}

const components = {
  configuration: { status: "ready", error_code: null },
  managed_state: { status: "ready", error_code: null },
  project_registry: { status: "ready", error_code: null },
  supervisor: { status: "ready", error_code: null },
  token_gateway: { status: "ready", error_code: null },
  providers: {
    codex_cli: { status: "degraded", error_code: "not_observed" },
    claude_cli: { status: "degraded", error_code: "not_observed" },
    agy_cli: { status: "degraded", error_code: "not_observed" },
    openrouter_api: { status: "degraded", error_code: "not_observed" }
  }
};

describe("ops readiness CLI", () => {
  it("requires a ready HTTP 200 and prints only bounded component pairs", async () => {
    const result = await runCli(200, {
      ready: true,
      status: "degraded",
      checked_at: "2026-07-13T12:00:00.000Z",
      components,
      secret: "must-not-print"
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(components);
    expect(result.stdout).not.toContain("must-not-print");
    expect(result.stdout).not.toContain("checked_at");
    expect(result.stderr).toBe("");
  });

  it("fails closed without echoing an unavailable response", async () => {
    const result = await runCli(503, { ready: false, error: "secret-value:/private/path", components });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("control_plane_readinesscheck_failed:unready_response\n");
    expect(result.stderr).not.toContain("secret-value");
    expect(result.stderr).not.toContain("/private/path");
  });

  it("rejects arbitrary component codes instead of echoing them", async () => {
    const unsafe = { ...components, configuration: { ...components.configuration, error_code: "secret-value" } };
    const result = await runCli(200, { ready: true, components: unsafe });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("control_plane_readinesscheck_failed:invalid_response\n");
    expect(result.stderr).not.toContain("secret-value");
  });
});
