import { randomBytes } from "node:crypto";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";

const LOCK_DIRECTORY_NAME = ".state-maintenance.lock";
const OWNER_FILE_NAME = "owner.json";
const RECLAIM_FILE_NAME = ".reclaim";
const OWNER_VERSION = 1;
const MAX_OWNER_BYTES = 1_024;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_INTERVAL_MS = 25;

interface StateMaintenanceOwner {
  readonly version: 1;
  readonly token: string;
  readonly pid: number;
  readonly hostname: string;
  readonly acquired_at: string;
}

interface LocalLeaseState {
  readonly token: string;
  readonly path: string;
  depth: number;
}

export interface StateMaintenanceLease {
  readonly token: string;
  readonly path: string;
  release(): void;
}

export interface StateMaintenanceLockOptions {
  readonly timeoutMs?: number;
  readonly retryIntervalMs?: number;
}

export class StateMaintenanceLockError extends Error {
  constructor(readonly code: "state_lock_timeout" | "state_lock_invalid") {
    super(code);
    this.name = "StateMaintenanceLockError";
  }
}

const localLeases = new Map<string, LocalLeaseState>();
const sleepArray = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

export function acquireStateMaintenanceLock(
  stateDirectory: string,
  options: StateMaintenanceLockOptions = {}
): StateMaintenanceLease {
  const lockPath = resolve(stateDirectory, LOCK_DIRECTORY_NAME);
  const local = localLeases.get(lockPath);
  if (local !== undefined) {
    local.depth += 1;
    return leaseFor(local);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || !Number.isSafeInteger(retryIntervalMs) || retryIntervalMs < 1) {
    throw new StateMaintenanceLockError("state_lock_invalid");
  }

  try {
    mkdirSync(resolve(stateDirectory), { recursive: true, mode: 0o700 });
  } catch {
    throw new StateMaintenanceLockError("state_lock_invalid");
  }

  const startedAt = Date.now();
  while (true) {
    const token = randomBytes(24).toString("hex");
    try {
      mkdirSync(lockPath, { mode: 0o700 });
    } catch (error) {
      if (!isFileSystemError(error, "EEXIST")) throw new StateMaintenanceLockError("state_lock_invalid");

      reclaimDeadOwner(lockPath);
      if (Date.now() - startedAt >= timeoutMs) {
        throw new StateMaintenanceLockError("state_lock_timeout");
      }
      sleep(Math.min(retryIntervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
      continue;
    }

    try {
      writeOwner(lockPath, {
        version: OWNER_VERSION,
        token,
        pid: process.pid,
        hostname: hostname(),
        acquired_at: new Date().toISOString()
      });
    } catch {
      removeIncompleteLock(lockPath);
      throw new StateMaintenanceLockError("state_lock_invalid");
    }
    const acquired: LocalLeaseState = { token, path: lockPath, depth: 1 };
    localLeases.set(lockPath, acquired);
    return leaseFor(acquired);
  }
}

export function withStateMaintenanceLock<T>(
  stateDirectory: string,
  callback: () => T,
  options: StateMaintenanceLockOptions = {}
): T {
  const lease = acquireStateMaintenanceLock(stateDirectory, options);
  try {
    return callback();
  } finally {
    lease.release();
  }
}

function leaseFor(state: LocalLeaseState): StateMaintenanceLease {
  let released = false;
  return {
    token: state.token,
    path: state.path,
    release(): void {
      if (released) return;
      released = true;
      const current = localLeases.get(state.path);
      if (current === undefined || current.token !== state.token) return;
      current.depth -= 1;
      if (current.depth > 0) return;
      localLeases.delete(state.path);
      releaseOwnedLock(state.path, state.token);
    }
  };
}

function writeOwner(lockPath: string, owner: StateMaintenanceOwner): void {
  const bytes = `${JSON.stringify(owner)}\n`;
  if (Buffer.byteLength(bytes) > MAX_OWNER_BYTES) throw new StateMaintenanceLockError("state_lock_invalid");
  const descriptor = openSync(join(lockPath, OWNER_FILE_NAME), "wx", 0o600);
  try {
    writeFileSync(descriptor, bytes, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function reclaimDeadOwner(lockPath: string): void {
  const ownerBytes = readBoundedOwner(lockPath);
  if (ownerBytes === null) return;
  const owner = parseOwner(ownerBytes);
  if (owner === null || owner.hostname !== hostname() || !pidIsProvablyDead(owner.pid)) return;

  const reclaimPath = join(lockPath, RECLAIM_FILE_NAME);
  let descriptor: number;
  try {
    descriptor = openSync(reclaimPath, "wx", 0o600);
  } catch {
    return;
  }
  closeSync(descriptor);

  try {
    if (readBoundedOwner(lockPath) !== ownerBytes) return;
    unlinkSync(join(lockPath, OWNER_FILE_NAME));
    unlinkSync(reclaimPath);
    rmdirSync(lockPath);
  } catch {
    tryUnlink(reclaimPath);
  }
}

function releaseOwnedLock(lockPath: string, token: string): void {
  const ownerBytes = readBoundedOwner(lockPath);
  const owner = ownerBytes === null ? null : parseOwner(ownerBytes);
  if (owner?.token !== token) return;
  try {
    unlinkSync(join(lockPath, OWNER_FILE_NAME));
    rmdirSync(lockPath);
  } catch {
    // A changed or non-empty lock is retained for manual inspection.
  }
}

function removeIncompleteLock(lockPath: string): void {
  tryUnlink(join(lockPath, OWNER_FILE_NAME));
  try {
    rmdirSync(lockPath);
  } catch {
    // Never remove an unexpected non-empty directory.
  }
}

function readBoundedOwner(lockPath: string): string | null {
  const ownerPath = join(lockPath, OWNER_FILE_NAME);
  try {
    const status = lstatSync(ownerPath);
    if (!status.isFile() || status.isSymbolicLink() || status.size > MAX_OWNER_BYTES) return null;
    return readFileSync(ownerPath, "utf8");
  } catch {
    return null;
  }
}

function parseOwner(bytes: string): StateMaintenanceOwner | null {
  try {
    const value = JSON.parse(bytes) as unknown;
    if (!isRecord(value)
      || value.version !== OWNER_VERSION
      || typeof value.token !== "string"
      || value.token.length < 1
      || value.token.length > 128
      || !Number.isSafeInteger(value.pid)
      || (value.pid as number) < 1
      || typeof value.hostname !== "string"
      || value.hostname.length < 1
      || value.hostname.length > 255
      || typeof value.acquired_at !== "string"
      || !Number.isFinite(Date.parse(value.acquired_at))
      || Date.parse(value.acquired_at) > Date.now()) {
      return null;
    }
    return value as unknown as StateMaintenanceOwner;
  } catch {
    return null;
  }
}

function pidIsProvablyDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return isFileSystemError(error, "ESRCH");
  }
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Best effort only; unexpected state must remain visible.
  }
}

function sleep(milliseconds: number): void {
  Atomics.wait(sleepArray, 0, 0, milliseconds);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
