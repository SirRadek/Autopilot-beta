export interface DecisionMeshNode {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly question: string;
  readonly why: string;
  readonly signals: readonly string[];
  readonly related_agents: readonly string[];
  readonly related_files: readonly string[];
  readonly required_checks: readonly string[];
  readonly stop_conditions?: readonly string[];
  readonly must_not_assume?: readonly string[];
  readonly objective?: readonly string[];
  readonly failure_modes?: readonly string[];
}

export interface DecisionMeshEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: string;
  readonly weight: number;
  readonly why: string;
}

export interface DecisionMeshRule {
  readonly id: string;
  readonly title: string;
  readonly applies_to: readonly string[];
  readonly instruction: string;
  readonly severity: "blocker" | "major" | "minor" | "note";
  readonly must_not_assume?: readonly string[];
}

export interface DecisionMesh {
  readonly nodes: readonly DecisionMeshNode[];
  readonly edges: readonly DecisionMeshEdge[];
  readonly rules: readonly DecisionMeshRule[];
}

export interface RelevantSubgraphInput {
  readonly task: string;
  readonly agent?: string;
  readonly max_nodes?: number;
}

export interface RelevantSubgraph {
  readonly task: string;
  readonly agent?: string;
  readonly relevant_nodes: readonly DecisionMeshNode[];
  readonly relevant_edges: readonly DecisionMeshEdge[];
  readonly required_agents: readonly string[];
  readonly excluded: readonly string[];
}

export interface AgentPacketInput {
  readonly task: string;
  readonly agent: string;
  readonly token_budget?: number;
}

export interface AgentPacket {
  readonly agent: string;
  readonly task: string;
  readonly objective: readonly string[];
  readonly rules: readonly string[];
  readonly relevant_nodes: readonly string[];
  readonly required_agents: readonly string[];
  readonly must_read: readonly string[];
  readonly must_not_assume: readonly string[];
  readonly required_checks: readonly string[];
  readonly stop_conditions: readonly string[];
  /**
   * Set to true when the task matched no mesh signal, so the packet carries only the governance
   * floor (or nothing, for a project mesh without one). Absent means governance matched normally.
   * A caller MUST stop and reclassify rather than proceed on an ungoverned packet.
   */
  readonly no_governance_matched?: boolean;
}

export interface ProjectMeshPacketInput {
  readonly project_slug: string;
  readonly task: string;
  readonly agent?: string;
  readonly max_nodes?: number;
}

export interface ProjectMeshPacket {
  readonly project_slug: string;
  readonly task: string;
  readonly agent?: string;
  readonly relevant_nodes: readonly string[];
  readonly rules: readonly ProjectMeshPacketRule[];
  readonly required_agents: readonly string[];
  readonly must_read: readonly string[];
  readonly must_not_assume: readonly string[];
  readonly required_checks: readonly string[];
  readonly stop_conditions: readonly string[];
  readonly why: readonly string[];
  /** See {@link AgentPacket.no_governance_matched}. */
  readonly no_governance_matched?: boolean;
}

export interface ProjectMeshPacketRule {
  readonly id: string;
  readonly title: string;
  readonly severity: DecisionMeshRule["severity"];
  readonly instruction: string;
  readonly applies_to: readonly string[];
  readonly must_not_assume: readonly string[];
}

export interface NodeExplanation {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly question: string;
  readonly why: string;
  readonly required_agents: readonly string[];
  readonly required_checks: readonly string[];
  readonly stop_conditions: readonly string[];
  readonly connections: readonly DecisionMeshEdge[];
  readonly connected_risks: readonly string[];
}

export interface RequiredAgentsResult {
  readonly task: string;
  readonly required_agents: readonly string[];
  readonly reason: readonly string[];
}

export interface RiskResult {
  readonly task: string;
  readonly risks: readonly DecisionMeshNode[];
  readonly stop_conditions: readonly string[];
}

export interface CapabilitySelectionInput {
  readonly task: string;
  readonly max_nodes?: number;
}

export interface CapabilitySelection {
  readonly task: string;
  readonly capabilities: readonly string[];
  readonly optional_capabilities: readonly string[];
  readonly avoided_capabilities: readonly string[];
  readonly required_agents: readonly string[];
  readonly required_checks: readonly string[];
  readonly relevant_nodes: readonly string[];
  readonly reason: readonly string[];
  readonly stop_conditions: readonly string[];
}

export interface DecisionMeshGraph {
  readonly nodes: readonly DecisionMeshGraphNode[];
  readonly links: readonly DecisionMeshGraphLink[];
}

export interface DecisionMeshGraphNode {
  readonly id: string;
  readonly group: string;
  readonly risk: number;
  readonly label: string;
}

export interface DecisionMeshGraphLink {
  readonly source: string;
  readonly target: string;
  readonly relation: string;
  readonly weight: number;
}
