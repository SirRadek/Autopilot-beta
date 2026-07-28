import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AuthSessionRegistry,
  MAX_AUTH_SESSIONS,
  SESSION_RENEW_AFTER_MS,
  SESSION_TTL_MS
} from "../../src/data/delivery-system/authSessionRegistry";

const token = (value: number): string => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(value, 28);
  return bytes.toString("base64url");
};
const serviceToken = (value: number): string => value.toString(16).padStart(64, "0");
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

function fixture(): { readonly root: string; readonly registry: AuthSessionRegistry } {
  const root = mkdtempSync(join(tmpdir(), "auth-session-registry-"));
  return { root, registry: new AuthSessionRegistry(root) };
}

describe("AuthSessionRegistry", () => {
  it("creates and looks up a session while persisting only its digest", () => {
    const { root, registry } = fixture();
    const rawToken = token(1);

    const created = registry.createSession(rawToken, 4, 1_000);
    const lookup = registry.lookupSession(rawToken, 4, 1_001);

    expect(created).toEqual({
      expires_at_epoch: 1_000 + SESSION_TTL_MS,
      credential_generation: 4,
      created_at_epoch: 1_000
    });
    expect(lookup).toEqual({ record: created, refreshCookie: false });
    const persisted = readFileSync(join(root, "sessions.json"), "utf8");
    expect(persisted).toContain(digest(rawToken));
    expect(persisted).not.toContain(rawToken);
    if (process.platform !== "win32") expect(lstatSync(join(root, "sessions.json")).mode & 0o777).toBe(0o600);
  });

  it("rejects expired sessions and opportunistically prunes all expired records", () => {
    const { root, registry } = fixture();
    registry.createSession(token(1), 1, 0);
    registry.createSession(token(2), 1, 10);

    expect(registry.lookupSession(token(1), 1, SESSION_TTL_MS)).toBeNull();

    const document = JSON.parse(readFileSync(join(root, "sessions.json"), "utf8")) as { sessions: Record<string, unknown> };
    expect(document.sessions[digest(token(1))]).toBeUndefined();
    expect(document.sessions[digest(token(2))]).toBeDefined();
  });

  it("renews only after more than one quarter of the sliding window has elapsed", () => {
    const { registry } = fixture();
    const rawToken = token(3);
    registry.createSession(rawToken, 2, 10_000);

    const boundary = 10_000 + SESSION_RENEW_AFTER_MS;
    const atBoundary = registry.lookupSession(rawToken, 2, boundary);
    expect(atBoundary?.refreshCookie).toBe(false);
    expect(atBoundary?.record.expires_at_epoch).toBe(10_000 + SESSION_TTL_MS);

    const renewed = registry.lookupSession(rawToken, 2, boundary + 1);
    expect(renewed).toEqual({
      refreshCookie: true,
      record: {
        expires_at_epoch: boundary + 1 + SESSION_TTL_MS,
        credential_generation: 2,
        created_at_epoch: 10_000
      }
    });
  });

  it("rejects credential-generation mismatch and deletes sessions on logout", () => {
    const { registry } = fixture();
    const rawToken = token(4);
    registry.createSession(rawToken, 8, 20_000);

    expect(registry.lookupSession(rawToken, 9, 20_001)).toBeNull();
    expect(registry.lookupSession(rawToken, 8, 20_001)).not.toBeNull();
    registry.deleteSession(rawToken);
    expect(registry.lookupSession(rawToken, 8, 20_002)).toBeNull();
  });

  it("verifies service tokens by digest and never persists plaintext", () => {
    const { root, registry } = fixture();
    const rawToken = serviceToken(5);
    const record = registry.storeServiceToken(rawToken, 30_000);

    expect(record.generation).toBe(1);
    expect(registry.serviceTokenDigest()).toBe(digest(rawToken));
    expect(registry.verifyServiceToken(rawToken)).toBe(true);
    expect(registry.verifyServiceToken(serviceToken(6))).toBe(false);
    const persisted = readFileSync(join(root, "service-token.json"), "utf8");
    expect(persisted).toContain(digest(rawToken));
    expect(persisted).not.toContain(rawToken);

    expect(registry.storeServiceToken(serviceToken(7), 31_000).generation).toBe(2);
  });

  it("caps sessions by evicting the oldest live record", () => {
    const { registry } = fixture();
    for (let index = 0; index <= MAX_AUTH_SESSIONS; index += 1) {
      registry.createSession(token(index + 10), 1, index);
    }

    expect(registry.lookupSession(token(10), 1, MAX_AUTH_SESSIONS + 1)).toBeNull();
    expect(registry.lookupSession(token(MAX_AUTH_SESSIONS + 10), 1, MAX_AUTH_SESSIONS + 1)).not.toBeNull();
    const document = JSON.parse(readFileSync(join(registry.authStateRoot, "sessions.json"), "utf8")) as { sessions: Record<string, unknown> };
    expect(Object.keys(document.sessions)).toHaveLength(MAX_AUTH_SESSIONS);
  });
});
