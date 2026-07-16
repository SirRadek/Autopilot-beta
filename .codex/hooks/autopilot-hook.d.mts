export interface InvestigatorDecisionInput {
  readonly failed: boolean;
  readonly flags: readonly string[];
  readonly recentFailureCount: number;
}

export declare const hookTestInternals: {
  readonly createSupervisorAlert: (
    type: string,
    message: string,
    provider?: string,
  ) => unknown;
  readonly shouldQueueInvestigator: (
    input: InvestigatorDecisionInput,
  ) => boolean;
};

export declare function handleHook(input: Record<string, unknown>): Promise<unknown>;
