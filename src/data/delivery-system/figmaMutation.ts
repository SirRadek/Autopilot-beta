// Shared Figma mutation contract — the single source of truth for the typed op
// allowlist. Governed by mesh node figma_write_boundary and
// docs/decisions/figma-write-plugin-executor-adr.md. There is no arbitrary-code op.

export const ALLOWED_OPS = ["createFrame", "applyTokens", "setText", "addComment", "createVariant", "verificationFrame", "placeImage"] as const;
export type FigmaOp = (typeof ALLOWED_OPS)[number];

export interface MutationOp {
  readonly op: FigmaOp;
  readonly target?: string;
  readonly args?: Record<string, unknown>;
}

export interface MutationProposal {
  readonly schemaVersion: "autopilot.figma-mutation/1";
  readonly source: { readonly provider: "figma"; readonly fileKey: string };
  readonly briefHash: string;
  readonly expectedVersion: string;
  readonly ops: readonly MutationOp[];
  readonly preview?: { readonly summary?: string; readonly imageRef?: string };
  readonly rollbackPlan: { readonly versionCheckpoint: true; readonly archivePage?: string; readonly notes?: string };
}

const OP_REQUIRED_ARGS: Partial<Record<FigmaOp, readonly string[]>> = {
  createFrame: ["name"],
  applyTokens: ["tokens"],
  setText: ["text"],
  addComment: ["text"],
  createVariant: ["component"],
  verificationFrame: ["label"],
  placeImage: ["assetRef"],
};
const OPS_NEEDING_TARGET: ReadonlySet<FigmaOp> = new Set(["applyTokens", "setText"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runtime governance guard for a mutation proposal: closed op allowlist, per-op
 * required args, target ids, and a mandatory version checkpoint. Returns a list
 * of issues (empty = acceptable). Used by both the validator script and the
 * store's submit path so the allowlist can never drift between them.
 */
export function validateProposalGovernance(proposal: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(proposal)) return ["proposal must be an object"];
  if (proposal.schemaVersion !== "autopilot.figma-mutation/1") issues.push("schemaVersion must be autopilot.figma-mutation/1");
  const source = proposal.source;
  if (!isRecord(source) || source.provider !== "figma" || typeof source.fileKey !== "string" || source.fileKey.length === 0) issues.push("source must be { provider: 'figma', fileKey }");
  if (typeof proposal.briefHash !== "string" || !/^[a-f0-9]{64}$/.test(proposal.briefHash)) issues.push("briefHash must be a sha256 hex string");
  if (typeof proposal.expectedVersion !== "string" || proposal.expectedVersion.length === 0) issues.push("expectedVersion is required");
  const rollback = proposal.rollbackPlan;
  if (!isRecord(rollback) || rollback.versionCheckpoint !== true) issues.push("rollbackPlan.versionCheckpoint must be true");
  const ops = proposal.ops;
  if (!Array.isArray(ops) || ops.length === 0) {
    issues.push("ops must be a non-empty array");
    return issues;
  }
  ops.forEach((op, index) => {
    if (!isRecord(op)) { issues.push(`ops[${index}] must be an object`); return; }
    const name = op.op;
    if (typeof name !== "string" || !(ALLOWED_OPS as readonly string[]).includes(name)) {
      issues.push(`ops[${index}]: op "${String(name)}" is outside the allowlist`);
      return;
    }
    const args = isRecord(op.args) ? op.args : {};
    for (const required of OP_REQUIRED_ARGS[name as FigmaOp] ?? []) {
      if (args[required] === undefined) issues.push(`ops[${index}] (${name}): missing args.${required}`);
    }
    if (OPS_NEEDING_TARGET.has(name as FigmaOp) && typeof op.target !== "string") issues.push(`ops[${index}] (${name}): requires a target node id`);
  });
  return issues;
}
