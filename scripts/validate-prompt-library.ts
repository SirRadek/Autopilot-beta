import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { isRecord, validateJsonSchema } from "../src/lib/delivery-system/validation";

export interface PromptLibraryValidationIssue {
  readonly file: string;
  readonly message: string;
}

export interface PromptLibraryValidationReport {
  readonly ok: boolean;
  readonly checkedFiles: readonly string[];
  readonly checkedPromptFiles: readonly string[];
  readonly errors: readonly PromptLibraryValidationIssue[];
}

const PROMPT_LIBRARY_ROOT = "prompt-library";
const PROMPT_SCHEMA_FILE = "prompt.schema.json";
const SOURCE_CATALOG_SCHEMA_FILE = "source-catalog.schema.json";
const SOURCE_CATALOG_FILE = "source-catalog.json";

export function validatePromptLibrary(repoRoot = process.cwd()): PromptLibraryValidationReport {
  const promptLibraryRoot = join(repoRoot, PROMPT_LIBRARY_ROOT);
  const promptSchemaPath = join(promptLibraryRoot, PROMPT_SCHEMA_FILE);
  const sourceCatalogSchemaPath = join(promptLibraryRoot, SOURCE_CATALOG_SCHEMA_FILE);
  const sourceCatalogPath = join(promptLibraryRoot, SOURCE_CATALOG_FILE);
  const checkedFiles = [promptSchemaPath, sourceCatalogSchemaPath, sourceCatalogPath].map((file) =>
    toRepoPath(repoRoot, file)
  );
  const checkedPromptFiles: string[] = [];
  const errors: PromptLibraryValidationIssue[] = [];

  if (!existsSync(promptLibraryRoot)) {
    return {
      ok: false,
      checkedFiles,
      checkedPromptFiles,
      errors: [{ file: PROMPT_LIBRARY_ROOT, message: "Prompt library directory does not exist." }]
    };
  }

  const promptSchema = readJsonFile(promptSchemaPath, repoRoot, errors);
  const sourceCatalogSchema = readJsonFile(sourceCatalogSchemaPath, repoRoot, errors);
  const sourceCatalog = readJsonFile(sourceCatalogPath, repoRoot, errors);
  const knownSourceIds = sourceIdsFromCatalog(sourceCatalog);

  if (isRecord(sourceCatalogSchema) && sourceCatalog !== undefined) {
    for (const issue of validateJsonSchema(sourceCatalog, sourceCatalogSchema)) {
      errors.push({ file: toRepoPath(repoRoot, sourceCatalogPath), message: `${issue.path}: ${issue.message}` });
    }
  }

  const promptFiles = listMarkdownFiles(promptLibraryRoot)
    .filter((file) => !file.endsWith(`${separator()}README.md`) && file !== join(promptLibraryRoot, "README.md"))
    .sort();

  for (const file of promptFiles) {
    const repoPath = toRepoPath(repoRoot, file);
    checkedFiles.push(repoPath);
    checkedPromptFiles.push(repoPath);

    const frontmatter = readPromptFrontmatter(file, repoRoot, errors);
    if (frontmatter === undefined || !isRecord(promptSchema)) {
      continue;
    }

    for (const issue of validateJsonSchema(frontmatter, promptSchema)) {
      errors.push({ file: repoPath, message: `${issue.path}: ${issue.message}` });
    }

    validatePromptSources(frontmatter, knownSourceIds, repoPath, errors);
  }

  return {
    ok: errors.length === 0,
    checkedFiles: [...new Set(checkedFiles)].sort(),
    checkedPromptFiles,
    errors
  };
}

export function formatPromptLibraryValidationReport(report: PromptLibraryValidationReport): string {
  if (report.ok) {
    return `Prompt-library validation passed: ${report.checkedPromptFiles.length} prompt file(s) and source-catalog.json.`;
  }

  const lines = [
    "Prompt-library validation failed.",
    `Checked prompt files: ${report.checkedPromptFiles.length}`,
    `Errors: ${report.errors.length}`,
    "",
    "Errors:"
  ];

  lines.push(...report.errors.map((issue) => `- ${issue.file}: ${issue.message}`));
  return lines.join("\n");
}

function readPromptFrontmatter(
  file: string,
  repoRoot: string,
  errors: PromptLibraryValidationIssue[]
): unknown | undefined {
  const repoPath = toRepoPath(repoRoot, file);

  try {
    const content = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const frontmatter = extractFrontmatter(content);

    if (!frontmatter.ok) {
      errors.push({ file: repoPath, message: frontmatter.message });
      return undefined;
    }

    try {
      return parse(frontmatter.yaml) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown YAML parse failure.";
      errors.push({ file: repoPath, message: `YAML frontmatter parse failed: ${message}` });
      return undefined;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown file read failure.";
    errors.push({ file: repoPath, message });
    return undefined;
  }
}

function extractFrontmatter(content: string): { ok: true; yaml: string } | { ok: false; message: string } {
  const lines = content.split(/\r?\n/);

  if (lines[0] !== "---") {
    return { ok: false, message: "Missing YAML frontmatter." };
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex === -1) {
    return { ok: false, message: "YAML frontmatter is missing a closing delimiter." };
  }

  return { ok: true, yaml: lines.slice(1, endIndex).join("\n") };
}

function readJsonFile(file: string, repoRoot: string, errors: PromptLibraryValidationIssue[]): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse failure.";
    errors.push({ file: toRepoPath(repoRoot, file), message });
    return undefined;
  }
}

function sourceIdsFromCatalog(sourceCatalog: unknown): ReadonlySet<string> {
  if (!isRecord(sourceCatalog) || !Array.isArray(sourceCatalog.sources)) {
    return new Set();
  }

  return new Set(
    sourceCatalog.sources
      .filter(isRecord)
      .map((source) => source.id)
      .filter((id): id is string => typeof id === "string")
  );
}

function validatePromptSources(
  frontmatter: unknown,
  knownSourceIds: ReadonlySet<string>,
  repoPath: string,
  errors: PromptLibraryValidationIssue[]
): void {
  if (!isRecord(frontmatter)) {
    return;
  }

  if (!Array.isArray(frontmatter.sources)) {
    return;
  }

  frontmatter.sources.forEach((source, index) => {
    if (typeof source === "string" && !knownSourceIds.has(source)) {
      errors.push({
        file: repoPath,
        message: `$.sources[${index}]: unknown source id "${source}" in prompt-library/source-catalog.json`
      });
    }
  });
}

function listMarkdownFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      return listMarkdownFiles(path);
    }

    return path.endsWith(".md") ? [path] : [];
  });
}

function separator(): "\\" | "/" {
  return process.platform === "win32" ? "\\" : "/";
}

function toRepoPath(repoRoot: string, file: string): string {
  return relative(repoRoot, file).replace(/\\/g, "/");
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (invokedFile === currentFile) {
  const report = validatePromptLibrary();
  console.log(formatPromptLibraryValidationReport(report));

  if (!report.ok) {
    process.exit(1);
  }
}
