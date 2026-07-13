import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TokenBudget {
  readonly max_tokens: number;
  readonly used_tokens: number;
}

export function assertTokenBudget(input: { readonly estimatedTokens: number; readonly budget: TokenBudget }): void {
  if (!Number.isFinite(input.estimatedTokens) || input.estimatedTokens < 0) throw new Error("invalid_estimated_tokens");
  if (input.estimatedTokens + input.budget.used_tokens > input.budget.max_tokens) {
    throw new Error("token_budget_exceeded");
  }
}

export function remainingTokenBudget(budget: TokenBudget): number {
  return Math.max(0, budget.max_tokens - budget.used_tokens);
}

export type TokenGatewayRefusalCode =
  | "token_input_cap_exceeded"
  | "token_output_cap_exceeded"
  | "token_budget_exhausted"
  | "token_reservation_missing"
  | "token_route_mismatch"
  | "token_settlement_exceeds_reservation"
  | "token_reservation_limit";

export class TokenGatewayError extends Error {
  readonly code: TokenGatewayRefusalCode;

  constructor(code: TokenGatewayRefusalCode) {
    super(code);
    this.name = "TokenGatewayError";
    this.code = code;
  }
}

export interface TokenGatewayLimits {
  readonly inputCapTokens: number;
  readonly outputCapTokens: number;
  readonly providerBudgetTokens: number;
  readonly modelBudgetTokens: number;
  readonly sessionBudgetTokens: number;
}

export const DEFAULT_TOKEN_GATEWAY_LIMITS: TokenGatewayLimits = {
  inputCapTokens: 128_000,
  outputCapTokens: 16_000,
  providerBudgetTokens: 1_000_000,
  modelBudgetTokens: 500_000,
  sessionBudgetTokens: 500_000
};

export interface TokenGatewayRoute {
  readonly provider: string;
  readonly model: string | null;
  readonly sessionId: string | null;
}

export interface TokenReservationRequest extends TokenGatewayRoute {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly handoffId?: string;
}

export interface TokenReservation extends TokenReservationRequest {
  readonly reservationId: string;
  readonly reservedAt: string;
  readonly totalTokens: number;
}

export interface TokenSettlement {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly released?: boolean;
}

export interface TokenGatewayTelemetry {
  readonly schema_version: "v1";
  readonly event: "reserved" | "settled" | "released" | "refused";
  readonly recorded_at: string;
  readonly reservation_id: string | null;
  readonly handoff_id: string | null;
  readonly provider: string;
  readonly model: string | null;
  readonly session_id: string | null;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly reason: TokenGatewayRefusalCode | null;
}

interface GatewayState {
  readonly used: Record<string, number>;
  readonly reservations: Record<string, TokenReservation>;
  readonly terminal: Record<string, { readonly event: "settled" | "released"; readonly settlement: TokenSettlement; readonly completedAt: string }>;
}

const STATE_FILE = "token-gateway-state.json";
const TELEMETRY_FILE = "token-gateway-telemetry.jsonl";
const MAX_TELEMETRY_LINES = 512;
const MAX_FIELD_LENGTH = 128;
const MAX_ACTIVE_RESERVATIONS = 512;
const MAX_TERMINAL_RESERVATIONS = 1024;
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_USAGE_KEYS = MAX_ACTIVE_RESERVATIONS * 3;

/**
 * The single pre-dispatch token gate. Reservations are bound to one provider,
 * model and session and must be settled with the same route; callers cannot
 * silently switch providers while a task is in flight.
 */
export class TokenGateway {
  private readonly statePath: string;
  private readonly telemetryPath: string;
  private readonly limits: TokenGatewayLimits;
  private state: GatewayState;

  constructor(options: { readonly stateDir?: string; readonly limits?: Partial<TokenGatewayLimits> } = {}) {
    const stateDir = options.stateDir ?? ".autopilot-state";
    mkdirSync(stateDir, { recursive: true });
    this.statePath = join(stateDir, STATE_FILE);
    this.telemetryPath = join(stateDir, TELEMETRY_FILE);
    this.limits = { ...DEFAULT_TOKEN_GATEWAY_LIMITS, ...(options.limits ?? {}) };
    this.state = this.loadState();
  }

  reserve(input: TokenReservationRequest): TokenReservation {
    const request = normalizeRequest(input);
    if (request.handoffId !== undefined) {
      const existing = Object.values(this.state.reservations).find((reservation) => reservation.handoffId === request.handoffId);
      if (existing !== undefined) {
        if (existing.provider !== request.provider || existing.model !== request.model || existing.sessionId !== request.sessionId || existing.inputTokens !== request.inputTokens || existing.outputTokens !== request.outputTokens) throw new TokenGatewayError("token_route_mismatch");
        return existing;
      }
    }
    if (Object.keys(this.state.reservations).length >= MAX_ACTIVE_RESERVATIONS) throw this.refuse(request, "token_reservation_limit");
    const routeKeys = [`provider:${request.provider}`, `model:${request.provider}:${request.model ?? "default"}`, `session:${request.sessionId ?? "unscoped"}`];
    const newUsageKeys = routeKeys.filter((key) => this.state.used[key] === undefined).length;
    if (Object.keys(this.state.used).length + newUsageKeys > MAX_USAGE_KEYS) throw this.refuse(request, "token_reservation_limit");
    if (request.inputTokens > this.limits.inputCapTokens) throw this.refuse(request, "token_input_cap_exceeded");
    if (request.outputTokens > this.limits.outputCapTokens) throw this.refuse(request, "token_output_cap_exceeded");
    const total = request.inputTokens + request.outputTokens;
    const providerUsed = this.used(`provider:${request.provider}`);
    const modelUsed = this.used(`model:${request.provider}:${request.model ?? "default"}`);
    const sessionUsed = this.used(`session:${request.sessionId ?? "unscoped"}`);
    if (
      providerUsed + total > this.limits.providerBudgetTokens ||
      modelUsed + total > this.limits.modelBudgetTokens ||
      sessionUsed + total > this.limits.sessionBudgetTokens
    ) {
      throw this.refuse(request, "token_budget_exhausted");
    }
    const reservation: TokenReservation = {
      ...request,
      reservationId: `tgr-${randomUUID()}`,
      reservedAt: new Date().toISOString(),
      totalTokens: total
    };
    this.state.reservations[reservation.reservationId] = reservation;
    this.addUsage(reservation, total);
    this.persist();
    this.record({ event: "reserved", reservation, inputTokens: request.inputTokens, outputTokens: request.outputTokens, reason: null });
    return reservation;
  }

  settle(reservation: TokenReservation, usage: TokenSettlement): TokenSettlement {
    const active = this.state.reservations[reservation.reservationId];
    if (!active) {
      const terminal = this.state.terminal[reservation.reservationId];
      if (terminal?.event === "settled") return terminal.settlement;
      throw new TokenGatewayError("token_reservation_missing");
    }
    assertRoute(active, reservation);
    const inputTokens = safeCount(usage.inputTokens);
    const outputTokens = safeCount(usage.outputTokens);
    if (inputTokens > this.limits.inputCapTokens) throw new TokenGatewayError("token_input_cap_exceeded");
    if (outputTokens > this.limits.outputCapTokens) throw new TokenGatewayError("token_output_cap_exceeded");
    const actualTotal = inputTokens + outputTokens;
    if (actualTotal > active.totalTokens) throw new TokenGatewayError("token_settlement_exceeds_reservation");
    const routes = [`provider:${active.provider}`, `model:${active.provider}:${active.model ?? "default"}`, `session:${active.sessionId ?? "unscoped"}`] as const;
    const caps = [this.limits.providerBudgetTokens, this.limits.modelBudgetTokens, this.limits.sessionBudgetTokens] as const;
    if (routes.some((key, index) => this.used(key) - active.totalTokens + actualTotal > caps[index]!)) throw new TokenGatewayError("token_budget_exhausted");
    const settled = { inputTokens, outputTokens, released: usage.released === true };
    this.addUsage(active, -(active.totalTokens));
    this.addUsage(active, inputTokens + outputTokens);
    delete this.state.reservations[reservation.reservationId];
    this.state.terminal[reservation.reservationId] = { event: "settled", settlement: settled, completedAt: new Date().toISOString() };
    this.pruneTerminal();
    this.persist();
    this.record({ event: "settled", reservation: active, ...settled, reason: null });
    return settled;
  }

  release(reservation: TokenReservation): void {
    const active = this.state.reservations[reservation.reservationId];
    if (!active) {
      if (this.state.terminal[reservation.reservationId] !== undefined) return;
      throw new TokenGatewayError("token_reservation_missing");
    }
    assertRoute(active, reservation);
    this.addUsage(active, -active.totalTokens);
    delete this.state.reservations[reservation.reservationId];
    this.state.terminal[reservation.reservationId] = { event: "released", settlement: { inputTokens: 0, outputTokens: 0, released: true }, completedAt: new Date().toISOString() };
    this.pruneTerminal();
    this.persist();
    this.record({ event: "released", reservation: active, inputTokens: 0, outputTokens: 0, reason: null });
  }

  snapshot(): { readonly used: Readonly<Record<string, number>>; readonly activeReservations: number } {
    return { used: { ...this.state.used }, activeReservations: Object.keys(this.state.reservations).length };
  }

  findActiveReservation(handoffId: string): TokenReservation | null {
    return Object.values(this.state.reservations).find((reservation) => reservation.handoffId === handoffId) ?? null;
  }

  acknowledgeTerminal(reservationId: string): void {
    if (this.state.terminal[reservationId] === undefined) return;
    delete this.state.terminal[reservationId];
    this.persist();
  }

  private used(key: string): number { return this.state.used[key] ?? 0; }

  private addUsage(reservation: TokenReservation, amount: number): void {
    for (const key of [`provider:${reservation.provider}`, `model:${reservation.provider}:${reservation.model ?? "default"}`, `session:${reservation.sessionId ?? "unscoped"}`]) {
      const usage = Math.max(0, (this.state.used[key] ?? 0) + amount);
      if (usage === 0) delete this.state.used[key]; else this.state.used[key] = usage;
    }
  }

  private refuse(request: TokenReservationRequest, reason: TokenGatewayRefusalCode): TokenGatewayError {
    this.record({ event: "refused", reservation: request, inputTokens: request.inputTokens, outputTokens: request.outputTokens, reason });
    return new TokenGatewayError(reason);
  }

  private loadState(): GatewayState {
    if (!existsSync(this.statePath)) return { used: {}, reservations: {}, terminal: {} };
    if (statSync(this.statePath).size > MAX_STATE_BYTES) throw new Error("invalid_token_gateway_state");
    let parsed: Partial<GatewayState>;
    try { parsed = JSON.parse(readFileSync(this.statePath, "utf8")) as Partial<GatewayState>; }
    catch { throw new Error("invalid_token_gateway_state"); }
    if (typeof parsed.used !== "object" || parsed.used === null || typeof parsed.reservations !== "object" || parsed.reservations === null || typeof parsed.terminal !== "object" || parsed.terminal === null ||
      Object.keys(parsed.used).length > MAX_USAGE_KEYS || Object.keys(parsed.reservations).length > MAX_ACTIVE_RESERVATIONS || Object.keys(parsed.terminal).length > MAX_TERMINAL_RESERVATIONS) throw new Error("invalid_token_gateway_state");
    const terminal = Object.fromEntries(Object.entries(parsed.terminal).map(([id, value]) => [id, { ...value, completedAt: value.completedAt ?? "1970-01-01T00:00:00.000Z" }]));
    return { used: parsed.used, reservations: parsed.reservations, terminal };
  }

  private persist(): void {
    const serialized = JSON.stringify(this.state);
    if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) throw new Error("token_gateway_state_limit");
    writeFileSync(this.statePath, serialized, { mode: 0o600 });
  }

  private pruneTerminal(): void {
    const entries = Object.entries(this.state.terminal).sort(([leftId, left], [rightId, right]) => left.completedAt.localeCompare(right.completedAt) || leftId.localeCompare(rightId));
    for (const [reservationId] of entries.slice(0, Math.max(0, entries.length - MAX_TERMINAL_RESERVATIONS))) delete this.state.terminal[reservationId];
  }

  private record(input: { readonly event: TokenGatewayTelemetry["event"]; readonly reservation: TokenGatewayRoute & { readonly reservationId?: string; readonly handoffId?: string }; readonly inputTokens: number; readonly outputTokens: number; readonly reason: TokenGatewayRefusalCode | null }): void {
    const record: TokenGatewayTelemetry = {
      schema_version: "v1",
      event: input.event,
      recorded_at: new Date().toISOString(),
      reservation_id: bounded(input.reservation.reservationId ?? null),
      handoff_id: bounded(input.reservation.handoffId ?? null),
      provider: bounded(input.reservation.provider) ?? "unknown",
      model: bounded(input.reservation.model),
      session_id: bounded(input.reservation.sessionId),
      input_tokens: safeCount(input.inputTokens),
      output_tokens: safeCount(input.outputTokens),
      total_tokens: safeCount(input.inputTokens) + safeCount(input.outputTokens),
      reason: input.reason
    };
    try {
      const lines = existsSync(this.telemetryPath) ? readFileSync(this.telemetryPath, "utf8").trim().split("\n").filter(Boolean) : [];
      lines.push(JSON.stringify(record));
      writeFileSync(this.telemetryPath, `${lines.slice(-MAX_TELEMETRY_LINES).join("\n")}\n`, { mode: 0o600 });
    } catch { /* telemetry is best effort and must never bypass the gate */ }
  }
}

export function estimateTokenCount(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

function normalizeRequest(input: TokenReservationRequest): TokenReservationRequest {
  return {
    provider: bounded(input.provider) ?? "unknown",
    model: bounded(input.model),
    sessionId: bounded(input.sessionId),
    inputTokens: safeCount(input.inputTokens),
    outputTokens: safeCount(input.outputTokens),
    ...(input.handoffId === undefined ? {} : { handoffId: bounded(input.handoffId) ?? "unknown" })
  };
}

function assertRoute(active: TokenReservation, next: TokenReservation): void {
  if (active.provider !== next.provider || active.model !== next.model || active.sessionId !== next.sessionId) throw new TokenGatewayError("token_route_mismatch");
}

function safeCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function bounded(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const clean = value.replace(/[\r\n\t]/g, " ").slice(0, MAX_FIELD_LENGTH);
  return clean.length > 0 ? clean : null;
}
