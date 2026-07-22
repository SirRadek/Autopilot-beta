import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { readManagedStateTextFile } from "./managedStateFile";
import { appendStateFile, withStateMaintenanceLock, writeStateFileAtomically } from "./stateMaintenanceLock";

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
  readonly groupId?: string;
  readonly slotId?: string;
  readonly heldTokens?: number;
}

export interface TokenGroupSlotRequest extends TokenGatewayRoute { readonly slotId: string; readonly holdTokens: number; }
export interface TokenGroupSlotReservation extends TokenGroupSlotRequest {
  readonly state: "reserved" | "claimed" | "settled" | "released";
  readonly reservation: TokenReservation | null;
}
export interface TokenGroupReservation { readonly groupId: string; readonly slots: readonly TokenGroupSlotReservation[]; readonly maximumTokens: number; }
export interface OrchestrationGroupSpec { readonly groupId: string; readonly slots: readonly TokenGroupSlotRequest[]; }

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
  used: Record<string, number>;
  readonly reservations: Record<string, TokenReservation>;
  readonly terminal: Record<string, { readonly event: "settled" | "released"; readonly settlement: TokenSettlement; readonly completedAt: string }>;
  readonly groups: Record<string, TokenGroupReservation>;
}

const STATE_FILE = "token-gateway-state.json";
const TELEMETRY_FILE = "token-gateway-telemetry.jsonl";
const MAX_TELEMETRY_LINES = 512;
const MAX_FIELD_LENGTH = 128;
const MAX_ACTIVE_RESERVATIONS = 512;
const MAX_TERMINAL_RESERVATIONS = 1024;
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_USAGE_KEYS = MAX_ACTIVE_RESERVATIONS * 3;

export function validateTokenGatewayState(stateDir: string): void {
  readGatewayState(join(stateDir, STATE_FILE));
}

/**
 * The single pre-dispatch token gate. Reservations are bound to one provider,
 * model and session and must be settled with the same route; callers cannot
 * silently switch providers while a task is in flight.
 */
export class TokenGateway {
  private readonly stateDir: string;
  private readonly statePath: string;
  private readonly telemetryPath: string;
  private readonly limits: TokenGatewayLimits;
  private state: GatewayState;

  constructor(options: { readonly stateDir?: string; readonly limits?: Partial<TokenGatewayLimits> } = {}) {
    const stateDir = options.stateDir ?? ".autopilot-state";
    mkdirSync(stateDir, { recursive: true });
    this.stateDir = stateDir;
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
    const activeGroupSlots = Object.values(this.state.groups).flatMap((group) => group.slots).filter((slot) => slot.state === "reserved" || slot.state === "claimed").length;
    const ordinaryReservations = Object.values(this.state.reservations).filter((reservation) => reservation.groupId === undefined).length;
    if (activeGroupSlots + ordinaryReservations >= MAX_ACTIVE_RESERVATIONS) throw this.refuse(request, "token_reservation_limit");
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

  reserveGroup(input: OrchestrationGroupSpec): TokenGroupReservation {
    const normalized = normalizeGroup(input);
    const existing = this.state.groups[normalized.groupId];
    if (existing !== undefined) {
      if (!sameGroupRequest(existing, normalized)) throw new Error("token_group_mismatch");
      return existing;
    }
    const activeGroupSlots = Object.values(this.state.groups).flatMap((group) => group.slots).filter((slot) => slot.state === "reserved" || slot.state === "claimed").length;
    const ordinaryReservations = Object.values(this.state.reservations).filter((reservation) => reservation.groupId === undefined).length;
    if (Object.keys(this.state.groups).length >= MAX_ACTIVE_RESERVATIONS || normalized.slots.length === 0 ||
      activeGroupSlots + ordinaryReservations + normalized.slots.length > MAX_ACTIVE_RESERVATIONS) throw new TokenGatewayError("token_reservation_limit");
    const candidate = { ...this.state.used };
    let maximumTokens = 0;
    for (const slot of normalized.slots) {
      maximumTokens += slot.holdTokens;
      if (!Number.isSafeInteger(maximumTokens)) throw new Error("token_group_mismatch");
      for (const [key, cap] of routeUsageKeys(slot).map((key, index) => [key, [this.limits.providerBudgetTokens, this.limits.modelBudgetTokens, this.limits.sessionBudgetTokens][index]!] as const)) {
        const next = (candidate[key] ?? 0) + slot.holdTokens;
        if (!Number.isSafeInteger(next) || next > cap) throw new TokenGatewayError("token_budget_exhausted");
        candidate[key] = next;
      }
    }
    if (Object.keys(candidate).length > MAX_USAGE_KEYS) throw new TokenGatewayError("token_reservation_limit");
    const reservation: TokenGroupReservation = { groupId: normalized.groupId, maximumTokens, slots: normalized.slots.map((slot) => ({ ...slot, state: "reserved", reservation: null })) };
    this.state.used = candidate;
    this.state.groups[reservation.groupId] = reservation;
    this.persist();
    return reservation;
  }

  findGroup(groupId: string): TokenGroupReservation | null { return this.state.groups[groupId] ?? null; }

  claimGroupSlot(groupId: string, slotId: string, input: TokenReservationRequest): TokenReservation {
    const group = this.state.groups[groupId];
    const index = group?.slots.findIndex((slot) => slot.slotId === slotId) ?? -1;
    if (group === undefined || index < 0) throw new Error("token_group_slot_missing");
    const slot = group.slots[index]!;
    const request = normalizeRequest(input);
    if (!isCanonicalRequest(input, request) || slot.provider !== request.provider || slot.model !== request.model || slot.sessionId !== request.sessionId || request.inputTokens + request.outputTokens > slot.holdTokens) throw new Error("token_group_slot_mismatch");
    if (slot.reservation !== null) {
      if (!sameReservationInput(slot.reservation, request)) throw new Error("token_group_slot_mismatch");
      return slot.reservation;
    }
    if (request.inputTokens > this.limits.inputCapTokens) throw new TokenGatewayError("token_input_cap_exceeded");
    if (request.outputTokens > this.limits.outputCapTokens) throw new TokenGatewayError("token_output_cap_exceeded");
    const reservation: TokenReservation = { ...request, reservationId: `tgr-${randomUUID()}`, reservedAt: new Date().toISOString(), totalTokens: request.inputTokens + request.outputTokens, groupId, slotId, heldTokens: slot.holdTokens };
    this.state.reservations[reservation.reservationId] = reservation;
    const slots = [...group.slots]; slots[index] = { ...slot, state: "claimed", reservation };
    this.state.groups[groupId] = { ...group, slots };
    this.persist();
    return reservation;
  }

  releaseGroupSlots(groupId: string, slotIds: readonly string[]): TokenGroupReservation {
    const group = this.state.groups[groupId];
    if (group === undefined) throw new Error("token_group_missing");
    const requested = new Set(slotIds);
    if (requested.size !== slotIds.length || slotIds.some((id) => !group.slots.some((slot) => slot.slotId === id))) throw new Error("token_group_slot_missing");
    const slots = group.slots.map((slot) => {
      if (!requested.has(slot.slotId) || slot.state === "released" || slot.state === "settled") return slot;
      if (slot.state === "claimed" && slot.reservation !== null) this.release(slot.reservation);
      else this.addRouteUsage(slot, -slot.holdTokens);
      return { ...slot, state: "released" as const };
    });
    this.state.groups[groupId] = { ...group, slots };
    this.persist();
    return this.state.groups[groupId]!;
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
    if (routes.some((key, index) => this.used(key) - (active.heldTokens ?? active.totalTokens) + actualTotal > caps[index]!)) throw new TokenGatewayError("token_budget_exhausted");
    const settled = { inputTokens, outputTokens, released: usage.released === true };
    this.addUsage(active, -(active.heldTokens ?? active.totalTokens));
    this.addUsage(active, inputTokens + outputTokens);
    delete this.state.reservations[reservation.reservationId];
    this.state.terminal[reservation.reservationId] = { event: "settled", settlement: settled, completedAt: new Date().toISOString() };
    this.updateGroupSlot(active, "settled");
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
    this.addUsage(active, -(active.heldTokens ?? active.totalTokens));
    delete this.state.reservations[reservation.reservationId];
    this.state.terminal[reservation.reservationId] = { event: "released", settlement: { inputTokens: 0, outputTokens: 0, released: true }, completedAt: new Date().toISOString() };
    this.updateGroupSlot(active, "released");
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

  private addRouteUsage(route: TokenGatewayRoute, amount: number): void {
    for (const key of routeUsageKeys(route)) { const usage = Math.max(0, (this.state.used[key] ?? 0) + amount); if (usage === 0) delete this.state.used[key]; else this.state.used[key] = usage; }
  }

  private updateGroupSlot(reservation: TokenReservation, state: "settled" | "released"): void {
    if (reservation.groupId === undefined || reservation.slotId === undefined) return;
    const group = this.state.groups[reservation.groupId]; if (group === undefined) return;
    this.state.groups[reservation.groupId] = { ...group, slots: group.slots.map((slot) => slot.slotId === reservation.slotId ? { ...slot, state } : slot) };
  }

  private refuse(request: TokenReservationRequest, reason: TokenGatewayRefusalCode): TokenGatewayError {
    this.record({ event: "refused", reservation: request, inputTokens: request.inputTokens, outputTokens: request.outputTokens, reason });
    return new TokenGatewayError(reason);
  }

  private loadState(): GatewayState {
    return readGatewayState(this.statePath);
  }

  private persist(): void {
    const serialized = JSON.stringify(this.state);
    if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) throw new Error("token_gateway_state_limit");
    writeStateFileAtomically(this.stateDir, this.statePath, serialized);
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
      withStateMaintenanceLock(this.stateDir, () => {
        appendStateFile(this.stateDir, this.telemetryPath, `${JSON.stringify(record)}\n`);
        const lines = readFileSync(this.telemetryPath, "utf8").trim().split("\n").filter(Boolean);
        if (lines.length > MAX_TELEMETRY_LINES) {
          writeStateFileAtomically(this.stateDir, this.telemetryPath, `${lines.slice(-MAX_TELEMETRY_LINES).join("\n")}\n`);
        }
      });
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

function readGatewayState(path: string): GatewayState {
  try {
    const file = readManagedStateTextFile(path, { maxBytes: MAX_STATE_BYTES });
    if (file.status === "missing") return { used: {}, reservations: {}, terminal: {}, groups: {} };
    const parsed: unknown = JSON.parse(file.text);
    if (!isGatewayState(parsed)) throw new Error("invalid_token_gateway_state");
    const terminal = Object.fromEntries(Object.entries(parsed.terminal).map(([id, value]) => [
      id,
      { ...value, completedAt: value.completedAt ?? "1970-01-01T00:00:00.000Z" }
    ]));
    return { used: parsed.used, reservations: parsed.reservations, terminal, groups: parsed.groups };
  } catch {
    throw new Error("invalid_token_gateway_state");
  }
}

function isGatewayState(value: unknown): value is GatewayState {
  if (!isRecord(value) || !hasOnlyKeys(value, ["used", "reservations", "terminal"], ["groups"]) ||
    !isRecord(value.used) || !isRecord(value.reservations) || !isRecord(value.terminal) || (value.groups !== undefined && !isRecord(value.groups)) ||
    Object.keys(value.used).length > MAX_USAGE_KEYS ||
    Object.keys(value.reservations).length > MAX_ACTIVE_RESERVATIONS ||
    Object.keys(value.terminal).length > MAX_TERMINAL_RESERVATIONS) {
    return false;
  }
  if (value.groups === undefined) value.groups = {};
  const groups = value.groups;
  if (!isRecord(groups) || Object.keys(groups).length > MAX_ACTIVE_RESERVATIONS || !Object.entries(groups).every(([id, group]) => isPersistedString(id) && isGroup(group) && group.groupId === id)) return false;
  const activeGroupSlots = Object.values(groups).flatMap((group) => (group as TokenGroupReservation).slots).filter((slot) => slot.state === "reserved" || slot.state === "claimed").length;
  const ordinaryReservations = Object.values(value.reservations).filter((reservation) => (reservation as TokenReservation).groupId === undefined).length;
  if (activeGroupSlots + ordinaryReservations > MAX_ACTIVE_RESERVATIONS) return false;
  const reservationEntries = Object.entries(value.reservations);
  const terminalEntries = Object.entries(value.terminal);
  if (!reservationEntries.every(([id, reservation]) => isReservation(id, reservation)) ||
    !terminalEntries.every(([id, terminal]) => isPersistedString(id) && isTerminalReservation(terminal))) {
    return false;
  }
  const reservations = reservationEntries.map(([, reservation]) => reservation as TokenReservation);
  const handoffIds = reservations.flatMap((reservation) => reservation.handoffId === undefined ? [] : [reservation.handoffId]);
  const terminalIds = new Set(terminalEntries.map(([id]) => id));
  if (new Set(handoffIds).size !== handoffIds.length ||
    reservationEntries.some(([id]) => terminalIds.has(id))) {
    return false;
  }
  const activeById = new Map(reservations.map((reservation) => [reservation.reservationId, reservation]));
  for (const group of Object.values(groups) as TokenGroupReservation[]) {
    for (const slot of group.slots) {
      if (slot.state === "claimed" && (slot.reservation === null || !isDeepStrictEqual(activeById.get(slot.reservation.reservationId), slot.reservation))) return false;
    }
  }
  for (const reservation of reservations) {
    if (reservation.groupId === undefined) continue;
    const slot = (groups[reservation.groupId] as TokenGroupReservation | undefined)?.slots.find((candidate) => candidate.slotId === reservation.slotId);
    if (slot?.state !== "claimed" || !isDeepStrictEqual(slot.reservation, reservation)) return false;
  }
  return usageIsCoherent(value.used, reservations, Object.values(groups) as TokenGroupReservation[]);
}

function isReservation(id: string, value: unknown): value is TokenReservation {
  return isPersistedString(id) && isRecord(value) &&
    hasOnlyKeys(value, ["provider", "model", "sessionId", "inputTokens", "outputTokens", "reservationId", "reservedAt", "totalTokens"], ["handoffId", "groupId", "slotId", "heldTokens"]) &&
    value.reservationId === id && isPersistedString(value.provider) &&
    (value.model === null || isPersistedString(value.model)) &&
    (value.sessionId === null || isPersistedString(value.sessionId)) &&
    (value.handoffId === undefined || isPersistedString(value.handoffId)) &&
    isTimestamp(value.reservedAt) &&
    isNonNegativeSafeInteger(value.inputTokens) &&
    isNonNegativeSafeInteger(value.outputTokens) &&
    isNonNegativeSafeInteger(value.totalTokens) &&
    Number.isSafeInteger(value.inputTokens + value.outputTokens) &&
    value.totalTokens === value.inputTokens + value.outputTokens &&
    ((value.groupId === undefined && value.slotId === undefined && value.heldTokens === undefined) || (isPersistedString(value.groupId) && isPersistedString(value.slotId) && isNonNegativeSafeInteger(value.heldTokens) && value.totalTokens <= value.heldTokens));
}

function normalizeGroup(input: OrchestrationGroupSpec): OrchestrationGroupSpec {
  if (!isRecord(input) || !hasOnlyKeys(input, ["groupId", "slots"]) || !isPersistedString(input.groupId) || !Array.isArray(input.slots)) throw new Error("token_group_mismatch");
  const slots = input.slots;
  if (slots.some((slot) => !isRecord(slot) || !hasOnlyKeys(slot, ["slotId", "provider", "model", "sessionId", "holdTokens"]) ||
    !isPersistedString(slot.slotId) || !isPersistedString(slot.provider) || !(slot.model === null || isPersistedString(slot.model)) ||
    !(slot.sessionId === null || isPersistedString(slot.sessionId)) || !isNonNegativeSafeInteger(slot.holdTokens) || slot.holdTokens === 0) ||
    new Set(slots.map((slot) => slot.slotId)).size !== slots.length) throw new Error("token_group_mismatch");
  return { groupId: input.groupId, slots: slots as unknown as readonly TokenGroupSlotRequest[] };
}
function sameGroupRequest(existing: TokenGroupReservation, request: OrchestrationGroupSpec): boolean { return existing.groupId === request.groupId && existing.slots.length === request.slots.length && existing.slots.every((slot, i) => { const next = request.slots[i]!; return slot.slotId === next.slotId && slot.provider === next.provider && slot.model === next.model && slot.sessionId === next.sessionId && slot.holdTokens === next.holdTokens; }); }
function sameReservationInput(existing: TokenReservation, request: TokenReservationRequest): boolean { return existing.provider === request.provider && existing.model === request.model && existing.sessionId === request.sessionId && existing.inputTokens === request.inputTokens && existing.outputTokens === request.outputTokens && existing.handoffId === request.handoffId; }
function isCanonicalRequest(input: TokenReservationRequest, normalized: TokenReservationRequest): boolean { return input.provider === normalized.provider && input.model === normalized.model && input.sessionId === normalized.sessionId && input.inputTokens === normalized.inputTokens && input.outputTokens === normalized.outputTokens && input.handoffId === normalized.handoffId; }
function isGroup(value: unknown): value is TokenGroupReservation {
  if (!isRecord(value) || !hasOnlyKeys(value, ["groupId", "slots", "maximumTokens"]) || !isPersistedString(value.groupId) || !isNonNegativeSafeInteger(value.maximumTokens) || !Array.isArray(value.slots) || value.slots.length === 0) return false;
  const ids = new Set<string>(); let maximumTokens = 0;
  for (const slot of value.slots) {
    if (!isRecord(slot) || !hasOnlyKeys(slot, ["slotId", "provider", "model", "sessionId", "holdTokens", "state", "reservation"]) || !isPersistedString(slot.slotId) || ids.has(slot.slotId) ||
      !isPersistedString(slot.provider) || !(slot.model === null || isPersistedString(slot.model)) || !(slot.sessionId === null || isPersistedString(slot.sessionId)) ||
      !isNonNegativeSafeInteger(slot.holdTokens) || slot.holdTokens === 0 || !["reserved", "claimed", "settled", "released"].includes(slot.state as string) ||
      !(slot.reservation === null || isReservation((slot.reservation as TokenReservation).reservationId, slot.reservation)) ||
      (slot.state === "reserved" && slot.reservation !== null) || (["claimed", "settled"].includes(slot.state as string) && slot.reservation === null)) return false;
    ids.add(slot.slotId); maximumTokens += slot.holdTokens;
    if (!Number.isSafeInteger(maximumTokens)) return false;
    if (slot.reservation !== null && ((slot.reservation as TokenReservation).groupId !== value.groupId || (slot.reservation as TokenReservation).slotId !== slot.slotId || (slot.reservation as TokenReservation).heldTokens !== slot.holdTokens)) return false;
  }
  return maximumTokens === value.maximumTokens;
}

function isTerminalReservation(value: unknown): value is GatewayState["terminal"][string] {
  if (!isRecord(value) || !hasOnlyKeys(value, ["event", "settlement"], ["completedAt"]) ||
    (value.event !== "settled" && value.event !== "released") || !isRecord(value.settlement) ||
    !hasOnlyKeys(value.settlement, ["inputTokens", "outputTokens"], ["released"]) ||
    !isNonNegativeSafeInteger(value.settlement.inputTokens) ||
    !isNonNegativeSafeInteger(value.settlement.outputTokens) ||
    !Number.isSafeInteger(value.settlement.inputTokens + value.settlement.outputTokens) ||
    (value.settlement.released !== undefined && typeof value.settlement.released !== "boolean") ||
    (value.completedAt !== undefined && !isTimestamp(value.completedAt))) {
    return false;
  }
  return value.event !== "released" ||
    (value.settlement.inputTokens === 0 && value.settlement.outputTokens === 0 && value.settlement.released === true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function isPersistedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD_LENGTH && bounded(value) === value;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function usageIsCoherent(used: Record<string, unknown>, reservations: readonly TokenReservation[], groups: readonly TokenGroupReservation[]): boolean {
  const totals = { provider: 0, model: 0, session: 0 };
  for (const [key, value] of Object.entries(used)) {
    const kind = usageKeyKind(key);
    if (kind === null || !isNonNegativeSafeInteger(value) || value === 0 || !safeIncrement(totals, kind, value)) return false;
  }
  if (totals.provider !== totals.model || totals.provider !== totals.session) return false;

  const required = new Map<string, number>();
  for (const reservation of reservations.filter((candidate) => candidate.groupId === undefined)) {
    if (reservation.totalTokens === 0) continue;
    for (const key of routeUsageKeys(reservation)) {
      const next = (required.get(key) ?? 0) + reservation.totalTokens;
      if (!Number.isSafeInteger(next)) return false;
      required.set(key, next);
    }
  }
  for (const slot of groups.flatMap((group) => group.slots).filter((candidate) => candidate.state === "reserved" || candidate.state === "claimed")) {
    for (const key of routeUsageKeys(slot)) {
      const next = (required.get(key) ?? 0) + slot.holdTokens;
      if (!Number.isSafeInteger(next)) return false;
      required.set(key, next);
    }
  }
  return [...required].every(([key, minimum]) => isNonNegativeSafeInteger(used[key]) && used[key] >= minimum);
}

function usageKeyKind(key: string): keyof { provider: number; model: number; session: number } | null {
  if (key.startsWith("provider:")) return isPersistedString(key.slice("provider:".length)) ? "provider" : null;
  if (key.startsWith("session:")) return isPersistedString(key.slice("session:".length)) ? "session" : null;
  if (!key.startsWith("model:")) return null;
  const route = key.slice("model:".length);
  for (let separator = 1; separator < route.length - 1; separator += 1) {
    if (route[separator] === ":" && isPersistedString(route.slice(0, separator)) && isPersistedString(route.slice(separator + 1))) return "model";
  }
  return null;
}

function safeIncrement(totals: { provider: number; model: number; session: number }, kind: "provider" | "model" | "session", amount: number): boolean {
  const next = totals[kind] + amount;
  if (!Number.isSafeInteger(next)) return false;
  totals[kind] = next;
  return true;
}

function routeUsageKeys(reservation: TokenGatewayRoute): readonly string[] {
  return [
    `provider:${reservation.provider}`,
    `model:${reservation.provider}:${reservation.model ?? "default"}`,
    `session:${reservation.sessionId ?? "unscoped"}`
  ];
}
