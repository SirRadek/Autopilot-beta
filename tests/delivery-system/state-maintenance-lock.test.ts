import { hostname } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StateMaintenanceLockError,
  acquireStateMaintenanceLock,
  appendStateFile,
  writeStateFileAtomically,
  withStateMaintenanceLock
} from "../../src/data/delivery-system/stateMaintenanceLock.js";
import { readSessionRegistry, writeSessionRegistry } from "../../src/data/delivery-system/sessionRegistry.js";

const temporaryDirectories: string[] = [];
const childProcesses: ChildProcess[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const child of childProcesses.splice(0)) child.kill("SIGKILL");
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("state maintenance lock", () => {
  it("writes bounded owner metadata and removes it on release", () => {
    const stateDir = makeStateDirectory();
    const lease = acquireStateMaintenanceLock(stateDir);
    const owner = JSON.parse(readFileSync(join(lease.path, "owner.json"), "utf8")) as Record<string, unknown>;

    expect(owner).toEqual({
      version: 1,
      token: lease.token,
      pid: process.pid,
      hostname: hostname(),
      acquired_at: expect.any(String)
    });
    expect(readFileSync(join(lease.path, "owner.json")).length).toBeLessThanOrEqual(1_024);

    lease.release();
    expect(existsSync(lease.path)).toBe(false);
  });

  it("times out without changing an active owner", () => {
    const stateDir = makeStateDirectory();
    const ownerPath = seedOwner(stateDir, { pid: process.pid, hostname: hostname() });
    const activeOwnerBytes = readFileSync(ownerPath, "utf8");

    expect(() => acquireStateMaintenanceLock(stateDir, { timeoutMs: 10, retryIntervalMs: 2 }))
      .toThrowError(new StateMaintenanceLockError("state_lock_timeout"));
    expect(readFileSync(ownerPath, "utf8")).toBe(activeOwnerBytes);
  });

  it("replaces only a valid dead same-host owner", () => {
    const stateDir = makeStateDirectory();
    seedOwner(stateDir, { pid: 2_147_483_647, hostname: hostname() });

    const lease = acquireStateMaintenanceLock(stateDir, { timeoutMs: 100, retryIntervalMs: 2 });

    expect(lease.token).toEqual(expect.any(String));
    expect(JSON.parse(readFileSync(join(lease.path, "owner.json"), "utf8"))).toMatchObject({
      pid: process.pid,
      hostname: hostname(),
      token: lease.token
    });
    lease.release();
  });

  it.each([
    ["malformed", "not-json\n"],
    ["foreign", JSON.stringify(validOwner({ pid: 2_147_483_647, hostname: "another-host" }))]
  ])("retains a %s owner when acquisition times out", (_case, ownerBytes) => {
    const stateDir = makeStateDirectory();
    const ownerPath = join(stateDir, ".state-maintenance.lock", "owner.json");
    mkdirSync(join(stateDir, ".state-maintenance.lock"));
    writeFileSync(ownerPath, ownerBytes, { mode: 0o600 });

    expect(() => acquireStateMaintenanceLock(stateDir, { timeoutMs: 10, retryIntervalMs: 2 }))
      .toThrow("state_lock_timeout");
    expect(readFileSync(ownerPath, "utf8")).toBe(ownerBytes);
  });

  it("treats EPERM from the PID probe as evidence that the owner may be alive", () => {
    const stateDir = makeStateDirectory();
    const ownerPath = seedOwner(stateDir, { pid: 987_654, hostname: hostname() });
    const ownerBytes = readFileSync(ownerPath, "utf8");
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    });

    expect(() => acquireStateMaintenanceLock(stateDir, { timeoutMs: 10, retryIntervalMs: 2 }))
      .toThrow("state_lock_timeout");
    expect(readFileSync(ownerPath, "utf8")).toBe(ownerBytes);
  });

  it("supports synchronous same-process reentrancy", () => {
    const stateDir = makeStateDirectory();

    expect(withStateMaintenanceLock(stateDir, () =>
      withStateMaintenanceLock(stateDir, () => "ok")
    )).toBe("ok");
    expect(existsSync(join(stateDir, ".state-maintenance.lock"))).toBe(false);
  });

  it("does not remove a lock whose owner token changed", () => {
    const stateDir = makeStateDirectory();
    const lease = acquireStateMaintenanceLock(stateDir);
    const ownerPath = join(lease.path, "owner.json");
    writeFileSync(ownerPath, JSON.stringify(validOwner({ token: "replacement-token" })), "utf8");

    lease.release();

    expect(existsSync(lease.path)).toBe(true);
    expect(JSON.parse(readFileSync(ownerPath, "utf8"))).toMatchObject({ token: "replacement-token" });
  });

  it("releases after the protected callback throws", () => {
    const stateDir = makeStateDirectory();

    expect(() => withStateMaintenanceLock(stateDir, () => {
      throw new Error("callback_failed");
    })).toThrow("callback_failed");
    expect(existsSync(join(stateDir, ".state-maintenance.lock"))).toBe(false);
  });

  it("does not replace a lock held by a real child process", async () => {
    const stateDir = makeStateDirectory();
    const lockPath = join(stateDir, ".state-maintenance.lock");
    const child = spawn(process.execPath, [
      "-e",
      [
        "const fs = require('node:fs');",
        "const os = require('node:os');",
        "const lockPath = process.argv[1];",
        "fs.mkdirSync(lockPath);",
        "fs.writeFileSync(lockPath + '/owner.json', JSON.stringify({ version: 1, token: 'child-owner', pid: process.pid, hostname: os.hostname(), acquired_at: new Date().toISOString() }), { mode: 0o600 });",
        "process.stdout.write('ready\\n');",
        "setInterval(() => {}, 1000);"
      ].join("\n"),
      lockPath
    ], { stdio: ["ignore", "pipe", "inherit"] });
    childProcesses.push(child);
    await waitForReady(child);

    expect(() => acquireStateMaintenanceLock(stateDir, { timeoutMs: 20, retryIntervalMs: 2 }))
      .toThrow("state_lock_timeout");
    expect(JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8"))).toMatchObject({
      token: "child-owner",
      pid: child.pid
    });
  });

  it("atomically replaces JSON state and leaves no temporary file", () => {
    const stateDir = makeStateDirectory();
    writeSessionRegistry(stateDir, { schema_version: "v1", sessions: [] });

    expect(readSessionRegistry(stateDir)).toEqual({ schema_version: "v1", sessions: [] });
    expect(readdirSync(stateDir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("provides lock-coordinated atomic replacement and append primitives", () => {
    const stateDir = makeStateDirectory();
    const jsonPath = join(stateDir, "state.json");
    const logPath = join(stateDir, "events.jsonl");

    writeStateFileAtomically(stateDir, jsonPath, "{\"version\":1}\n");
    appendStateFile(stateDir, logPath, "{\"event\":1}\n");
    appendStateFile(stateDir, logPath, "{\"event\":2}\n");

    expect(readFileSync(jsonPath, "utf8")).toBe("{\"version\":1}\n");
    expect(readFileSync(logPath, "utf8")).toBe("{\"event\":1}\n{\"event\":2}\n");
    if (process.platform !== "win32") {
      expect(statSync(jsonPath).mode & 0o777).toBe(0o600);
      expect(statSync(logPath).mode & 0o777).toBe(0o600);
    }
    expect(readdirSync(stateDir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it.runIf(process.platform !== "win32")("refuses to append through a symbolic link", () => {
    const stateDir = makeStateDirectory();
    const outside = join(makeStateDirectory(), "outside.jsonl");
    writeFileSync(outside, "sentinel\n");
    const linked = join(stateDir, "events.jsonl");
    symlinkSync(outside, linked);

    expect(() => appendStateFile(stateDir, linked, "injected\n")).toThrow("state_lock_invalid");
    expect(readFileSync(outside, "utf8")).toBe("sentinel\n");
  });

  it("keeps every persistent state writer on the shared maintenance primitive", () => {
    const root = join(import.meta.dirname, "..", "..");
    const sources = [
      "src/data/delivery-system/approvalQueue.ts",
      "src/data/delivery-system/sessionRegistry.ts",
      "src/data/delivery-system/projectRegistry.ts",
      "src/data/delivery-system/providerQuotaStore.ts",
      "src/data/delivery-system/supervisorQueue.ts",
      "src/data/delivery-system/tokenGateway.ts",
      "src/data/delivery-system/runStore.ts",
      "src/data/delivery-system/incidentStore.ts",
      "src/data/delivery-system/subagentEvidence.ts",
      "src/data/delivery-system/supervisorAlerts.ts",
      "src/data/delivery-system/cliWorker.ts",
      "src/data/delivery-system/cliWorkerCapture.ts",
      "scripts/control-plane-server.ts",
      "scripts/worker-cancel.ts",
      "scripts/worker-cleanup.ts"
    ];

    expect(sources.filter((source) =>
      !readFileSync(join(root, source), "utf8").includes("stateMaintenanceLock")
    )).toEqual([]);
  });
});

function makeStateDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "autopilot-state-lock-"));
  temporaryDirectories.push(directory);
  return directory;
}

function validOwner(overrides: Partial<Record<"token" | "pid" | "hostname" | "acquired_at", string | number>> = {}) {
  return {
    version: 1,
    token: "existing-token",
    pid: process.pid,
    hostname: hostname(),
    acquired_at: "2026-07-13T00:00:00.000Z",
    ...overrides
  };
}

function seedOwner(stateDir: string, overrides: Partial<Record<"token" | "pid" | "hostname", string | number>>): string {
  const lockPath = join(stateDir, ".state-maintenance.lock");
  mkdirSync(lockPath);
  const ownerPath = join(lockPath, "owner.json");
  writeFileSync(ownerPath, JSON.stringify(validOwner(overrides)), { mode: 0o600 });
  return ownerPath;
}

async function waitForReady(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`child_exited:${code ?? "signal"}`)));
    child.stdout?.once("data", (chunk: Buffer) => {
      if (chunk.toString("utf8").includes("ready")) resolve();
      else reject(new Error("child_not_ready"));
    });
  });
}
