import { describe, expect, it, vi } from "vitest";

import {
  createProviderQuotaScheduler,
  type ProviderQuotaClock
} from "../../src/data/delivery-system/providerQuotaScheduler";
import type { ProviderQuotaAdapter, ProviderSnapshot } from "../../src/data/delivery-system/providerQuota";
import type { SessionRegistryRecord } from "../../src/data/delivery-system/sessionRegistry";
import type { ProviderQuotaStoreDocument } from "../../src/data/delivery-system/providerQuotaStore";

const start = "2026-07-11T12:00:00.000Z";
async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function session(provider: string, status: "active" | "closed" = "active"): SessionRegistryRecord {
  return {
    schema_version: "v1", session_id: `${provider}-session`, agent_command: provider, cwd: "/tmp/project",
    name: null, status, created_at: start, updated_at: start, owner_expires_at: null, queue: []
  };
}

function snapshot(provider: string, now: string): ProviderSnapshot {
  return {
    provider, source: "cli", fetched_at: now, observed_at: now,
    five_hour: { limit: null, used: null, remaining: null, resets_at: null },
    weekly: { limit: null, used: null, remaining: null, resets_at: null },
    api_spend: null, currency: null, models: [], health: "healthy", error_code: null
  };
}

class FakeClock implements ProviderQuotaClock {
  private current = Date.parse(start);
  private nextId = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  now = () => new Date(this.current).toISOString();
  setTimeout = (callback: () => void, delayMs: number) => {
    const id = ++this.nextId;
    this.timers.set(id, { at: this.current + delayMs, callback });
    return id;
  };
  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
  async advance(ms: number): Promise<void> {
    this.current += ms;
    while (true) {
      const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= this.current).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      due[1].callback();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    await flush();
    await flush();
    await Promise.resolve();
  }
}

function persistence() {
  let document: ProviderQuotaStoreDocument = { schema_version: "v1", snapshots: [] };
  const events: unknown[] = [];
  return {
    read: () => document,
    write: (next: ProviderQuotaStoreDocument) => { document = next; },
    appendEvent: (event: unknown) => { events.push(event); },
    get document() { return document; },
    get events() { return events; }
  };
}

describe("provider quota scheduler", () => {
  it("polls active providers immediately and deduplicates sessions", async () => {
    const clock = new FakeClock();
    const store = persistence();
    const calls: string[] = [];
    const adapters = { codex_cli: { provider: "codex_cli", fetchSnapshot: async ({ now }: { now: string }) => { calls.push(now); return snapshot("codex_cli", now); } } satisfies ProviderQuotaAdapter };
    const sessions = [session("codex_cli"), { ...session("codex_cli"), session_id: "second" }];
    const scheduler = createProviderQuotaScheduler({ sessions, adapters, clock, store });
    scheduler.start();
    await flush();
    expect(calls).toHaveLength(1);
    expect(store.document.snapshots).toHaveLength(1);
  });

  it("polls a provider activated after start", async () => {
    const clock = new FakeClock();
    const store = persistence();
    const sessions: SessionRegistryRecord[] = [];
    let calls = 0;
    const scheduler = createProviderQuotaScheduler({
      sessions,
      adapters: { codex_cli: { provider: "codex_cli", fetchSnapshot: async ({ now }) => { calls += 1; return snapshot("codex_cli", now); } } },
      clock, store
    });
    scheduler.start();
    sessions.push(session("codex_cli"));
    await clock.advance(1000);
    expect(calls).toBe(1);
  });

  it("does not poll an expired active session", async () => {
    const clock = new FakeClock();
    const store = persistence();
    let calls = 0;
    const expired = { ...session("codex_cli"), owner_expires_at: "2026-07-11T11:59:00.000Z" };
    const scheduler = createProviderQuotaScheduler({
      sessions: [expired],
      adapters: { codex_cli: { provider: "codex_cli", fetchSnapshot: async ({ now }) => { calls += 1; return snapshot("codex_cli", now); } } },
      clock, store
    });
    scheduler.start();
    await flush();
    expect(calls).toBe(0);
  });

  it("polls again after five minutes and stops after the last session closes", async () => {
    const clock = new FakeClock();
    const store = persistence();
    const calls: string[] = [];
    const adapters = { claude_cli: { provider: "claude_cli", fetchSnapshot: async ({ now }: { now: string }) => { calls.push(now); return snapshot("claude_cli", now); } } satisfies ProviderQuotaAdapter };
    const sessions = [session("claude_cli")];
    const scheduler = createProviderQuotaScheduler({ sessions, adapters, clock, store });
    scheduler.start(); await flush();
    await clock.advance(5 * 60 * 1000); expect(calls).toHaveLength(2);
    sessions[0] = { ...sessions[0]!, status: "closed" };
    await clock.advance(5 * 60 * 1000); expect(calls).toHaveLength(2);
  });

  it("does not overlap an in-flight poll and aborts it on stop", async () => {
    const clock = new FakeClock();
    const store = persistence();
    let resolve: ((value: ProviderSnapshot) => void) | undefined;
    let aborted = false;
    const adapter: ProviderQuotaAdapter = { provider: "agy_cli", fetchSnapshot: ({ signal }) => new Promise((done) => { resolve = done; signal.addEventListener("abort", () => { aborted = true; }, { once: true }); }) };
    const scheduler = createProviderQuotaScheduler({ sessions: [session("agy_cli")], adapters: { agy_cli: adapter }, clock, store });
    scheduler.start();
    await clock.advance(5 * 60 * 1000);
    expect(resolve).toBeDefined();
    scheduler.stop();
    expect(aborted).toBe(true);
    resolve?.(snapshot("agy_cli", clock.now()));
  });

  it("does not persist a result after the last session closes in-flight", async () => {
    const clock = new FakeClock();
    const store = persistence();
    const sessions = [session("agy_cli")];
    let resolve: ((value: ProviderSnapshot) => void) | undefined;
    const adapter: ProviderQuotaAdapter = { provider: "agy_cli", fetchSnapshot: ({ signal }) => new Promise((done) => { resolve = done; signal.addEventListener("abort", () => undefined, { once: true }); }) };
    const scheduler = createProviderQuotaScheduler({ sessions, adapters: { agy_cli: adapter }, clock, store });
    scheduler.start();
    sessions[0] = { ...sessions[0]!, status: "closed" };
    scheduler.refresh();
    resolve?.(snapshot("agy_cli", clock.now()));
    await flush();
    expect(store.document.snapshots).toHaveLength(0);
  });

  it("records adapter rejection and schedules a retry", async () => {
    const clock = new FakeClock();
    const store = persistence();
    const scheduler = createProviderQuotaScheduler({
      sessions: [session("codex_cli")],
      adapters: { codex_cli: { provider: "codex_cli", fetchSnapshot: async () => { throw new Error("provider_unavailable"); } } },
      clock, store
    });
    scheduler.start();
    await flush();
    expect(store.document.snapshots[0]?.error_code).toBe("provider_unavailable");
    expect(store.events).toHaveLength(1);
  });

  it("reports only the first provider failure until a success resets the transition", async () => {
    const clock = new FakeClock();
    const store = persistence();
    const onPollFailure = vi.fn();
    let attempt = 0;
    const scheduler = createProviderQuotaScheduler({
      sessions: [session("codex_cli")],
      adapters: {
        codex_cli: {
          provider: "codex_cli",
          fetchSnapshot: async ({ now }) => {
            attempt += 1;
            if (attempt === 3) return snapshot("codex_cli", now);
            throw new Error("provider_unavailable injected-secret");
          }
        }
      },
      clock,
      store,
      onPollFailure
    });

    scheduler.start();
    await flush();
    await clock.advance(60_000);
    await clock.advance(120_000);

    expect(onPollFailure).toHaveBeenCalledTimes(1);

    await clock.advance(300_000);

    expect(onPollFailure).toHaveBeenCalledTimes(2);
    expect(onPollFailure).toHaveBeenCalledWith({ provider: "codex_cli", error_code: "provider_unavailable" });
    expect(JSON.stringify(onPollFailure.mock.calls)).not.toContain("injected-secret");
  });

  it("times out a hung adapter and records a bounded timeout", async () => {
    const clock = new FakeClock();
    const store = persistence();
    const scheduler = createProviderQuotaScheduler({
      sessions: [session("codex_cli")],
      adapters: { codex_cli: { provider: "codex_cli", fetchSnapshot: async () => await new Promise<ProviderSnapshot>(() => undefined) } },
      clock, store, pollTimeoutMs: 1000
    });
    scheduler.start();
    await clock.advance(1000);
    await Promise.resolve();
    expect(store.document.snapshots[0]?.error_code).toBe("timeout");
  });

  it("backs off failures and caps the delay at thirty minutes", async () => {
    const clock = new FakeClock();
    const store = persistence();
    let calls = 0;
    const adapter: ProviderQuotaAdapter = { provider: "openrouter_api", fetchSnapshot: async ({ now }) => { calls += 1; return { ...snapshot("openrouter_api", now), health: "unavailable", error_code: "provider_error" }; } };
    const scheduler = createProviderQuotaScheduler({ sessions: [session("openrouter_api")], adapters: { openrouter_api: adapter }, clock, store });
    scheduler.start(); await flush();
    for (const delay of [60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000]) {
      await clock.advance(delay);
    }
    expect(calls).toBe(7);
  });
});
