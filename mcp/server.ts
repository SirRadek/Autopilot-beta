import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import {
  PDOS_PROJECT_TYPES,
  PDOS_RECIPE_IDS,
  routeProductDesignOs,
  type PdosChangeRequestContext,
  type PdosProjectType,
  type PdosRecipeId,
  type PdosRiskLevel,
  type PdosRouteRequest
} from "../product-design-os/scripts/route-product-design-os";
import {
  scoreProductDesignOs,
  type PdosScoreInput
} from "../product-design-os/scripts/score-product-design-os";
import {
  searchArchitectureLibrary,
  selectDesignReviewRoute
} from "../src/data/delivery-system/designIntelligence";
import { selectGraphicRoute } from "../src/data/delivery-system/graphicAgent";
import { selectLocalWorkerRoute } from "../src/data/delivery-system/localWorkers";
import { selectModelOutputEvaluationRoute } from "../src/data/delivery-system/modelOutputEvaluation";
import { selectReasoningModelRoute } from "../src/data/delivery-system/modelPolicy";
import { selectProtectiveSupervisionRoute } from "../src/data/delivery-system/protectiveSupervision";
import { selectTokenEfficiencyRoute } from "../src/data/delivery-system/tokenEfficiency";
import { selectToolInventoryForTask } from "../src/data/delivery-system/toolInventory";
import {
  buildAgentPacket,
  buildProjectMeshPacket,
  explainNode,
  findRequiredAgents,
  findRisks,
  getRelevantSubgraph,
  loadDecisionMeshFromRoot,
  loadProjectDecisionMeshFromRoot,
  selectCapabilities
} from "../src/lib/decision-mesh";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const packageVersion = readPackageVersion(projectRoot);
const mesh = loadDecisionMeshFromRoot(projectRoot);

const stringArraySchema = z.array(z.string());
const decisionMeshNodeSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    question: z.string(),
    why: z.string(),
    signals: stringArraySchema,
    related_agents: stringArraySchema,
    related_files: stringArraySchema,
    required_checks: stringArraySchema,
    stop_conditions: stringArraySchema.optional(),
    must_not_assume: stringArraySchema.optional(),
    objective: stringArraySchema.optional()
  })
  .passthrough();
const decisionMeshEdgeSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    relation: z.string(),
    weight: z.number(),
    why: z.string()
  })
  .passthrough();
const decisionMeshRuleSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    severity: z.string(),
    instruction: z.string(),
    applies_to: stringArraySchema,
    must_not_assume: stringArraySchema
  })
  .passthrough();
const textOutputSchema = z.object({ text: z.string() });
const capabilitySelectionOutputSchema = z
  .object({
    task: z.string(),
    capabilities: stringArraySchema,
    optional_capabilities: stringArraySchema,
    avoided_capabilities: stringArraySchema,
    required_agents: stringArraySchema,
    required_checks: stringArraySchema,
    relevant_nodes: stringArraySchema,
    reason: stringArraySchema,
    stop_conditions: stringArraySchema
  })
  .passthrough();
const graphicRouteOutputSchema = z
  .object({
    activateAgent: z.string(),
    matchedRules: stringArraySchema,
    outputs: stringArraySchema,
    preferredTools: stringArraySchema,
    fallbackTools: stringArraySchema,
    requiredChecks: stringArraySchema,
    stopConditions: stringArraySchema
  })
  .passthrough();
const designReviewRouteOutputSchema = z
  .object({
    agents: stringArraySchema,
    modes: stringArraySchema,
    requiredInputs: stringArraySchema,
    requiredOutputs: stringArraySchema,
    criteria: stringArraySchema,
    stopConditions: stringArraySchema
  })
  .passthrough();
const architectureLibrarySearchOutputSchema = z
  .object({
    providers: stringArraySchema,
    candidates: stringArraySchema,
    requiredChecks: stringArraySchema,
    stopConditions: stringArraySchema
  })
  .passthrough();
const reasoningModelRouteOutputSchema = z
  .object({
    route: z.string(),
    taskLanes: stringArraySchema,
    providerPolicies: stringArraySchema,
    advisoryProviders: stringArraySchema,
    docsVerificationProviders: stringArraySchema,
    allowedUse: stringArraySchema,
    forbiddenUse: stringArraySchema,
    requiredChecks: stringArraySchema,
    stopConditions: stringArraySchema
  })
  .passthrough();
const toolInventoryRouteOutputSchema = z
  .object({
    matchingItems: stringArraySchema,
    requiredChecks: stringArraySchema,
    stopConditions: stringArraySchema,
    notes: stringArraySchema
  })
  .passthrough();
const localWorkerRouteOutputSchema = z
  .object({
    route: z.string(),
    selectedWorkers: stringArraySchema,
    taskKinds: stringArraySchema,
    requiredChecks: stringArraySchema,
    stopConditions: stringArraySchema,
    handoff: stringArraySchema
  })
  .passthrough();
const modelOutputEvaluationRouteOutputSchema = z
  .object({
    phase: z.string(),
    qualityState: z.string(),
    dimensions: stringArraySchema,
    requiredChecks: stringArraySchema,
    stopConditions: stringArraySchema,
    nextActions: stringArraySchema,
    promptTuningActions: stringArraySchema,
    escalationActions: stringArraySchema,
    sourceIds: stringArraySchema
  })
  .passthrough();
const tokenEfficiencyRouteOutputSchema = z
  .object({
    profile: z.string(),
    budgetClass: z.string(),
    contextRules: stringArraySchema,
    firstMoves: stringArraySchema,
    preferredWorkerOrder: stringArraySchema,
    outputRules: stringArraySchema,
    escalationRules: stringArraySchema,
    stopConditions: stringArraySchema
  })
  .passthrough();
const protectiveSupervisionRouteOutputSchema = z
  .object({
    activateAgent: z.string(),
    lanes: stringArraySchema,
    progressStates: stringArraySchema,
    requiredChecks: stringArraySchema,
    stopConditions: stringArraySchema,
    outputContract: stringArraySchema
  })
  .passthrough();
const pdosIntakeRouteSchema = z
  .object({
    project_type: z.string(),
    selected_recipe: z.string(),
    confidence: z.number(),
    logic_priority: z.number(),
    design_priority: z.number(),
    motion_level: z.number(),
    risk_level: z.string(),
    reasons: stringArraySchema,
    required_gates: stringArraySchema,
    stop_conditions: stringArraySchema,
    open_questions: stringArraySchema
  })
  .passthrough();
const pdosChangeRequestRouteSchema = z
  .object({
    request: z.string(),
    classification: z.string(),
    label: z.string(),
    requires_scope_change: z.boolean(),
    risk_level: z.string(),
    reasons: stringArraySchema,
    recommendation: z.string(),
    stop_conditions: stringArraySchema
  })
  .passthrough();
const pdosRouteOutputSchema = z
  .union([
    z
      .object({
        kind: z.literal("project_intake"),
        route: pdosIntakeRouteSchema,
        report_markdown: z.string()
      })
      .passthrough(),
    z
      .object({
        kind: z.literal("change_request"),
        route: pdosChangeRequestRouteSchema,
        report_markdown: z.string()
      })
      .passthrough()
  ]);
const pdosScoredItemSchema = z
  .object({
    id: z.string(),
    score: z.number(),
    selected: z.boolean(),
    reasons: stringArraySchema,
    penalties: stringArraySchema
  })
  .passthrough();
const pdosScoreOutputSchema = z
  .object({
    route: pdosIntakeRouteSchema,
    selected: z.object({
      recipes: z.array(pdosScoredItemSchema),
      patterns: z.array(pdosScoredItemSchema),
      assets: z.array(pdosScoredItemSchema)
    }),
    rejected: z.object({
      recipes: z.array(pdosScoredItemSchema),
      patterns: z.array(pdosScoredItemSchema),
      assets: z.array(pdosScoredItemSchema)
    }),
    warnings: stringArraySchema,
    formula: z.string(),
    report_markdown: z.string()
  })
  .passthrough();
const relevantSubgraphOutputSchema = z
  .object({
    task: z.string(),
    agent: z.string().optional(),
    relevant_nodes: z.array(decisionMeshNodeSchema),
    relevant_edges: z.array(decisionMeshEdgeSchema),
    required_agents: stringArraySchema,
    excluded: stringArraySchema
  })
  .passthrough();
const agentPacketOutputSchema = z
  .object({
    agent: z.string(),
    task: z.string(),
    objective: stringArraySchema,
    rules: stringArraySchema,
    relevant_nodes: stringArraySchema,
    required_agents: stringArraySchema,
    must_read: stringArraySchema,
    must_not_assume: stringArraySchema,
    required_checks: stringArraySchema,
    stop_conditions: stringArraySchema,
    no_governance_matched: z.boolean().optional()
  })
  .passthrough();
const projectMeshPacketOutputSchema = z
  .object({
    project_slug: z.string(),
    task: z.string(),
    agent: z.string().optional(),
    relevant_nodes: stringArraySchema,
    rules: z.array(decisionMeshRuleSchema),
    required_agents: stringArraySchema,
    must_read: stringArraySchema,
    must_not_assume: stringArraySchema,
    required_checks: stringArraySchema,
    stop_conditions: stringArraySchema,
    why: stringArraySchema,
    no_governance_matched: z.boolean().optional()
  })
  .passthrough();
const nodeExplanationOutputSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    question: z.string(),
    why: z.string(),
    required_agents: stringArraySchema,
    required_checks: stringArraySchema,
    stop_conditions: stringArraySchema,
    connections: z.array(decisionMeshEdgeSchema),
    connected_risks: stringArraySchema
  })
  .passthrough();
const requiredAgentsOutputSchema = z
  .object({
    task: z.string(),
    required_agents: stringArraySchema,
    reason: stringArraySchema
  })
  .passthrough();
const risksOutputSchema = z
  .object({
    task: z.string(),
    risks: z.array(decisionMeshNodeSchema),
    stop_conditions: stringArraySchema
  })
  .passthrough();

function readOnlyTool<OutputArgs extends z.ZodType>(outputSchema: OutputArgs): {
  outputSchema: OutputArgs;
  annotations: {
    readOnlyHint: true;
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: false;
  };
} {
  return {
    outputSchema,
    annotations: readOnlyToolAnnotations
  };
}

const readOnlyToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

const server = new McpServer(
  {
    name: "autopilot-decision-mesh",
    version: packageVersion
  },
  {
    instructions:
      "Read-only Autopilot Decision Mesh context router. Use it to classify tasks, retrieve compact mesh packets, and inspect governance guidance. It must not mutate repositories, connectors, deployments, project runtimes, or external services."
  }
);

server.registerTool(
  "select_capabilities",
  {
    title: "Select Autopilot Capabilities",
    description: "Route a task to Autopilot capability modules before building a compact agent packet.",
    ...readOnlyTool(capabilitySelectionOutputSchema),
    inputSchema: {
      task: z.string().min(1),
      max_nodes: z.number().int().min(1).max(24).optional()
    }
  },
  async (input) => toJsonText(selectCapabilities(mesh, toCapabilitySelectionInput(input)))
);

server.registerTool(
  "select_graphic_route",
  {
    title: "Select Graphic Production Route",
    description:
      "Return a read-only Graphic Production Agent route for static graphics, motion, physics, models, or storyboards.",
    ...readOnlyTool(graphicRouteOutputSchema),
    inputSchema: {
      task: z.string().min(1)
    }
  },
  async (input) => toJsonText(selectGraphicRoute(input))
);

server.registerTool(
  "select_design_review_route",
  {
    title: "Select Design Review Route",
    description:
      "Return a read-only Visual Analyst and Design Critic route for visual analysis, critique, research, and handoff.",
    ...readOnlyTool(designReviewRouteOutputSchema),
    inputSchema: {
      task: z.string().min(1)
    }
  },
  async (input) => toJsonText(selectDesignReviewRoute(input))
);

server.registerTool(
  "search_architecture_library",
  {
    title: "Search Autopilot Architecture Library",
    description:
      "Return read-only candidate technologies from Autopilot's LLM/ML architecture library without approving adoption.",
    ...readOnlyTool(architectureLibrarySearchOutputSchema),
    inputSchema: {
      task: z.string().min(1)
    }
  },
  async (input) => toJsonText(searchArchitectureLibrary(input))
);

server.registerTool(
  "select_reasoning_model_route",
  {
    title: "Select Reasoning Model Route",
    description:
      "Return a read-only model-routing recommendation for deterministic tools, local Qwen workers, GPT/OpenAI, Claude Code subscription, Gemini CLI, or DeepSeek advisory lanes.",
    ...readOnlyTool(reasoningModelRouteOutputSchema),
    inputSchema: {
      task: z.string().min(1)
    }
  },
  async (input) => toJsonText(selectReasoningModelRoute(input))
);

server.registerTool(
  "select_tool_inventory_route",
  {
    title: "Select Tool Inventory Route",
    description:
      "Return read-only plugin and skill availability guidance, distinguishing current session callable tools from cached-only bundles.",
    ...readOnlyTool(toolInventoryRouteOutputSchema),
    inputSchema: {
      task: z.string().min(1)
    }
  },
  async (input) => toJsonText(selectToolInventoryForTask(input))
);

server.registerTool(
  "select_local_worker_route",
  {
    title: "Select Local Worker Route",
    description:
      "Return a read-only local worker routing recommendation for Qwen2.5-Coder, deterministic tooling, tests, search, and summarization.",
    ...readOnlyTool(localWorkerRouteOutputSchema),
    inputSchema: {
      task: z.string().min(1)
    }
  },
  async (input) => toJsonText(selectLocalWorkerRoute(input))
);

server.registerTool(
  "select_model_output_evaluation_route",
  {
    title: "Select Model Output Evaluation Route",
    description:
      "Return a read-only route for scoring model output, prompt/input tuning, repeated-failure model or reasoning review, and weekly eval-based tuning.",
    ...readOnlyTool(modelOutputEvaluationRouteOutputSchema),
    inputSchema: {
      task: z.string().min(1),
      score: z.number().min(0).max(100).optional(),
      repeatedFailures: z.number().int().min(0).optional(),
      provider: z.enum(["openai", "anthropic", "google", "qwen", "deepseek", "local", "unknown"]).optional(),
      phase: z.enum(["learning_immediate_loop", "weekly_batch_tuning"]).optional()
    }
  },
  async (input) => toJsonText(selectModelOutputEvaluationRoute(input))
);

server.registerTool(
  "select_token_efficiency_route",
  {
    title: "Select Token Efficiency Route",
    description:
      "Return a read-only Caveman/compact routing profile for minimal context, deterministic-first work, and paid-token avoidance.",
    ...readOnlyTool(tokenEfficiencyRouteOutputSchema),
    inputSchema: {
      task: z.string().min(1)
    }
  },
  async (input) => toJsonText(selectTokenEfficiencyRoute(input))
);

server.registerTool(
  "select_protective_supervision_route",
  {
    title: "Select Protective Supervision Route",
    description:
      "Return a read-only protective supervision route for currentness checks, agent handoff compilation, progress tracking, and blocker review.",
    ...readOnlyTool(protectiveSupervisionRouteOutputSchema),
    inputSchema: {
      task: z.string().min(1)
    }
  },
  async (input) => toJsonText(selectProtectiveSupervisionRoute(input))
);

server.registerTool(
  "route_product_design_os",
  {
    title: "Route Product & Design OS Intake",
    description:
      "Return a read-only Product & Design OS route for project intake or change-request triage, with optional Markdown report output.",
    ...readOnlyTool(z.union([pdosRouteOutputSchema, textOutputSchema])),
    inputSchema: {
      text: z.string().min(1).optional(),
      project_type: z.string().min(1).optional(),
      primary_goal: z.string().min(1).optional(),
      target_users: z.array(z.string().min(1)).optional(),
      critical_user_action: z.string().min(1).optional(),
      content_or_data: z.array(z.string().min(1)).optional(),
      must_have: z.array(z.string().min(1)).optional(),
      must_not_do: z.array(z.string().min(1)).optional(),
      logic_priority: z.number().int().min(1).max(10).optional(),
      design_priority: z.number().int().min(1).max(10).optional(),
      motion_level: z.number().int().min(0).max(10).optional(),
      risk_level: z.enum(["low", "medium", "high", "critical"]).optional(),
      change_request: z.string().min(1).optional(),
      change_context: z
        .object({
          project_type: z.string().min(1).optional(),
          selected_recipe: z.string().min(1).optional(),
          primary_goal: z.string().min(1).optional(),
          critical_user_action: z.string().min(1).optional(),
          logic_priority: z.number().int().min(1).max(10).optional(),
          design_priority: z.number().int().min(1).max(10).optional(),
          motion_level: z.number().int().min(0).max(10).optional(),
          risk_level: z.enum(["low", "medium", "high", "critical"]).optional()
        })
        .optional(),
      format: z.enum(["json", "markdown"]).optional()
    }
  },
  async (input) => {
    const result = routeProductDesignOs(toPdosRouteRequest(input));
    return input.format === "markdown" ? toText(result.report_markdown) : toJsonText(result);
  }
);

server.registerTool(
  "score_product_design_os",
  {
    title: "Score Product & Design OS Candidates",
    description:
      "Return a read-only deterministic Product & Design OS score report for recipes, patterns, and assets using local registries.",
    ...readOnlyTool(z.union([pdosScoreOutputSchema, textOutputSchema])),
    inputSchema: {
      text: z.string().min(1).optional(),
      project_type: z.string().min(1).optional(),
      primary_goal: z.string().min(1).optional(),
      target_users: z.array(z.string().min(1)).optional(),
      critical_user_action: z.string().min(1).optional(),
      content_or_data: z.array(z.string().min(1)).optional(),
      must_have: z.array(z.string().min(1)).optional(),
      must_not_do: z.array(z.string().min(1)).optional(),
      logic_priority: z.number().int().min(1).max(10).optional(),
      design_priority: z.number().int().min(1).max(10).optional(),
      motion_level: z.number().int().min(0).max(10).optional(),
      risk_level: z.enum(["low", "medium", "high", "critical"]).optional(),
      limit: z.number().int().min(1).max(10).optional(),
      format: z.enum(["json", "markdown"]).optional()
    }
  },
  async (input) => {
    const result = scoreProductDesignOs(toPdosScoreInput(input), projectRoot);
    return input.format === "markdown" ? toText(result.report_markdown) : toJsonText(result);
  }
);

server.registerTool(
  "get_relevant_subgraph",
  {
    title: "Get Relevant Decision Mesh Subgraph",
    description: "Return a compact read-only Decision Mesh subgraph for a task and optional agent role.",
    ...readOnlyTool(relevantSubgraphOutputSchema),
    inputSchema: {
      task: z.string().min(1),
      agent: z.string().min(1).optional(),
      max_nodes: z.number().int().min(1).max(24).optional()
    }
  },
  async (input) => toJsonText(getRelevantSubgraph(mesh, toRelevantSubgraphInput(input)))
);

server.registerTool(
  "build_agent_packet",
  {
    title: "Build Decision Mesh Agent Packet",
    description: "Return compact task guidance for one agent role without loading the full mesh.",
    ...readOnlyTool(agentPacketOutputSchema),
    inputSchema: {
      task: z.string().min(1),
      agent: z.string().min(1),
      token_budget: z.number().int().min(1000).max(32000).optional()
    }
  },
  async (input) => toJsonText(buildAgentPacket(mesh, toAgentPacketInput(input)))
);

server.registerTool(
  "build_project_mesh_packet",
  {
    title: "Build Project Decision Mesh Packet",
    description: "Return compact task guidance from a supervised project's own Decision Mesh.",
    ...readOnlyTool(projectMeshPacketOutputSchema),
    inputSchema: {
      project_slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      task: z.string().min(1),
      agent: z.string().min(1).optional(),
      max_nodes: z.number().int().min(1).max(24).optional()
    }
  },
  async (input) => {
    const projectMesh = loadProjectDecisionMeshFromRoot(projectRoot, input.project_slug);
    return toJsonText(buildProjectMeshPacket(projectMesh, toProjectMeshPacketInput(input)));
  }
);

server.registerTool(
  "explain_node",
  {
    title: "Explain Decision Mesh Node",
    description: "Explain why a node exists and which risks, checks, agents, and edges connect to it.",
    ...readOnlyTool(nodeExplanationOutputSchema),
    inputSchema: {
      node_id: z.string().min(1)
    }
  },
  async ({ node_id }) => toJsonText(explainNode(mesh, node_id))
);

server.registerTool(
  "find_required_agents",
  {
    title: "Find Required Agents",
    description: "Return likely required agents and reasons for a task.",
    ...readOnlyTool(requiredAgentsOutputSchema),
    inputSchema: {
      task: z.string().min(1)
    }
  },
  async (input) => toJsonText(findRequiredAgents(mesh, input))
);

server.registerTool(
  "find_risks",
  {
    title: "Find Decision Mesh Risks",
    description: "Return relevant risk nodes and stop conditions for a task.",
    ...readOnlyTool(risksOutputSchema),
    inputSchema: {
      task: z.string().min(1)
    }
  },
  async (input) => toJsonText(findRisks(mesh, input))
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function toJsonText(value: unknown): { content: { type: "text"; text: string }[]; structuredContent: Record<string, unknown> } {
  return {
    structuredContent: toStructuredContent(value),
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function toText(value: string): { content: { type: "text"; text: string }[]; structuredContent: Record<string, unknown> } {
  return {
    structuredContent: { text: value },
    content: [
      {
        type: "text",
        text: value
      }
    ]
  };
}

function toStructuredContent(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { value };
}

function readPackageVersion(root: string): string {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as unknown;

  if (!manifest || typeof manifest !== "object" || !("version" in manifest) || typeof manifest.version !== "string") {
    throw new Error("package.json must contain a string version for the MCP server.");
  }

  return manifest.version;
}

function toPdosRouteRequest(input: {
  text?: string | undefined;
  project_type?: string | undefined;
  primary_goal?: string | undefined;
  target_users?: string[] | undefined;
  critical_user_action?: string | undefined;
  content_or_data?: string[] | undefined;
  must_have?: string[] | undefined;
  must_not_do?: string[] | undefined;
  logic_priority?: number | undefined;
  design_priority?: number | undefined;
  motion_level?: number | undefined;
  risk_level?: PdosRiskLevel | undefined;
  change_request?: string | undefined;
  change_context?: {
    project_type?: string | undefined;
    selected_recipe?: string | undefined;
    primary_goal?: string | undefined;
    critical_user_action?: string | undefined;
    logic_priority?: number | undefined;
    design_priority?: number | undefined;
    motion_level?: number | undefined;
    risk_level?: PdosRiskLevel | undefined;
  } | undefined;
}): PdosRouteRequest {
  const output: {
    text?: string;
    project_type?: string;
    primary_goal?: string;
    target_users?: string[];
    critical_user_action?: string;
    content_or_data?: string[];
    must_have?: string[];
    must_not_do?: string[];
    logic_priority?: number;
    design_priority?: number;
    motion_level?: number;
    risk_level?: PdosRiskLevel;
    change_request?: string;
    change_context?: PdosChangeRequestContext;
  } = {};

  if (input.text !== undefined) output.text = input.text;
  if (input.project_type !== undefined) output.project_type = input.project_type;
  if (input.primary_goal !== undefined) output.primary_goal = input.primary_goal;
  if (input.target_users !== undefined) output.target_users = input.target_users;
  if (input.critical_user_action !== undefined) output.critical_user_action = input.critical_user_action;
  if (input.content_or_data !== undefined) output.content_or_data = input.content_or_data;
  if (input.must_have !== undefined) output.must_have = input.must_have;
  if (input.must_not_do !== undefined) output.must_not_do = input.must_not_do;
  if (input.logic_priority !== undefined) output.logic_priority = input.logic_priority;
  if (input.design_priority !== undefined) output.design_priority = input.design_priority;
  if (input.motion_level !== undefined) output.motion_level = input.motion_level;
  if (input.risk_level !== undefined) output.risk_level = input.risk_level;
  if (input.change_request !== undefined) output.change_request = input.change_request;
  if (input.change_context !== undefined) output.change_context = toPdosChangeContext(input.change_context);

  return output;
}

function toPdosChangeContext(input: {
  project_type?: string | undefined;
  selected_recipe?: string | undefined;
  primary_goal?: string | undefined;
  critical_user_action?: string | undefined;
  logic_priority?: number | undefined;
  design_priority?: number | undefined;
  motion_level?: number | undefined;
  risk_level?: PdosRiskLevel | undefined;
}): PdosChangeRequestContext {
  const output: {
    project_type?: PdosProjectType;
    selected_recipe?: PdosRecipeId;
    primary_goal?: string;
    critical_user_action?: string;
    logic_priority?: number;
    design_priority?: number;
    motion_level?: number;
    risk_level?: PdosRiskLevel;
  } = {};

  if (isPdosProjectType(input.project_type)) output.project_type = input.project_type;
  if (isPdosRecipeId(input.selected_recipe)) output.selected_recipe = input.selected_recipe;
  if (input.primary_goal !== undefined) output.primary_goal = input.primary_goal;
  if (input.critical_user_action !== undefined) output.critical_user_action = input.critical_user_action;
  if (input.logic_priority !== undefined) output.logic_priority = input.logic_priority;
  if (input.design_priority !== undefined) output.design_priority = input.design_priority;
  if (input.motion_level !== undefined) output.motion_level = input.motion_level;
  if (input.risk_level !== undefined) output.risk_level = input.risk_level;

  return output;
}

function toPdosScoreInput(input: {
  text?: string | undefined;
  project_type?: string | undefined;
  primary_goal?: string | undefined;
  target_users?: string[] | undefined;
  critical_user_action?: string | undefined;
  content_or_data?: string[] | undefined;
  must_have?: string[] | undefined;
  must_not_do?: string[] | undefined;
  logic_priority?: number | undefined;
  design_priority?: number | undefined;
  motion_level?: number | undefined;
  risk_level?: PdosRiskLevel | undefined;
  limit?: number | undefined;
}): PdosScoreInput {
  const output: {
    text?: string;
    project_type?: string;
    primary_goal?: string;
    target_users?: string[];
    critical_user_action?: string;
    content_or_data?: string[];
    must_have?: string[];
    must_not_do?: string[];
    logic_priority?: number;
    design_priority?: number;
    motion_level?: number;
    risk_level?: PdosRiskLevel;
    limit?: number;
  } = {};

  if (input.text !== undefined) output.text = input.text;
  if (input.project_type !== undefined) output.project_type = input.project_type;
  if (input.primary_goal !== undefined) output.primary_goal = input.primary_goal;
  if (input.target_users !== undefined) output.target_users = input.target_users;
  if (input.critical_user_action !== undefined) output.critical_user_action = input.critical_user_action;
  if (input.content_or_data !== undefined) output.content_or_data = input.content_or_data;
  if (input.must_have !== undefined) output.must_have = input.must_have;
  if (input.must_not_do !== undefined) output.must_not_do = input.must_not_do;
  if (input.logic_priority !== undefined) output.logic_priority = input.logic_priority;
  if (input.design_priority !== undefined) output.design_priority = input.design_priority;
  if (input.motion_level !== undefined) output.motion_level = input.motion_level;
  if (input.risk_level !== undefined) output.risk_level = input.risk_level;
  if (input.limit !== undefined) output.limit = input.limit;

  return output;
}

function isPdosProjectType(value: string | undefined): value is PdosProjectType {
  return value !== undefined && PDOS_PROJECT_TYPES.includes(value as PdosProjectType);
}

function isPdosRecipeId(value: string | undefined): value is PdosRecipeId {
  return value !== undefined && PDOS_RECIPE_IDS.includes(value as PdosRecipeId);
}

function toRelevantSubgraphInput(input: {
  task: string;
  agent?: string | undefined;
  max_nodes?: number | undefined;
}): { task: string; agent?: string; max_nodes?: number } {
  const output: { task: string; agent?: string; max_nodes?: number } = { task: input.task };

  if (input.agent !== undefined) {
    output.agent = input.agent;
  }

  if (input.max_nodes !== undefined) {
    output.max_nodes = input.max_nodes;
  }

  return output;
}

function toAgentPacketInput(input: {
  task: string;
  agent: string;
  token_budget?: number | undefined;
}): { task: string; agent: string; token_budget?: number } {
  const output: { task: string; agent: string; token_budget?: number } = {
    task: input.task,
    agent: input.agent
  };

  if (input.token_budget !== undefined) {
    output.token_budget = input.token_budget;
  }

  return output;
}

function toCapabilitySelectionInput(input: {
  task: string;
  max_nodes?: number | undefined;
}): { task: string; max_nodes?: number } {
  const output: { task: string; max_nodes?: number } = { task: input.task };

  if (input.max_nodes !== undefined) {
    output.max_nodes = input.max_nodes;
  }

  return output;
}

function toProjectMeshPacketInput(input: {
  project_slug: string;
  task: string;
  agent?: string | undefined;
  max_nodes?: number | undefined;
}): { project_slug: string; task: string; agent?: string; max_nodes?: number } {
  const output: { project_slug: string; task: string; agent?: string; max_nodes?: number } = {
    project_slug: input.project_slug,
    task: input.task
  };

  if (input.agent !== undefined) {
    output.agent = input.agent;
  }

  if (input.max_nodes !== undefined) {
    output.max_nodes = input.max_nodes;
  }

  return output;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
