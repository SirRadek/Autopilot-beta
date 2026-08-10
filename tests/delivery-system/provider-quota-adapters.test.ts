import { describe, expect, it, vi } from "vitest";

import {
  createProviderQuotaAdapters,
  type ProviderCommandResult,
  type ProviderCommandRunner
} from "../../src/data/delivery-system/providerQuotaAdapters";

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
  codex_cli: { kind: "tmux_usage" as const, executable: "/provider-bin/codex" },
  claude_cli: { kind: "tmux_usage" as const, executable: "/provider-bin/claude" },
  agy_cli: { kind: "tmux_usage" as const, executable: "/provider-bin/agy" }
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
      { model_id: "gpt-5.6-sol", available: true, health: "healthy", source: "cli", discovery: "usage_probe" }
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
    let invocation: { readonly executable: string; readonly signal: AbortSignal } | undefined;
    const snapshot = await createProviderQuotaAdapters({
      runCommand: runnerFor(""),
      commands: usageCommands,
      runUsageProbe: async (provider, executable, forwardedSignal) => {
        invocation = { executable, signal: forwardedSignal };
        return { stdout: provider === "codex_cli" ? payload : "", stderr: "", exitCode: 0 };
      }
    }).codex_cli.fetchSnapshot({ now, signal });
    expect(snapshot.five_hour.remaining).toBe(75);
    expect(snapshot.error_code).toBeNull();
    expect(invocation).toEqual({ executable: "/provider-bin/codex", signal: expect.any(AbortSignal) });
  });

  it("preserves a built-in probe missing-credential result", async () => {
    const snapshot = await createProviderQuotaAdapters({
      runCommand: runnerFor(""),
      commands: usageCommands,
      runUsageProbe: async () => ({ stdout: "", stderr: "missing_credential", exitCode: 1 })
    }).claude_cli.fetchSnapshot({ now, signal });
    expect(snapshot.error_code).toBe("missing_credential");
  });

  it("preserves the built-in probe quota_not_applicable result for API-billing Claude accounts", async () => {
    const snapshot = await createProviderQuotaAdapters({
      runCommand: runnerFor(""),
      commands: usageCommands,
      runUsageProbe: async () => ({ stdout: "", stderr: "quota_not_applicable", exitCode: 1 })
    }).claude_cli.fetchSnapshot({ now, signal });

    expect(snapshot.health).toBe("unavailable");
    expect(snapshot.error_code).toBe("quota_not_applicable");
    expect(snapshot.five_hour).toEqual({ limit: null, used: null, remaining: null, resets_at: null });
    expect(snapshot.weekly).toEqual({ limit: null, used: null, remaining: null, resets_at: null });
  });

  it.each(["provider_executable_missing", "provider_runtime_denied", "malformed_response"] as const)("preserves the fixed built-in probe error %s", async (errorCode) => {
    const snapshot = await createProviderQuotaAdapters({
      runCommand: runnerFor(""),
      commands: usageCommands,
      runUsageProbe: async () => ({ stdout: "", stderr: errorCode, exitCode: 1 })
    }).agy_cli.fetchSnapshot({ now, signal });

    expect(snapshot.health).toBe("unavailable");
    expect(snapshot.error_code).toBe(errorCode);
    expect(JSON.stringify(snapshot)).not.toContain("/provider-bin/agy");
  });

  it("propagates only the allowlisted probe failure phase and attempts", async () => {
    const privateAccount = "probe-owner@example.invalid";
    const privateSession = "00000000-0000-4000-8000-000000000001";
    const privateStderr = `raw failure for ${privateAccount}, session ${privateSession}`;
    const snapshot = await createProviderQuotaAdapters({
      runCommand: runnerFor(""),
      commands: usageCommands,
      runUsageProbe: async () => ({
        stdout: "",
        stderr: privateStderr,
        exitCode: 1,
        probe_failure: {
          phase: "render",
          attempts: 4,
          stderr: privateStderr,
          account: privateAccount,
          session: privateSession
        }
      } as unknown as ProviderCommandResult)
    }).codex_cli.fetchSnapshot({ now, signal });

    expect(snapshot.probe_failure).toEqual({ phase: "render", attempts: 4 });
    expect(snapshot.error_code).toBe("provider_error");
    expect(JSON.stringify(snapshot)).not.toContain(privateStderr);
    expect(JSON.stringify(snapshot)).not.toContain(privateAccount);
    expect(JSON.stringify(snapshot)).not.toContain(privateSession);
  });

  it("waits for bounded probe cleanup and preserves its phase after the adapter timeout", async () => {
    let cleanupSettled = false;
    const snapshotPromise = createProviderQuotaAdapters({
      runCommand: runnerFor(""),
      commands: usageCommands,
      timeoutMs: 1,
      runUsageProbe: async (_provider, _executable, probeSignal) => await new Promise<ProviderCommandResult>((resolve) => {
        probeSignal.addEventListener("abort", () => {
          cleanupSettled = true;
          resolve({
            stdout: "",
            stderr: "timeout",
            exitCode: 1,
            probe_failure: { phase: "readiness", attempts: 25 }
          });
        }, { once: true });
      })
    }).codex_cli.fetchSnapshot({ now, signal });

    const snapshot = await snapshotPromise;

    expect(cleanupSettled).toBe(true);
    expect(snapshot.error_code).toBe("timeout");
    expect(snapshot.probe_failure).toEqual({ phase: "readiness", attempts: 25 });
  });

  it("forwards caller abort to a built-in probe without leaking its stderr", async () => {
    const caller = new AbortController();
    let forwardedSignal: AbortSignal | undefined;
    const snapshotPromise = createProviderQuotaAdapters({
      runCommand: runnerFor(""),
      commands: usageCommands,
      timeoutMs: 1_000,
      runUsageProbe: async (_provider, _executable, probeSignal) => {
        forwardedSignal = probeSignal;
        await new Promise<void>((resolve) => {
          if (probeSignal.aborted) resolve();
          else probeSignal.addEventListener("abort", () => resolve(), { once: true });
        });
        return { stdout: "", stderr: "raw provider stderr", exitCode: 1 };
      }
    }).codex_cli.fetchSnapshot({ now, signal: caller.signal });

    caller.abort();
    const snapshot = await snapshotPromise;

    expect(forwardedSignal?.aborted).toBe(true);
    expect(snapshot.error_code).toBe("timeout");
    expect(JSON.stringify(snapshot)).not.toContain("raw provider stderr");
  });

  it("preserves an unavailable executable capability without invoking a provider", async () => {
    const runCommand = vi.fn(runnerFor(payload));
    const runUsageProbe = vi.fn(async () => ({ stdout: payload, stderr: "", exitCode: 0 }));
    const snapshot = await createProviderQuotaAdapters({
      runCommand,
      commands: {
        codex_cli: { kind: "unavailable", error_code: "provider_executable_missing" }
      },
      runUsageProbe
    }).codex_cli.fetchSnapshot({ now, signal });

    expect(snapshot.health).toBe("unavailable");
    expect(snapshot.error_code).toBe("provider_executable_missing");
    expect(runCommand).not.toHaveBeenCalled();
    expect(runUsageProbe).not.toHaveBeenCalled();
  });
});
