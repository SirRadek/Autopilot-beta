import { describe, expect, it } from "vitest";

import { loadDecisionMeshFromRoot, validateCapabilityRoutingMirror } from "../../src/lib/decision-mesh";
import type { DecisionMesh, DecisionMeshNode } from "../../src/lib/decision-mesh";

describe("capability routing mirror drift validation", () => {
  it("passes for the current YAML and TypeScript capability mirrors", () => {
    expect(validateCapabilityRoutingMirror(loadMesh())).toEqual([]);
  });

  it("detects a missing YAML capability id", () => {
    const mesh = withoutNode(loadMesh(), "web_build_mesh");

    expect(validateCapabilityRoutingMirror(mesh)).toContain(
      "capability ids drift: missing [], extra [web_build_mesh]"
    );
  });

  it("detects a missing YAML signal", () => {
    const mesh = withoutNodeValue(loadMesh(), "optimization_mesh", "signals", "slow");

    expect(validateCapabilityRoutingMirror(mesh)).toContain(
      "optimization_mesh.signals drift: missing [], extra [slow]"
    );
  });

  it("detects a missing YAML related agent", () => {
    const mesh = withoutNodeValue(loadMesh(), "web_build_mesh", "related_agents", "frontend");

    expect(validateCapabilityRoutingMirror(mesh)).toContain(
      "web_build_mesh.requiredAgents drift: missing [], extra [frontend]"
    );
  });

  it("detects a missing YAML required check", () => {
    const mesh = withoutNodeValue(loadMesh(), "web_build_mesh", "required_checks", "responsive_check");

    expect(validateCapabilityRoutingMirror(mesh)).toContain(
      "web_build_mesh.requiredChecks drift: missing [], extra [responsive_check]"
    );
  });

  it("detects baseline_metric drift", () => {
    const mesh = withoutNodeValue(loadMesh(), "optimization_mesh", "required_checks", "baseline_metric");

    expect(validateCapabilityRoutingMirror(mesh)).toContain(
      "optimization_mesh.requiredChecks drift: missing [], extra [baseline_metric]"
    );
  });
});

function loadMesh(): DecisionMesh {
  return structuredClone(loadDecisionMeshFromRoot(process.cwd()));
}

function withoutNode(mesh: DecisionMesh, nodeId: string): DecisionMesh {
  return {
    ...mesh,
    nodes: mesh.nodes.filter((node) => node.id !== nodeId)
  };
}

function withoutNodeValue<K extends "signals" | "related_agents" | "required_checks">(
  mesh: DecisionMesh,
  nodeId: string,
  key: K,
  value: string
): DecisionMesh {
  return {
    ...mesh,
    nodes: mesh.nodes.map((node): DecisionMeshNode =>
      node.id === nodeId
        ? {
            ...node,
            [key]: node[key].filter((candidate) => candidate !== value)
          }
        : node
    )
  };
}
