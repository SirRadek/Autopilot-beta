import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createControlPlaneRuntime, type ControlPlaneScheduler } from "../../scripts/control-plane-server";
import { AuthSessionRegistry, authStateRoot } from "../../src/data/delivery-system/authSessionRegistry";

const runtimes: Array<{ stop: () => void }> = [];

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
});

function fakeScheduler(): ControlPlaneScheduler & { starts: number; stops: number } {
  return {
    starts: 0,
    stops: 0,
    start() { this.starts += 1; },
    stop() { this.stops += 1; }
  };
}

describe("control plane quota service lifecycle", () => {
  it("starts the scheduler with the service state directory", () => {
    const scheduler = fakeScheduler();
    const runtime = createControlPlaneRuntime(mkdtempSync(join(tmpdir(), "quota-service-")), { scheduler });
    runtimes.push(runtime);
    expect(scheduler.starts).toBe(1);
  });

  it("stops the scheduler and server exactly once", async () => {
    const scheduler = fakeScheduler();
    const runtime = createControlPlaneRuntime(mkdtempSync(join(tmpdir(), "quota-service-")), { scheduler });
    runtimes.push(runtime);
    await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
    const close = vi.spyOn(runtime.server, "close");
    runtime.stop();
    runtime.stop();
    expect(scheduler.stops).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("exposes leases from the concrete scheduler for configured provider capabilities only", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "quota-service-leases-"));
    const serviceToken = "c".repeat(64);
    new AuthSessionRegistry(authStateRoot(stateDir)).storeServiceToken(serviceToken);
    const runtime = createControlPlaneRuntime(stateDir, {
      projectRoot: stateDir,
      providerCommands: { codex_cli: { command: "codex", args: ["status"] } },
      commandRunner: vi.fn().mockResolvedValue({ stdout: "{}", exitCode: 0 }),
      supervisorPollMs: 60_000
    });
    runtimes.push(runtime);
    await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
    const address = runtime.server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");

    const response = await fetch(`http://127.0.0.1:${address.port}/providers/probes/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${serviceToken}`, "content-type": "application/json" },
      body: JSON.stringify({ providers: ["codex_cli", "claude_cli"] })
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      accepted: ["codex_cli"],
      rejected: ["claude_cli"],
      expires_at: expect.any(String)
    });
    await runtime.stop();
  });
});
