import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const RUNTIME_MODULE = "../../src/data/delivery-system/providerCliRuntime";
const originalBinDir = process.env.AUTOPILOT_PROVIDER_CLI_BIN_DIR;
const originalTestMode = process.env.AUTOPILOT_PROVIDER_CLI_TEST_MODE;
const originalTestRoot = process.env.AUTOPILOT_PROVIDER_CLI_TEST_ROOT;
const roots: string[] = [];

function temporaryRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cli-worker-paths-")));
  roots.push(root);
  return root;
}

function writeExecutable(path: string): void {
  writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  chmodSync(path, 0o700);
}

function configureProviderRuntime(binDir: string): void {
  process.env.AUTOPILOT_PROVIDER_CLI_BIN_DIR = binDir;
  process.env.AUTOPILOT_PROVIDER_CLI_TEST_MODE = "1";
  process.env.AUTOPILOT_PROVIDER_CLI_TEST_ROOT = join(binDir, "..");
}

function restoreEnvironment(name: string, original: string | undefined): void {
  if (original === undefined) delete process.env[name];
  else process.env[name] = original;
}

afterEach(() => {
  restoreEnvironment("AUTOPILOT_PROVIDER_CLI_BIN_DIR", originalBinDir);
  restoreEnvironment("AUTOPILOT_PROVIDER_CLI_TEST_MODE", originalTestMode);
  restoreEnvironment("AUTOPILOT_PROVIDER_CLI_TEST_ROOT", originalTestRoot);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.doUnmock("node:child_process");
  vi.doUnmock("node:process");
  vi.doUnmock("node-pty");
  vi.doUnmock(RUNTIME_MODULE);
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("CLI worker provider executable resolution", () => {
  it.runIf(process.platform !== "win32")("uses the shared deterministic executable for all three provider captures", async () => {
    const binDir = join(temporaryRoot(), "bin");
    mkdirSync(binDir, { mode: 0o700 });
    const executables = {
      codex_cli: join(binDir, "codex"),
      claude_cli: join(binDir, "claude"),
      agy_cli: join(binDir, "agy")
    } as const;
    for (const path of Object.values(executables)) writeExecutable(path);
    configureProviderRuntime(binDir);
    const spawnSyncMock = vi.fn((_command: string, _args: readonly string[], _options: unknown) => ({
      status: 0,
      stdout: "ok",
      stderr: "",
      error: undefined
    }));
    const ptySpawnMock = vi.fn((_executable: string, _args: readonly string[], _options: unknown) => ({
      pid: 101,
      kill: vi.fn(),
      onData(callback: (data: string) => void) { callback("ok"); },
      onExit(callback: (event: { exitCode: number }) => void) { callback({ exitCode: 0 }); }
    }));

    vi.resetModules();
    vi.doMock("node:child_process", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:child_process")>()),
      spawnSync: spawnSyncMock
    }));
    vi.doMock("node-pty", () => ({ default: { spawn: ptySpawnMock }, spawn: ptySpawnMock }));

    const { captureAgyResponse, captureClaudeResponse, captureCodexResponse } = await import("../../src/data/delivery-system/cliWorkerCapture");
    await captureClaudeResponse("ping", { timeoutMs: 1_000 });
    await captureCodexResponse("ping", { retries: 0, timeoutMs: 1_000 });
    await captureAgyResponse("ping", { timeoutMs: 1_000 });

    expect(spawnSyncMock.mock.calls.map(([command]) => command)).toEqual([
      executables.claude_cli,
      executables.codex_cli
    ]);
    expect(ptySpawnMock.mock.calls[0]?.[0]).toBe(executables.agy_cli);
  });

  it("passes the resolved Windows Codex .cmd path through Git Bash without provider lookup", async () => {
    const codexPath = "C:\\trusted provider\\codex.cmd";
    const resolveRuntime = vi.fn(() => ({ status: "available" as const, executable: codexPath }));
    const execSyncMock = vi.fn((command: string) => {
      if (command === '"C:/Program Files/Git/bin/bash.exe" --version') return "git version 2";
      throw new Error(`unexpected command: ${command}`);
    });
    const spawnSyncMock = vi.fn((_command: string, _args: readonly string[], _options: unknown) => ({
      status: 0,
      stdout: "",
      stderr: "",
      error: undefined
    }));
    vi.resetModules();
    vi.doMock(RUNTIME_MODULE, () => ({ resolveProviderCliRuntime: resolveRuntime }));
    vi.doMock("node:process", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:process")>()),
      platform: "win32"
    }));
    vi.doMock("node:child_process", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:child_process")>()),
      execSync: execSyncMock,
      spawnSync: spawnSyncMock
    }));

    const { captureCodexResponse } = await import("../../src/data/delivery-system/cliWorkerCapture");
    await captureCodexResponse("ping", { retries: 0, timeoutMs: 1_000 });

    expect(resolveRuntime).toHaveBeenCalledWith("codex_cli");
    expect(execSyncMock.mock.calls.map(([command]) => command)).toEqual([
      '"C:/Program Files/Git/bin/bash.exe" --version'
    ]);
    expect(spawnSyncMock.mock.calls[0]?.[0]).toBe("C:/Program Files/Git/bin/bash.exe");
    expect(spawnSyncMock.mock.calls[0]?.[1][0]).toBe("-c");
    expect(spawnSyncMock.mock.calls[0]?.[1][1]).toContain("'C:/trusted provider/codex.cmd' exec");
  });

  it.each([
    ["provider_executable_missing", "claude_cli", "captureClaudeResponse"],
    ["provider_runtime_denied", "codex_cli", "captureCodexResponse"],
    ["provider_executable_missing", "agy_cli", "captureAgyResponse"]
  ] as const)("fails %s before spawning %s", async (errorCode, _provider, captureName) => {
    const spawnSyncMock = vi.fn();
    const ptySpawnMock = vi.fn();
    if (errorCode === "provider_runtime_denied") {
      process.env.AUTOPILOT_PROVIDER_CLI_BIN_DIR = "relative/bin";
      delete process.env.AUTOPILOT_PROVIDER_CLI_TEST_MODE;
      delete process.env.AUTOPILOT_PROVIDER_CLI_TEST_ROOT;
    } else {
      const binDir = join(temporaryRoot(), "bin");
      mkdirSync(binDir, { mode: 0o700 });
      configureProviderRuntime(binDir);
    }
    vi.resetModules();
    vi.doMock("node:child_process", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:child_process")>()),
      spawnSync: spawnSyncMock
    }));
    vi.doMock("node-pty", () => ({ default: { spawn: ptySpawnMock }, spawn: ptySpawnMock }));

    const captures = await import("../../src/data/delivery-system/cliWorkerCapture");
    const result = captureName === "captureCodexResponse"
      ? captures.captureCodexResponse("ping", { retries: 0, timeoutMs: 1_000 })
      : captureName === "captureClaudeResponse"
        ? captures.captureClaudeResponse("ping", { timeoutMs: 1_000 })
        : captures.captureAgyResponse("ping", { timeoutMs: 1_000 });
    await expect(result).rejects.toThrow(errorCode);
    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(ptySpawnMock).not.toHaveBeenCalled();
  });
});
