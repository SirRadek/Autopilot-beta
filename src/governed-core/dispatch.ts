import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  type CliWorkerInput,
  type CliWorkerResult,
  runCliWorker
} from "../data/delivery-system/cliWorker";
import type { EvalRecordSummary } from "../data/delivery-system/modelOutputEvaluation";
import {
  buildSupervisorRoutingDecision,
  type ModelPolicyLayer,
  type SupervisorRoutingDecision
} from "../data/delivery-system/modelPolicy";
import type { TierCircuitBreakerThresholds, TierFailureSignalRecord } from "../data/delivery-system/routingGuards";
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
  | "missing_required_checks";

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
export function computePacketHash(packet: GovernanceHashPacket): string {
  const canonical = {
    relevant_nodes: sorted(packet.relevant_nodes),
    rules: sorted(packet.rules),
    required_checks: sorted(packet.required_checks),
    stop_conditions: sorted(packet.stop_conditions),
    must_not_assume: sorted(packet.must_not_assume)
  };

  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
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

  if (computePacketHash(packet) !== handoff.packet_hash) {
    return refuse("packet_provenance_mismatch", null, false);
  }

  const tierId = resolveTierId(handoff);
  if (tierId === undefined) {
    return refuse("routing_no_viable_provider", null, true);
  }

  if (!Array.isArray(handoff.required_checks) || handoff.required_checks.length === 0) {
    return refuse("missing_required_checks", tierId, true);
  }

  const result = await runCliWorker(toCliWorkerInput(handoff), stateDir);

  return {
    ...result,
    refused: false,
    tier_id: tierId,
    provenance_verified: true
  };
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
    ...(handoff.cwd !== undefined ? { cwd: handoff.cwd } : {}),
    ...(handoff.addDirs !== undefined ? { addDirs: handoff.addDirs } : {}),
    ...(handoff.images !== undefined ? { images: handoff.images } : {}),
    ...(handoff.timeoutMs !== undefined ? { timeoutMs: handoff.timeoutMs } : {}),
    ...(handoff.outputSchemaPath !== undefined ? { outputSchemaPath: handoff.outputSchemaPath } : {}),
    lockSource: VERIFIED_LOCK_SOURCE
  };
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
