export type DependencyFreshnessState =
  | "current"
  | "minor_update_available"
  | "major_update_available"
  | "deprecated"
  | "security_vulnerability"
  | "unknown";

export type UpdateDecision = "update_when_convenient" | "research_needed" | "urgent" | "hold" | "pending";

export interface DependencyCheckRecord {
  readonly checkedAt: string;
  readonly packageName: string;
  readonly installedVersion: string;
  readonly latestVersion: string | undefined;
  readonly freshnessState: DependencyFreshnessState;
  readonly newFeaturesRelevantToProject: readonly string[];
  readonly securityAdvisory: string | undefined;
  readonly updateDecision: UpdateDecision;
  readonly ownerApprovalRequired: boolean;
}

export type ReuseDecision = "implement_new" | "reuse_existing" | "extend_existing";

export interface ReuseCheckResult {
  readonly searchedPatterns: readonly string[];
  readonly existingMatches: readonly string[];
  readonly packageMatches: readonly string[];
  readonly decision: ReuseDecision;
  readonly reuseTarget: string | undefined;
  readonly tokenSavingEstimate: "high" | "medium" | "low" | "none";
}

export const dependencyFreshnessPolicy = {
  checkCommands: ["npm.cmd outdated --json", "npm.cmd audit --json"],
  autoUpdateAllowed: false as const,
  majorUpdateRequiresOwner: true,
  checkBeforeTaskTypes: ["architecture_review", "new_feature", "major_refactor", "security_audit"],
  stopConditions: [
    "major_version_bump_without_owner_decision",
    "security_vulnerability_ignored",
    "new_code_written_when_library_update_would_provide_it"
  ]
} as const;
