import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { withStateMaintenanceLock } from "./stateMaintenanceLock";
import { AUTH_STATE_DIRECTORY_NAME, authStateRoot } from "./authSessionRegistry";

const BACKUP_VERSION = 1;
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_KEEP_STATE_BACKUPS = 7;
const DEFAULT_KEEP_ENVIRONMENT_BACKUPS = 0;

interface BackupEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface BackupFile extends BackupEntry {
  readonly data: string;
}

interface BackupArchive {
  readonly version: number;
  readonly created_at: string;
  readonly manifest: readonly BackupEntry[];
  readonly files: readonly BackupFile[];
}

export interface BackupResult {
  readonly path: string;
  readonly file_count: number;
  readonly total_bytes: number;
}

export interface BackupValidation {
  readonly valid: boolean;
  readonly file_count: number;
  readonly total_bytes: number;
  readonly errors: readonly string[];
}

export interface CreateStateBackupOptions {
  readonly now?: Date;
  readonly max_file_bytes?: number;
  readonly max_total_bytes?: number;
  readonly keep_backups?: number;
  readonly retention?: "apply" | "defer";
}

export interface PruneOperationalBackupsOptions {
  readonly keep_state_backups?: number;
  readonly keep_environment_backups?: number;
}

export function createStateBackup(
  stateDirectory: string,
  backupDirectory: string,
  options: CreateStateBackupOptions = {}
): BackupResult {
  return withStateMaintenanceLock(stateDirectory, () => {
    const result = createStateBackupUnderLease(stateDirectory, backupDirectory, options);
    const validation = validateStateBackup(result.path);
    if (!validation.valid
      || validation.file_count !== result.file_count
      || validation.total_bytes !== result.total_bytes) {
      quarantineStateBackup(result.path);
      throw new Error("backup_validation_failed");
    }
    if ((options.retention ?? "apply") === "apply") {
      pruneOperationalBackups(backupDirectory, {
        keep_state_backups: options.keep_backups ?? DEFAULT_KEEP_STATE_BACKUPS
      });
    }
    return result;
  });
}

function createStateBackupUnderLease(
  stateDirectory: string,
  backupDirectory: string,
  options: CreateStateBackupOptions
): BackupResult {
  const maxFileBytes = options.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = options.max_total_bytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const files: BackupFile[] = [];
  let totalBytes = 0;
  for (const path of regularBackupFiles(stateDirectory, backupDirectory)) {
    if (files.length >= DEFAULT_MAX_FILES) throw new Error("backup_file_count_exceeded");
    const name = portableRelative(stateDirectory, path);
    const size = statSync(path).size;
    if (size > maxFileBytes) throw new Error(`backup_file_too_large:${name}`);
    totalBytes += size;
    if (totalBytes > maxTotalBytes) throw new Error("backup_total_too_large");
    const content = readFileSync(path);
    files.push({ path: name, bytes: content.length, sha256: checksum(content), data: content.toString("base64") });
  }
  const now = options.now ?? new Date();
  const archive: BackupArchive = {
    version: BACKUP_VERSION,
    created_at: now.toISOString(),
    manifest: files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
    files
  };
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  chmodSync(backupDirectory, 0o700);
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const outputPath = join(backupDirectory, `autopilot-state-${timestamp}.apbackup.json`);
  if (existsSync(outputPath)) throw new Error("backup_name_collision");
  const temporaryPath = join(backupDirectory, `.backup-${randomBytes(8).toString("hex")}.tmp`);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(archive)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    linkSync(temporaryPath, outputPath);
    unlinkSync(temporaryPath);
    chmodSync(outputPath, 0o600);
    fsyncDirectory(backupDirectory);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    tryUnlink(temporaryPath);
    if (isFileSystemError(error, "EEXIST")) throw new Error("backup_name_collision");
    throw error;
  }
  return { path: outputPath, file_count: files.length, total_bytes: totalBytes };
}

export function validateStateBackup(path: string): BackupValidation {
  const errors: string[] = [];
  let archive: unknown;
  try {
    if (statSync(path).size > DEFAULT_MAX_TOTAL_BYTES * 2) throw new Error("archive_too_large");
    archive = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { valid: false, file_count: 0, total_bytes: 0, errors: [error instanceof Error ? error.message : "invalid_archive"] };
  }
  if (!isRecord(archive) || archive.version !== BACKUP_VERSION || !Array.isArray(archive.manifest) || !Array.isArray(archive.files)) {
    return { valid: false, file_count: 0, total_bytes: 0, errors: ["invalid_archive_schema"] };
  }
  if (archive.manifest.length > DEFAULT_MAX_FILES || archive.files.length > DEFAULT_MAX_FILES) {
    return { valid: false, file_count: 0, total_bytes: 0, errors: ["backup_file_count_exceeded"] };
  }
  const manifest = new Map<string, BackupEntry>();
  for (const value of archive.manifest) {
    if (!isBackupEntry(value) || !safeArchivePath(value.path) || manifest.has(value.path)) errors.push("invalid_manifest_entry");
    else manifest.set(value.path, value);
  }
  let totalBytes = 0;
  const seen = new Set<string>();
  for (const value of archive.files) {
    if (!isRecord(value) || typeof value.path !== "string" || typeof value.data !== "string" || !safeArchivePath(value.path) || seen.has(value.path)) {
      errors.push("invalid_file_entry");
      continue;
    }
    seen.add(value.path);
    const content = Buffer.from(value.data, "base64");
    if (content.toString("base64") !== value.data) errors.push(`invalid_base64:${value.path}`);
    totalBytes += content.length;
    const entry = manifest.get(value.path);
    if (entry === undefined) errors.push(`manifest_missing:${value.path}`);
    else if (entry.bytes !== content.length) errors.push(`size_mismatch:${value.path}`);
    else if (entry.sha256 !== checksum(content)) errors.push(`checksum_mismatch:${value.path}`);
  }
  for (const name of manifest.keys()) if (!seen.has(name)) errors.push(`payload_missing:${name}`);
  if (totalBytes > DEFAULT_MAX_TOTAL_BYTES) errors.push("backup_total_too_large");
  return { valid: errors.length === 0, file_count: seen.size, total_bytes: totalBytes, errors };
}

export function pruneOperationalBackups(
  backupDirectory: string,
  options: PruneOperationalBackupsOptions = {}
): readonly string[] {
  const entries = readdirSync(backupDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const stateBackups = entries.filter(isStateBackupFileName).sort().reverse();
  const environmentBackups = entries.filter(isEnvironmentBackupFileName).sort().reverse();
  const keepState = Math.max(1, options.keep_state_backups ?? DEFAULT_KEEP_STATE_BACKUPS);
  const keepEnvironment = Math.max(0, options.keep_environment_backups ?? DEFAULT_KEEP_ENVIRONMENT_BACKUPS);
  const removed = [...stateBackups.slice(keepState), ...environmentBackups.slice(keepEnvironment)].sort();
  for (const stale of removed) unlinkSync(join(backupDirectory, stale));
  if (removed.length > 0) fsyncDirectory(backupDirectory);
  return removed;
}

export function isStateBackupFileName(name: string): boolean {
  return name.startsWith("autopilot-state-") && name.endsWith(".apbackup.json");
}

function isEnvironmentBackupFileName(name: string): boolean {
  return /^control-plane\.env\.\d{8}T\d{6}Z\.bak$/.test(name);
}

export function quarantineStateBackup(path: string): string {
  let candidate = `${path}.quarantine`;
  let suffix = 0;
  while (existsSync(candidate)) {
    suffix += 1;
    candidate = `${path}.quarantine-${suffix}`;
  }
  renameSync(path, candidate);
  fsyncDirectory(dirname(path));
  return candidate;
}

function regularBackupFiles(stateDirectory: string, backupDirectory: string): string[] {
  const root = resolve(stateDirectory);
  const excludedBackupDirectory = resolve(backupDirectory);
  const excludedAuthDirectory = resolve(authStateRoot(stateDirectory));
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const resolved = resolve(path);
        if (resolved === excludedBackupDirectory
          || resolved === excludedAuthDirectory
          || entry.name === ".state-maintenance.lock"
          || entry.name.endsWith("-incident-spool")) continue;
        visit(path);
      } else if (entry.isFile() && !isExcludedStateFile(entry.name)) {
        output.push(path);
      }
    }
  };
  visit(root);
  return output.sort();
}

function isExcludedStateFile(name: string): boolean {
  return name.endsWith(".tmp")
    || name.includes(".tmp-")
    || name.includes(".quarantine")
    || name.endsWith(".apbackup.json");
}

function portableRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function safeArchivePath(path: string): boolean {
  if (path.length === 0 || path.length > 512 || path.startsWith("/") || path.includes("\\")) return false;
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return false;
  if (segments[0] === AUTH_STATE_DIRECTORY_NAME) return false;
  return resolve("/restore", ...segments).startsWith("/restore/");
}

function checksum(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBackupEntry(value: unknown): value is BackupEntry {
  return isRecord(value) && typeof value.path === "string" && Number.isSafeInteger(value.bytes) && Number(value.bytes) >= 0 && typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256);
}

function fsyncDirectory(directory: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(directory, "r");
    fsyncSync(descriptor);
  } catch {
    // Some supported filesystems do not permit directory fsync.
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup preserves the original failure.
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
