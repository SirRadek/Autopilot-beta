import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateJsonSchema } from "../src/lib/delivery-system/validation";

export interface DesignBriefValidationIssue {
  readonly file: string;
  readonly message: string;
}

export interface DesignBriefValidationReport {
  readonly ok: boolean;
  readonly checkedFiles: readonly string[];
  readonly errors: readonly DesignBriefValidationIssue[];
}

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const briefsDir = join(repoRoot, "design", "briefs");
const schemaPath = join(briefsDir, "schema", "design-brief.schema.json");

function collectBriefFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "schema") continue;
      out.push(...collectBriefFiles(full));
    } else if (entry.endsWith(".brief.json")) {
      out.push(full);
    }
  }
  return out;
}

export function validateDesignBriefs(): DesignBriefValidationReport {
  const errors: DesignBriefValidationIssue[] = [];
  const checkedFiles: string[] = [];

  if (!existsSync(schemaPath)) {
    return { ok: false, checkedFiles, errors: [{ file: relative(repoRoot, schemaPath), message: "schema file missing" }] };
  }
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as unknown;

  for (const file of collectBriefFiles(briefsDir)) {
    const rel = relative(repoRoot, file);
    checkedFiles.push(rel);
    let record: unknown;
    try {
      record = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      errors.push({ file: rel, message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    for (const issue of validateJsonSchema(record, schema)) {
      errors.push({ file: rel, message: `${issue.path}: ${issue.message}` });
    }
    // Layer 1 integrity: the referenced code tokens file (source of truth) must exist.
    const tokensPath = (record as { tokensRef?: { path?: unknown } }).tokensRef?.path;
    if (typeof tokensPath === "string" && !existsSync(join(repoRoot, tokensPath))) {
      errors.push({ file: rel, message: `tokensRef.path does not exist in repo: ${tokensPath}` });
    }
  }

  return { ok: errors.length === 0, checkedFiles, errors };
}

function main(): void {
  const report = validateDesignBriefs();
  for (const error of report.errors) {
    console.error(`✗ ${error.file} — ${error.message}`);
  }
  console.log(`Design brief validation ${report.ok ? "passed" : "FAILED"}.`);
  console.log(`Checked files: ${report.checkedFiles.length}`);
  console.log(`Errors: ${report.errors.length}`);
  if (!report.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
