import type { DecisionMesh, DecisionMeshGraph, DecisionMeshGraphLink, DecisionMeshGraphNode } from "./types";

export function buildDecisionMeshGraph(mesh: DecisionMesh): DecisionMeshGraph {
  return {
    nodes: mesh.nodes.map(toGraphNode),
    links: mesh.edges.map(toGraphLink)
  };
}

function toGraphNode(node: DecisionMeshGraphNodeSource): DecisionMeshGraphNode {
  return {
    id: node.id,
    group: node.type,
    risk: inferRisk(node.type, node.stop_conditions?.length ?? 0),
    label: node.name
  };
}

function toGraphLink(edge: DecisionMeshGraphLinkSource): DecisionMeshGraphLink {
  return {
    source: edge.from,
    target: edge.to,
    relation: edge.relation,
    weight: edge.weight
  };
}

function inferRisk(type: string, stopConditionCount: number): number {
  if (type.includes("risk")) {
    return 0.9;
  }

  if (stopConditionCount > 0) {
    return 0.7;
  }

  return 0.35;
}

interface DecisionMeshGraphNodeSource {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly stop_conditions?: readonly string[];
}

interface DecisionMeshGraphLinkSource {
  readonly from: string;
  readonly to: string;
  readonly relation: string;
  readonly weight: number;
}
