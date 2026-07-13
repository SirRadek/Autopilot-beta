import { describe, expect, it, vi } from "vitest";

describe("CLI worker POSIX path resolution", () => {
  it("uses command -v agy on Linux instead of the Windows-only where command", async () => {
    const execSyncMock = vi.fn((command: string) => {
      if (command === "command -v agy") {
        return "/home/radek/.local/bin/agy\n";
      }
      throw new Error(`unexpected command: ${command}`);
    });
    vi.resetModules();
    vi.doMock("node:child_process", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:child_process")>()),
      execSync: execSyncMock,
    }));

    try {
      const { resolveAgyPath } = await import("../../src/data/delivery-system/cliWorkerCapture");
      expect(resolveAgyPath()).toBe("/home/radek/.local/bin/agy");
      expect(execSyncMock).toHaveBeenCalledWith("command -v agy", { encoding: "utf8" });
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });
});
