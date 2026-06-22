export type HandoffSection =
  | "handoff_id"
  | "source_agent"
  | "target_agent"
  | "project"
  | "mode"
  | "goal"
  | "scope"
  | "allowed_files_or_surfaces"
  | "forbidden_actions"
  | "verified_facts"
  | "expected_output"
  | "required_checks"
  | "stop_conditions"
  | "reuse_check"
  | "context_budget";

declare const __handoffIdBrand: unique symbol;
export type HandoffId = string & { readonly [__handoffIdBrand]: "HandoffId" };

export function makeHandoffId(slug: string): HandoffId {
  if (!/^hp-\d{8}-[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`Invalid HandoffId format: "${slug}". Expected: hp-YYYYMMDD-<slug>`);
  }

  return slug as HandoffId;
}

export type HandoffMode = "DRY_RUN" | "INSPECT_ONLY" | "WRITE_ALLOWED" | "REMOTE_MUTATION_APPROVED";

export interface ContextBudgetSummary {
  readonly profile: "caveman" | "standard_compact" | "review_compact" | "research_compact";
  readonly maxFilesInPacket: number;
  readonly maxContextLines: number;
}

export interface ReuseCheckSummary {
  readonly searchedPatterns: readonly string[];
  readonly existingMatches: readonly string[];
  readonly packageMatches: readonly string[];
  readonly decision: "implement_new" | "reuse_existing" | "extend_existing";
  readonly reuseTarget: string | undefined;
}

export interface HandoffPacket {
  readonly handoffId: HandoffId;
  readonly sourceAgent: string;
  readonly targetAgent: string;
  readonly project: string;
  readonly mode: HandoffMode;
  readonly goal: string;
  readonly scope: string;
  readonly allowedFilesOrSurfaces: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly verifiedFacts: readonly string[];
  readonly expectedOutput: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
  readonly reuseCheck: ReuseCheckSummary | undefined;
  readonly contextBudget: ContextBudgetSummary | undefined;
}

export interface CompletionMatrixResult {
  readonly valid: boolean;
  readonly missingSections: readonly HandoffSection[];
  readonly warnings: readonly string[];
}

export const REQUIRED_SECTIONS_ALWAYS: readonly HandoffSection[] = [
  "handoff_id",
  "source_agent",
  "target_agent",
  "project",
  "mode",
  "goal",
  "scope",
  "allowed_files_or_surfaces",
  "forbidden_actions",
  "verified_facts",
  "expected_output",
  "required_checks",
  "stop_conditions",
  "context_budget"
];

export const REQUIRED_SECTIONS_BOUNDED_CODING: readonly HandoffSection[] = [
  ...REQUIRED_SECTIONS_ALWAYS,
  "reuse_check"
];

type HandoffTaskType = "bounded_coding" | "review" | "analysis";

const SECTION_FIELD_MAP = {
  handoff_id: "handoffId",
  source_agent: "sourceAgent",
  target_agent: "targetAgent",
  project: "project",
  mode: "mode",
  goal: "goal",
  scope: "scope",
  allowed_files_or_surfaces: "allowedFilesOrSurfaces",
  forbidden_actions: "forbiddenActions",
  verified_facts: "verifiedFacts",
  expected_output: "expectedOutput",
  required_checks: "requiredChecks",
  stop_conditions: "stopConditions",
  reuse_check: "reuseCheck",
  context_budget: "contextBudget"
} as const satisfies Record<HandoffSection, keyof HandoffPacket>;

const HANDOFF_MODES = new Set<HandoffMode>([
  "DRY_RUN",
  "INSPECT_ONLY",
  "WRITE_ALLOWED",
  "REMOTE_MUTATION_APPROVED"
]);

const CONTEXT_BUDGET_PROFILES = new Set<ContextBudgetSummary["profile"]>([
  "caveman",
  "standard_compact",
  "review_compact",
  "research_compact"
]);

const REUSE_DECISIONS = new Set<ReuseCheckSummary["decision"]>([
  "implement_new",
  "reuse_existing",
  "extend_existing"
]);

const HANDOFF_PACKET_KEYS = new Set<keyof HandoffPacket>([
  "handoffId",
  "sourceAgent",
  "targetAgent",
  "project",
  "mode",
  "goal",
  "scope",
  "allowedFilesOrSurfaces",
  "forbiddenActions",
  "verifiedFacts",
  "expectedOutput",
  "requiredChecks",
  "stopConditions",
  "reuseCheck",
  "contextBudget"
]);

export function validateHandoffPacket(
  packet: Partial<HandoffPacket>,
  taskType?: HandoffTaskType
): CompletionMatrixResult {
  const requiredSections =
    taskType === "bounded_coding" ? REQUIRED_SECTIONS_BOUNDED_CODING : REQUIRED_SECTIONS_ALWAYS;
  const missingSections: HandoffSection[] = [];
  const warnings: string[] = [];

  for (const section of requiredSections) {
    const value = packet[SECTION_FIELD_MAP[section]];

    if (isMissing(value)) {
      missingSections.push(section);
    } else if (!isSectionValueValid(section, value)) {
      addMissingOnce(missingSections, section);
      warnings.push(`${section} is present but invalid.`);
    }
  }

  if (
    !requiredSections.includes("reuse_check") &&
    packet.reuseCheck !== undefined &&
    !isReuseCheckSummary(packet.reuseCheck)
  ) {
    addMissingOnce(missingSections, "reuse_check");
    warnings.push("reuse_check is present but invalid.");
  }

  return {
    valid: missingSections.length === 0,
    missingSections,
    warnings
  };
}

export function isHandoffPacket(value: unknown): value is HandoffPacket {
  if (!isRecord(value)) {
    return false;
  }

  const packet = value as Partial<HandoffPacket>;
  const result = validateHandoffPacket(packet);

  return (
    result.valid &&
    Object.keys(value).every((key) => HANDOFF_PACKET_KEYS.has(key as keyof HandoffPacket)) &&
    typeof packet.handoffId === "string" &&
    isValidHandoffId(packet.handoffId) &&
    typeof packet.sourceAgent === "string" &&
    typeof packet.targetAgent === "string" &&
    typeof packet.project === "string" &&
    HANDOFF_MODES.has(packet.mode as HandoffMode) &&
    typeof packet.goal === "string" &&
    typeof packet.scope === "string" &&
    isStringArray(packet.allowedFilesOrSurfaces) &&
    isStringArray(packet.forbiddenActions) &&
    isStringArray(packet.verifiedFacts) &&
    isStringArray(packet.expectedOutput) &&
    isStringArray(packet.requiredChecks) &&
    isStringArray(packet.stopConditions) &&
    isContextBudgetSummary(packet.contextBudget) &&
    (packet.reuseCheck === undefined || isReuseCheckSummary(packet.reuseCheck))
  );
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function isSectionValueValid(section: HandoffSection, value: unknown): boolean {
  switch (section) {
    case "handoff_id":
      return typeof value === "string" && isValidHandoffId(value);
    case "source_agent":
    case "target_agent":
    case "project":
    case "goal":
    case "scope":
      return typeof value === "string" && value.length > 0;
    case "mode":
      return HANDOFF_MODES.has(value as HandoffMode);
    case "allowed_files_or_surfaces":
    case "forbidden_actions":
    case "verified_facts":
    case "expected_output":
    case "required_checks":
    case "stop_conditions":
      return isStringArray(value);
    case "reuse_check":
      return isReuseCheckSummary(value);
    case "context_budget":
      return isContextBudgetSummary(value);
  }
}

function addMissingOnce(missingSections: HandoffSection[], section: HandoffSection): void {
  if (!missingSections.includes(section)) {
    missingSections.push(section);
  }
}

function isValidHandoffId(value: string): boolean {
  try {
    makeHandoffId(value);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isContextBudgetSummary(value: unknown): value is ContextBudgetSummary {
  if (!isRecord(value)) {
    return false;
  }

  const maxFilesInPacket = value.maxFilesInPacket;
  const maxContextLines = value.maxContextLines;

  return (
    CONTEXT_BUDGET_PROFILES.has(value.profile as ContextBudgetSummary["profile"]) &&
    Number.isInteger(maxFilesInPacket) &&
    typeof maxFilesInPacket === "number" &&
    maxFilesInPacket > 0 &&
    Number.isInteger(maxContextLines) &&
    typeof maxContextLines === "number" &&
    maxContextLines > 0
  );
}

function isReuseCheckSummary(value: unknown): value is ReuseCheckSummary {
  return (
    isRecord(value) &&
    isStringArray(value.searchedPatterns) &&
    isStringArray(value.existingMatches) &&
    isStringArray(value.packageMatches) &&
    REUSE_DECISIONS.has(value.decision as ReuseCheckSummary["decision"]) &&
    (typeof value.reuseTarget === "string" || value.reuseTarget === undefined)
  );
}
