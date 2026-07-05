// Types for the report-first baseline-waiver gate so its pure core is unit-testable.

export interface BaselineEntry {
  readonly path: string;
  readonly before: ReadonlySet<string>;
  readonly after: ReadonlySet<string>;
}

export interface BaselineFinding {
  readonly path: string;
  readonly added: readonly string[];
}

export declare function extractWaivedTargets(commitMessages: readonly string[]): Set<string>;
export declare function findUnwaivedBaselineGrowth(
  entries: readonly BaselineEntry[],
  commitMessages: readonly string[]
): BaselineFinding[];
