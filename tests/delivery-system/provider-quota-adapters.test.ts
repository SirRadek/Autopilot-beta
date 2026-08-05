import { describe, expect, it } from "vitest";

import { createProviderQuotaAdapters, type ProviderCommandRunner } from "../../src/data/delivery-system/providerQuotaAdapters";

const now = "2026-07-11T12:00:00.000Z";
const signal = new AbortController().signal;
const payload = JSON.stringify({
  five_hour: { limit: 100, used: 25, remaining: 75, resets_at: "2026-07-11T17:00:00.000Z" },
  weekly: { limit: 1000, used: 200, remaining: 800 },
  models: [{ model_id: "test-model", available: true }]
});

function runnerFor(stdout: string, exitCode = 0): ProviderCommandRunner {
  return async () => ({ stdout, exitCode });
}

const commands = {
  codex_cli: { command: "codex-test", args: ["quota"] },
  claude_cli: { command: "claude-test", args: ["quota"] },
  agy_cli: { command: "agy-test", args: ["quota"] }
};

const usageCommands = {
  codex_cli: { kind: "tmux_usage" as const },
  claude_cli: { kind: "tmux_usage" as const },
  agy_cli: { kind: "tmux_usage" as const }
};

describe("provider quota adapters", () => {
  it.each(["codex_cli", "claude_cli", "agy_cli"] as const)("normalizes %s CLI output", async (provider) => {
    const adapter = createProviderQuotaAdapters({ runCommand: runnerFor(payload), commands })[provider];
    const snapshot = await adapter.fetchSnapshot({ now, signal });
    expect(snapshot.five_hour.remaining).toBe(75);
    expect(snapshot.weekly.limit).toBe(1000);
    expect(snapshot.models[0]?.model_id).toBe("test-model");
    expect(snapshot.error_code).toBeNull();
  });

  it("drops non-canonical CLI model rows without rejecting the snapshot", async () => {
    const mixedPayload = JSON.stringify({
      five_hour: { limit: 100, used: 25, remaining: 75 },
      weekly: { limit: 1000, used: 200, remaining: 800 },
      models: [
        { model_id: "gpt-5.6-sol", available: true },
        { model_id: "Opus 4.8", available: true },
        { model_id: "-provider-option", available: true }
      ]
    });

    const snapshot = await createProviderQuotaAdapters({ runCommand: runnerFor(mixedPayload), commands })
      .codex_cli.fetchSnapshot({ now, signal });

    expect(snapshot.models).toEqual([
      { model_id: "gpt-5.6-sol", available: true, health: "healthy", source: "cli" }
    ]);
    expect(snapshot.health).toBe("healthy");
    expect(snapshot.error_code).toBeNull();
  });

  it("normalizes OpenRouter model health through injected fetch", async () => {
    let calls = 0;
    const adapter = createProviderQuotaAdapters({
      runCommand: runnerFor(""),
      commands,
      environment: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl: async (url) => {
        calls += 1;
        return {
        ok: true,
        status: 200,
        text: async () => url.endsWith("/credits")
          ? JSON.stringify({ data: { total_credits: 20, total_usage: 3.5 } })
          : JSON.stringify({ data: { endpoints: [{ status: 200, uptime_last_5m: 100, uptime_last_30m: 100 }] } })
        };
      }
    }).openrouter_api;
    const snapshot = await adapter.fetchSnapshot({ now, signal });
    expect(snapshot.source).toBe("api");
    expect(snapshot.models.length).toBeGreaterThan(0);
    expect(snapshot.health).toBe("healthy");
    expect(snapshot.api_spend).toBe(3.5);
    expect(calls).toBeGreaterThan(1);
  });

  it("maps command timeout to bounded timeout error", async () => {
    const adapter = createProviderQuotaAdapters({
      runCommand: async () => await new Promise(() => undefined),
      commands,
      timeoutMs: 1
    }).codex_cli;
    const snapshot = await adapter.fetchSnapshot({ now, signal });
    expect(snapshot.error_code).toBe("timeout");
    expect(snapshot.health).toBe("unavailable");
  });

  it("maps malformed CLI output", async () => {
    const snapshot = await createProviderQuotaAdapters({ runCommand: runnerFor("not-json"), commands }).claude_cli.fetchSnapshot({ now, signal });
    expect(snapshot.error_code).toBe("malformed_response");
  });

  it("rejects oversized injected CLI output before parsing", async () => {
    const snapshot = await createProviderQuotaAdapters({ runCommand: runnerFor("x".repeat(128 * 1024 + 1), 0), commands }).codex_cli.fetchSnapshot({ now, signal });
    expect(snapshot.error_code).toBe("malformed_response");
  });

  it("maps missing OpenRouter credential", async () => {
    const snapshot = await createProviderQuotaAdapters({ runCommand: runnerFor(""), environment: {} }).openrouter_api.fetchSnapshot({ now, signal });
    expect(snapshot.error_code).toBe("missing_credential");
  });

  it("aborts a hanging OpenRouter credits probe", async () => {
    const snapshot = await createProviderQuotaAdapters({
      runCommand: runnerFor(""),
      timeoutMs: 1,
      environment: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl: async (url) => url.endsWith("/credits")
        ? await new Promise<never>(() => undefined)
        : { ok: true, status: 200, text: async () => JSON.stringify({ data: { endpoints: [] } }) }
    }).openrouter_api.fetchSnapshot({ now, signal });
    expect(snapshot.error_code).toBe("timeout");
  });

  it("propagates caller abort during OpenRouter credits", async () => {
    const caller = new AbortController();
    const snapshotPromise = createProviderQuotaAdapters({
      runCommand: runnerFor(""),
      timeoutMs: 1000,
      environment: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl: async (url) => url.endsWith("/credits")
        ? await new Promise<never>(() => undefined)
        : { ok: true, status: 200, text: async () => JSON.stringify({ data: { endpoints: [] } }) }
    }).openrouter_api.fetchSnapshot({ now, signal: caller.signal });
    setTimeout(() => caller.abort(), 1);
    const snapshot = await snapshotPromise;
    expect(snapshot.error_code).toBe("timeout");
  });

  it("maps unavailable subscription quota", async () => {
    const snapshot = await createProviderQuotaAdapters({ runCommand: runnerFor(JSON.stringify({ status: "unavailable" })), commands }).agy_cli.fetchSnapshot({ now, signal });
    expect(snapshot.error_code).toBe("provider_unavailable");
    expect(snapshot.health).toBe("unavailable");
  });

  it("uses only the built-in tmux usage capability when explicitly enabled", async () => {
    const snapshot = await createProviderQuotaAdapters({
      runCommand: runnerFor(""),
      commands: usageCommands,
      runUsageProbe: async (provider) => ({ stdout: provider === "codex_cli" ? payload : "", stderr: "", exitCode: 0 })
    }).codex_cli.fetchSnapshot({ now, signal });
    expect(snapshot.five_hour.remaining).toBe(75);
    expect(snapshot.error_code).toBeNull();
  });

  it("preserves a built-in probe missing-credential result", async () => {
    const snapshot = await createProviderQuotaAdapters({
      runCommand: runnerFor(""),
      commands: usageCommands,
      runUsageProbe: async () => ({ stdout: "", stderr: "missing_credential", exitCode: 1 })
    }).claude_cli.fetchSnapshot({ now, signal });
    expect(snapshot.error_code).toBe("missing_credential");
  });
});
