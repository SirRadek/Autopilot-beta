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

function usagePayload(models: readonly Record<string, unknown>[], status?: "unavailable"): string {
  return JSON.stringify({
    five_hour: { limit: 100, used: 25, remaining: 75 },
    weekly: { limit: 1000, used: 200, remaining: 800 },
    models,
    ...(status === undefined ? {} : { status })
  });
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

    expect(discoverCodexModels(homeDir)).toEqual([]);
  });

  it("returns no Codex models when models_cache.json is malformed", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "provider-model-discovery-malformed-"));
    const cacheDir = join(homeDir, ".codex");
    mkdirSync(cacheDir);
    writeFileSync(join(cacheDir, "models_cache.json"), "{not-json", "utf8");

    expect(discoverCodexModels(homeDir)).toEqual([]);
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
      discoverCodexModels: () => [
        { model_id: "gpt-5.6-sol" },
        { model_id: "codex-discovered" },
        { model_id: "codex-discovered" }
      ],
      environment: { HOME: "/provider-home" }
    }).codex_cli.fetchSnapshot({ now, signal });

    expect(snapshot.cli_version).toBe("codex-cli 1.2.3");
    expect(snapshot.models).toEqual([
      {
        model_id: "gpt-5.6-sol",
        available: false,
        health: "degraded",
        source: "cli",
        discovery: "usage_probe"
      },
      {
        model_id: "codex-discovered",
        available: true,
        health: "healthy",
        source: "cli",
        discovery: "models_cache"
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
      captureCliVersion: async () => null,
      discoverCodexModels: () => [{ model_id: "codex-discovered" }]
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
        return [];
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
