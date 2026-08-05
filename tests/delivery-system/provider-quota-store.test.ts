import fs from "node:fs";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  appendProviderQuotaEvent,
  readProviderQuotaStore,
  writeProviderQuotaStore,
  type ProviderQuotaStoreDocument,
  type ProviderQuotaEvent
} from "../../src/data/delivery-system/providerQuotaStore";
import type { ProviderSnapshot } from "../../src/data/delivery-system/providerQuota";

const MAX_PROVIDER_QUOTA_STORE_BYTES = 2 * 1024 * 1024;
const snapshotDocument: ProviderQuotaStoreDocument = { schema_version: "v1", snapshots: [] };

function minimumSnapshot(): ProviderSnapshot {
  const window = { limit: null, used: null, remaining: null, resets_at: null };
  return {
    provider: "p",
    source: "cli",
    fetched_at: "f",
    observed_at: "o",
    five_hour: window,
    weekly: window,
    api_spend: null,
    currency: null,
    models: [],
    health: "healthy",
    error_code: null
  };
}

function serialized(document: ProviderQuotaStoreDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function documentAtByteLength(targetBytes: number): ProviderQuotaStoreDocument {
  const emptyBytes = Buffer.byteLength(serialized(snapshotDocument));
  const oneBytes = Buffer.byteLength(serialized({ schema_version: "v1", snapshots: [minimumSnapshot()] }));
  const twoBytes = Buffer.byteLength(serialized({
    schema_version: "v1",
    snapshots: [minimumSnapshot(), minimumSnapshot()]
  }));
  const perAdditionalSnapshot = twoBytes - oneBytes;
  const count = Math.floor((targetBytes - oneBytes) / perAdditionalSnapshot) + 1;
  const snapshots = Array.from({ length: count }, minimumSnapshot);
  const document: ProviderQuotaStoreDocument = { schema_version: "v1", snapshots };
  let remaining = targetBytes - Buffer.byteLength(serialized(document));
  expect(remaining).toBeGreaterThanOrEqual(0);
  expect(emptyBytes).toBeLessThan(oneBytes);

  const tail = { ...snapshots.at(-1)! };
  const providerExtra = Math.min(remaining, 299);
  tail.provider = utf8String(1 + providerExtra, 100);
  remaining -= providerExtra;
  tail.fetched_at = utf8String(1 + remaining, 200);
  snapshots[snapshots.length - 1] = tail;

  expect(Buffer.byteLength(serialized(document))).toBe(targetBytes);
  return document;
}

function utf8String(bytes: number, maxCharacters: number): string {
  const threeByteCharacters = Math.floor(bytes / 3);
  const remainder = bytes % 3;
  const value = `${"€".repeat(threeByteCharacters)}${remainder === 2 ? "é" : remainder === 1 ? "a" : ""}`;
  expect(value.length).toBeLessThanOrEqual(maxCharacters);
  expect(Buffer.byteLength(value)).toBe(bytes);
  return value;
}

describe("provider quota store", () => {
  it("returns an empty document when the snapshot file is missing", () => {
    expect(readProviderQuotaStore(mkdtempSync(join(tmpdir(), "quota-store-")))).toEqual(snapshotDocument);
  });

  it("atomically replaces the snapshot and creates the state directory", () => {
    const stateDir = join(mkdtempSync(join(tmpdir(), "quota-store-")), "nested");
    writeProviderQuotaStore(stateDir, snapshotDocument);
    const replacement = { schema_version: "v1" as const, snapshots: [] };
    writeProviderQuotaStore(stateDir, replacement);
    expect(readProviderQuotaStore(stateDir)).toEqual(replacement);
  });

  it("round-trips deterministic output at the exact read/write byte cap", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "quota-store-boundary-"));
    const document = documentAtByteLength(MAX_PROVIDER_QUOTA_STORE_BYTES);

    writeProviderQuotaStore(stateDir, document);
    const first = readFileSync(join(stateDir, "provider-quota-snapshots.json"));
    writeProviderQuotaStore(stateDir, document);
    const second = readFileSync(join(stateDir, "provider-quota-snapshots.json"));

    expect(first.byteLength).toBe(MAX_PROVIDER_QUOTA_STORE_BYTES);
    expect(second).toEqual(first);
    expect(readProviderQuotaStore(stateDir)).toEqual(document);
  }, 15_000);

  it("rejects oversize output before writing and preserves the existing store without leaking data", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "quota-store-oversize-"));
    const path = join(stateDir, "provider-quota-snapshots.json");
    writeProviderQuotaStore(stateDir, snapshotDocument);
    const existing = readFileSync(path);
    const boundary = documentAtByteLength(MAX_PROVIDER_QUOTA_STORE_BYTES);
    const oversize: ProviderQuotaStoreDocument = {
      schema_version: "v1",
      snapshots: [...boundary.snapshots, { ...minimumSnapshot(), provider: "private-marker" }]
    };
    expect(Buffer.byteLength(serialized(oversize))).toBeGreaterThan(MAX_PROVIDER_QUOTA_STORE_BYTES);

    const originalWriteFileSync = fs.writeFileSync;
    let writes = 0;
    fs.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
      writes += 1;
      return originalWriteFileSync(...args as Parameters<typeof fs.writeFileSync>);
    }) as typeof fs.writeFileSync;
    syncBuiltinESMExports();
    let thrown: unknown;
    try {
      writeProviderQuotaStore(stateDir, oversize);
    } catch (error) {
      thrown = error;
    } finally {
      fs.writeFileSync = originalWriteFileSync;
      syncBuiltinESMExports();
    }

    expect(thrown).toEqual(new Error("provider_quota_store_limit"));
    expect(String(thrown)).not.toContain("private-marker");
    expect(writes).toBe(0);
    expect(readFileSync(path)).toEqual(existing);
    expect(readdirSync(stateDir)).toEqual(["provider-quota-snapshots.json"]);
  });

  it("rejects malformed snapshot JSON", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "quota-store-"));
    writeFileSync(join(stateDir, "provider-quota-snapshots.json"), "{broken", "utf8");
    expect(() => readProviderQuotaStore(stateDir)).toThrow("invalid_provider_quota_store");
  });

  it("strips unknown fields and rejects malformed snapshots on read", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "quota-store-"));
    writeFileSync(join(stateDir, "provider-quota-snapshots.json"), JSON.stringify({
      schema_version: "v1",
      snapshots: [{
        provider: "codex_cli", source: "cli", fetched_at: "2026-07-11T12:00:00.000Z", observed_at: "2026-07-11T12:00:00.000Z",
        five_hour: { limit: 10, used: 1, remaining: 9, resets_at: null }, weekly: { limit: null, used: null, remaining: null, resets_at: null },
        api_spend: null, currency: null, models: [], health: "healthy", error_code: null, api_key: "must-not-leak"
      }, { provider: "bad", source: "unknown" }]
    }), "utf8");
    const document = readProviderQuotaStore(stateDir);
    expect(document.snapshots).toHaveLength(1);
    expect(document.snapshots[0]).not.toHaveProperty("api_key");
  });

  it("filters legacy display-label models when a snapshot round-trips through the store", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "quota-store-model-id-"));
    const path = join(stateDir, "provider-quota-snapshots.json");
    const legacyDocument: ProviderQuotaStoreDocument = {
      schema_version: "v1",
      snapshots: [{
        ...minimumSnapshot(),
        provider: "claude_cli",
        models: [
          { model_id: "Opus 4.8", available: true, health: "healthy", source: "cli" },
          { model_id: "claude-opus-4-8", available: true, health: "healthy", source: "cli" }
        ]
      }]
    };
    writeFileSync(path, serialized(legacyDocument), "utf8");

    const sanitized = readProviderQuotaStore(stateDir);
    expect(sanitized.snapshots[0]?.models).toEqual([
      { model_id: "claude-opus-4-8", available: true, health: "healthy", source: "cli" }
    ]);

    writeProviderQuotaStore(stateDir, sanitized);

    expect(readProviderQuotaStore(stateDir)).toEqual(sanitized);
    expect(readFileSync(path, "utf8")).not.toContain("Opus 4.8");
  });

  it.each([
    "provider_executable_missing",
    "provider_runtime_denied"
  ] as const)("round-trips the allowlisted %s error code", (errorCode) => {
    const stateDir = mkdtempSync(join(tmpdir(), "quota-store-error-code-"));
    const document: ProviderQuotaStoreDocument = {
      schema_version: "v1",
      snapshots: [{
        ...minimumSnapshot(),
        health: "unavailable",
        error_code: errorCode
      }]
    };

    writeProviderQuotaStore(stateDir, document);

    expect(readProviderQuotaStore(stateDir)).toEqual(document);
  });

  it("bounds event fields and never persists raw response text", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "quota-store-"));
    const event: ProviderQuotaEvent = {
      provider: "p".repeat(500),
      observed_at: "2026-07-11T12:00:00.000Z",
      status: "error",
      changed_fields: ["a".repeat(500), "weekly", "weekly"],
      error_code: "provider_error",
      raw_response: "must-not-be-written"
    };
    appendProviderQuotaEvent(stateDir, event);
    const line = readFileSync(join(stateDir, "provider-quota-events.jsonl"), "utf8");
    expect(line).not.toContain("must-not-be-written");
    const persisted = JSON.parse(line) as Record<string, unknown>;
    expect(persisted.provider).toHaveLength(100);
    expect(persisted.changed_fields).toEqual(["a".repeat(200), "weekly"]);
  });
});
