import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { HandoffId } from "./checkCompletionMatrix";
import {
  AGENT_HANDOFF_INDEX_PATH,
  AGENT_REGISTRY_PATH,
  SUBAGENT_EVIDENCE_PATH
} from "./sessionState";

export type AgentRegistryEventType = "subagent_start" | "subagent_stop";

export interface AgentRegistryStartEntry {
  readonly schema_version: "v1";
  readonly event: "subagent_start";
  readonly agent_id: string | null;
  readonly agent_type: string | null;
  readonly parent_session_hash: string | null;
  readonly parent_turn_hash: string;
  readonly started_at: string;
}

export interface AgentRegistryStopEntry {
  readonly schema_version: "v1";
  readonly event: "subagent_stop";
  readonly agent_id: string | null;
  readonly stopped_at: string;
}

export type AgentRegistryEntry = AgentRegistryStartEntry | AgentRegistryStopEntry;

export interface AgentHandoffIndexEntry {
  readonly schema_version: "v1";
  readonly agent_id: string;
  readonly handoff_id: HandoffId;
  readonly correlated_at: string;
  readonly source: "supervisor_assignment" | "worker_echo";
}

export interface SubagentEvidenceArtifacts {
  readonly handoff_packet: string;
  readonly worker_output: string;
  readonly reviewer_output: string | null;
}

export type LockStatus =
  | "acquired"
  | "acquired_supervisor_spawn"
  | "already_locked"
  | "stale_replaced"
  | "missing_agent_id"
  | "failed";

export interface SubagentEvidenceRecord {
  readonly schema_version: "v1";
  readonly handoff_id: HandoffId;
  readonly agent_id: string;
  readonly agent_type: string | null;
  readonly parent_session_hash: string | null;
  readonly started_at: string;
  readonly stopped_at: string | null;
  readonly duration_seconds: number | null;
  readonly artifacts: SubagentEvidenceArtifacts;
  readonly lock_status: LockStatus;
  readonly verified: boolean;
  readonly recorded_at: string;
}

export interface SubagentTreeChild {
  readonly agent_id: string;
  readonly handoff_id: HandoffId | null;
  readonly evidence: SubagentEvidenceRecord | null;
  readonly started_at: string;
  readonly stopped_at: string | null;
}

export interface SubagentTree {
  readonly parent_session_hash: string;
  readonly children: readonly SubagentTreeChild[];
}

const MAX_JSONL_ENTRIES = 200;
const MAX_JSONL_BYTES = 256 * 1024;
const DEFAULT_SESSION_STATE_DIRECTORY = join(process.cwd(), "docs", "autopilot", "session-state");

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function stateFilePath(stateDir: string | undefined, path: string): string {
  return join(stateDir ?? DEFAULT_SESSION_STATE_DIRECTORY, fileName(path));
}

function trimJsonlIfNeeded(path: string): void {
  if (!existsSync(path)) {
    return;
  }

  const content = readFileSync(path, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length <= MAX_JSONL_ENTRIES && statSync(path).size <= MAX_JSONL_BYTES) {
    return;
  }

  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, `${lines.slice(-MAX_JSONL_ENTRIES).join("\n")}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function appendJsonl(path: string, record: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  trimJsonlIfNeeded(path);
}

function readJsonl<T>(path: string): T[] {
  try {
    if (!existsSync(path)) {
      return [];
    }

    const content = readFileSync(path, "utf8").trim();
    if (!content) {
      return [];
    }

    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

function isStartEntry(entry: AgentRegistryEntry): entry is AgentRegistryStartEntry {
  return entry.event === "subagent_start";
}

function isStopEntry(entry: AgentRegistryEntry): entry is AgentRegistryStopEntry {
  return entry.event === "subagent_stop";
}

export function writeCorrelationEntry(
  entry: Omit<AgentHandoffIndexEntry, "schema_version">,
  stateDir?: string
): void {
  appendJsonl(stateFilePath(stateDir, AGENT_HANDOFF_INDEX_PATH), {
    schema_version: "v1",
    ...entry
  });
}

export function writeSubagentEvidence(
  record: Omit<SubagentEvidenceRecord, "schema_version">,
  stateDir?: string
): void {
  appendJsonl(stateFilePath(stateDir, SUBAGENT_EVIDENCE_PATH), {
    schema_version: "v1",
    ...record
  });
}

export function readAgentRegistry(stateDir?: string): AgentRegistryEntry[] {
  return readJsonl<AgentRegistryEntry>(stateFilePath(stateDir, AGENT_REGISTRY_PATH));
}

export function readCorrelationIndex(stateDir?: string): AgentHandoffIndexEntry[] {
  return readJsonl<AgentHandoffIndexEntry>(stateFilePath(stateDir, AGENT_HANDOFF_INDEX_PATH));
}

export function readSubagentEvidence(stateDir?: string): SubagentEvidenceRecord[] {
  return readJsonl<SubagentEvidenceRecord>(stateFilePath(stateDir, SUBAGENT_EVIDENCE_PATH));
}

export function buildSubagentTree(parentSessionHash: string, stateDir?: string): SubagentTree {
  const registry = readAgentRegistry(stateDir);
  const correlationsByAgent = new Map<string, AgentHandoffIndexEntry>();
  const evidenceByHandoff = new Map<HandoffId, SubagentEvidenceRecord>();
  const stopsByAgent = new Map<string, AgentRegistryStopEntry>();

  for (const correlation of readCorrelationIndex(stateDir)) {
    correlationsByAgent.set(correlation.agent_id, correlation);
  }

  for (const evidence of readSubagentEvidence(stateDir)) {
    evidenceByHandoff.set(evidence.handoff_id, evidence);
  }

  for (const entry of registry) {
    if (isStopEntry(entry) && entry.agent_id) {
      stopsByAgent.set(entry.agent_id, entry);
    }
  }

  const children = registry
    .filter(isStartEntry)
    .filter((entry) => entry.parent_session_hash === parentSessionHash && entry.agent_id !== null)
    .map((entry): SubagentTreeChild => {
      const agentId = entry.agent_id as string;
      const correlation = correlationsByAgent.get(agentId);
      const handoffId = correlation?.handoff_id ?? null;

      return {
        agent_id: agentId,
        handoff_id: handoffId,
        evidence: handoffId ? (evidenceByHandoff.get(handoffId) ?? null) : null,
        started_at: entry.started_at,
        stopped_at: stopsByAgent.get(agentId)?.stopped_at ?? null
      };
    });

  return {
    parent_session_hash: parentSessionHash,
    children
  };
}
