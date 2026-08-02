import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateJsonSchema } from "../src/lib/delivery-system/validation";

/** The closed, typed op allowlist. There is no arbitrary-code op — governance depends on this. */
export const ALLOWED_OPS = ["createFrame", "applyTokens", "setText", "addComment", "createVariant", "verificationFrame", "placeImage"] as const;
export type FigmaOp = (typeof ALLOWED_OPS)[number];

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

export interface MutationValidationIssue { readonly file: string; readonly message: string }
export interface MutationValidationReport { readonly ok: boolean; readonly checkedFiles: readonly string[]; readonly errors: readonly MutationValidationIssue[] }

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dir = join(repoRoot, "design", "mutations");
const schemaPath = join(dir, "mutation-proposal.schema.json");

function collect(d: string): string[] {
  if (!existsSync(d)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(d)) {
    const full = join(d, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (entry.endsWith(".proposal.json")) out.push(full);
  }
  return out;
}

export function validateMutationProposals(): MutationValidationReport {
  const errors: MutationValidationIssue[] = [];
  const checkedFiles: string[] = [];
  if (!existsSync(schemaPath)) return { ok: false, checkedFiles, errors: [{ file: relative(repoRoot, schemaPath), message: "schema missing" }] };
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as unknown;

  for (const file of collect(dir)) {
    const rel = relative(repoRoot, file);
    checkedFiles.push(rel);
    let record: { ops?: Array<{ op?: string; target?: unknown; args?: Record<string, unknown> }>; rollbackPlan?: { versionCheckpoint?: unknown } };
    try {
      record = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      errors.push({ file: rel, message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    for (const issue of validateJsonSchema(record, schema)) errors.push({ file: rel, message: `${issue.path}: ${issue.message}` });

    // Governance: closed op allowlist + per-op required args + mandatory version checkpoint.
    for (const [index, op] of (record.ops ?? []).entries()) {
      const name = op.op as FigmaOp | undefined;
      if (!name || !(ALLOWED_OPS as readonly string[]).includes(name)) {
        errors.push({ file: rel, message: `ops[${index}]: op "${String(name)}" is outside the allowlist` });
        continue;
      }
      for (const required of OP_REQUIRED_ARGS[name] ?? []) {
        if (op.args?.[required] === undefined) errors.push({ file: rel, message: `ops[${index}] (${name}): missing args.${required}` });
      }
      if (OPS_NEEDING_TARGET.has(name) && typeof op.target !== "string") {
        errors.push({ file: rel, message: `ops[${index}] (${name}): requires a target node id` });
      }
    }
    if (record.rollbackPlan?.versionCheckpoint !== true) {
      errors.push({ file: rel, message: "rollbackPlan.versionCheckpoint must be true (a Figma version checkpoint is always required before a write)" });
    }
  }
  return { ok: errors.length === 0, checkedFiles, errors };
}

function main(): void {
  const report = validateMutationProposals();
  for (const error of report.errors) console.error(`✗ ${error.file} — ${error.message}`);
  console.log(`Figma mutation proposal validation ${report.ok ? "passed" : "FAILED"}.`);
  console.log(`Checked files: ${report.checkedFiles.length}`);
  console.log(`Errors: ${report.errors.length}`);
  if (!report.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
