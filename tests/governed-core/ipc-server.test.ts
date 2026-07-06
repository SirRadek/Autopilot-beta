import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { makeHandoffId } from "../../src/data/delivery-system/checkCompletionMatrix";
import {
  handleRequest,
  type DispatchIpcResponse,
  type GetPacketIpcResponse
} from "../../src/governed-core/ipc-server";

const task = "bounded implementation security audit vendor chokepoint dispatch";
const agent = "security";
// Refusal paths now RECORD a dispatch-decision line (Phase 5.1) — use a real writable stateDir.
const refusalStateDir = mkdtempSync(join(tmpdir(), "governed-ipc-refusal-"));

describe("governed-core IPC handleRequest", () => {
  it("returns a mesh packet and stable packet hash", async () => {
    const response = await getPacket(1);

    expect(response.id).toBe(1);
    expect(response.packet.relevant_nodes.length).toBeGreaterThan(0);
    expect(response.packet_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("round-trips packet data into dispatch refusal without spawning a vendor", async () => {
    const packetResponse = await getPacket(2);
    const handoff = baseHandoff(packetResponse.packet_hash);

    expect(handoff.task).toBe(task);
    expect(handoff.agent).toBe(agent);
    expect(handoff.required_checks.length).toBeGreaterThan(0);

    const response = await handleRequest({
      id: 3,
      op: "dispatch",
      handoff: {
        ...handoff,
        packet_hash: "0".repeat(64)
      },
      stateDir: refusalStateDir
    });

    expect(response.ok).toBe(true);
    const dispatchResponse = response as DispatchIpcResponse;
    expect(dispatchResponse.result.refused).toBe(true);
    if (dispatchResponse.result.refused) {
      expect(dispatchResponse.result.reason).toBe("packet_provenance_mismatch");
    }
  });

  it("returns an error response for unknown operations", async () => {
    const response = await handleRequest({ id: 4, op: "unknown" });

    expect(response).toEqual({
      id: 4,
      ok: false,
      error: "unknown op: unknown"
    });
  });

  it("returns an error response for malformed handoffs", async () => {
    const response = await handleRequest({ id: 5, op: "dispatch", handoff: null });

    expect(response.ok).toBe(false);
    expect(response.id).toBe(5);
    if (!response.ok) {
      expect(response.error).toContain("handoff must be a governed handoff");
    }
  });
});

async function getPacket(id: number): Promise<GetPacketIpcResponse> {
  const response = await handleRequest({ id, op: "get_packet", task, agent });
  expect(response.ok).toBe(true);
  expect("packet" in response).toBe(true);
  return response as GetPacketIpcResponse;
}

function baseHandoff(packetHash: string) {
  return {
    handoffId: makeHandoffId("hp-20260630-governed-ipc"),
    vendor: "codex_cli" as const,
    prompt: "Refuse before the worker lane.",
    parentSessionHash: "parent-session-hash",
    parentTurnHash: "parent-turn-hash",
    task,
    agent,
    packet_hash: packetHash,
    required_checks: ["ipc_dispatch_refusal_gate"]
  };
}
