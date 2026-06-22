import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateJsonSchema } from "../../src/lib/delivery-system/validation";

export interface PdosValidationIssue {
  readonly file: string;
  readonly message: string;
}

export interface PdosValidationReport {
  readonly ok: boolean;
  readonly checkedFiles: readonly string[];
  readonly errors: readonly PdosValidationIssue[];
  readonly warnings: readonly PdosValidationIssue[];
}

const REQUIRED_FILES = [
  "README.md",
  "briefs/project-brief.schema.json",
  "briefs/brief-template.md",
  "scope/PROJECT_SCOPE.md",
  "scope/CHANGE_REQUESTS.md",
  "scope/DECISIONS.md",
  "scope/OUT_OF_SCOPE.md",
  "rules/strict-process.md",
  "rules/logic-first.md",
  "rules/multi-agent-routing.md",
  "rules/change-request-rules.md",
  "rules/anti-ai-slop.md",
  "rules/design-seo-tradeoff.md",
  "rules/source-and-license-gates.md",
  "rules/clean-room-reference-workflow.md",
  "rules/accessibility.md",
  "rules/performance.md",
  "library/README.md",
  "library/source.schema.json",
  "library/reference.schema.json",
  "library/project-entry.schema.json",
  "library/source-catalog.json",
  "library/reference-catalog.json",
  "library/project-index.json",
  "assets/asset.schema.json",
  "assets/asset-manifest.json",
  "patterns/pattern.schema.json",
  "patterns/pattern-manifest.json",
  "agents/agent-task-template.md",
  "agents/design-critic.md",
  "agents/strict-opponent.md",
  "agents/gemini-reviewer.md",
  "agents/qwen-worker.md",
  "taste/global-liked.json",
  "taste/global-disliked.json",
  "taste/project-preferences.json",
  "taste/feedback-log.json",
  "taste/pattern-scores.json",
  "reader/README.md",
  "reader/capture-sample.html",
  "reader/document-reader-adapter.ts",
  "reader/pdf-supervisor-adapter.md",
  "reader/visual-qa-sample.json",
  "scripts/capture-design-reader.ts",
  "scripts/validate-product-design-os.ts",
  "scripts/route-product-design-os.ts",
  "scripts/score-product-design-os.ts",
  "scripts/visual-qa-product-design-os.ts",
  "scripts/update-project-library.ts"
] as const;

const REQUIRED_RECIPES = [
  "client-portal-trust",
  "creative-motion",
  "dashboard-data-heavy",
  "ecommerce-conversion",
  "internal-ops-clean",
  "marketing-premium",
  "public-sector-accessible"
] as const;

const REQUIRED_SCOPE_HEADINGS = [
  "## Typ projektu",
  "## Primarni cil",
  `## Cilovi ${"uzivatel"}e`,
  "## Kriticke workflow",
  "## Definition Of Done"
] as const;

const REQUIRED_STRICT_PROCESS_TERMS = [
  "select_capabilities",
  "get_relevant_subgraph",
  "build_agent_packet",
  "build_project_mesh_packet",
  "Project Type Lock",
  "QA Lock"
] as const;

const PROJECT_STATUSES = [
  "not_started",
  "ready",
  "in_progress",
  "needs_review",
  "blocked",
  "waiting_owner",
  "waiting_external",
  "done",
  "cancelled"
] as const;

export function validateProductDesignOs(repoRoot = process.cwd()): PdosValidationReport {
  const pdosRoot = join(repoRoot, "product-design-os");
  const errors: PdosValidationIssue[] = [];
  const warnings: PdosValidationIssue[] = [];
  const checkedFiles: string[] = [];

  if (!existsSync(pdosRoot)) {
    return {
      ok: false,
      checkedFiles,
      errors: [{ file: "product-design-os", message: "Product & Design OS root does not exist." }],
      warnings
    };
  }

  for (const file of REQUIRED_FILES) {
    const absolutePath = join(pdosRoot, file);
    checkedFiles.push(toRepoPath(repoRoot, absolutePath));

    if (!existsSync(absolutePath)) {
      errors.push({ file: toRepoPath(repoRoot, absolutePath), message: "Required file is missing." });
    }
  }

  const jsonFiles = listFiles(pdosRoot).filter((file) => file.endsWith(".json"));
  for (const file of jsonFiles) {
    checkedFiles.push(toRepoPath(repoRoot, file));
    readJsonFile(file, repoRoot, errors);
  }

  validateBriefSchema(join(pdosRoot, "briefs/project-brief.schema.json"), repoRoot, errors);
  validateManifests(pdosRoot, repoRoot, errors);
  validateSchemaCatalogs(pdosRoot, repoRoot, errors);
  validateLibraryRelationships(pdosRoot, repoRoot, errors);
  validateTasteMemory(pdosRoot, repoRoot, errors);
  validateRecipes(join(pdosRoot, "recipes"), repoRoot, errors);
  validateMarkdown(pdosRoot, repoRoot, errors, warnings);

  return {
    ok: errors.length === 0,
    checkedFiles: [...new Set(checkedFiles)].sort(),
    errors,
    warnings
  };
}

export function formatPdosValidationReport(report: PdosValidationReport): string {
  const lines = [
    report.ok ? "PDOS validation passed." : "PDOS validation failed.",
    `Checked files: ${report.checkedFiles.length}`,
    `Errors: ${report.errors.length}`,
    `Warnings: ${report.warnings.length}`
  ];

  if (report.errors.length > 0) {
    lines.push("", "Errors:");
    lines.push(...report.errors.map((issue) => `- ${issue.file}: ${issue.message}`));
  }

  if (report.warnings.length > 0) {
    lines.push("", "Warnings:");
    lines.push(...report.warnings.map((issue) => `- ${issue.file}: ${issue.message}`));
  }

  return lines.join("\n");
}

function validateBriefSchema(file: string, repoRoot: string, errors: PdosValidationIssue[]): void {
  const value = readJsonFile(file, repoRoot, errors);
  if (!isRecord(value)) {
    return;
  }

  const required = value.required;
  for (const field of ["project_type", "primary_goal", "target_users", "critical_user_action"]) {
    if (!Array.isArray(required) || !required.includes(field)) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Brief schema must require ${field}.`
      });
    }
  }

  const projectType = value.properties;
  const enumValues = isRecord(projectType)
    ? getNestedArray(projectType, ["project_type", "enum"])
    : [];

  for (const projectTypeValue of ["marketing_web", "ecommerce", "internal_system", "dashboard"]) {
    if (!enumValues.includes(projectTypeValue)) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Brief schema project_type enum must include ${projectTypeValue}.`
      });
    }
  }
}

function validateManifests(pdosRoot: string, repoRoot: string, errors: PdosValidationIssue[]): void {
  const manifests = [
    { file: join(pdosRoot, "assets/asset-manifest.json"), key: "assets" },
    { file: join(pdosRoot, "patterns/pattern-manifest.json"), key: "patterns" }
  ];

  for (const manifest of manifests) {
    const value = readJsonFile(manifest.file, repoRoot, errors);
    if (!isRecord(value)) {
      continue;
    }

    if (value.version !== 1) {
      errors.push({ file: toRepoPath(repoRoot, manifest.file), message: "Manifest version must be 1." });
    }

    if (!Array.isArray(value[manifest.key])) {
      errors.push({
        file: toRepoPath(repoRoot, manifest.file),
        message: `Manifest must contain an array field named ${manifest.key}.`
      });
    }
  }
}

function validateSchemaCatalogs(pdosRoot: string, repoRoot: string, errors: PdosValidationIssue[]): void {
  validateCatalogEntries({
    pdosRoot,
    repoRoot,
    errors,
    schemaPath: "assets/asset.schema.json",
    catalogPath: "assets/asset-manifest.json",
    key: "assets"
  });
  validateCatalogEntries({
    pdosRoot,
    repoRoot,
    errors,
    schemaPath: "patterns/pattern.schema.json",
    catalogPath: "patterns/pattern-manifest.json",
    key: "patterns"
  });
  validateCatalogEntries({
    pdosRoot,
    repoRoot,
    errors,
    schemaPath: "library/source.schema.json",
    catalogPath: "library/source-catalog.json",
    key: "sources"
  });
  validateCatalogEntries({
    pdosRoot,
    repoRoot,
    errors,
    schemaPath: "library/reference.schema.json",
    catalogPath: "library/reference-catalog.json",
    key: "references"
  });
  validateCatalogEntries({
    pdosRoot,
    repoRoot,
    errors,
    schemaPath: "library/project-entry.schema.json",
    catalogPath: "library/project-index.json",
    key: "projects"
  });
}

function validateCatalogEntries(input: {
  readonly pdosRoot: string;
  readonly repoRoot: string;
  readonly errors: PdosValidationIssue[];
  readonly schemaPath: string;
  readonly catalogPath: string;
  readonly key: string;
}): void {
  const schemaFile = join(input.pdosRoot, input.schemaPath);
  const catalogFile = join(input.pdosRoot, input.catalogPath);
  const schema = readJsonFile(schemaFile, input.repoRoot, input.errors);
  const catalog = readJsonFile(catalogFile, input.repoRoot, input.errors);

  if (!isRecord(schema) || !isRecord(catalog)) {
    return;
  }

  const entries = catalog[input.key];
  if (!Array.isArray(entries)) {
    return;
  }

  entries.forEach((entry, index) => {
    for (const issue of validateJsonSchema(entry, schema)) {
      input.errors.push({
        file: toRepoPath(input.repoRoot, catalogFile),
        message: `${input.key}[${index}] ${issue.path}: ${issue.message}`
      });
    }
  });
}

function validateLibraryRelationships(pdosRoot: string, repoRoot: string, errors: PdosValidationIssue[]): void {
  const sourceCatalogFile = join(pdosRoot, "library/source-catalog.json");
  const referenceCatalogFile = join(pdosRoot, "library/reference-catalog.json");
  const assetManifestFile = join(pdosRoot, "assets/asset-manifest.json");
  const patternManifestFile = join(pdosRoot, "patterns/pattern-manifest.json");
  const projectIndexFile = join(pdosRoot, "library/project-index.json");

  const sourceCatalog = readJsonFile(sourceCatalogFile, repoRoot, errors);
  const referenceCatalog = readJsonFile(referenceCatalogFile, repoRoot, errors);
  const assetManifest = readJsonFile(assetManifestFile, repoRoot, errors);
  const patternManifest = readJsonFile(patternManifestFile, repoRoot, errors);
  const projectIndex = readJsonFile(projectIndexFile, repoRoot, errors);

  const sources = getRecordArray(sourceCatalog, "sources");
  const references = getRecordArray(referenceCatalog, "references");
  const assets = getRecordArray(assetManifest, "assets");
  const patterns = getRecordArray(patternManifest, "patterns");
  const projects = getRecordArray(projectIndex, "projects");
  const sourceById = new Map(sources.map((source) => [String(source.id), source]));
  const referenceBySourceUrl = new Map(
    references
      .filter((reference) => typeof reference.source_url === "string")
      .map((reference) => [String(reference.source_url), reference])
  );
  const sourceIds = new Set(sourceById.keys());
  const referenceIds = new Set(references.map((reference) => String(reference.id)));
  const assetIds = new Set(assets.map((asset) => String(asset.id)));
  const patternIds = new Set(patterns.map((pattern) => String(pattern.id)));

  validateUniqueCatalogKeys(sourceCatalogFile, repoRoot, "sources", "id", sources, errors);
  validateUniqueCatalogKeys(referenceCatalogFile, repoRoot, "references", "id", references, errors);
  validateUniqueCatalogKeys(assetManifestFile, repoRoot, "assets", "id", assets, errors);
  validateUniqueCatalogKeys(patternManifestFile, repoRoot, "patterns", "id", patterns, errors);
  validateUniqueCatalogKeys(projectIndexFile, repoRoot, "projects", "slug", projects, errors);
  validateSourceProvenance(sourceCatalogFile, repoRoot, sources, errors);
  validateAssetProvenance(assetManifestFile, repoRoot, assets, sourceById, sourceIds, referenceBySourceUrl, referenceIds, errors);
  validateProjectLibraryLinks(projectIndexFile, repoRoot, projects, sourceIds, referenceIds, assetIds, patternIds, errors);
}

function validateUniqueCatalogKeys(
  file: string,
  repoRoot: string,
  catalogName: string,
  key: string,
  entries: readonly Record<string, unknown>[],
  errors: PdosValidationIssue[]
): void {
  const seen = new Set<string>();

  entries.forEach((entry, index) => {
    const value = entry[key];
    if (typeof value !== "string") {
      return;
    }

    if (seen.has(value)) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `${catalogName}[${index}] duplicates ${key} ${value}.`
      });
      return;
    }

    seen.add(value);
  });
}

function validateSourceProvenance(
  file: string,
  repoRoot: string,
  sources: readonly Record<string, unknown>[],
  errors: PdosValidationIssue[]
): void {
  for (const source of sources) {
    const id = String(source.id);
    const license = isRecord(source.license) ? source.license : {};
    const licenseType = license.type;
    const commercialUse = source.commercial_use;
    const status = source.status;

    if ((licenseType === "unknown" || commercialUse === "unknown") && !["inspiration_only", "blocked"].includes(String(status))) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Source ${id} has unknown license/commercial use and must remain inspiration_only or blocked.`
      });
    }
  }
}

function validateAssetProvenance(
  file: string,
  repoRoot: string,
  assets: readonly Record<string, unknown>[],
  sourceById: ReadonlyMap<string, Record<string, unknown>>,
  sourceIds: ReadonlySet<string>,
  referenceBySourceUrl: ReadonlyMap<string, Record<string, unknown>>,
  referenceIds: ReadonlySet<string>,
  errors: PdosValidationIssue[]
): void {
  for (const asset of assets) {
    const id = String(asset.id);
    const source = typeof asset.source === "string" ? asset.source : "";
    const librarySourceId = typeof asset.library_source_id === "string" ? asset.library_source_id : "";
    const provenanceStatus = typeof asset.provenance_status === "string" ? asset.provenance_status : "";
    const assetReferenceIds = getStringArray(asset.reference_ids);

    if (source.startsWith("http") && !librarySourceId) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Asset ${id} uses an external source and must declare library_source_id.`
      });
    }

    if (librarySourceId && !sourceIds.has(librarySourceId)) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Asset ${id} references missing library_source_id ${librarySourceId}.`
      });
    }

    validateKnownIds(file, repoRoot, `Asset ${id}`, "reference_ids", assetReferenceIds, referenceIds, errors);

    if (provenanceStatus === "source-recorded" && !librarySourceId) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Asset ${id} has source-recorded provenance without library_source_id.`
      });
    }

    if (provenanceStatus === "internal" && source.startsWith("http")) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Asset ${id} cannot use internal provenance for an external URL.`
      });
    }

    const linkedSource = librarySourceId ? sourceById.get(librarySourceId) : undefined;
    if (linkedSource?.status === "inspiration_only" && provenanceStatus !== "inspiration-only") {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Asset ${id} uses inspiration-only source ${librarySourceId} and must stay inspiration-only.`
      });
    }

    if (provenanceStatus === "source-recorded" && linkedSource !== undefined && !isAdoptableSource(linkedSource)) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Asset ${id} cannot use non-adoptable source ${librarySourceId} for source-recorded provenance.`
      });
    }

    const linkedReference = referenceBySourceUrl.get(source);
    if (provenanceStatus === "source-recorded" && linkedReference?.status === "inspiration_only") {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Asset ${id} cannot use inspiration-only reference ${String(linkedReference.id)} as source-recorded provenance.`
      });
    }
  }
}

function isAdoptableSource(source: Record<string, unknown>): boolean {
  const license = isRecord(source.license) ? source.license : {};

  return (
    source.status !== "inspiration_only" &&
    license.type !== "unknown" &&
    !["inspiration_only", "unknown", "blocked"].includes(String(source.commercial_use))
  );
}

function validateProjectLibraryLinks(
  file: string,
  repoRoot: string,
  projects: readonly Record<string, unknown>[],
  sourceIds: ReadonlySet<string>,
  referenceIds: ReadonlySet<string>,
  assetIds: ReadonlySet<string>,
  patternIds: ReadonlySet<string>,
  errors: PdosValidationIssue[]
): void {
  const allowedStatuses = new Set<string>(PROJECT_STATUSES);

  for (const project of projects) {
    const slug = String(project.slug);
    if (typeof project.status === "string" && !allowedStatuses.has(project.status)) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `Project ${slug} has invalid status ${project.status}; use status_label for free-form labels.`
      });
    }

    const links = isRecord(project.library_links) ? project.library_links : {};
    validateKnownIds(file, repoRoot, `Project ${slug}`, "source_ids", getStringArray(links.source_ids), sourceIds, errors);
    validateKnownIds(file, repoRoot, `Project ${slug}`, "reference_ids", getStringArray(links.reference_ids), referenceIds, errors);
    validateKnownIds(file, repoRoot, `Project ${slug}`, "asset_ids", getStringArray(links.asset_ids), assetIds, errors);
    validateKnownIds(file, repoRoot, `Project ${slug}`, "pattern_ids", getStringArray(links.pattern_ids), patternIds, errors);
  }
}

function validateKnownIds(
  file: string,
  repoRoot: string,
  owner: string,
  field: string,
  values: readonly string[],
  knownIds: ReadonlySet<string>,
  errors: PdosValidationIssue[]
): void {
  for (const value of values) {
    if (!knownIds.has(value)) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: `${owner} references unknown ${field} value ${value}.`
      });
    }
  }
}

function validateTasteMemory(pdosRoot: string, repoRoot: string, errors: PdosValidationIssue[]): void {
  const itemFiles = ["global-liked.json", "global-disliked.json"];

  for (const fileName of itemFiles) {
    const file = join(pdosRoot, "taste", fileName);
    const value = readJsonFile(file, repoRoot, errors);
    if (!isRecord(value)) {
      continue;
    }

    if (value.version !== 1 || !Array.isArray(value.items) || value.items.length === 0) {
      errors.push({
        file: toRepoPath(repoRoot, file),
        message: "Taste memory must have version 1 and at least one item."
      });
    }
  }

  const feedbackLog = join(pdosRoot, "taste/feedback-log.json");
  const feedbackValue = readJsonFile(feedbackLog, repoRoot, errors);
  if (isRecord(feedbackValue) && (!Array.isArray(feedbackValue.entries) || feedbackValue.entries.length === 0)) {
    errors.push({
      file: toRepoPath(repoRoot, feedbackLog),
      message: "Feedback log must contain at least one structured entry."
    });
  }
}

function validateRecipes(recipesRoot: string, repoRoot: string, errors: PdosValidationIssue[]): void {
  if (!existsSync(recipesRoot)) {
    errors.push({ file: toRepoPath(repoRoot, recipesRoot), message: "Recipes directory is missing." });
    return;
  }

  const recipes = readdirSync(recipesRoot)
    .filter((file) => file.endsWith(".json"))
    .map((file) => join(recipesRoot, file));
  const recipeIds = new Set<string>();

  for (const recipe of recipes) {
    const value = readJsonFile(recipe, repoRoot, errors);
    if (!isRecord(value)) {
      continue;
    }

    const id = value.id;
    if (typeof id !== "string" || id.length === 0) {
      errors.push({ file: toRepoPath(repoRoot, recipe), message: "Recipe must contain a non-empty id." });
    } else {
      recipeIds.add(id);
      if (`${id}.json` !== basename(recipe)) {
        errors.push({ file: toRepoPath(repoRoot, recipe), message: "Recipe filename must match its id." });
      }
    }

    validateRequiredArray(value, "project_types", recipe, repoRoot, errors);
    validateRequiredArray(value, "priorities", recipe, repoRoot, errors);
    validateRequiredArray(value, "allowed_patterns", recipe, repoRoot, errors);
    validateRequiredArray(value, "blocked_assets", recipe, repoRoot, errors);
    validateRequiredArray(value, "tests_required", recipe, repoRoot, errors);
    validateNumberRange(value, "logic_priority", 1, 10, recipe, repoRoot, errors);
    validateNumberRange(value, "design_priority", 1, 10, recipe, repoRoot, errors);
    validateNumberRange(value, "motion_level", 0, 10, recipe, repoRoot, errors);
  }

  for (const recipeId of REQUIRED_RECIPES) {
    if (!recipeIds.has(recipeId)) {
      errors.push({ file: toRepoPath(repoRoot, recipesRoot), message: `Missing required recipe ${recipeId}.` });
    }
  }
}

function validateMarkdown(
  pdosRoot: string,
  repoRoot: string,
  errors: PdosValidationIssue[],
  warnings: PdosValidationIssue[]
): void {
  const markdownFiles = listFiles(pdosRoot).filter((file) => file.endsWith(".md"));
  for (const file of markdownFiles) {
    const content = readFileSync(file, "utf8");
    if (!content.trimStart().startsWith("# ")) {
      warnings.push({ file: toRepoPath(repoRoot, file), message: "Markdown file should start with an H1." });
    }
  }

  const scopeTemplate = join(pdosRoot, "scope/PROJECT_SCOPE.md");
  const scopeContent = readFileSync(scopeTemplate, "utf8");
  for (const heading of REQUIRED_SCOPE_HEADINGS) {
    if (!scopeContent.includes(heading)) {
      errors.push({ file: toRepoPath(repoRoot, scopeTemplate), message: `Scope template missing ${heading}.` });
    }
  }

  const strictProcess = join(pdosRoot, "rules/strict-process.md");
  const strictProcessContent = readFileSync(strictProcess, "utf8");
  for (const term of REQUIRED_STRICT_PROCESS_TERMS) {
    if (!strictProcessContent.includes(term)) {
      errors.push({ file: toRepoPath(repoRoot, strictProcess), message: `Strict process missing ${term}.` });
    }
  }
}

function validateRequiredArray(
  value: Record<string, unknown>,
  key: string,
  file: string,
  repoRoot: string,
  errors: PdosValidationIssue[]
): void {
  if (!Array.isArray(value[key]) || value[key].length === 0) {
    errors.push({ file: toRepoPath(repoRoot, file), message: `Recipe must contain non-empty ${key} array.` });
  }
}

function validateNumberRange(
  value: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  file: string,
  repoRoot: string,
  errors: PdosValidationIssue[]
): void {
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < min || candidate > max) {
    errors.push({ file: toRepoPath(repoRoot, file), message: `${key} must be an integer from ${min} to ${max}.` });
  }
}

function readJsonFile(file: string, repoRoot: string, errors: PdosValidationIssue[]): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse failure.";
    errors.push({ file: toRepoPath(repoRoot, file), message });
    return undefined;
  }
}

function toRepoPath(repoRoot: string, file: string): string {
  return relative(repoRoot, file).replace(/\\/g, "/");
}

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    const stats = statSync(path);

    return stats.isDirectory() ? listFiles(path) : [path];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNestedArray(value: Record<string, unknown>, path: readonly string[]): readonly unknown[] {
  let current: unknown = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return [];
    }
    current = current[key];
  }

  return Array.isArray(current) ? current : [];
}

function getRecordArray(value: unknown, key: string): readonly Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    return [];
  }

  return value[key].filter(isRecord);
}

function getStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => typeof item === "string");
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (invokedFile === currentFile) {
  const report = validateProductDesignOs();
  console.log(formatPdosValidationReport(report));

  if (!report.ok) {
    process.exit(1);
  }
}
