import type {
  AgentPacket,
  AgentPacketInput,
  CapabilitySelection,
  CapabilitySelectionInput,
  DecisionMesh,
  DecisionMeshEdge,
  DecisionMeshNode,
  DecisionMeshRule,
  NodeExplanation,
  ProjectMeshPacketRule,
  ProjectMeshPacket,
  ProjectMeshPacketInput,
  RelevantSubgraph,
  RelevantSubgraphInput,
  RequiredAgentsResult,
  RiskResult
} from "./types";
import { selectCapabilityModules } from "../../data/delivery-system/capabilities";

const DEFAULT_MAX_NODES = 12;
// Always-applicable root-mesh nodes forced into a packet when a task matched no signal, so an
// unclassified task never yields a silently advice-free packet. Project meshes without these ids
// still get the no_governance_matched flag (their own floor is a separate concern).
const GOVERNANCE_FLOOR_NODE_IDS = ["capability_routing", "context_economy_policy"] as const;
// buildAgentPacket caps the packet at this many nodes for ANY token budget; it is also the ceiling
// against which blocker protection is computed, so a tiny packet surfaces the same blockers a full one would.
const AGENT_PACKET_MAX_NODES = 7;
const AGENT_ORDER = [
  "architect",
  "web_architect",
  "backend",
  "backend_database",
  "frontend",
  "seo_performance",
  "data_processing",
  "automation",
  "design_ux",
  "security",
  "business",
  "qa",
  "qa_recovery",
  "content"
];

interface ScoredNode {
  readonly node: DecisionMeshNode;
  readonly score: number;
}

export function getRelevantSubgraph(mesh: DecisionMesh, input: RelevantSubgraphInput): RelevantSubgraph {
  const maxNodes = Math.max(1, Math.min(input.max_nodes ?? DEFAULT_MAX_NODES, mesh.nodes.length));
  const scored = mesh.nodes
    .map((node) => ({ node, score: scoreNode(node, input.task, input.agent) }))
    .filter((entry) => entry.score > 0)
    .sort(compareScoredNodes);

  const selectedIds: string[] = [];

  for (const entry of scored) {
    addId(selectedIds, entry.node.id, maxNodes);
    if (selectedIds.length >= maxNodes) {
      break;
    }
  }

  if (selectedIds.length < maxNodes) {
    for (const entry of scored) {
      addConnectedNodes(mesh, entry.node.id, selectedIds, maxNodes);
      if (selectedIds.length >= maxNodes) {
        break;
      }
    }
  }

  const selectedIdSet = new Set(selectedIds);
  const relevantNodes = selectedIds.map((id) => requireNode(mesh, id));
  const relevantEdges = mesh.edges.filter((edge) => selectedIdSet.has(edge.from) && selectedIdSet.has(edge.to));
  const excluded = mesh.nodes.filter((node) => !selectedIdSet.has(node.id)).map((node) => node.id);

  const result: RelevantSubgraph = {
    task: input.task,
    relevant_nodes: relevantNodes,
    relevant_edges: relevantEdges,
    required_agents: orderAgents(unique(relevantNodes.flatMap((node) => node.related_agents))),
    excluded
  };

  return input.agent ? { ...result, agent: input.agent } : result;
}

/**
 * Severity-aware packet construction. getRelevantSubgraph keeps only the top-N scored
 * nodes for the token budget, and packet rules/stop_conditions are derived from selected
 * nodes only — so a BLOCKER relevant to the task could be silently truncated away before
 * the agent ever sees it.
 *
 * The fix must be BUDGET-INDEPENDENT within the builder's range: a blocker present in the
 * WIDEST packet this builder can produce must also be present in a tight one. So blocker
 * protection is computed against a fixed CEILING subgraph (getRelevantSubgraph at the builder's
 * maximum node count), not against the already-truncated base. Any blocker carrier the ceiling
 * subgraph contains — including one reached only via a mesh edge (the escalates_when_combined
 * case a directly-scored-only test would miss) — is re-attached if the tighter base dropped it.
 * This makes full-packet blockers ⊆ tiny-packet blockers hold, while never surfacing a blocker
 * the widest packet itself would not (which an unbounded 1-hop frontier would wrongly do).
 */
function withRelevantBlockerNodes(
  mesh: DecisionMesh,
  baseNodes: readonly DecisionMeshNode[],
  task: string,
  agent: string | undefined,
  ceilingMaxNodes: number
): readonly DecisionMeshNode[] {
  const have = new Set(baseNodes.map((node) => node.id));
  const blockerNodeIds = new Set(
    mesh.rules.filter((rule) => rule.severity === "blocker").flatMap((rule) => rule.applies_to)
  );
  const ceiling = getRelevantSubgraph(
    mesh,
    agent ? { task, agent, max_nodes: ceilingMaxNodes } : { task, max_nodes: ceilingMaxNodes }
  );
  const ceilingIds = new Set(ceiling.relevant_nodes.map((node) => node.id));
  const forced = mesh.nodes.filter(
    (node) => !have.has(node.id) && blockerNodeIds.has(node.id) && ceilingIds.has(node.id)
  );
  return forced.length > 0 ? [...baseNodes, ...forced] : baseNodes;
}

/**
 * A task that matches no mesh signal would otherwise yield a packet with zero rules and zero
 * stop_conditions and no indication that governance silently evaporated (the exact failure the
 * A-Z audit hit on a real task). Flag the miss so the caller must stop and reclassify instead of
 * proceeding ungoverned, and — where the mesh has them — force in the always-applicable governance
 * floor so the packet is never advice-free.
 */
function applyGovernanceFloor(
  mesh: DecisionMesh,
  nodes: readonly DecisionMeshNode[]
): { readonly nodes: readonly DecisionMeshNode[]; readonly noGovernanceMatched: boolean } {
  if (nodes.length > 0) {
    return { nodes, noGovernanceMatched: false };
  }
  const floor = GOVERNANCE_FLOOR_NODE_IDS.map((id) => mesh.nodes.find((node) => node.id === id)).filter(
    (node): node is DecisionMeshNode => node !== undefined
  );
  return { nodes: floor, noGovernanceMatched: true };
}

export function buildAgentPacket(mesh: DecisionMesh, input: AgentPacketInput): AgentPacket {
  const maxNodes = Math.max(4, Math.min(AGENT_PACKET_MAX_NODES, Math.floor((input.token_budget ?? 7000) / 1000)));
  const subgraph = getRelevantSubgraph(mesh, {
    task: input.task,
    agent: input.agent,
    max_nodes: maxNodes
  });
  const scored = withRelevantBlockerNodes(
    mesh,
    subgraph.relevant_nodes,
    input.task,
    input.agent,
    AGENT_PACKET_MAX_NODES
  );
  const { nodes, noGovernanceMatched } = applyGovernanceFloor(mesh, scored);
  const selectedIds = new Set(nodes.map((node) => node.id));
  const rules = mesh.rules.filter((rule) => rule.applies_to.some((nodeId) => selectedIds.has(nodeId)));

  return {
    agent: input.agent,
    task: input.task,
    objective: unique(
      nodes.flatMap((node) => node.objective ?? [`Answer: ${node.question}`])
    ),
    rules: rules.map((rule) => rule.id),
    relevant_nodes: nodes.map((node) => node.id),
    required_agents: orderAgents(unique(nodes.flatMap((node) => node.related_agents))),
    must_read: unique(nodes.flatMap((node) => node.related_files)),
    must_not_assume: unique([
      ...nodes.flatMap((node) => node.must_not_assume ?? []),
      ...rules.flatMap((rule) => rule.must_not_assume ?? [])
    ]),
    required_checks: unique(nodes.flatMap((node) => node.required_checks)),
    stop_conditions: unique(nodes.flatMap((node) => node.stop_conditions ?? [])),
    ...(noGovernanceMatched ? { no_governance_matched: true } : {})
  };
}

export function buildProjectMeshPacket(mesh: DecisionMesh, input: ProjectMeshPacketInput): ProjectMeshPacket {
  const subgraphInput: RelevantSubgraphInput = {
    task: input.task,
    max_nodes: input.max_nodes ?? DEFAULT_MAX_NODES
  };
  const subgraph = getRelevantSubgraph(mesh, input.agent ? { ...subgraphInput, agent: input.agent } : subgraphInput);
  const scored = withRelevantBlockerNodes(
    mesh,
    subgraph.relevant_nodes,
    input.task,
    input.agent,
    Math.max(input.max_nodes ?? DEFAULT_MAX_NODES, DEFAULT_MAX_NODES)
  );
  const { nodes, noGovernanceMatched } = applyGovernanceFloor(mesh, scored);
  const selectedIds = new Set(nodes.map((node) => node.id));
  const rules = mesh.rules.filter((rule) => rule.applies_to.some((nodeId) => selectedIds.has(nodeId)));

  const packet: ProjectMeshPacket = {
    project_slug: input.project_slug,
    task: input.task,
    relevant_nodes: nodes.map((node) => node.id),
    rules: rules.map(toProjectMeshPacketRule),
    required_agents: orderAgents(unique(nodes.flatMap((node) => node.related_agents))),
    must_read: unique(nodes.flatMap((node) => node.related_files)),
    must_not_assume: unique([
      ...nodes.flatMap((node) => node.must_not_assume ?? []),
      ...rules.flatMap((rule) => rule.must_not_assume ?? [])
    ]),
    required_checks: unique(nodes.flatMap((node) => node.required_checks)),
    stop_conditions: unique(nodes.flatMap((node) => node.stop_conditions ?? [])),
    why: unique(nodes.map((node) => node.why)),
    ...(noGovernanceMatched ? { no_governance_matched: true } : {})
  };

  return input.agent ? { ...packet, agent: input.agent } : packet;
}

export function explainNode(mesh: DecisionMesh, nodeId: string): NodeExplanation {
  const node = requireNode(mesh, nodeId);
  const connections = mesh.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId);
  const connectedNodeIds = connections.map((edge) => (edge.from === nodeId ? edge.to : edge.from));
  const connectedRisks = connectedNodeIds
    .map((id) => requireNode(mesh, id))
    .filter((connectedNode) => isRiskNode(connectedNode))
    .map((connectedNode) => connectedNode.id);

  return {
    id: node.id,
    type: node.type,
    name: node.name,
    question: node.question,
    why: node.why,
    required_agents: orderAgents(node.related_agents),
    required_checks: node.required_checks,
    stop_conditions: node.stop_conditions ?? [],
    connections,
    connected_risks: unique(connectedRisks)
  };
}

export function findRequiredAgents(
  mesh: DecisionMesh,
  input: Pick<RelevantSubgraphInput, "task">
): RequiredAgentsResult {
  const subgraph = getRelevantSubgraph(mesh, {
    task: input.task,
    max_nodes: DEFAULT_MAX_NODES
  });

  return {
    task: input.task,
    required_agents: subgraph.required_agents,
    reason: unique(subgraph.relevant_nodes.map((node) => node.why))
  };
}

export function findRisks(mesh: DecisionMesh, input: Pick<RelevantSubgraphInput, "task">): RiskResult {
  const subgraph = getRelevantSubgraph(mesh, {
    task: input.task,
    max_nodes: DEFAULT_MAX_NODES
  });
  const risks = subgraph.relevant_nodes.filter(
    (node) => isRiskNode(node) || (node.stop_conditions && node.stop_conditions.length > 0)
  );

  return {
    task: input.task,
    risks,
    stop_conditions: unique(risks.flatMap((node) => node.stop_conditions ?? []))
  };
}

export function selectCapabilities(mesh: DecisionMesh, input: CapabilitySelectionInput): CapabilitySelection {
  const selection = selectCapabilityModules({ task: input.task });
  const maxNodes = Math.max(1, Math.min(input.max_nodes ?? DEFAULT_MAX_NODES, mesh.nodes.length));
  const nodeIds = new Set(mesh.nodes.map((node) => node.id));

  if (selection.activate.length === 0) {
    return {
      task: input.task,
      capabilities: [],
      optional_capabilities: [],
      avoided_capabilities: [],
      required_agents: [],
      required_checks: [],
      relevant_nodes: [],
      reason: selection.reason,
      stop_conditions: []
    };
  }

  const selectedNodeIds = unique([
    ...selection.activate.filter((id) => nodeIds.has(id)),
    ..."capability_routing context_economy_policy model_spend_policy"
      .split(" ")
      .filter((id) => nodeIds.has(id))
  ]).slice(0, maxNodes);
  const selectedNodes = selectedNodeIds.map((id) => requireNode(mesh, id));

  return {
    task: input.task,
    capabilities: selection.activate,
    optional_capabilities: selection.optional,
    avoided_capabilities: selection.avoid,
    required_agents: orderAgents(selection.requiredAgents),
    required_checks: selection.requiredChecks,
    relevant_nodes: selectedNodeIds,
    reason: selection.reason,
    stop_conditions: unique(selectedNodes.flatMap((node) => node.stop_conditions ?? []))
  };
}

function scoreNode(node: DecisionMeshNode, task: string, agent?: string): number {
  const normalizedTask = normalize(task);
  let score = 0;

  for (const signal of node.signals) {
    if (containsTerm(normalizedTask, signal)) {
      score += 4;
    }
  }

  for (const term of [...node.id.split("_"), ...node.name.split(/\s+/), node.type]) {
    if (term.length > 2 && containsTerm(normalizedTask, term)) {
      score += 1;
    }
  }

  if (score > 0 && agent && node.related_agents.includes(agent)) {
    score += 0.5;
  }

  return score;
}

function addConnectedNodes(mesh: DecisionMesh, sourceNodeId: string, selectedIds: string[], maxNodes: number): void {
  const outgoingEdges = mesh.edges
    .filter((edge) => edge.from === sourceNodeId)
    .sort((left, right) => right.weight - left.weight || left.to.localeCompare(right.to));

  for (const edge of outgoingEdges) {
    addId(selectedIds, edge.to, maxNodes);
    if (selectedIds.length >= maxNodes) {
      return;
    }
  }

  const incomingEdges = mesh.edges
    .filter((edge) => edge.to === sourceNodeId)
    .sort((left, right) => right.weight - left.weight || left.from.localeCompare(right.from));

  for (const edge of incomingEdges) {
    addId(selectedIds, edge.from, maxNodes);
    if (selectedIds.length >= maxNodes) {
      return;
    }
  }
}

function addId(selectedIds: string[], nodeId: string, maxNodes: number): void {
  if (selectedIds.length < maxNodes && !selectedIds.includes(nodeId)) {
    selectedIds.push(nodeId);
  }
}

function compareScoredNodes(left: ScoredNode, right: ScoredNode): number {
  return right.score - left.score || left.node.id.localeCompare(right.node.id);
}

function requireNode(mesh: DecisionMesh, nodeId: string): DecisionMeshNode {
  const node = mesh.nodes.find((candidate) => candidate.id === nodeId);

  if (!node) {
    throw new Error(`Decision Mesh node not found: ${nodeId}`);
  }

  return node;
}

function toProjectMeshPacketRule(rule: DecisionMeshRule): ProjectMeshPacketRule {
  return {
    id: rule.id,
    title: rule.title,
    severity: rule.severity,
    instruction: rule.instruction,
    applies_to: rule.applies_to,
    must_not_assume: rule.must_not_assume ?? []
  };
}

function isRiskNode(node: DecisionMeshNode): boolean {
  return node.type.includes("risk");
}

function orderAgents(agents: readonly string[]): readonly string[] {
  return unique(agents).sort((left, right) => {
    const leftIndex = AGENT_ORDER.indexOf(left);
    const rightIndex = AGENT_ORDER.indexOf(right);
    const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return normalizedLeft - normalizedRight || left.localeCompare(right);
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, " ");
}

function containsTerm(normalizedTask: string, term: string): boolean {
  const normalizedTerm = normalize(term);

  if (normalizedTerm.includes(" ")) {
    return normalizedTask.includes(normalizedTerm);
  }

  return normalizedTask.split(/\s+/).includes(normalizedTerm);
}
