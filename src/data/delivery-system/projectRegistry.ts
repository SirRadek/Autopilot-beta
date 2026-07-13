import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
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
  INSECURE_PERMISSIONS: "insecure_project_registry_permissions",
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
  let file: number;
  try {
    const posixSafetyFlags = process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK;
    file = openSync(path, constants.O_RDONLY | posixSafetyFlags);
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return { schema_version: "v1", projects: [] };
    if (nodeErrorCode(error) === "ELOOP") throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.IO_ERROR);
  }

  let bytes: Buffer;
  try {
    const before = fstatSync(file, { bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_REGISTRY_BYTES)) {
      throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
    }
    const buffer = Buffer.alloc(MAX_REGISTRY_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(file, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    const after = fstatSync(file, { bigint: true });
    const activePath = lstatSync(path, { bigint: true });
    if (length > MAX_REGISTRY_BYTES ||
        !sameRegistryMetadata(before, after) ||
        !activePath.isFile() ||
        activePath.dev !== after.dev ||
        activePath.ino !== after.ino) {
      throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
    }
    bytes = buffer.subarray(0, length);
  } catch (error) {
    if (error instanceof Error && error.message === PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY) throw error;
    if (["ENOENT", "ELOOP"].includes(nodeErrorCode(error))) {
      throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
    }
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.IO_ERROR);
  } finally {
    closeSync(file);
  }

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
  }
  let serialized: string;
  try {
    serialized = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.INVALID_REGISTRY);
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
  const stateDirCreated = ensurePrivateDirectory(stateDir);
  const projectRootCreated = ensurePrivateDirectory(projectRoot);

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
    const file = openSync(temporaryPath, "wx", 0o600);
    try {
      writeFileSync(file, serialized, "utf8");
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
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
  const projectRoot = options.projectRoot === undefined
    ? resolveConfiguredProjectRoot()
    : resolveConfiguredProjectRoot({ AUTOPILOT_PROJECTS_DIR: options.projectRoot });
  const realRoot = canonicalPath(projectRoot, PROJECT_REGISTRY_ERROR_CODES.INVALID_PROJECT_ROOT);
  const realCwd = canonicalPath(project.cwd, PROJECT_REGISTRY_ERROR_CODES.PROJECT_PATH_MISSING);
  const pathFromRoot = relative(realRoot, realCwd);
  if (pathFromRoot === "" || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.PROJECT_PATH_OUTSIDE_ROOT);
  }
  return { ...project, cwd: realCwd };
}

function sameRegistryMetadata(
  left: ReturnType<typeof fstatSync>,
  right: ReturnType<typeof fstatSync>
): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function ensurePrivateDirectory(path: string): boolean {
  let created: boolean;
  try {
    created = mkdirSync(path, { recursive: true, mode: 0o700 }) !== undefined;
    const metadata = lstatSync(path);
    if (!metadata.isDirectory()) throw new Error(PROJECT_REGISTRY_ERROR_CODES.IO_ERROR);
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      throw new Error(PROJECT_REGISTRY_ERROR_CODES.INSECURE_PERMISSIONS);
    }
  } catch (error) {
    if (error instanceof Error && error.message === PROJECT_REGISTRY_ERROR_CODES.INSECURE_PERMISSIONS) throw error;
    throw new Error(PROJECT_REGISTRY_ERROR_CODES.IO_ERROR);
  }
  return created;
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
    PROJECT_REGISTRY_ERROR_CODES.INVALID_PROJECT_ROOT,
    PROJECT_REGISTRY_ERROR_CODES.INSECURE_PERMISSIONS
  ] as readonly string[]).includes(code);
}

function nodeErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
}
