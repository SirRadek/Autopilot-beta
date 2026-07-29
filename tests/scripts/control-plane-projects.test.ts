import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createControlPlaneServer } from "../../scripts/control-plane-server";
import { AuthSessionRegistry, authStateRoot } from "../../src/data/delivery-system/authSessionRegistry";
import { readProjectRegistry, writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";

const SERVICE_TOKEN = "c".repeat(64);
const servers: ReturnType<typeof createControlPlaneServer>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

async function projectsApi() {
  const stateDir = mkdtempSync(join(tmpdir(), "control-plane-projects-"));
  const existingCwd = join(stateDir, "projects", "existing");
  mkdirSync(existingCwd, { recursive: true });
  writeProjectRegistry(stateDir, {
    schema_version: "v1",
    projects: [{
      schema_version: "v1",
      project_id: "existing",
      name: "Existing",
      cwd: existingCwd,
      enabled: true
    }]
  });
  new AuthSessionRegistry(authStateRoot(stateDir)).storeServiceToken(SERVICE_TOKEN);
  const server = createControlPlaneServer(stateDir);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing address");
  const base = `http://127.0.0.1:${address.port}`;
  const create = (body: unknown) => fetch(`${base}/projects`, {
    method: "POST",
    headers: { authorization: `Bearer ${SERVICE_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { stateDir, existingCwd, base, create };
}

describe("control plane project API", () => {
  it("creates and appends an enabled project", async () => {
    const api = await projectsApi();
    const cwd = join(api.stateDir, "projects", "crypto_analyzer");

    const response = await api.create({ name: "Crypto_Analyzer", cwd });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      schema_version: "v1",
      project_id: "crypto_analyzer",
      name: "Crypto_Analyzer",
      cwd,
      enabled: true
    });
    expect(readProjectRegistry(api.stateDir).projects.map((project) => project.project_id))
      .toEqual(["existing", "crypto_analyzer"]);
  });

  it("rejects duplicate derived ids and duplicate cwd values", async () => {
    const api = await projectsApi();

    const duplicateId = await api.create({
      name: "Existing",
      cwd: join(api.stateDir, "projects", "other")
    });
    const duplicateCwd = await api.create({ name: "Other", cwd: `${api.existingCwd}/` });

    expect(duplicateId.status).toBe(400);
    expect(await duplicateId.json()).toEqual({ error: "project_exists" });
    expect(duplicateCwd.status).toBe(400);
    expect(await duplicateCwd.json()).toEqual({ error: "project_exists" });
    expect(readProjectRegistry(api.stateDir).projects).toHaveLength(1);
  });

  it("rejects a relative cwd and unauthenticated creation", async () => {
    const api = await projectsApi();

    const invalid = await api.create({ name: "Relative", cwd: "projects/relative" });
    const unauthorized = await fetch(`${api.base}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "No Auth", cwd: join(api.stateDir, "projects", "no-auth") })
    });

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "project_invalid" });
    expect(unauthorized.status).toBe(401);
  });
});
