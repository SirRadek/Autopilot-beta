import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PDOS_PROJECT_TYPES = [
  "marketing_web",
  "portfolio",
  "landing_page",
  "ecommerce",
  "internal_system",
  "dashboard",
  "crm",
  "client_portal",
  "admin_panel",
  "data_tool",
  "ai_agent_ui",
  "document_system",
  "automation_ui",
  "public_sector",
  "experimental"
] as const;

export const PDOS_RECIPE_IDS = [
  "internal-ops-clean",
  "client-portal-trust",
  "ecommerce-conversion",
  "dashboard-data-heavy",
  "public-sector-accessible",
  "marketing-premium",
  "creative-motion"
] as const;

export type PdosProjectType = (typeof PDOS_PROJECT_TYPES)[number];
export type PdosRecipeId = (typeof PDOS_RECIPE_IDS)[number];
export type PdosRiskLevel = "low" | "medium" | "high" | "critical";
export type PdosChangeRequestClass = "A" | "B" | "C" | "D" | "E";

export interface PdosIntakeInput {
  readonly text?: string;
  readonly project_type?: string;
  readonly primary_goal?: string;
  readonly target_users?: readonly string[];
  readonly critical_user_action?: string;
  readonly content_or_data?: readonly string[];
  readonly must_have?: readonly string[];
  readonly must_not_do?: readonly string[];
  readonly logic_priority?: number;
  readonly design_priority?: number;
  readonly motion_level?: number;
  readonly risk_level?: string;
}

export interface PdosIntakeRoute {
  readonly project_type: PdosProjectType;
  readonly selected_recipe: PdosRecipeId;
  readonly confidence: number;
  readonly logic_priority: number;
  readonly design_priority: number;
  readonly motion_level: number;
  readonly risk_level: PdosRiskLevel;
  readonly reasons: readonly string[];
  readonly required_gates: readonly string[];
  readonly stop_conditions: readonly string[];
  readonly open_questions: readonly string[];
}

export interface PdosChangeRequestContext {
  readonly project_type?: PdosProjectType;
  readonly selected_recipe?: PdosRecipeId;
  readonly primary_goal?: string;
  readonly critical_user_action?: string;
  readonly logic_priority?: number;
  readonly design_priority?: number;
  readonly motion_level?: number;
  readonly risk_level?: PdosRiskLevel;
}

export interface PdosChangeRequestRoute {
  readonly request: string;
  readonly classification: PdosChangeRequestClass;
  readonly label: string;
  readonly requires_scope_change: boolean;
  readonly risk_level: PdosRiskLevel;
  readonly reasons: readonly string[];
  readonly recommendation: string;
  readonly stop_conditions: readonly string[];
}

export interface PdosRouteRequest extends PdosIntakeInput {
  readonly change_request?: string;
  readonly change_context?: PdosChangeRequestContext;
}

export type PdosRouteResult =
  | {
      readonly kind: "project_intake";
      readonly route: PdosIntakeRoute;
      readonly report_markdown: string;
    }
  | {
      readonly kind: "change_request";
      readonly route: PdosChangeRequestRoute;
      readonly report_markdown: string;
    };

interface ProjectSignalRule {
  readonly projectType: PdosProjectType;
  readonly signals: readonly string[];
  readonly weight: number;
}

const PROJECT_SIGNAL_RULES: readonly ProjectSignalRule[] = [
  {
    projectType: "ecommerce",
    weight: 5,
    signals: ["ecommerce", "e shop", "eshop", "shop", "cart", "checkout", "payment", "stripe", "shipping", "product grid", "kosik", "platb", "objednav", "doprava"]
  },
  {
    projectType: "internal_system",
    weight: 4,
    signals: ["internal system", "operator", "approval", "permissions", "roles", "state model", "bulk action", "audit log", "interni", "schval", "opravnen"]
  },
  {
    projectType: "crm",
    weight: 4,
    signals: ["crm", "lead pipeline", "sales pipeline", "contact record", "deal stage"]
  },
  {
    projectType: "admin_panel",
    weight: 4,
    signals: ["admin", "crud", "table", "filters", "detail drawer", "record review"]
  },
  {
    projectType: "dashboard",
    weight: 4,
    signals: ["dashboard", "kpi", "metric", "chart", "analytics", "report", "filter", "graf", "metrik"]
  },
  {
    projectType: "data_tool",
    weight: 4,
    signals: ["data tool", "csv", "xlsx", "export", "import", "dataset", "schema", "data cleaning"]
  },
  {
    projectType: "marketing_web",
    weight: 3,
    signals: ["marketing", "website", "customers", "lead", "cta", "service", "seo", "brand", "case study", "poptav", "zakaznik", "sluzb"]
  },
  {
    projectType: "landing_page",
    weight: 4,
    signals: ["landing page", "campaign", "conversion page", "one page", "offer"]
  },
  {
    projectType: "portfolio",
    weight: 4,
    signals: ["portfolio", "case studies", "visual identity", "creative", "motion", "cursor", "interactive", "hravy", "animac", "pohyb"]
  },
  {
    projectType: "client_portal",
    weight: 4,
    signals: [
      "client portal",
      "customer portal",
      "client login",
      "account area",
      "account overview",
      "secure document",
      "support thread",
      "client task",
      "client action",
      "portal documents"
    ]
  },
  {
    projectType: "ai_agent_ui",
    weight: 4,
    signals: ["agent ui", "chatbot", "assistant", "llm", "rag", "prompt", "conversation"]
  },
  {
    projectType: "document_system",
    weight: 4,
    signals: ["document", "pdf", "ocr", "scan", "invoice", "extraction", "reconstruction"]
  },
  {
    projectType: "automation_ui",
    weight: 4,
    signals: ["automation", "workflow automation", "trigger", "notification", "integration", "zapier", "make"]
  },
  {
    projectType: "public_sector",
    weight: 4,
    signals: ["public sector", "municipality", "office", "citizen", "accessibility", "verejn", "ured"]
  },
  {
    projectType: "experimental",
    weight: 3,
    signals: ["experimental", "prototype", "proof of concept", "3d", "webgl", "physics", "sandbox"]
  }
];

const REQUIRED_GATES = [
  "Project Type Lock",
  "Needs Lock",
  "Scope Contract",
  "Product Opposition",
  "Direction Lock",
  "Implementation Lock",
  "QA Lock"
] as const;

const RISK_SIGNALS = ["auth", "permission", "payment", "checkout", "billing", "database", "migration", "security", "public api", "production", "pii", "secret", "stripe"];
const MOTION_SIGNALS = ["motion", "cursor", "animation", "animated", "scroll", "webgl", "3d", "physics", "video", "hravy", "pohyb", "animac"];
const LOGIC_SIGNALS = ["role", "permission", "workflow", "state", "validation", "audit", "table", "filter", "checkout", "payment", "data", "export", "error"];

const CHANGE_LABELS: Record<PdosChangeRequestClass, string> = {
  A: "clarification",
  B: "scope_expansion",
  C: "direction_change",
  D: "backlog_idea",
  E: "conflict_with_goal"
};

export function classifyProjectIntake(input: PdosIntakeInput | string): PdosIntakeRoute {
  const normalizedInput = typeof input === "string" ? { text: input } : input;
  const signalText = buildSignalText(normalizedInput);
  const explicitProjectType = parseProjectType(normalizedInput.project_type);
  const scoredProjectType = explicitProjectType ?? scoreProjectType(signalText);
  const selectedRecipe = selectRecipe(scoredProjectType, signalText, normalizedInput);
  const recipeDefaults = getRecipeDefaults(selectedRecipe);
  const logicPriority = boundedInt(normalizedInput.logic_priority, 1, 10) ?? tunePriority(recipeDefaults.logicPriority, signalText, LOGIC_SIGNALS, 2);
  const designPriority = boundedInt(normalizedInput.design_priority, 1, 10) ?? tunePriority(recipeDefaults.designPriority, signalText, MOTION_SIGNALS, 1);
  const motionLevel = boundedInt(normalizedInput.motion_level, 0, 10) ?? tunePriority(recipeDefaults.motionLevel, signalText, MOTION_SIGNALS, 2, 0);
  const riskLevel = parseRiskLevel(normalizedInput.risk_level) ?? inferRiskLevel(scoredProjectType, signalText);
  const openQuestions = inferOpenQuestions(normalizedInput, signalText);
  const stopConditions = inferProjectStopConditions(openQuestions, scoredProjectType, signalText);
  const confidence = explicitProjectType ? 1 : calculateConfidence(signalText, scoredProjectType);

  return {
    project_type: scoredProjectType,
    selected_recipe: selectedRecipe,
    confidence,
    logic_priority: logicPriority,
    design_priority: designPriority,
    motion_level: motionLevel,
    risk_level: riskLevel,
    reasons: buildProjectReasons(scoredProjectType, selectedRecipe, signalText, explicitProjectType !== undefined),
    required_gates: REQUIRED_GATES,
    stop_conditions: stopConditions,
    open_questions: openQuestions
  };
}

export function classifyChangeRequest(request: string, context: PdosChangeRequestContext = {}): PdosChangeRequestRoute {
  const signalText = normalizeText([request, context.primary_goal, context.critical_user_action].filter(Boolean).join(" "));
  const projectType = context.project_type;
  const conflict = isConflictRequest(signalText, projectType);
  const directionChange = includesAny(signalText, ["redesign", "new look", "different style", "change direction", "instead of", "replace", "whole new", "prepinani"]);
  const backlogIdea = includesAny(signalText, ["later", "someday", "nice to have", "maybe", "experiment", "backlog", "az pozdeji"]);
  const scopeExpansion = includesAny(signalText, ["add", "new module", "integrate", "connect", "api", "auth", "payment", "database", "blog", "cms", "upload", "checkout"]);

  if (conflict) {
    return buildChangeRoute("E", request, context, [
      "The request introduces a high-friction or high-cost element inside a critical flow.",
      "It can reduce clarity, accessibility, performance, conversion, or auditability."
    ]);
  }

  if (directionChange) {
    return buildChangeRoute("C", request, context, [
      "The request changes the approved visual or product direction.",
      "Direction changes must update scope before implementation."
    ]);
  }

  if (scopeExpansion) {
    return buildChangeRoute("B", request, context, [
      "The request adds a new surface, integration, module, or behavior.",
      "Scope expansion needs owner-visible acceptance criteria."
    ]);
  }

  if (backlogIdea) {
    return buildChangeRoute("D", request, context, [
      "The request is useful but not clearly tied to the current critical user action.",
      "It should be kept visible without blocking the active slice."
    ]);
  }

  return buildChangeRoute("A", request, context, [
    "The request appears to clarify the existing goal without adding a new system surface."
  ]);
}

export function selectRecipe(projectType: PdosProjectType, signalText: string, input: PdosIntakeInput = {}): PdosRecipeId {
  if (projectType === "ecommerce") {
    return "ecommerce-conversion";
  }

  if (projectType === "dashboard" || projectType === "data_tool") {
    return "dashboard-data-heavy";
  }

  if (projectType === "client_portal") {
    return "client-portal-trust";
  }

  if (projectType === "public_sector") {
    return "public-sector-accessible";
  }

  if (projectType === "portfolio" || projectType === "experimental") {
    return "creative-motion";
  }

  if (projectType === "marketing_web" || projectType === "landing_page") {
    const explicitMotion = boundedInt(input.motion_level, 0, 10);
    if ((explicitMotion !== undefined && explicitMotion >= 6) || includesAny(signalText, MOTION_SIGNALS)) {
      return "creative-motion";
    }
    return "marketing-premium";
  }

  return "internal-ops-clean";
}

export function routeProductDesignOs(input: PdosRouteRequest | string): PdosRouteResult {
  const routeInput = typeof input === "string" ? { text: input } : input;

  if (routeInput.change_request) {
    const context = routeInput.change_context ?? toChangeContext(routeInput);
    const route = classifyChangeRequest(routeInput.change_request, context);
    const result: PdosRouteResult = {
      kind: "change_request",
      route,
      report_markdown: buildChangeRequestReport(route, context)
    };
    return result;
  }

  const route = classifyProjectIntake(routeInput);
  const result: PdosRouteResult = {
    kind: "project_intake",
    route,
    report_markdown: buildProjectIntakeReport(route, routeInput)
  };
  return result;
}

export function formatPdosRoute(value: PdosIntakeRoute | PdosChangeRequestRoute): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function formatPdosRouteResult(value: PdosRouteResult, format: "json" | "markdown" = "json"): string {
  if (format === "markdown") {
    return `${value.report_markdown.trimEnd()}\n`;
  }
  return `${JSON.stringify(value.route, null, 2)}\n`;
}

function buildProjectIntakeReport(route: PdosIntakeRoute, input: PdosIntakeInput): string {
  const explicitText = input.text?.trim() || "Structured intake input was provided.";
  const targetUsers = input.target_users && input.target_users.length > 0 ? input.target_users.join(", ") : "Missing";
  const criticalAction = input.critical_user_action?.trim() || "Missing";
  const primaryGoal = input.primary_goal?.trim() || "Missing";

  return [
    "# Product & Design OS Routing Report",
    "",
    "## Routing Summary",
    `- Project type: ${route.project_type}`,
    `- Selected recipe: ${route.selected_recipe}`,
    `- Confidence: ${route.confidence.toFixed(2)}`,
    `- Logic priority: ${route.logic_priority}/10`,
    `- Design priority: ${route.design_priority}/10`,
    `- Motion level: ${route.motion_level}/10`,
    `- Risk level: ${route.risk_level}`,
    "",
    "## Needs Report Draft",
    "### Explicit Requirements",
    `- ${explicitText}`,
    "### Hidden Needs",
    ...toBullets(route.reasons),
    "### Critical Workflow",
    `- ${criticalAction}`,
    "### Target Users",
    `- ${targetUsers}`,
    "### Risks",
    ...toBullets(route.stop_conditions, "No deterministic stop condition was detected."),
    "### Open Questions",
    ...toBullets(route.open_questions, "No deterministic open question was detected."),
    "## Scope Contract Draft",
    `- Primary goal: ${primaryGoal}`,
    `- Project type: ${route.project_type}`,
    `- Critical user action: ${criticalAction}`,
    `- Approved recipe candidate: ${route.selected_recipe}`,
    "- Out of scope until owner approval: new runtime, connector mutation, paid tools, and unverified external claims.",
    "## Product Opposition Draft",
    ...toBullets(buildOppositionNotes(route)),
    "## Implementation Lock Checklist",
    ...toBullets(route.required_gates),
    "- Define files to change before coding.",
    "- Define local verification commands before coding.",
    "- Do not implement when stop conditions remain unresolved."
  ].join("\n");
}

function buildChangeRequestReport(route: PdosChangeRequestRoute, context: PdosChangeRequestContext): string {
  return [
    "# Product & Design OS Change Request Report",
    "",
    "## Classification",
    `- Request: ${route.request}`,
    `- Classification: ${route.classification} / ${route.label}`,
    `- Requires scope change: ${String(route.requires_scope_change)}`,
    `- Risk level: ${route.risk_level}`,
    "",
    "## Reasoning",
    ...toBullets(route.reasons),
    "## Recommendation",
    `- ${route.recommendation}`,
    "## Scope Impact",
    `- Project type: ${context.project_type ?? "Unknown"}`,
    `- Recipe: ${context.selected_recipe ?? "Unknown"}`,
    `- Critical user action: ${context.critical_user_action ?? "Unknown"}`,
    "## Product Opposition",
    ...toBullets(route.stop_conditions, "No deterministic stop condition was detected."),
    "## Implementation Lock Checklist",
    "- Record the change request before implementation.",
    "- Re-run scope and direction lock when scope or direction changes.",
    "- Do not implement conflicts without an owner decision."
  ].join("\n");
}

function buildOppositionNotes(route: PdosIntakeRoute): readonly string[] {
  const notes = [
    "Do not start implementation before scope and direction locks are explicit.",
    "Do not treat the selected recipe as approval; it is a routing recommendation."
  ];

  if (route.motion_level >= 6) {
    notes.push("Motion must serve the primary goal and include reduced-motion and mobile fallbacks.");
  }

  if (route.risk_level === "high" || route.risk_level === "critical") {
    notes.push("High-risk work needs explicit owner acceptance criteria and verification evidence.");
  }

  if (route.stop_conditions.length > 0) {
    notes.push("Stop conditions must be resolved or explicitly accepted before implementation.");
  }

  return notes;
}

function toBullets(items: readonly string[], fallback = "None."): readonly string[] {
  if (items.length === 0) {
    return [`- ${fallback}`];
  }
  return items.map((item) => `- ${item}`);
}

function toChangeContext(input: PdosRouteRequest): PdosChangeRequestContext {
  const output: {
    project_type?: PdosProjectType;
    primary_goal?: string;
    critical_user_action?: string;
    logic_priority?: number;
    design_priority?: number;
    motion_level?: number;
    risk_level?: PdosRiskLevel;
  } = {};
  const projectType = parseProjectType(input.project_type);
  const riskLevel = parseRiskLevel(input.risk_level);

  if (projectType !== undefined) {
    output.project_type = projectType;
  }
  if (input.primary_goal !== undefined) {
    output.primary_goal = input.primary_goal;
  }
  if (input.critical_user_action !== undefined) {
    output.critical_user_action = input.critical_user_action;
  }
  if (input.logic_priority !== undefined) {
    output.logic_priority = input.logic_priority;
  }
  if (input.design_priority !== undefined) {
    output.design_priority = input.design_priority;
  }
  if (input.motion_level !== undefined) {
    output.motion_level = input.motion_level;
  }
  if (riskLevel !== undefined) {
    output.risk_level = riskLevel;
  }

  return output;
}

function buildSignalText(input: PdosIntakeInput): string {
  return normalizeText([
    input.text,
    input.project_type,
    input.primary_goal,
    input.critical_user_action,
    ...(input.target_users ?? []),
    ...(input.content_or_data ?? []),
    ...(input.must_have ?? []),
    ...(input.must_not_do ?? [])
  ].filter(Boolean).join(" "));
}

function scoreProjectType(signalText: string): PdosProjectType {
  const scores = new Map<PdosProjectType, number>();
  for (const type of PDOS_PROJECT_TYPES) {
    scores.set(type, 0);
  }

  for (const rule of PROJECT_SIGNAL_RULES) {
    const hits = rule.signals.filter((signal) => signalText.includes(signal)).length;
    scores.set(rule.projectType, (scores.get(rule.projectType) ?? 0) + hits * rule.weight);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const winner = ranked[0];
  if (winner && winner[1] > 0) {
    return winner[0];
  }

  return "marketing_web";
}

function calculateConfidence(signalText: string, projectType: PdosProjectType): number {
  const matchingRules = PROJECT_SIGNAL_RULES.filter((rule) => rule.projectType === projectType);
  const totalSignals = matchingRules.reduce((count, rule) => count + rule.signals.length, 0);
  const hits = matchingRules.reduce((count, rule) => count + rule.signals.filter((signal) => signalText.includes(signal)).length, 0);
  if (totalSignals === 0 || hits === 0) {
    return 0.35;
  }
  return Math.min(0.95, 0.45 + hits / totalSignals);
}

function getRecipeDefaults(recipe: PdosRecipeId): { logicPriority: number; designPriority: number; motionLevel: number } {
  switch (recipe) {
    case "internal-ops-clean":
      return { logicPriority: 9, designPriority: 3, motionLevel: 1 };
    case "client-portal-trust":
      return { logicPriority: 8, designPriority: 5, motionLevel: 1 };
    case "ecommerce-conversion":
      return { logicPriority: 8, designPriority: 6, motionLevel: 2 };
    case "dashboard-data-heavy":
      return { logicPriority: 9, designPriority: 4, motionLevel: 1 };
    case "public-sector-accessible":
      return { logicPriority: 8, designPriority: 4, motionLevel: 0 };
    case "marketing-premium":
      return { logicPriority: 5, designPriority: 8, motionLevel: 4 };
    case "creative-motion":
      return { logicPriority: 4, designPriority: 9, motionLevel: 7 };
  }
}

function tunePriority(base: number, signalText: string, signals: readonly string[], bump: number, min = 1): number {
  const matched = includesAny(signalText, signals);
  return clampInt(base + (matched ? bump : 0), min, 10);
}

function inferRiskLevel(projectType: PdosProjectType, signalText: string): PdosRiskLevel {
  if (includesAny(signalText, ["secret", "security", "pii", "production", "billing", "payment", "checkout", "auth"])) {
    return "high";
  }

  if (projectType === "ecommerce" || projectType === "public_sector") {
    return "high";
  }

  if (projectType === "internal_system" || projectType === "crm" || projectType === "admin_panel" || projectType === "dashboard" || projectType === "data_tool") {
    return "medium";
  }

  return includesAny(signalText, RISK_SIGNALS) ? "medium" : "low";
}

function inferOpenQuestions(input: PdosIntakeInput, signalText: string): readonly string[] {
  const questions: string[] = [];
  if (!input.primary_goal && !includesAny(signalText, ["goal", "conversion", "lead", "sell", "support", "zisk", "poptav"])) {
    questions.push("primary_goal_missing");
  }
  if (!input.target_users || input.target_users.length === 0) {
    questions.push("target_users_missing");
  }
  if (!input.critical_user_action && !includesAny(signalText, ["cta", "checkout", "submit", "approve", "export", "contact", "buy", "poptav"])) {
    questions.push("critical_user_action_missing");
  }
  return questions;
}

function inferProjectStopConditions(openQuestions: readonly string[], projectType: PdosProjectType, signalText: string): readonly string[] {
  const stops = [...openQuestions];
  if ((projectType === "ecommerce" || signalText.includes("checkout")) && !includesAny(signalText, ["price", "payment", "shipping", "cart", "kosik"])) {
    stops.push("checkout_rules_missing");
  }
  if ((projectType === "internal_system" || projectType === "crm" || projectType === "admin_panel") && !includesAny(signalText, ["role", "permission", "workflow", "state"])) {
    stops.push("logic_model_missing");
  }
  return stops;
}

function buildProjectReasons(projectType: PdosProjectType, recipe: PdosRecipeId, signalText: string, explicit: boolean): readonly string[] {
  const reasons = [
    explicit ? "Project type came from explicit input." : `Project type inferred from matching ${projectType} signals.`,
    `Selected recipe ${recipe} for the inferred project type and visual/logic signals.`
  ];

  if (includesAny(signalText, MOTION_SIGNALS)) {
    reasons.push("Motion or visual-experience signals were present, so motion and reduced-motion QA must stay visible.");
  }

  if (includesAny(signalText, LOGIC_SIGNALS)) {
    reasons.push("Logic/workflow/data signals were present, so validation and state checks must stay visible.");
  }

  return reasons;
}

function isConflictRequest(signalText: string, projectType: PdosProjectType | undefined): boolean {
  const heavyVisual = includesAny(signalText, ["3d avatar", "particles", "video background", "webgl", "heavy motion", "hide seo", "skip accessibility", "remove tests"]);
  const criticalFlow = includesAny(signalText, ["checkout", "payment", "auth", "permission", "approval", "data entry", "critical flow"]);
  const conservativeProject = projectType === "ecommerce" || projectType === "internal_system" || projectType === "dashboard" || projectType === "public_sector";
  return heavyVisual && (criticalFlow || conservativeProject);
}

function buildChangeRoute(
  classification: PdosChangeRequestClass,
  request: string,
  context: PdosChangeRequestContext,
  reasons: readonly string[]
): PdosChangeRequestRoute {
  const riskLevel = classification === "E" ? "high" : context.risk_level ?? "medium";
  return {
    request,
    classification,
    label: CHANGE_LABELS[classification],
    requires_scope_change: classification === "B" || classification === "C",
    risk_level: riskLevel,
    reasons,
    recommendation: changeRecommendation(classification),
    stop_conditions: classification === "E" ? ["owner_decision_required", "do_not_implement_blindly"] : []
  };
}

function changeRecommendation(classification: PdosChangeRequestClass): string {
  switch (classification) {
    case "A":
      return "Record as a clarification and keep the current scope.";
    case "B":
      return "Create a scope change entry with acceptance criteria before implementation.";
    case "C":
      return "Re-run direction lock and product opposition before implementation.";
    case "D":
      return "Move to backlog or out-of-scope notes unless the owner promotes it.";
    case "E":
      return "Stop implementation, explain the conflict, and ask whether project priority or scope should change.";
  }
}

function parseProjectType(value: string | undefined): PdosProjectType | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = normalizeText(value).replace(/ /g, "_");
  return PDOS_PROJECT_TYPES.find((type) => type === normalized);
}

function parseRiskLevel(value: string | undefined): PdosRiskLevel | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "critical" ? value : undefined;
}

function boundedInt(value: number | undefined, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return undefined;
  }
  return clampInt(value, min, max);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function includesAny(text: string, signals: readonly string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readInputFile(file: string): unknown {
  const content = readFileSync(file, "utf8");
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArgs(args: readonly string[]): {
  file?: string;
  text?: string;
  change?: string;
  context?: string;
  format?: "json" | "markdown";
} {
  const result: {
    file?: string;
    text?: string;
    change?: string;
    context?: string;
    format?: "json" | "markdown";
  } = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key === "--report") {
      result.format = "markdown";
      continue;
    }
    if (!value) {
      continue;
    }
    if (key === "--file") {
      result.file = value;
      index += 1;
    } else if (key === "--text") {
      result.text = value;
      index += 1;
    } else if (key === "--change") {
      result.change = value;
      index += 1;
    } else if (key === "--context") {
      result.context = value;
      index += 1;
    } else if (key === "--format" && (value === "json" || value === "markdown")) {
      result.format = value;
      index += 1;
    }
  }
  return result;
}

function printUsage(): void {
  console.log(`Usage:
  npm run pdos:route -- --text "marketing site for leads"
  npm run pdos:report -- --text "marketing site for leads"
  npm run pdos:route -- --file product-design-os/briefs/example.json
  npm run pdos:route -- --change "add 3d avatar to checkout" --context context.json`);
}

function runCli(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file && !args.text && !args.change) {
    printUsage();
    return;
  }

  const contextValue = args.context && existsSync(args.context) ? readInputFile(args.context) : {};
  const context = isRecord(contextValue) ? (contextValue as PdosChangeRequestContext) : {};

  if (args.change) {
    const result = routeProductDesignOs({
      change_request: args.change,
      change_context: context
    });
    console.log(formatPdosRouteResult(result, args.format));
    return;
  }

  const inputValue = args.file ? readInputFile(args.file) : args.text ?? "";
  const input = isRecord(inputValue) || typeof inputValue === "string" ? inputValue : "";
  console.log(formatPdosRouteResult(routeProductDesignOs(input), args.format));
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (invokedFile === currentFile) {
  runCli();
}
