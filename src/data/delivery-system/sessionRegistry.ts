import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeStateFileAtomically } from "./stateMaintenanceLock";

export interface SessionQueueItem {
  readonly prompt_id: string;
  readonly queued_at: string;
}

export interface SessionRegistryRecord {
  readonly schema_version: "v1";
  readonly session_id: string;
  readonly agent_command: string;
  readonly cwd: string;
  readonly name: string | null;
  readonly status: "active" | "closed";
  readonly created_at: string;
  readonly updated_at: string;
  readonly owner_expires_at: string | null;
  readonly queue: readonly SessionQueueItem[];
  readonly close_reason?: string;
}

export interface SessionScope {
  readonly agentCommand: string;
  readonly cwd: string;
  readonly name?: string;
}

export interface SessionRegistryDocument {
  readonly schema_version: "v1";
  readonly sessions: readonly SessionRegistryRecord[];
}

export const SESSION_REGISTRY_FILE = "session-registry.json";

export function createSessionRecord(input: {
  readonly sessionId: string;
  readonly agentCommand: string;
  readonly cwd: string;
  readonly name?: string;
  readonly ownerExpiresAt?: string;
  readonly now?: string;
}): SessionRegistryRecord {
  const now = input.now ?? new Date().toISOString();
  return {
    schema_version: "v1",
    session_id: input.sessionId,
    agent_command: input.agentCommand,
    cwd: input.cwd,
    name: input.name ?? null,
    status: "active",
    created_at: now,
    updated_at: now,
    owner_expires_at: input.ownerExpiresAt ?? null,
    queue: []
  };
}

export function selectScopedSession(
  sessions: readonly SessionRegistryRecord[],
  scope: SessionScope
): SessionRegistryRecord | null {
  return sessions.find((session) =>
    session.status === "active" &&
    session.agent_command === scope.agentCommand &&
    session.cwd === scope.cwd &&
    session.name === (scope.name ?? null)
  ) ?? null;
}

export function enqueuePrompt(
  session: SessionRegistryRecord,
  promptId: string,
  now = new Date().toISOString()
): SessionRegistryRecord {
  return {
    ...session,
    updated_at: now,
    queue: [...session.queue, { prompt_id: promptId, queued_at: now }]
  };
}

export function cancelSession(
  session: SessionRegistryRecord,
  reason: string,
  now = new Date().toISOString()
): SessionRegistryRecord {
  return {
    ...session,
    status: "closed",
    updated_at: now,
    close_reason: reason
  };
}

export function resumeSession(
  session: SessionRegistryRecord,
  now = new Date().toISOString()
): SessionRegistryRecord {
  return {
    ...session,
    status: "active",
    updated_at: now,
    owner_expires_at: null,
  };
}

export function isSessionOwnerExpired(session: SessionRegistryRecord, now: string): boolean {
  if (session.owner_expires_at === null) {
    return false;
  }

  const expiresAt = Date.parse(session.owner_expires_at);
  const nowAt = Date.parse(now);
  return !Number.isFinite(expiresAt) || !Number.isFinite(nowAt) || nowAt >= expiresAt;
}

export function readSessionRegistry(stateDir: string): SessionRegistryDocument {
  const path = join(stateDir, SESSION_REGISTRY_FILE);
  if (!existsSync(path)) {
    return { schema_version: "v1", sessions: [] };
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as SessionRegistryDocument;
  if (parsed.schema_version !== "v1" || !Array.isArray(parsed.sessions)) {
    throw new Error("invalid_session_registry");
  }

  return parsed;
}

export function writeSessionRegistry(stateDir: string, document: SessionRegistryDocument): void {
  const path = join(stateDir, SESSION_REGISTRY_FILE);
  writeStateFileAtomically(stateDir, path, `${JSON.stringify(document, null, 2)}\n`);
}

export function sessionRegistryPath(stateDir: string): string {
  return join(stateDir, SESSION_REGISTRY_FILE);
}
