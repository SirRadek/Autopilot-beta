import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import {
  buildAgentPacket,
  loadDecisionMeshFromRoot,
  type AgentPacket
} from "../lib/decision-mesh";
import {
  computePacketHash,
  dispatchHandoff,
  type DispatchResult,
  type GovernedHandoff
} from "./dispatch";

const DEFAULT_AGENT_PACKET_TOKEN_BUDGET = 8000;
const DEFAULT_STATE_DIR = join(tmpdir(), "autopilot-governed-core-ipc");
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export interface GetPacketIpcRequest {
  readonly id: number;
  readonly op: "get_packet";
  readonly task: string;
  readonly agent: string;
}

export interface DispatchIpcRequest {
  readonly id: number;
  readonly op: "dispatch";
  readonly handoff: GovernedHandoff;
  readonly stateDir?: string;
}

export type IpcRequest = GetPacketIpcRequest | DispatchIpcRequest;

export interface GetPacketIpcResponse {
  readonly id: number;
  readonly ok: true;
  readonly packet: AgentPacket;
  readonly packet_hash: string;
}

export interface DispatchIpcResponse {
  readonly id: number;
  readonly ok: true;
  readonly result: DispatchResult;
}

export interface IpcErrorResponse {
  readonly id: number | null;
  readonly ok: false;
  readonly error: string;
}

export type IpcResponse = GetPacketIpcResponse | DispatchIpcResponse | IpcErrorResponse;

interface GovernanceHashPacketInput {
  readonly relevant_nodes: readonly string[];
  readonly rules: readonly string[];
  readonly required_checks: readonly string[];
  readonly stop_conditions: readonly string[];
  readonly must_not_assume: readonly string[];
}

export async function handleRequest(req: unknown): Promise<IpcResponse> {
  const id = extractRequestId(req);

  try {
    if (!isRecord(req)) {
      throw new Error("request must be an object");
    }
    if (id === null) {
      throw new Error("request.id must be a finite number");
    }

    if (req.op === "get_packet") {
      const task = requireString(req.task, "task");
      const agent = requireString(req.agent, "agent");
      const mesh = loadDecisionMeshFromRoot(REPO_ROOT);
      const packet = buildAgentPacket(mesh, {
        task,
        agent,
        token_budget: DEFAULT_AGENT_PACKET_TOKEN_BUDGET
      });

      return {
        id,
        ok: true,
        packet,
        packet_hash: computePacketHash(toGovernanceHashPacket(packet))
      };
    }

    if (req.op === "dispatch") {
      if (!isGovernedHandoff(req.handoff)) {
        throw new Error("handoff must be a governed handoff with required dispatch fields");
      }

      const stateDir = req.stateDir === undefined ? DEFAULT_STATE_DIR : requireString(req.stateDir, "stateDir");
      return {
        id,
        ok: true,
        result: await dispatchHandoff(req.handoff, stateDir)
      };
    }

    throw new Error(`unknown op: ${String(req.op)}`);
  } catch (error) {
    return {
      id,
      ok: false,
      error: errorMessage(error)
    };
  }
}

async function runStdioServer(): Promise<void> {
  const lines = createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });

  for await (const line of lines) {
    const response = await responseForLine(line);
    await writeStdoutLine(`${JSON.stringify(response)}\n`);
  }
}

async function responseForLine(line: string): Promise<IpcResponse> {
  try {
    return await handleRequest(JSON.parse(line));
  } catch (error) {
    return {
      id: null,
      ok: false,
      error: errorMessage(error)
    };
  }
}

async function writeStdoutLine(line: string): Promise<void> {
  if (process.stdout.write(line)) {
    return;
  }
  await once(process.stdout, "drain");
}

function toGovernanceHashPacket(packet: AgentPacket): GovernanceHashPacketInput {
  return {
    relevant_nodes: packet.relevant_nodes,
    rules: packet.rules,
    required_checks: packet.required_checks,
    stop_conditions: packet.stop_conditions,
    must_not_assume: packet.must_not_assume
  };
}

function extractRequestId(value: unknown): number | null {
  return isRecord(value) && typeof value.id === "number" && Number.isFinite(value.id) ? value.id : null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`request.${field} must be a non-empty string`);
  }

  return value;
}

function isGovernedHandoff(value: unknown): value is GovernedHandoff {
  return (
    isRecord(value) &&
    typeof value.handoffId === "string" &&
    isCliVendor(value.vendor) &&
    typeof value.prompt === "string" &&
    typeof value.parentSessionHash === "string" &&
    typeof value.parentTurnHash === "string" &&
    typeof value.task === "string" &&
    typeof value.agent === "string" &&
    typeof value.packet_hash === "string" &&
    Array.isArray(value.required_checks) &&
    value.required_checks.every((check) => typeof check === "string")
  );
}

function isCliVendor(value: unknown): value is GovernedHandoff["vendor"] {
  return value === "codex_cli" || value === "claude_cli" || value === "agy_cli" || value === "openrouter_api";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMainEntry(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainEntry()) {
  runStdioServer().catch((error: unknown) => {
    process.stderr.write(`[governed-core:ipc] ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
