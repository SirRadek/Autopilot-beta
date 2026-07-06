import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type CliWorkerInput,
  type CliWorkerResult,
  runCliWorker
} from "../data/delivery-system/cliWorker";
import { DISPATCH_DECISION_TELEMETRY_PATH } from "../data/delivery-system/sessionState";
import type { EvalRecordSummary } from "../data/delivery-system/modelOutputEvaluation";
import {
  buildSupervisorRoutingDecision,
  type ModelPolicyLayer,
  type SupervisorRoutingDecision
} from "../data/delivery-system/modelPolicy";
import type { TierCircuitBreakerThresholds, TierFailureSignalRecord } from "../data/delivery-system/routingGuards";
import {
  isLaneAllowedInMode,
  resolveRoutingLane,
  type RoutingLaneId,
  type RoutingModeId
} from "../data/delivery-system/routingModes";
import type { SubscriptionSessionBudget } from "../data/delivery-system/subscriptionBudget";
import {
  buildAgentPacket,
  loadDecisionMeshFromRoot
} from "../lib/decision-mesh";

const DEFAULT_AGENT_PACKET_TOKEN_BUDGET = 8000;
const VERIFIED_LOCK_SOURCE = "governed_dispatch_verified";
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export type DispatchRefusalReason =
  | "packet_provenance_mismatch"
  | "routing_no_viable_provider"
  | "missing_required_checks"
  | "lane_not_allowed_in_mode";

export interface SupervisorRoutingContext {
  readonly layer: ModelPolicyLayer;
  readonly budgets: readonly SubscriptionSessionBudget[];
  readonly evalRecords: readonly EvalRecordSummary[];
  readonly recentFailureSignals?: readonly TierFailureSignalRecord[];
  readonly circuitBreakerThresholds?: TierCircuitBreakerThresholds;
  readonly now?: string | Date;
}

export type GovernedHandoff = CliWorkerInput & {
  readonly task: string;
  readonly agent: string;
  readonly packet_hash: string;
  readonly required_checks: readonly string[];
  readonly routing_mode?: RoutingModeId;
  readonly routing?: SupervisorRoutingContext;
};

export type DispatchResult =
  | (CliWorkerResult & {
      readonly refused: false;
      readonly tier_id: string | null;
      readonly provenance_verified: true;
    })
  | {
      readonly refused: true;
      readonly reason: DispatchRefusalReason;
      readonly tier_id: string | null;
      readonly provenance_verified: boolean;
    };

export interface DispatchDecisionRecord {
  readonly schema_version: "v1";
  readonly recorded_at: string;
  readonly handoff_id: string;
  readonly task_hash: string;
  readonly agent: string;
  readonly vendor: string;
  readonly routing_mode: RoutingModeId | null;
  readonly resolved_lane: string | null;
  readonly tier_id: string | null;
  readonly decision: "dispatched" | "refused";
  readonly refusal_reason: DispatchRefusalReason | null;
}

export interface BuildDispatchDecisionRecordInput {
  readonly recordedAt: string;
  readonly handoff: GovernedHandoff;
  readonly tierId: string | null;
  readonly decision: DispatchDecisionRecord["decision"];
  readonly refusalReason: DispatchRefusalReason | null;
}

interface GovernanceHashPacket {
  readonly relevant_nodes: readonly string[];
  readonly rules: readonly string[];
  readonly required_checks: readonly string[];
  readonly stop_conditions: readonly string[];
  readonly must_not_assume: readonly string[];
}

/**
 * Stable hash of a packet's governance-relevant fields. This is a CONSISTENCY / freshness guard, NOT
 * cryptographic authentication: the mesh is public and this function is deterministic over public
 * inputs, so any caller can compute the correct hash for a given {task, agent}. Its value is that
 * dispatchHandoff refuses a handoff whose declared route no longer matches the LIVE mesh — so a caller
 * cannot act on a stale/mismatched governance packet, and dispatch always governs the real route.
 * True UNFORGEABLE provenance (an HMAC-signed route token issued by the governed core when the packet
 * is built) is a Phase-2 hardening. The structural bypass-prevention in Phase 1 is the dependency
 * boundary: the spawn lane is reachable only through this module (see dispatch-boundary.test.ts).
 */
export function computePacketHash(packet: GovernanceHashPacket, routingMode?: RoutingModeId): string {
  const canonical = {
    relevant_nodes: sorted(packet.relevant_nodes),
    rules: sorted(packet.rules),
    required_checks: sorted(packet.required_checks),
    stop_conditions: sorted(packet.stop_conditions),
    must_not_assume: sorted(packet.must_not_assume),
    routing_mode: routingMode ?? null
  };

  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export function buildDispatchDecisionRecord(input: BuildDispatchDecisionRecordInput): DispatchDecisionRecord {
  return {
    schema_version: "v1",
    recorded_at: input.recordedAt,
    handoff_id: input.handoff.handoffId as string,
    task_hash: createHash("sha256").update(input.handoff.task, "utf8").digest("hex"),
    agent: input.handoff.agent,
    vendor: input.handoff.vendor,
    routing_mode: input.handoff.routing_mode ?? null,
    resolved_lane: resolveHandoffLane(input.handoff) ?? null,
    tier_id: input.tierId,
    decision: input.decision,
    refusal_reason: input.refusalReason
  };
}

export async function dispatchHandoff(
  handoff: GovernedHandoff,
  stateDir: string
): Promise<DispatchResult> {
  const mesh = loadDecisionMeshFromRoot(REPO_ROOT);
  const packet = buildAgentPacket(mesh, {
    task: handoff.task,
    agent: handoff.agent,
    token_budget: DEFAULT_AGENT_PACKET_TOKEN_BUDGET
  });

  if (computePacketHash(packet, handoff.routing_mode) !== handoff.packet_hash) {
    recordDispatchDecision(handoff, stateDir, {
      decision: "refused",
      refusalReason: "packet_provenance_mismatch",
      tierId: null
    });
    return refuse("packet_provenance_mismatch", null, false);
  }

  const tierId = resolveTierId(handoff);
  if (tierId === undefined) {
    recordDispatchDecision(handoff, stateDir, {
      decision: "refused",
      refusalReason: "routing_no_viable_provider",
      tierId: null
    });
    return refuse("routing_no_viable_provider", null, true);
  }

  if (!Array.isArray(handoff.required_checks) || handoff.required_checks.length === 0) {
    recordDispatchDecision(handoff, stateDir, {
      decision: "refused",
      refusalReason: "missing_required_checks",
      tierId
    });
    return refuse("missing_required_checks", tierId, true);
  }

  if (handoff.routing_mode !== undefined) {
    const lane = resolveHandoffLane(handoff);
    if (lane === undefined || !isLaneAllowedInMode(handoff.routing_mode, lane)) {
      recordDispatchDecision(handoff, stateDir, {
        decision: "refused",
        refusalReason: "lane_not_allowed_in_mode",
        tierId
      });
      return refuse("lane_not_allowed_in_mode", tierId, true);
    }
  }

  const result = await runCliWorker(toCliWorkerInput(handoff), stateDir);
  recordDispatchDecision(handoff, stateDir, {
    decision: "dispatched",
    refusalReason: null,
    tierId
  });

  return {
    ...result,
    refused: false,
    tier_id: tierId,
    provenance_verified: true
  };
}

function resolveHandoffLane(handoff: GovernedHandoff): RoutingLaneId | undefined {
  try {
    return resolveRoutingLane({
      vendor: handoff.vendor,
      ...(handoff.openrouterMode !== undefined ? { openrouterMode: handoff.openrouterMode } : {}),
      ...(handoff.model !== undefined ? { model: handoff.model } : {})
    });
  } catch {
    return undefined;
  }
}

function resolveTierId(handoff: GovernedHandoff): string | null | undefined {
  if (handoff.routing === undefined) {
    return null;
  }

  const decision = buildSupervisorRoutingDecision({
    taskId: handoff.handoffId as string,
    taskDescription: handoff.task,
    layer: handoff.routing.layer,
    budgets: handoff.routing.budgets,
    evalRecords: handoff.routing.evalRecords,
    ...(handoff.routing.recentFailureSignals !== undefined
      ? { recentFailureSignals: handoff.routing.recentFailureSignals }
      : {}),
    ...(handoff.routing.circuitBreakerThresholds !== undefined
      ? { circuitBreakerThresholds: handoff.routing.circuitBreakerThresholds }
      : {}),
    ...(handoff.routing.now !== undefined ? { now: handoff.routing.now } : {})
  });

  if (!hasViableAssignedProvider(decision)) {
    return undefined;
  }

  return decision.assignedTierId ?? null;
}

function hasViableAssignedProvider(decision: SupervisorRoutingDecision): boolean {
  const assignedProvider = (decision as { readonly assignedProvider?: unknown }).assignedProvider;
  return typeof assignedProvider === "string" && assignedProvider.length > 0 && assignedProvider !== "none";
}

function toCliWorkerInput(handoff: GovernedHandoff): CliWorkerInput {
  return {
    handoffId: handoff.handoffId,
    vendor: handoff.vendor,
    prompt: handoff.prompt,
    parentSessionHash: handoff.parentSessionHash,
    parentTurnHash: handoff.parentTurnHash,
    ...(handoff.model !== undefined ? { model: handoff.model } : {}),
    ...(handoff.routing_mode !== undefined ? { routingMode: handoff.routing_mode } : {}),
    ...(handoff.cwd !== undefined ? { cwd: handoff.cwd } : {}),
    ...(handoff.addDirs !== undefined ? { addDirs: handoff.addDirs } : {}),
    ...(handoff.images !== undefined ? { images: handoff.images } : {}),
    ...(handoff.timeoutMs !== undefined ? { timeoutMs: handoff.timeoutMs } : {}),
    ...(handoff.outputSchemaPath !== undefined ? { outputSchemaPath: handoff.outputSchemaPath } : {}),
    lockSource: VERIFIED_LOCK_SOURCE
  };
}

function recordDispatchDecision(
  handoff: GovernedHandoff,
  stateDir: string,
  input: {
    readonly decision: DispatchDecisionRecord["decision"];
    readonly refusalReason: DispatchRefusalReason | null;
    readonly tierId: string | null;
  }
): void {
  appendDispatchDecisionRecordBestEffort(buildDispatchDecisionRecord({
    recordedAt: new Date().toISOString(),
    handoff,
    tierId: input.tierId,
    decision: input.decision,
    refusalReason: input.refusalReason
  }), stateDir);
}

function appendDispatchDecisionRecordBestEffort(record: DispatchDecisionRecord, stateDir: string): void {
  try {
    mkdirSync(stateDir, { recursive: true });
    appendFileSync(dispatchDecisionTelemetryPath(stateDir), `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // dispatch telemetry is best-effort and must never affect governed dispatch behavior
  }
}

function dispatchDecisionTelemetryPath(stateDir: string): string {
  const fileName = DISPATCH_DECISION_TELEMETRY_PATH.split(/[\\/]/).at(-1) ?? "dispatch-decisions.jsonl";
  return join(stateDir, fileName);
}

function refuse(
  reason: DispatchRefusalReason,
  tierId: string | null,
  provenanceVerified: boolean
): DispatchResult {
  return {
    refused: true,
    reason,
    tier_id: tierId,
    provenance_verified: provenanceVerified
  };
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
