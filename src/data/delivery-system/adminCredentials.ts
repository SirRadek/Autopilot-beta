import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { readManagedStateTextFile } from "./managedStateFile";

export const ADMIN_CREDENTIALS_VERSION = "autopilot-admin-credentials-v1";
export const RECOMMENDED_SCRYPT_PARAMS = {
  N: 2 ** 15,
  r: 8,
  p: 1,
  keylen: 64
} as const;

const MAX_CREDENTIAL_BYTES = 64 * 1024;
const MAX_SCRYPT_MEMORY = 256 * 1024 * 1024;

export interface AdminCredentialStore {
  readonly version: typeof ADMIN_CREDENTIALS_VERSION;
  readonly username: string;
  readonly salt: string;
  readonly params: {
    readonly N: number;
    readonly r: number;
    readonly p: number;
    readonly keylen: number;
  };
  readonly hash: string;
  readonly credential_generation: number;
}

export type AdminCredentialsErrorCode =
  | "admin_credentials_missing"
  | "admin_credentials_file_too_large"
  | "unsafe_admin_credentials_file"
  | "unsafe_admin_credentials_mode"
  | "invalid_admin_credentials_schema"
  | "admin_credentials_io_error";

export class AdminCredentialsError extends Error {
  constructor(readonly code: AdminCredentialsErrorCode) {
    super(code);
    this.name = "AdminCredentialsError";
  }
}

export function defaultAdminCredentialsPath(
  environment: Readonly<Record<string, string | undefined>> = process.env
): string {
  const configured = environment.AUTOPILOT_ADMIN_CREDENTIALS_PATH?.trim();
  if (configured) return configured;
  const home = environment.HOME?.trim() || environment.USERPROFILE?.trim() || homedir();
  return join(home, ".config", "autopilot", "admin-credentials.json");
}

export function adminCredentialsPathIsOutsideState(stateDir: string, path: string): boolean {
  const pathFromState = relative(
    canonicalExistingPath(stateDir),
    canonicalPotentialFilePath(path)
  );
  return pathFromState !== ""
    && (pathFromState === ".." || pathFromState.startsWith(`..${sep}`) || isAbsolute(pathFromState));
}

export function loadAdminCredentials(path = defaultAdminCredentialsPath()): AdminCredentialStore {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") throw new AdminCredentialsError("admin_credentials_missing");
    throw new AdminCredentialsError("admin_credentials_io_error");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new AdminCredentialsError("unsafe_admin_credentials_file");
  }
  if (metadata.size > MAX_CREDENTIAL_BYTES) {
    throw new AdminCredentialsError("admin_credentials_file_too_large");
  }
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new AdminCredentialsError("unsafe_admin_credentials_mode");
  }

  let text: string;
  try {
    const loaded = readManagedStateTextFile(path, { maxBytes: MAX_CREDENTIAL_BYTES });
    if (loaded.status === "missing") throw new AdminCredentialsError("unsafe_admin_credentials_file");
    text = loaded.text;
  } catch (error) {
    if (error instanceof AdminCredentialsError) throw error;
    throw new AdminCredentialsError("unsafe_admin_credentials_file");
  }

  try {
    return parseCredentialStore(JSON.parse(text));
  } catch (error) {
    if (error instanceof AdminCredentialsError) throw error;
    throw new AdminCredentialsError("invalid_admin_credentials_schema");
  }
}

export async function hashPassword(
  _username: string,
  password: string
): Promise<Pick<AdminCredentialStore, "salt" | "params" | "hash">> {
  const salt = randomBytes(32);
  const params = { ...RECOMMENDED_SCRYPT_PARAMS };
  const derived = await derivePassword(password, salt, params);
  return {
    salt: salt.toString("hex"),
    params,
    hash: derived.toString("hex")
  };
}

export async function verifyPassword(
  store: AdminCredentialStore,
  username: string,
  password: string
): Promise<boolean> {
  const expectedUsername = createHash("sha256").update(store.username, "utf8").digest();
  const suppliedUsername = createHash("sha256").update(username, "utf8").digest();
  const usernameMatches = timingSafeEqual(expectedUsername, suppliedUsername);
  try {
    const expectedHash = Buffer.from(store.hash, "hex");
    const actualHash = await derivePassword(password, Buffer.from(store.salt, "hex"), store.params);
    return timingSafeEqual(expectedHash, actualHash) && usernameMatches;
  } catch {
    return false;
  }
}

export function credentialGeneration(store: AdminCredentialStore): number {
  return store.credential_generation;
}

export function writeAdminCredentials(path: string, store: AdminCredentialStore): void {
  const validated = parseCredentialStore(store);
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    const active = lstatSync(path);
    if (!active.isFile() || active.isSymbolicLink()) {
      throw new AdminCredentialsError("unsafe_admin_credentials_file");
    }
  }
  const temporaryPath = join(parent, `.${basename(path)}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(validated)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
    fsyncDirectory(parent);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    tryUnlink(temporaryPath);
    if (error instanceof AdminCredentialsError) throw error;
    throw new AdminCredentialsError("admin_credentials_io_error");
  }
}

function parseCredentialStore(value: unknown): AdminCredentialStore {
  if (!isRecord(value) ||
    value.version !== ADMIN_CREDENTIALS_VERSION ||
    typeof value.username !== "string" ||
    !/^[a-zA-Z0-9._-]{1,64}$/.test(value.username) ||
    typeof value.salt !== "string" ||
    !isHex(value.salt, 32, 64) ||
    typeof value.hash !== "string" ||
    !isRecord(value.params) ||
    !validScryptParams(value.params) ||
    !isHex(value.hash, value.params.keylen, value.params.keylen) ||
    !Number.isSafeInteger(value.credential_generation) ||
    Number(value.credential_generation) < 1) {
    throw new AdminCredentialsError("invalid_admin_credentials_schema");
  }
  return value as unknown as AdminCredentialStore;
}

function validScryptParams(value: Record<string, unknown>): value is AdminCredentialStore["params"] {
  if (!Number.isSafeInteger(value.N) || !Number.isSafeInteger(value.r) ||
    !Number.isSafeInteger(value.p) || !Number.isSafeInteger(value.keylen)) return false;
  const N = Number(value.N);
  const r = Number(value.r);
  const p = Number(value.p);
  const keylen = Number(value.keylen);
  return N >= 2 ** 14 && N <= 2 ** 18 && (N & (N - 1)) === 0 &&
    r >= 1 && r <= 16 && p >= 1 && p <= 8 && keylen >= 32 && keylen <= 128 &&
    requiredScryptMemory({ N, r }) <= MAX_SCRYPT_MEMORY;
}

function derivePassword(
  password: string,
  salt: Buffer,
  params: AdminCredentialStore["params"]
): Promise<Buffer> {
  const maxmem = Math.max(64 * 1024 * 1024, requiredScryptMemory(params));
  return new Promise((resolve, reject) => {
    scrypt(password, salt, params.keylen, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function requiredScryptMemory(params: Pick<AdminCredentialStore["params"], "N" | "r">): number {
  return 128 * params.N * params.r + 2 * 1024 * 1024;
}

function isHex(value: string, minBytes: number, maxBytes: number): boolean {
  return value.length >= minBytes * 2 &&
    value.length <= maxBytes * 2 &&
    value.length % 2 === 0 &&
    /^[a-f0-9]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fsyncDirectory(directory: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(directory, "r");
    fsyncSync(descriptor);
  } catch {
    // Some supported filesystems do not permit directory fsync.
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup preserves the original failure.
  }
}

function nodeErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "";
}

function canonicalExistingPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function canonicalPotentialFilePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    try {
      return join(realpathSync(dirname(path)), basename(path));
    } catch {
      return resolve(path);
    }
  }
}
