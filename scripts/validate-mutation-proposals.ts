import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ALLOWED_OPS, validateProposalGovernance } from "../src/data/delivery-system/figmaMutation";
import { validateJsonSchema } from "../src/lib/delivery-system/validation";

export { ALLOWED_OPS };

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
    let record: unknown;
    try {
      record = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      errors.push({ file: rel, message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    // File-shape validation against the JSON schema, then shared runtime governance guard.
    for (const issue of validateJsonSchema(record, schema)) errors.push({ file: rel, message: `${issue.path}: ${issue.message}` });
    for (const issue of validateProposalGovernance(record)) errors.push({ file: rel, message: issue });
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
