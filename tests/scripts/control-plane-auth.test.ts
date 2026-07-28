import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadAdminCredentials, verifyPassword } from "../../src/data/delivery-system/adminCredentials";
import { authStateRoot } from "../../src/data/delivery-system/authSessionRegistry";

describe("control-plane auth provisioning CLI", () => {
  it("sets an admin password without printing it and bumps credential generation", async () => {
    const root = mkdtempSync(join(tmpdir(), "control-plane-auth-cli-"));
    const credentialsPath = join(root, "admin-credentials.json");
    const environment = {
      ...process.env,
      AUTOPILOT_ADMIN_CREDENTIALS_PATH: credentialsPath,
      AUTOPILOT_ADMIN_USERNAME: "admin.owner",
      AUTOPILOT_ADMIN_PASSWORD: "first-password-value"
    };

    const first = runCli("set-admin-password", environment);
    expect(first.stdout.trim()).toBe("Admin password updated.");
    expect(first.stdout).not.toContain(environment.AUTOPILOT_ADMIN_PASSWORD);
    expect(loadAdminCredentials(credentialsPath).credential_generation).toBe(1);

    const secondPassword = "second-password-value";
    const second = runCli("set-admin-password", {
      ...environment,
      AUTOPILOT_ADMIN_PASSWORD: secondPassword
    });
    const store = loadAdminCredentials(credentialsPath);
    expect(second.stdout.trim()).toBe("Admin password updated.");
    expect(store.credential_generation).toBe(2);
    await expect(verifyPassword(store, "admin.owner", secondPassword)).resolves.toBe(true);
    await expect(verifyPassword(store, "admin.owner", environment.AUTOPILOT_ADMIN_PASSWORD)).resolves.toBe(false);
    if (process.platform !== "win32") expect(lstatSync(credentialsPath).mode & 0o777).toBe(0o600);
  });

  it("rejects invalid usernames and short passwords without creating credentials", () => {
    const root = mkdtempSync(join(tmpdir(), "control-plane-auth-invalid-"));
    const credentialsPath = join(root, "admin-credentials.json");
    const result = runCli("set-admin-password", {
      ...process.env,
      AUTOPILOT_ADMIN_CREDENTIALS_PATH: credentialsPath,
      AUTOPILOT_ADMIN_USERNAME: "invalid username",
      AUTOPILOT_ADMIN_PASSWORD: "too-short"
    }, false);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("invalid_admin_credentials_input");
    expect(() => readFileSync(credentialsPath)).toThrow();
  });

  it("issues a service token exactly once and persists only its digest", () => {
    const root = mkdtempSync(join(tmpdir(), "control-plane-service-token-"));
    const result = runCli("issue-service-token", process.env, true, [root]);
    const markerLines = result.stdout.split(/\r?\n/).filter((line) => line.startsWith("SERVICE_TOKEN="));
    expect(markerLines).toHaveLength(1);
    const rawToken = markerLines[0]!.slice("SERVICE_TOKEN=".length);
    expect(rawToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.stdout).toContain("will not be shown again");

    const registry = JSON.parse(readFileSync(join(authStateRoot(root), "service-token.json"), "utf8")) as {
      digest: string;
      generation: number;
    };
    expect(registry.digest).toBe(createHash("sha256").update(rawToken).digest("hex"));
    expect(registry.generation).toBe(1);
    expect(readFileSync(join(authStateRoot(root), "service-token.json"), "utf8")).not.toContain(rawToken);
    if (process.platform !== "win32") {
      expect(lstatSync(join(authStateRoot(root), "service-token.json")).mode & 0o777).toBe(0o600);
    }
  });
});

function runCli(command: string, env: NodeJS.ProcessEnv, expectSuccess = true, args: readonly string[] = []) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/control-plane-auth.ts", command, ...args],
    { cwd: process.cwd(), encoding: "utf8", env }
  );
  if (expectSuccess) expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
  return result;
}
