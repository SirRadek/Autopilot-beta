import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const snapshotDocument: ProviderQuotaStoreDocument = { schema_version: "v1", snapshots: [] };

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
