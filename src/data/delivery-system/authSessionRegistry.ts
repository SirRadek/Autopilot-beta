import { createHash, timingSafeEqual } from "node:crypto";
import { lstatSync } from "node:fs";
import { join } from "node:path";

import { readManagedStateTextFile } from "./managedStateFile";
import {
  withStateMaintenanceLock,
  writeStateFileAtomically
} from "./stateMaintenanceLock";

export const AUTH_STATE_DIRECTORY_NAME = "auth";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const SESSION_RENEW_AFTER_MS = Math.floor(SESSION_TTL_MS / 4);
export const MAX_AUTH_SESSIONS = 256;

const SESSION_REGISTRY_VERSION = "autopilot-auth-sessions-v1";
const SERVICE_TOKEN_VERSION = "autopilot-service-token-v1";
const MAX_SESSION_REGISTRY_BYTES = 256 * 1024;
const MAX_SERVICE_TOKEN_BYTES = 4 * 1024;

export interface AuthSessionRecord {
  readonly expires_at_epoch: number;
  readonly credential_generation: number;
  readonly created_at_epoch: number;
}

export interface AuthSessionLookup {
  readonly record: AuthSessionRecord;
  readonly refreshCookie: boolean;
}

export interface ServiceTokenRecord {
  readonly version: typeof SERVICE_TOKEN_VERSION;
  readonly digest: string;
  readonly issued_at_epoch: number;
  readonly generation: number;
}

interface SessionRegistryDocument {
  readonly version: typeof SESSION_REGISTRY_VERSION;
  readonly sessions: Readonly<Record<string, AuthSessionRecord>>;
}

export function authStateRoot(stateDir: string): string {
  return join(stateDir, AUTH_STATE_DIRECTORY_NAME);
}

export class AuthSessionRegistry {
  readonly authStateRoot: string;
  private readonly sessionPath: string;
  private readonly serviceTokenPath: string;

  constructor(authStateDirectory: string) {
    this.authStateRoot = authStateDirectory;
    this.sessionPath = join(authStateDirectory, "sessions.json");
    this.serviceTokenPath = join(authStateDirectory, "service-token.json");
  }

  createSession(rawToken: string, generation: number, now = Date.now()): AuthSessionRecord {
    assertSessionToken(rawToken);
    assertEpoch(now);
    if (!Number.isSafeInteger(generation) || generation < 1) throw new Error("invalid_credential_generation");
    return withStateMaintenanceLock(this.authStateRoot, () => {
      const document = readSessionDocument(this.sessionPath);
      const sessions = pruneExpired(document.sessions, now);
      const entries = Object.entries(sessions)
        .sort(([leftDigest, left], [rightDigest, right]) =>
          left.created_at_epoch - right.created_at_epoch || leftDigest.localeCompare(rightDigest));
      for (const [oldestDigest] of entries.slice(0, Math.max(0, entries.length - MAX_AUTH_SESSIONS + 1))) {
        delete sessions[oldestDigest];
      }
      const record: AuthSessionRecord = {
        expires_at_epoch: now + SESSION_TTL_MS,
        credential_generation: generation,
        created_at_epoch: now
      };
      sessions[tokenDigest(rawToken)] = record;
      writeSessionDocument(this.authStateRoot, this.sessionPath, sessions);
      return record;
    });
  }

  lookupSession(
    rawToken: string,
    currentGeneration: number,
    now = Date.now()
  ): AuthSessionLookup | null {
    if (!isSessionToken(rawToken) || !Number.isSafeInteger(currentGeneration) || currentGeneration < 1) return null;
    assertEpoch(now);
    return withStateMaintenanceLock(this.authStateRoot, () => {
      const document = readSessionDocument(this.sessionPath);
      const sessions = pruneExpired(document.sessions, now);
      const pruned = Object.keys(sessions).length !== Object.keys(document.sessions).length;
      const digest = tokenDigest(rawToken);
      const current = sessions[digest];
      if (current === undefined || current.credential_generation !== currentGeneration) {
        if (pruned) writeSessionDocument(this.authStateRoot, this.sessionPath, sessions);
        return null;
      }
      const lastExtendedAt = current.expires_at_epoch - SESSION_TTL_MS;
      if (now <= lastExtendedAt + SESSION_RENEW_AFTER_MS) {
        if (pruned) writeSessionDocument(this.authStateRoot, this.sessionPath, sessions);
        return { record: current, refreshCookie: false };
      }
      const renewed: AuthSessionRecord = {
        ...current,
        expires_at_epoch: now + SESSION_TTL_MS
      };
      sessions[digest] = renewed;
      writeSessionDocument(this.authStateRoot, this.sessionPath, sessions);
      return { record: renewed, refreshCookie: true };
    });
  }

  deleteSession(rawToken: string): void {
    if (!isSessionToken(rawToken)) return;
    withStateMaintenanceLock(this.authStateRoot, () => {
      const document = readSessionDocument(this.sessionPath);
      const sessions = { ...document.sessions };
      const digest = tokenDigest(rawToken);
      if (sessions[digest] === undefined) return;
      delete sessions[digest];
      writeSessionDocument(this.authStateRoot, this.sessionPath, sessions);
    });
  }

  serviceTokenDigest(): string | null {
    return withStateMaintenanceLock(this.authStateRoot, () => readServiceTokenRecord(this.serviceTokenPath)?.digest ?? null);
  }

  verifyServiceToken(rawToken: string): boolean {
    if (!isServiceToken(rawToken)) return false;
    return withStateMaintenanceLock(this.authStateRoot, () => {
      const stored = readServiceTokenRecord(this.serviceTokenPath);
      if (stored === null) return false;
      const expected = Buffer.from(stored.digest, "hex");
      const supplied = Buffer.from(tokenDigest(rawToken), "hex");
      return timingSafeEqual(expected, supplied);
    });
  }

  storeServiceToken(rawToken: string, now = Date.now()): ServiceTokenRecord {
    assertServiceToken(rawToken);
    assertEpoch(now);
    return withStateMaintenanceLock(this.authStateRoot, () => {
      const previous = readServiceTokenRecord(this.serviceTokenPath);
      const record: ServiceTokenRecord = {
        version: SERVICE_TOKEN_VERSION,
        digest: tokenDigest(rawToken),
        issued_at_epoch: now,
        generation: (previous?.generation ?? 0) + 1
      };
      writeStateFileAtomically(this.authStateRoot, this.serviceTokenPath, `${JSON.stringify(record)}\n`);
      return record;
    });
  }
}

function readSessionDocument(path: string): SessionRegistryDocument {
  const text = readPrivateText(path, MAX_SESSION_REGISTRY_BYTES);
  if (text === null) return { version: SESSION_REGISTRY_VERSION, sessions: {} };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("invalid_auth_session_registry");
  }
  if (!isRecord(value) || value.version !== SESSION_REGISTRY_VERSION || !isRecord(value.sessions) ||
    Object.keys(value.sessions).length > MAX_AUTH_SESSIONS) {
    throw new Error("invalid_auth_session_registry");
  }
  const sessions: Record<string, AuthSessionRecord> = {};
  for (const [digest, record] of Object.entries(value.sessions)) {
    if (!isDigest(digest) || !isSessionRecord(record)) throw new Error("invalid_auth_session_registry");
    sessions[digest] = record;
  }
  return { version: SESSION_REGISTRY_VERSION, sessions };
}

function readServiceTokenRecord(path: string): ServiceTokenRecord | null {
  const text = readPrivateText(path, MAX_SERVICE_TOKEN_BYTES);
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("invalid_service_token_registry");
  }
  if (!isRecord(value) || value.version !== SERVICE_TOKEN_VERSION ||
    typeof value.digest !== "string" || !isDigest(value.digest) ||
    !isEpoch(value.issued_at_epoch) ||
    !Number.isSafeInteger(value.generation) || Number(value.generation) < 1) {
    throw new Error("invalid_service_token_registry");
  }
  return value as unknown as ServiceTokenRecord;
}

function readPrivateText(path: string, maxBytes: number): string | null {
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maxBytes ||
      (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)) {
      throw new Error("unsafe_auth_state_file");
    }
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return null;
    if (error instanceof Error && error.message === "unsafe_auth_state_file") throw error;
    throw new Error("auth_state_io_error");
  }
  try {
    const loaded = readManagedStateTextFile(path, { maxBytes });
    if (loaded.status === "missing") throw new Error("unsafe_auth_state_file");
    return loaded.text;
  } catch {
    throw new Error("unsafe_auth_state_file");
  }
}

function writeSessionDocument(
  authRoot: string,
  path: string,
  sessions: Readonly<Record<string, AuthSessionRecord>>
): void {
  const document: SessionRegistryDocument = {
    version: SESSION_REGISTRY_VERSION,
    sessions
  };
  writeStateFileAtomically(authRoot, path, `${JSON.stringify(document)}\n`);
}

function pruneExpired(
  source: Readonly<Record<string, AuthSessionRecord>>,
  now: number
): Record<string, AuthSessionRecord> {
  return Object.fromEntries(Object.entries(source).filter(([, record]) => record.expires_at_epoch > now));
}

function tokenDigest(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function isSessionRecord(value: unknown): value is AuthSessionRecord {
  return isRecord(value) &&
    isEpoch(value.expires_at_epoch) &&
    isEpoch(value.created_at_epoch) &&
    value.expires_at_epoch > value.created_at_epoch &&
    Number.isSafeInteger(value.credential_generation) &&
    Number(value.credential_generation) >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function isServiceToken(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function isSessionToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function assertSessionToken(value: string): void {
  if (!isSessionToken(value)) throw new Error("invalid_auth_token");
}

function assertServiceToken(value: string): void {
  if (!isServiceToken(value)) throw new Error("invalid_auth_token");
}

function isEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function assertEpoch(value: number): void {
  if (!isEpoch(value)) throw new Error("invalid_auth_epoch");
}

function nodeErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "";
}
