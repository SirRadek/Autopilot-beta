export type TokenPrimitive = string | number | boolean;

export type TokenOverrideMap = Partial<Record<string, Record<string, TokenPrimitive>>>;

export interface ContractProp {
  readonly name: string;
  readonly value_type: string;
  readonly required: boolean;
  readonly min_length?: number;
}

export interface ContractSlot {
  readonly name: string;
  readonly required: boolean;
  readonly min_items?: number;
  readonly max_items?: number;
  readonly allowed_asset_ids?: readonly string[];
}

export interface ContractInvariant {
  readonly code: string;
  readonly required: boolean;
  readonly severity: "error" | "warning";
  readonly description?: string;
}

export interface ComponentContract {
  readonly id: string;
  readonly target_kind: "asset" | "pattern";
  readonly target_id: string;
  readonly props: readonly ContractProp[];
  readonly slots: readonly ContractSlot[];
  readonly output_invariants: readonly ContractInvariant[];
}

export interface AssetManifestEntry {
  readonly id: string;
  readonly type: string;
  readonly source: string;
  readonly notes?: string;
}

export interface ResolvedAsset {
  readonly id: string;
  readonly targetKind: "asset";
  readonly assetType: string;
  readonly source: string;
  readonly href?: string;
  readonly inlineSvg?: string;
}

export interface QaTarget {
  readonly patternId: string;
  readonly contractId: string;
  readonly invariants: readonly string[];
  readonly selectors: {
    readonly h1: string;
    readonly cta: string;
    readonly trustCue: string;
  };
}
