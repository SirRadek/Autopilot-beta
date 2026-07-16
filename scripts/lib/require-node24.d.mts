export interface RequireNode24Input {
  readonly version?: string;
  readonly execPath?: string;
  readonly writeError?: (message: string) => void;
}

export declare function parseNodeMajor(version: string): number | null;
export declare function requireNode24(input?: RequireNode24Input): void;
