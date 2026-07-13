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
  readonly clock?: ProviderQuotaClock;
  readonly store: ProviderQuotaPersistence | { readonly stateDir: string };
  readonly pollTimeoutMs?: number;
  readonly onPollFailure?: (failure: { readonly provider: string; readonly error_code: ProviderErrorCode }) => void;
}

const SUCCESS_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_BACKOFF_MS = 60 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
const RECONCILE_INTERVAL_MS = 1000;

const systemClock: ProviderQuotaClock = {
  now: () => new Date().toISOString(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export class ProviderQuotaScheduler {
  private readonly sessions: () => readonly SessionRegistryRecord[];
  private readonly adapters: Readonly<Record<string, ProviderQuotaAdapter>>;
  private readonly clock: ProviderQuotaClock;
  private readonly store: ProviderQuotaPersistence;
  private readonly pollTimeoutMs: number;
  private readonly onPollFailure: ProviderQuotaSchedulerOptions["onPollFailure"];
  private readonly timers = new Map<string, unknown>();
  private readonly inFlight = new Map<string, AbortController>();
  private readonly failures = new Map<string, number>();
  private running = false;
  private reconcileTimer: unknown;

  constructor(options: ProviderQuotaSchedulerOptions) {
    const sessionSource = options.sessions;
    this.sessions = typeof sessionSource === "function" ? sessionSource : () => sessionSource;
    this.adapters = options.adapters;
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
    if (!this.running) return;
    this.running = false;
    for (const timer of this.timers.values()) this.clock.clearTimeout(timer);
    this.timers.clear();
    if (this.reconcileTimer !== undefined) this.clock.clearTimeout(this.reconcileTimer);
    this.reconcileTimer = undefined;
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
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

  /** Re-evaluates active sessions after a registry update. */
  refresh(): void {
    this.reconcile();
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
    return new Set(this.sessions().filter((session) => session.status === "active" && !isSessionOwnerExpired(session, now)).map((session) => session.agent_command));
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
