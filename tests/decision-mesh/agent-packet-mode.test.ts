import { describe, expect, it } from "vitest";

import { getRoutingMode } from "../../src/data/delivery-system/routingModes";
import { buildAgentPacket, loadDecisionMeshFromRoot } from "../../src/lib/decision-mesh";

const mesh = loadDecisionMeshFromRoot(process.cwd());
const baseInput = {
  task: "Add authenticated avatar upload",
  agent: "backend",
  token_budget: 8000
} as const;

describe("Decision Mesh agent packet routing modes", () => {
  it("merges idea mode checks and stop conditions into the agent packet", () => {
    const mode = getRoutingMode("idea");
    const packet = buildAgentPacket(mesh, { ...baseInput, mode: "idea" });

    expect(packet.routing_mode).toBe("idea");
    expect(packet.required_checks).toEqual(expect.arrayContaining([...mode.requiredChecks]));
    expect(packet.stop_conditions).toEqual(expect.arrayContaining([...mode.stopConditions]));
  });

  it("keeps no-mode packets unchanged when mode is absent", () => {
    const packet = buildAgentPacket(mesh, baseInput);
    const repeatedPacket = buildAgentPacket(mesh, { ...baseInput });

    expect(packet.routing_mode).toBeUndefined();
    expect(packet).not.toHaveProperty("routing_mode");
    expect(repeatedPacket).toEqual(packet);
    expect(repeatedPacket.required_checks).toEqual(packet.required_checks);
    expect(repeatedPacket.stop_conditions).toEqual(packet.stop_conditions);
  });

  it("returns the idea routing mode contract used by the read-only MCP tool", () => {
    const contract = getRoutingMode("idea");

    expect(contract.expensiveLanesAllowed).toBe(false);
    expect(contract.allowedLanes).not.toContain("claude_supervisor");
    expect(contract.allowedLanes).not.toContain("codex_cli");
  });
});
