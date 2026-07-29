import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createControlPlaneRuntime, type ControlPlaneScheduler } from "../../scripts/control-plane-server";

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
});
