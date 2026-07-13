import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

import { resolveConfiguredProjectRoot } from "./runtimePaths";

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

export interface ProjectRegistryInitialization {
  readonly state_dir: string;
  readonly project_root: string;
  readonly state_dir_created: boolean;
  readonly project_root_created: boolean;
  readonly registry_created: boolean;
}

export const PROJECT_REGISTRY_ERROR_CODES = {
  INVALID_REGISTRY: "invalid_project_registry",
  PROJECT_NOT_FOUND: "project_not_found",
  PROJECT_PATH_MISSING: "project_path_missing",
  PROJECT_PATH_OUTSIDE_ROOT: "project_path_outside_root",
  INVALID_PROJECT_ROOT: "invalid_project_root",
  IO_ERROR: "project_registry_io_error"
} as const;

export type ProjectRegistryErrorCode = typeof PROJECT_REGISTRY_ERROR_CODES[keyof typeof PROJECT_REGISTRY_ERROR_CODES];

const PROJECT_REGISTRY_FILE = "projects.json";
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const MAX_PROJECTS = 64;
const MAX_PROJECT_NAME_LENGTH = 160;
const MAX_CWD_LENGTH = 1_024;
const MAX_REGISTRY_BYTES = 128 * 1_024;
const EMPTY_PROJECT_REGISTRY: ProjectRegistryDocument = { schema_version: "v1", projects: [] };

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
  let size: number;
  try {
    size = statSync(path).size;
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return { schema_version: "v1", projects: [] };
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.IO_ERROR);
  }
  if (size > MAX_REGISTRY_BYTES) {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
  }
  let serialized: string;
  try {
    serialized = readFileSync(path, "utf8");
  } catch {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.IO_ERROR);
  }
  let document: unknown;
  try {
    document = JSON.parse(serialized);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.IO_ERROR);
  }
  validateProjectRegistry(document);
  return document;
}

export function initializeProjectRegistry(
  stateDir: string,
  options: ProjectRegistryOptions = {}
): ProjectRegistryInitialization {
  const projectRoot = options.projectRoot === undefined
    ? resolveConfiguredProjectRoot()
    : resolveConfiguredProjectRoot({ AUTOPILOT_PROJECTS_DIR: options.projectRoot });
  let stateDirCreated: boolean;
  let projectRootCreated: boolean;
  try {
    stateDirCreated = mkdirSync(stateDir, { recursive: true, mode: 0o700 }) !== undefined;
    projectRootCreated = mkdirSync(projectRoot, { recursive: true, mode: 0o700 }) !== undefined;
  } catch {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.IO_ERROR);
  }

  const path = join(stateDir, PROJECT_REGISTRY_FILE);
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  let registryCreated = false;
  try {
    const file = openSync(temporaryPath, "wx", 0o600);
    try {
      writeFileSync(file, `${JSON.stringify(EMPTY_PROJECT_REGISTRY, null, 2)}\n`, "utf8");
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    try {
      linkSync(temporaryPath, path);
      registryCreated = true;
    } catch (error) {
      if (nodeErrorCode(error) !== "EEXIST") throw error;
    }
  } catch {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.IO_ERROR);
  } finally {
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    } catch {
      throw new Error(PROJECT_REGISTRY_ERROR_CODES.IO_ERROR);
    }
  }

  if (!registryCreated) readProjectRegistry(stateDir);

  return {
    state_dir: stateDir,
    project_root: projectRoot,
    state_dir_created: stateDirCreated,
    project_root_created: projectRootCreated,
    registry_created: registryCreated
  };
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
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    } catch { /* cleanup must not expose filesystem details */ }
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.IO_ERROR);
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
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(nodeErrorCode(error))) throw new Error(errorCode);
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.IO_ERROR);
  }
}

export function isProjectConfigurationError(error: unknown): boolean {
  const code = error instanceof Error ? error.message : "";
  return ([
    PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY,
    PROJECT_REGISTRY_ERROR_CODES.PROJECT_NOT_FOUND,
    PROJECT_REGISTRY_ERROR_CODES.PROJECT_PATH_MISSING,
    PROJECT_REGISTRY_ERROR_CODES.PROJECT_PATH_OUTSIDE_ROOT,
    PROJECT_REGISTRY_ERROR_CODES.INVALID_PROJECT_ROOT
  ] as readonly string[]).includes(code);
}

function nodeErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
}
