import { existsSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

export interface ProjectEntry {
  readonly schema_version: "v1";
  readonly project_id: string;
  readonly name: string;
  readonly cwd: string;
  readonly enabled: boolean;
}

export interface ProjectRegistryDocument {
  readonly schema_version: "v1";
  readonly projects: readonly ProjectEntry[];
}

export interface ProjectRegistryOptions {
  readonly projectRoot?: string;
}

export const PROJECT_REGISTRY_ERROR_CODES = {
  INVALID_REGISTRY: "invalid_project_registry",
  PROJECT_NOT_FOUND: "project_not_found",
  PROJECT_PATH_MISSING: "project_path_missing",
  PROJECT_PATH_OUTSIDE_ROOT: "project_path_outside_root",
  INVALID_PROJECT_ROOT: "invalid_project_root"
} as const;

export type ProjectRegistryErrorCode = typeof PROJECT_REGISTRY_ERROR_CODES[keyof typeof PROJECT_REGISTRY_ERROR_CODES];

const PROJECT_REGISTRY_FILE = "projects.json";
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const MAX_PROJECTS = 64;
const MAX_PROJECT_NAME_LENGTH = 160;
const MAX_CWD_LENGTH = 1_024;
const MAX_REGISTRY_BYTES = 128 * 1_024;

function validateProjectRegistry(document: unknown): asserts document is ProjectRegistryDocument {
  if (typeof document !== "object" || document === null) {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
  }

  const candidate = document as Partial<ProjectRegistryDocument>;
  if (candidate.schema_version !== "v1" ||
      !Array.isArray(candidate.projects) ||
      candidate.projects.length > MAX_PROJECTS) {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
  }

  const projectIds = new Set<string>();
  for (const entry of candidate.projects) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
    }

    const project = entry as Partial<ProjectEntry>;
    if (project.schema_version !== "v1" ||
        typeof project.project_id !== "string" ||
        !PROJECT_ID_PATTERN.test(project.project_id) ||
        projectIds.has(project.project_id) ||
        typeof project.name !== "string" ||
        project.name.length > MAX_PROJECT_NAME_LENGTH ||
        typeof project.cwd !== "string" ||
        project.cwd.length > MAX_CWD_LENGTH ||
        !isAbsolute(project.cwd) ||
        normalize(project.cwd) !== project.cwd ||
        typeof project.enabled !== "boolean") {
      throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
    }
    projectIds.add(project.project_id);
  }
}

export function readProjectRegistry(stateDir: string): ProjectRegistryDocument {
  const path = join(stateDir, PROJECT_REGISTRY_FILE);
  if (!existsSync(path)) {
    return { schema_version: "v1", projects: [] };
  }
  let document: unknown;
  try {
    if (statSync(path).size > MAX_REGISTRY_BYTES) {
      throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
    }
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
  }
  validateProjectRegistry(document);
  return document;
}

export function writeProjectRegistry(stateDir: string, document: ProjectRegistryDocument): void {
  validateProjectRegistry(document);
  const path = join(stateDir, PROJECT_REGISTRY_FILE);
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_REGISTRY_BYTES) {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
  }
  try {
    writeFileSync(temporaryPath, serialized, "utf8");
    renameSync(temporaryPath, path);
  } catch {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
  }
}

export function resolveEnabledProject(
  stateDir: string,
  projectId: string,
  options: ProjectRegistryOptions = {}
): ProjectEntry {
  const project = readProjectRegistry(stateDir).projects.find(
    (entry) => entry.project_id === projectId && entry.enabled
  );
  if (project === undefined) {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.PROJECT_NOT_FOUND);
  }
  if (options.projectRoot === undefined) {
    return project;
  }
  if (!isAbsolute(options.projectRoot) || normalize(options.projectRoot) !== options.projectRoot) {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_PROJECT_ROOT);
  }
  const realRoot = canonicalPath(options.projectRoot, PROJECT_REGISTRY_ERROR_CODES.INVALID_PROJECT_ROOT);
  const realCwd = canonicalPath(project.cwd, PROJECT_REGISTRY_ERROR_CODES.PROJECT_PATH_MISSING);
  const pathFromRoot = relative(realRoot, realCwd);
  if (pathFromRoot === "" || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.PROJECT_PATH_OUTSIDE_ROOT);
  }
  return { ...project, cwd: realCwd };
}

function canonicalPath(path: string, errorCode: ProjectRegistryErrorCode): string {
  try {
    return realpathSync(path);
  } catch {
    throw new Error(errorCode);
  }
}
