import { isSessionOwnerExpired, type SessionRegistryRecord } from "./sessionRegistry";
import {
  normalizeProviderError,
  normalizeQuotaWindow,
  type ProviderErrorCode,
  type ProviderQuotaAdapter,
  type ProviderSnapshot
} from "./providerQuota";
import {
  appendProviderQuotaEvent,
  readProviderQuotaStore,
  type ProviderQuotaEvent,
  type ProviderQuotaStoreDocument,
  writeProviderQuotaStore
} from "./providerQuotaStore";

export interface ProviderQuotaClock {
  readonly now: () => string;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface ProviderQuotaPersistence {
  readonly read: () => ProviderQuotaStoreDocument;
  readonly write: (document: ProviderQuotaStoreDocument) => void;
  readonly appendEvent: (event: ProviderQuotaEvent) => void;
}

export interface ProviderQuotaSchedulerOptions {
  readonly sessions: readonly SessionRegistryRecord[] | (() => readonly SessionRegistryRecord[]);
  readonly adapters: Readonly<Record<string, ProviderQuotaAdapter>>;
  /** Registered probe capabilities; defaults to the explicitly supplied adapter keys. */
  readonly leaseProviders?: readonly string[];
  readonly clock?: ProviderQuotaClock;
  readonly store: ProviderQuotaPersistence | { readonly stateDir: string };
  readonly pollTimeoutMs?: number;
  readonly onPollFailure?: (failure: { readonly provider: string; readonly error_code: ProviderErrorCode }) => void;
}

export interface ProviderProbeLeaseResult {
  readonly accepted: readonly string[];
  readonly rejected: readonly string[];
  readonly expires_at: string;
}

export interface ProviderProbeLeaseState {
  readonly leased: boolean;
  readonly expires_at: string | null;
}

const SUCCESS_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_BACKOFF_MS = 60 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
const RECONCILE_INTERVAL_MS = 1000;
const PROBE_LEASE_TTL_MS = 10 * 60 * 1000;
const PROBE_LEASE_COOLDOWN_MS = 30 * 1000;

const systemClock: ProviderQuotaClock = {
  now: () => new Date().toISOString(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export class ProviderQuotaScheduler {
  private readonly sessions: () => readonly SessionRegistryRecord[];
  private readonly adapters: Readonly<Record<string, ProviderQuotaAdapter>>;
  private readonly leaseProviders: ReadonlySet<string>;
  private readonly clock: ProviderQuotaClock;
  private readonly store: ProviderQuotaPersistence;
  private readonly pollTimeoutMs: number;
  private readonly onPollFailure: ProviderQuotaSchedulerOptions["onPollFailure"];
  private readonly timers = new Map<string, unknown>();
  private readonly inFlight = new Map<string, AbortController>();
  private readonly failures = new Map<string, number>();
  /** Owner-requested demand is process-local; a scheduler restart cancels every lease. */
  private readonly leases = new Map<string, number>();
  private readonly leaseRequests = new Map<string, number>();
  private running = false;
  private reconcileTimer: unknown;

  constructor(options: ProviderQuotaSchedulerOptions) {
    const sessionSource = options.sessions;
    this.sessions = typeof sessionSource === "function" ? sessionSource : () => sessionSource;
    this.adapters = options.adapters;
    this.leaseProviders = new Set(options.leaseProviders ?? Object.keys(options.adapters));
    this.clock = options.clock ?? systemClock;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 30_000;
    this.onPollFailure = options.onPollFailure;
    const store = options.store;
    this.store = "stateDir" in store
      ? {
          read: () => readProviderQuotaStore(store.stateDir),
          write: (document: ProviderQuotaStoreDocument) => writeProviderQuotaStore(store.stateDir, document),
          appendEvent: (event: ProviderQuotaEvent) => appendProviderQuotaEvent(store.stateDir, event)
        }
      : store;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.reconcile();
    this.scheduleReconcile();
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) this.clock.clearTimeout(timer);
    this.timers.clear();
    if (this.reconcileTimer !== undefined) this.clock.clearTimeout(this.reconcileTimer);
    this.reconcileTimer = undefined;
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
    this.leases.clear();
    this.leaseRequests.clear();
  }

  private reconcile(): void {
    if (!this.running) return;
    const active = this.activeProviders();
    for (const [provider, controller] of this.inFlight) {
      if (!active.has(provider)) controller.abort();
    }
    for (const [provider, timer] of this.timers) {
      if (!active.has(provider)) {
        this.clock.clearTimeout(timer);
        this.timers.delete(provider);
      }
    }
    for (const provider of active) {
      if (!this.timers.has(provider) && !this.inFlight.has(provider)) void this.poll(provider);
    }
  }

  /** Re-evaluates session and owner-lease demand after an external state update. */
  reconcileDemand(): void {
    this.reconcile();
  }

  requestProbeLease(
    providers: readonly string[],
    ttlMs = PROBE_LEASE_TTL_MS
  ): ProviderProbeLeaseResult {
    const nowEpoch = this.nowEpoch();
    const boundedTtlMs = Number.isFinite(ttlMs) && ttlMs > 0
      ? Math.min(Math.max(1, Math.floor(ttlMs)), PROBE_LEASE_TTL_MS)
      : PROBE_LEASE_TTL_MS;
    const expiresAtEpoch = nowEpoch + boundedTtlMs;
    const accepted: string[] = [];
    const rejected: string[] = [];
    const acceptedExpiries: number[] = [];
    const uniqueProviders = [...new Set(providers)];

    if (!this.running) {
      return {
        accepted,
        rejected: uniqueProviders,
        expires_at: new Date(expiresAtEpoch).toISOString()
      };
    }

    for (const provider of uniqueProviders) {
      const adapter = Object.prototype.hasOwnProperty.call(this.adapters, provider)
        ? this.adapters[provider]
        : undefined;
      const lastRequestAt = this.leaseRequests.get(provider);
      if (adapter === undefined || !this.leaseProviders.has(provider)
        || lastRequestAt !== undefined && nowEpoch - lastRequestAt < PROBE_LEASE_COOLDOWN_MS) {
        rejected.push(provider);
        continue;
      }
      this.leaseRequests.set(provider, nowEpoch);
      const actualExpiresAtEpoch = Math.max(this.leases.get(provider) ?? 0, expiresAtEpoch);
      this.leases.set(provider, actualExpiresAtEpoch);
      accepted.push(provider);
      acceptedExpiries.push(actualExpiresAtEpoch);
    }

    if (accepted.length > 0) this.reconcileDemand();
    const activeRejectedExpiries = accepted.length === 0
      ? rejected.flatMap((provider) => {
          const expiresAt = this.leases.get(provider);
          return expiresAt !== undefined && expiresAt > nowEpoch ? [expiresAt] : [];
        })
      : [];
    const actualExpiries = acceptedExpiries.length > 0 ? acceptedExpiries : activeRejectedExpiries;
    const responseExpiresAtEpoch = actualExpiries.length > 0
      ? Math.min(...actualExpiries)
      : expiresAtEpoch;
    return {
      accepted,
      rejected,
      expires_at: new Date(responseExpiresAtEpoch).toISOString()
    };
  }

  leaseState(provider: string): ProviderProbeLeaseState {
    const expiresAtEpoch = this.leases.get(provider);
    if (expiresAtEpoch === undefined || expiresAtEpoch <= this.nowEpoch()) {
      this.leases.delete(provider);
      return { leased: false, expires_at: null };
    }
    return { leased: true, expires_at: new Date(expiresAtEpoch).toISOString() };
  }

  private scheduleReconcile(): void {
    if (!this.running) return;
    this.reconcileTimer = this.clock.setTimeout(() => {
      this.reconcileTimer = undefined;
      this.reconcile();
      this.scheduleReconcile();
    }, RECONCILE_INTERVAL_MS);
  }

  private activeProviders(): Set<string> {
    const now = this.clock.now();
    const nowEpoch = this.parseEpoch(now);
    const active = new Set(this.sessions().filter((session) => session.status === "active" && !isSessionOwnerExpired(session, now)).map((session) => session.agent_command));
    for (const [provider, expiresAtEpoch] of this.leases) {
      if (expiresAtEpoch <= nowEpoch) this.leases.delete(provider);
      else active.add(provider);
    }
    for (const [provider, requestedAtEpoch] of this.leaseRequests) {
      if (nowEpoch - requestedAtEpoch >= PROBE_LEASE_COOLDOWN_MS) this.leaseRequests.delete(provider);
    }
    return active;
  }

  private nowEpoch(): number {
    return this.parseEpoch(this.clock.now());
  }

  private parseEpoch(value: string): number {
    const epoch = Date.parse(value);
    return Number.isFinite(epoch) ? epoch : Date.now();
  }

  private async poll(provider: string): Promise<void> {
    if (!this.running || !this.activeProviders().has(provider) || this.inFlight.has(provider)) return;
    const adapter = this.adapters[provider];
    if (!adapter) return;
    const controller = new AbortController();
    this.inFlight.set(provider, controller);
    const now = this.clock.now();
    let timeoutHandle: unknown;
    let timedOut = false;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = this.clock.setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error("timeout"));
        }, this.pollTimeoutMs);
      });
      const snapshot = await Promise.race([adapter.fetchSnapshot({ now, signal: controller.signal }), timeout]);
      if (!this.running || !this.activeProviders().has(provider)) return;
      this.persist(provider, snapshot);
      const failed = snapshot.health === "unavailable" || snapshot.error_code !== null;
      if (failed) {
        const failureCount = this.noteFailure(provider, snapshot.error_code ?? "provider_error");
        this.schedule(provider, Math.min(INITIAL_BACKOFF_MS * 2 ** (failureCount - 1), MAX_BACKOFF_MS));
      } else {
        this.failures.delete(provider);
        this.schedule(provider, SUCCESS_INTERVAL_MS);
      }
    } catch (error) {
      if (this.running && this.activeProviders().has(provider) && (timedOut || !controller.signal.aborted)) {
        const errorCode = normalizeProviderError(error);
        const failedSnapshot: ProviderSnapshot = {
          provider,
          source: provider === "openrouter_api" ? "api" : "cli",
          fetched_at: now,
          observed_at: now,
          five_hour: normalizeQuotaWindow({}),
          weekly: normalizeQuotaWindow({}),
          api_spend: null,
          currency: null,
          models: [],
          health: "unavailable",
          error_code: errorCode
        };
        this.persist(provider, failedSnapshot);
        const failureCount = this.noteFailure(provider, errorCode);
        this.schedule(provider, Math.min(INITIAL_BACKOFF_MS * 2 ** (failureCount - 1), MAX_BACKOFF_MS));
      }
    } finally {
      if (timeoutHandle !== undefined) this.clock.clearTimeout(timeoutHandle);
      this.inFlight.delete(provider);
    }
  }

  private noteFailure(provider: string, errorCode: ProviderErrorCode): number {
    const failureCount = (this.failures.get(provider) ?? 0) + 1;
    this.failures.set(provider, failureCount);
    if (failureCount === 1) {
      try {
        this.onPollFailure?.({ provider, error_code: errorCode });
      } catch {
        // Incident reporting must never interrupt quota scheduling.
      }
    }
    return failureCount;
  }

  private schedule(provider: string, delayMs: number): void {
    if (!this.running || !this.activeProviders().has(provider)) return;
    const timer = this.clock.setTimeout(() => {
      this.timers.delete(provider);
      void this.poll(provider);
    }, delayMs);
    this.timers.set(provider, timer);
  }

  private persist(provider: string, snapshot: ProviderSnapshot): void {
    const document = this.store.read();
    const previous = document.snapshots.find((candidate) => candidate.provider === provider);
    const snapshots = [...document.snapshots.filter((candidate) => candidate.provider !== provider), snapshot];
    this.store.write({ ...document, snapshots });
    const changedFields = previous === undefined
      ? ["snapshot"]
      : Object.keys(snapshot).filter((key) => JSON.stringify(snapshot[key as keyof ProviderSnapshot]) !== JSON.stringify(previous[key as keyof ProviderSnapshot]));
    this.store.appendEvent({
      provider,
      observed_at: snapshot.observed_at,
      status: snapshot.error_code === null ? "success" : "error",
      changed_fields: changedFields,
      error_code: snapshot.error_code
    });
  }
}

export function createProviderQuotaScheduler(options: ProviderQuotaSchedulerOptions): ProviderQuotaScheduler {
  return new ProviderQuotaScheduler(options);
}
