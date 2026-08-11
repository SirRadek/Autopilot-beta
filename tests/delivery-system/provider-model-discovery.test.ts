import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  captureCliVersion,
  discoverAgyModels,
  discoverCodexModels
} from "../../src/data/delivery-system/providerModelDiscovery";
import {
  createProviderQuotaAdapters,
  type ProviderCommandRunner
} from "../../src/data/delivery-system/providerQuotaAdapters";

const now = "2026-08-05T12:00:00.000Z";
const signal = new AbortController().signal;
const codexCacheNow = new Date("2026-08-06T10:04:00.000Z");
const codexCacheVersion = "0.144.5";

function usagePayload(models: readonly Record<string, unknown>[], status?: "unavailable"): string {
  return JSON.stringify({
    five_hour: { limit: 100, used: 25, remaining: 75 },
    weekly: { limit: 1000, used: 200, remaining: 800 },
    models,
    ...(status === undefined ? {} : { status })
  });
}

function writeCodexCache(
  homeDir: string,
  models: readonly Record<string, unknown>[],
  padding = ""
): void {
  const cacheDir = join(homeDir, ".codex");
  mkdirSync(cacheDir);
  writeFileSync(join(cacheDir, "models_cache.json"), JSON.stringify({
    fetched_at: "2026-08-06T10:00:00.123456789Z",
    client_version: "0.144.5",
    models,
    padding
  }), "utf8");
}

function reasoningLevels(...efforts: string[]): readonly Record<string, string>[] {
  return efforts.map((effort) => ({ effort, description: `${effort} reasoning` }));
}

describe("provider model discovery", () => {
  it("captures the first sanitized CLI version line with a bounded environment", async () => {
    const invocations: Parameters<ProviderCommandRunner>[0][] = [];
    vi.stubEnv("P9_UNSAFE_PROVIDER_SECRET", "must-not-cross-command-boundary");

    let version: string | null = null;
    try {
      version = await captureCliVersion("/provider-bin/codex", async (input) => {
        invocations.push(input);
        return { stdout: "codex-cli 1.2.3 (stable)\nignored second line", exitCode: 0 };
      }, signal);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(version).toBe("codex-cli 1.2.3 (stable)");
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.command).toBe("/provider-bin/codex");
    expect(invocations[0]?.args).toEqual(["--version"]);
    expect(invocations[0]?.environment).toEqual(expect.any(Object));
    expect(Object.keys(invocations[0]?.environment ?? {}).every((key) =>
      ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TERM", "TMPDIR"].includes(key)
    )).toBe(true);
    expect(invocations[0]?.environment).not.toHaveProperty("P9_UNSAFE_PROVIDER_SECRET");
  });

  it.each([
    ["ANSI", "\u001b[31mcodex-cli 1.2.3\u001b[0m"],
    ["over-long", "v".repeat(101)],
    ["garbage", "codex-cli=1.2.3"]
  ])("rejects %s CLI version output", async (_label, stdout) => {
    const version = await captureCliVersion(
      "codex",
      async () => ({ stdout, exitCode: 0 }),
      signal
    );

    expect(version).toBeNull();
  });

  it("returns null when CLI version capture fails", async () => {
    const version = await captureCliVersion("codex", async () => {
      throw new Error("raw provider failure");
    }, signal);

    expect(version).toBeNull();
  });

  it("returns no Codex models when models_cache.json is missing", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "provider-model-discovery-missing-"));

    expect(discoverCodexModels(homeDir, codexCacheVersion, codexCacheNow)).toBeNull();
  });

  it("returns no Codex models when models_cache.json is malformed", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "provider-model-discovery-malformed-"));
    const cacheDir = join(homeDir, ".codex");
    mkdirSync(cacheDir);
    writeFileSync(join(cacheDir, "models_cache.json"), "{not-json", "utf8");

    expect(discoverCodexModels(homeDir, codexCacheVersion, codexCacheNow)).toBeNull();
  });

  it("parses every picker-visible model and its reasoning levels from the verified Codex cache shape", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "provider-model-discovery-codex-"));
    writeCodexCache(homeDir, [
      { slug: "gpt-5.6-sol", visibility: "list", supported_in_api: true, supported_reasoning_levels: reasoningLevels("low", "medium", "high", "xhigh", "max", "ultra") },
      { slug: "gpt-5.6-sol-wm", visibility: "hide", supported_in_api: false, supported_reasoning_levels: reasoningLevels("low", "medium", "high", "xhigh", "max", "ultra") },
      { slug: "gpt-5.6-terra", visibility: "list", supported_in_api: true, supported_reasoning_levels: reasoningLevels("low", "medium", "high", "xhigh", "max", "ultra") },
      { slug: "gpt-5.6-luna", visibility: "list", supported_in_api: true, supported_reasoning_levels: reasoningLevels("low", "medium", "high", "xhigh", "max") },
      { slug: "gpt-5.5", visibility: "list", supported_in_api: true, supported_reasoning_levels: reasoningLevels("low", "medium", "high", "xhigh") },
      { slug: "gpt-5.4", visibility: "list", supported_in_api: true, supported_reasoning_levels: reasoningLevels("low", "medium", "high", "xhigh") },
      { slug: "gpt-5.4-mini", visibility: "list", supported_in_api: true, supported_reasoning_levels: reasoningLevels("low", "medium", "high", "xhigh") },
      { slug: "gpt-5.3-codex-spark", visibility: "list", supported_in_api: false, supported_reasoning_levels: reasoningLevels("low", "medium", "high", "xhigh") },
      { slug: "codex-auto-review", visibility: "hide", supported_in_api: true, supported_reasoning_levels: reasoningLevels("low", "medium", "high", "xhigh", "max") },
      { slug: "-not-a-model", visibility: "list", supported_in_api: true, supported_reasoning_levels: reasoningLevels("ultra") }
    ], "x".repeat(350 * 1024));

    expect(discoverCodexModels(homeDir, codexCacheVersion, codexCacheNow)).toEqual({
      fetched_at: "2026-08-06T10:00:00.123Z",
      freshness: "fresh",
      age_ms: 239_877,
      models: [
        { model_id: "gpt-5.6-sol", reasoning_efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
        { model_id: "gpt-5.6-terra", reasoning_efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
        { model_id: "gpt-5.6-luna", reasoning_efforts: ["low", "medium", "high", "xhigh", "max"] },
        { model_id: "gpt-5.5", reasoning_efforts: ["low", "medium", "high", "xhigh"] },
        { model_id: "gpt-5.4", reasoning_efforts: ["low", "medium", "high", "xhigh"] },
        { model_id: "gpt-5.4-mini", reasoning_efforts: ["low", "medium", "high", "xhigh"] },
        { model_id: "gpt-5.3-codex-spark", reasoning_efforts: ["low", "medium", "high", "xhigh"] }
      ]
    });
  });

  it("drops unknown or malformed per-model effort values without exposing raw cache fields", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "provider-model-discovery-efforts-"));
    writeCodexCache(homeDir, [{
      slug: "gpt-5.6-sol",
      visibility: "list",
      secret_provider_metadata: "must-not-cross-module-boundary",
      supported_reasoning_levels: [
        { effort: "ultra", description: "Maximum reasoning with automatic task delegation" },
        { effort: "future-effort", description: "unknown" },
        { effort: 42, description: "invalid" },
        { effort: "ultra", description: "duplicate" }
      ]
    }]);

    const catalog = discoverCodexModels(homeDir, codexCacheVersion, codexCacheNow);
    expect(catalog?.models).toEqual([{ model_id: "gpt-5.6-sol", reasoning_efforts: ["ultra"] }]);
    expect(JSON.stringify(catalog)).not.toContain("secret_provider_metadata");
    expect(JSON.stringify(catalog)).not.toContain("automatic task delegation");
  });

  it("returns no Codex models when the cache exceeds the bounded one-megabyte read", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "provider-model-discovery-oversized-"));
    writeCodexCache(homeDir, [{ slug: "gpt-5.6-sol", visibility: "list", supported_reasoning_levels: reasoningLevels("low") }], "x".repeat(1024 * 1024));

    expect(discoverCodexModels(homeDir, codexCacheVersion, codexCacheNow)).toBeNull();
  });

  it("keeps a version-matched stale cache and reports its exact age", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "provider-model-discovery-stale-cache-"));
    const cacheDir = join(homeDir, ".codex");
    mkdirSync(cacheDir);
    writeFileSync(join(cacheDir, "models_cache.json"), JSON.stringify({
      fetched_at: "2026-08-03T09:58:59.000Z",
      client_version: codexCacheVersion,
      models: [{ slug: "gpt-5.6-sol", visibility: "list", supported_reasoning_levels: reasoningLevels("low", "ultra") }]
    }), "utf8");

    expect(discoverCodexModels(homeDir, codexCacheVersion, codexCacheNow)).toEqual({
      fetched_at: "2026-08-03T09:58:59.000Z",
      freshness: "stale",
      age_ms: 259_501_000,
      models: [{ model_id: "gpt-5.6-sol", reasoning_efforts: ["low", "ultra"] }]
    });
  });

  it.each([
    ["wrong-client", "0.143.0", "2026-08-06T10:00:00.000Z"],
    ["future-dated", "0.144.5", "2026-08-06T10:04:01.000Z"]
  ])("returns no Codex models for a %s cache", (_label, clientVersion, fetchedAt) => {
    const homeDir = mkdtempSync(join(tmpdir(), "provider-model-discovery-invalid-cache-"));
    const cacheDir = join(homeDir, ".codex");
    mkdirSync(cacheDir);
    writeFileSync(join(cacheDir, "models_cache.json"), JSON.stringify({
      fetched_at: fetchedAt,
      client_version: clientVersion,
      models: [{ slug: "gpt-5.6-sol", visibility: "list", supported_reasoning_levels: reasoningLevels("ultra") }]
    }), "utf8");

    expect(discoverCodexModels(homeDir, codexCacheVersion, codexCacheNow)).toBeNull();
  });

  it("parses canonical agy model IDs and expands known display labels", async () => {
    const models = await discoverAgyModels("/provider-bin/agy", async ({ command, args }) => {
      expect(command).toBe("/provider-bin/agy");
      expect(args).toEqual(["models"]);
      return {
        stdout: [
          "gemini-3.1-pro-high",
          "Gemini Flash",
          "not a canonical id",
          "-provider-option",
          "gemini-3.1-pro-high",
          "1) claude-4.6-sonnet"
        ].join("\n"),
        exitCode: 0
      };
    }, signal);

    expect(models).toEqual([
      { model_id: "gemini-3.1-pro-high" },
      { model_id: "gemini-3.5-flash-medium" },
      { model_id: "gemini-3.5-flash-high" },
      { model_id: "claude-4.6-sonnet" }
    ]);
  });

  it("returns no agy models when the model-list command fails", async () => {
    const models = await discoverAgyModels("agy", async () => {
      throw new Error("raw provider failure");
    }, signal);

    expect(models).toEqual([]);
  });

  it("deduplicates discovered models while probe availability wins on overlap", async () => {
    const snapshot = await createProviderQuotaAdapters({
      runCommand: async () => ({
        stdout: usagePayload([{ model_id: "gpt-5.6-sol", available: false }]),
        exitCode: 0
      }),
      commands: {
        codex_cli: { command: "/provider-bin/codex", args: ["quota"] }
      },
      captureCliVersion: async () => "codex-cli 1.2.3",
      discoverCodexModels: (homeDir, expectedClientVersion) => {
        expect(homeDir).toBe("/provider-home");
        expect(expectedClientVersion).toBe("1.2.3");
        return {
          fetched_at: "2026-08-03T09:58:59.000Z",
          freshness: "stale",
          age_ms: 259_501_000,
          models: [
            { model_id: "gpt-5.6-sol", reasoning_efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
            { model_id: "codex-discovered", reasoning_efforts: ["low", "medium"] },
            { model_id: "codex-discovered", reasoning_efforts: ["low"] }
          ]
        };
      },
      environment: { HOME: "/provider-home" }
    }).codex_cli.fetchSnapshot({ now, signal });

    expect(snapshot.cli_version).toBe("codex-cli 1.2.3");
    expect(snapshot.model_catalog).toEqual({
      discovery: "models_cache",
      fetched_at: "2026-08-03T09:58:59.000Z"
    });
    expect(snapshot.models).toEqual([
      {
        model_id: "gpt-5.6-sol",
        available: false,
        health: "degraded",
        source: "cli",
        discovery: "usage_probe",
        reasoning_efforts: ["low", "medium", "high", "xhigh", "max", "ultra"]
      },
      {
        model_id: "codex-discovered",
        available: true,
        health: "healthy",
        source: "cli",
        discovery: "models_cache",
        reasoning_efforts: ["low", "medium"]
      }
    ]);
  });

  it("merges agy model-list discovery with CLI-list provenance", async () => {
    const snapshot = await createProviderQuotaAdapters({
      runCommand: async () => ({ stdout: "", exitCode: 0 }),
      commands: {
        agy_cli: { kind: "tmux_usage", executable: "/provider-bin/agy" }
      },
      runUsageProbe: async () => ({ stdout: usagePayload([]), exitCode: 0 }),
      captureCliVersion: async () => "agy 1.2.3",
      discoverAgyModels: async () => [{ model_id: "gemini-3.1-pro-high" }]
    }).agy_cli.fetchSnapshot({ now, signal });

    expect(snapshot.cli_version).toBe("agy 1.2.3");
    expect(snapshot.models).toEqual([{
      model_id: "gemini-3.1-pro-high",
      available: true,
      health: "healthy",
      source: "cli",
      discovery: "cli_list"
    }]);
  });

  it("marks discovery-only models unavailable when the parsed snapshot is unhealthy", async () => {
    const snapshot = await createProviderQuotaAdapters({
      runCommand: async () => ({ stdout: "", exitCode: 0 }),
      commands: {
        codex_cli: { kind: "tmux_usage", executable: "/provider-bin/codex" }
      },
      runUsageProbe: async () => ({ stdout: usagePayload([], "unavailable"), exitCode: 0 }),
      captureCliVersion: async () => "codex-cli 1.2.3",
      discoverCodexModels: () => ({
        fetched_at: "2026-08-03T09:58:59.000Z",
        freshness: "stale",
        age_ms: 259_501_000,
        models: [{ model_id: "codex-discovered" }]
      })
    }).codex_cli.fetchSnapshot({ now, signal });

    expect(snapshot.models).toEqual([{
      model_id: "codex-discovered",
      available: false,
      health: "unavailable",
      source: "cli",
      discovery: "models_cache"
    }]);
  });

  it("keeps Claude models usage-probe-derived without invoking a model-list discovery", async () => {
    let discoveryCalls = 0;
    const snapshot = await createProviderQuotaAdapters({
      runCommand: async () => ({
        stdout: usagePayload([{ model_id: "claude-opus-4-8", available: true }]),
        exitCode: 0
      }),
      commands: {
        claude_cli: { command: "/provider-bin/claude", args: ["quota"] }
      },
      captureCliVersion: async () => "claude 1.2.3",
      discoverCodexModels: () => {
        discoveryCalls += 1;
        return null;
      },
      discoverAgyModels: async () => {
        discoveryCalls += 1;
        return [];
      }
    }).claude_cli.fetchSnapshot({ now, signal });

    expect(discoveryCalls).toBe(0);
    expect(snapshot.cli_version).toBe("claude 1.2.3");
    expect(snapshot.models).toEqual([{
      model_id: "claude-opus-4-8",
      available: true,
      health: "healthy",
      source: "cli",
      discovery: "usage_probe"
    }]);
  });

  it("degrades discovery failure to the successful probe snapshot", async () => {
    const snapshot = await createProviderQuotaAdapters({
      runCommand: async () => ({ stdout: "", exitCode: 0 }),
      commands: {
        codex_cli: { kind: "tmux_usage", executable: "/provider-bin/codex" }
      },
      runUsageProbe: async () => ({
        stdout: usagePayload([{ model_id: "gpt-5.6-sol", available: true }]),
        exitCode: 0
      }),
      captureCliVersion: async () => null,
      discoverCodexModels: () => {
        throw new Error("models cache unavailable");
      }
    }).codex_cli.fetchSnapshot({ now, signal });

    expect(snapshot.health).toBe("healthy");
    expect(snapshot.error_code).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain("models cache unavailable");
    expect(snapshot.models).toEqual([{
      model_id: "gpt-5.6-sol",
      available: true,
      health: "healthy",
      source: "cli",
      discovery: "usage_probe"
    }]);
  });
});
