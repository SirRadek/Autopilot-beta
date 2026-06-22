export type WorkflowState =
  | "request"
  | "business_review"
  | "planning"
  | "architecture"
  | "analysis"
  | "execution"
  | "testing"
  | "review"
  | "copywriting_ux_validation"
  | "governance_gate"
  | "delivery"
  | "monitoring"
  | "memory"
  | "rework"
  | "blocked";

export interface WorkflowTransition {
  from: WorkflowState;
  to: WorkflowState;
  condition: string;
}

export const workflowStates = [
  "request",
  "business_review",
  "planning",
  "architecture",
  "analysis",
  "execution",
  "testing",
  "review",
  "copywriting_ux_validation",
  "governance_gate",
  "delivery",
  "monitoring",
  "memory",
  "rework",
  "blocked"
] as const satisfies readonly WorkflowState[];

export const workflowTransitions = [
  { from: "request", to: "business_review", condition: "request received" },
  { from: "business_review", to: "planning", condition: "business alignment accepted" },
  { from: "planning", to: "architecture", condition: "task graph drafted" },
  { from: "architecture", to: "analysis", condition: "architecture boundary recorded" },
  { from: "analysis", to: "execution", condition: "risks and unknowns recorded" },
  { from: "execution", to: "testing", condition: "bounded implementation complete" },
  { from: "testing", to: "review", condition: "tests pass or failures summarized" },
  { from: "review", to: "copywriting_ux_validation", condition: "review passed" },
  {
    from: "copywriting_ux_validation",
    to: "governance_gate",
    condition: "UX and content checks complete"
  },
  { from: "governance_gate", to: "delivery", condition: "gate result pass" },
  { from: "delivery", to: "monitoring", condition: "delivery accepted" },
  { from: "monitoring", to: "memory", condition: "run evidence summarized" },
  { from: "memory", to: "planning", condition: "lessons and optimization signals shape the next planning cycle" },
  { from: "governance_gate", to: "rework", condition: "blocker or major issue found" },
  { from: "testing", to: "rework", condition: "failed tests require fix" },
  { from: "rework", to: "testing", condition: "fix assigned and completed" },
  { from: "planning", to: "blocked", condition: "missing approval or evidence" }
] as const satisfies readonly WorkflowTransition[];
