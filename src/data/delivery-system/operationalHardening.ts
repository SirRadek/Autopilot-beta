import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";

export * from "./stateMaintenanceLock.js";

const BACKUP_VERSION = 1;
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_FILES = 2_000;
const SECRET_SCAN_MAX_BYTES = 2 * 1024 * 1024;

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

export interface RestoreResult {
  readonly applied: boolean;
  readonly file_count: number;
  readonly total_bytes: number;
}

export interface PermissionFinding {
  readonly code: "state_dir_permissions" | "environment_file_permissions" | "environment_file_missing";
  readonly path: string;
}

export interface SecretFinding {
  readonly file: string;
  readonly rule: "bearer_token" | "api_key" | "private_key";
}

export function createStateBackup(
  stateDirectory: string,
  backupDirectory: string,
  options: { readonly now?: Date; readonly max_file_bytes?: number; readonly max_total_bytes?: number; readonly keep_backups?: number } = {}
): BackupResult {
  const maxFileBytes = options.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = options.max_total_bytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const files: BackupFile[] = [];
  let totalBytes = 0;
  for (const path of regularFiles(stateDirectory)) {
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
  const temporaryPath = join(backupDirectory, `.backup-${randomBytes(8).toString("hex")}.tmp`);
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(archive)}\n`, "utf8");
  } finally {
    // writeFileSync does not close a numeric descriptor.
    closeSync(descriptor);
  }
  renameSync(temporaryPath, outputPath);
  chmodSync(outputPath, 0o600);
  const keepBackups = Math.max(1, options.keep_backups ?? 7);
  const backups = readdirSync(backupDirectory).filter((name) => name.startsWith("autopilot-state-") && name.endsWith(".apbackup.json")).sort().reverse();
  for (const stale of backups.slice(keepBackups)) unlinkSync(join(backupDirectory, stale));
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

export function restoreStateBackup(
  archivePath: string,
  targetDirectory: string,
  options: { readonly apply?: boolean } = {}
): RestoreResult {
  const validation = validateStateBackup(archivePath);
  if (!validation.valid) throw new Error(`backup_validation_failed:${validation.errors.join(",")}`);
  if (options.apply !== true) return { applied: false, file_count: validation.file_count, total_bytes: validation.total_bytes };
  if (existsSync(targetDirectory) && readdirSync(targetDirectory).length > 0) throw new Error("restore_target_not_empty");
  const archive = JSON.parse(readFileSync(archivePath, "utf8")) as BackupArchive;
  mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
  chmodSync(targetDirectory, 0o700);
  for (const file of archive.files) {
    const outputPath = join(targetDirectory, ...file.path.split("/"));
    mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
    writeFileSync(outputPath, Buffer.from(file.data, "base64"), { mode: 0o600, flag: "wx" });
  }
  return { applied: true, file_count: validation.file_count, total_bytes: validation.total_bytes };
}

export function rotateStateLogs(
  stateDirectory: string,
  options: { readonly max_bytes?: number; readonly keep_archives?: number } = {}
): readonly string[] {
  const maxBytes = options.max_bytes ?? 2 * 1024 * 1024;
  const keepArchives = Math.max(0, options.keep_archives ?? 5);
  const rotated: string[] = [];
  for (const name of readdirSync(stateDirectory).filter((entry) => entry.endsWith(".jsonl")).sort()) {
    const path = join(stateDirectory, name);
    if (!lstatSync(path).isFile() || statSync(path).size <= maxBytes) continue;
    const size = statSync(path).size;
    const tailWindowStart = Math.max(0, size - maxBytes);
    const tailWindow = readRange(path, tailWindowStart, size - tailWindowStart);
    const tailStart = tailWindowStart === 0 ? 0 : tailWindow.indexOf(0x0a) + 1;
    const current = tailStart > 0 ? tailWindow.subarray(tailStart) : tailWindowStart === 0 ? tailWindow : Buffer.alloc(0);
    const currentStart = tailWindowStart + Math.max(0, tailStart);
    const archiveWindowStart = Math.max(0, currentStart - maxBytes);
    const archiveWindow = readRange(path, archiveWindowStart, currentStart - archiveWindowStart);
    const archiveStart = archiveWindowStart === 0 ? 0 : archiveWindow.indexOf(0x0a) + 1;
    const archived = archiveStart > 0 ? archiveWindow.subarray(archiveStart) : archiveWindowStart === 0 ? archiveWindow : Buffer.alloc(0);
    const archivePath = nextArchivePath(stateDirectory, name);
    if (archived.length > 0) writeFileSync(archivePath, archived, { mode: 0o600 });
    const temporaryPath = join(stateDirectory, `.${name}.${randomBytes(6).toString("hex")}.tmp`);
    writeFileSync(temporaryPath, current, { mode: 0o600 });
    renameSync(temporaryPath, path);
    rotated.push(name);
    const archives = readdirSync(stateDirectory).filter((entry) => entry.startsWith(`${name}.`) && entry.endsWith(".archive")).sort().reverse();
    for (const stale of archives.slice(keepArchives)) unlinkSync(join(stateDirectory, stale));
  }
  return rotated;
}

export function scanOperationalSecrets(stateDirectory: string): readonly SecretFinding[] {
  const rules = [
    { rule: "private_key" as const, pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { rule: "bearer_token" as const, pattern: /(?:authorization["']?\s*[:=]\s*["']?|\b)bearer\s+[A-Za-z0-9._~+\/-]{8,}/i },
    { rule: "api_key" as const, pattern: /\b(?:sk|or|ghp|github_pat|xoxb)-[A-Za-z0-9_-]{8,}\b/ }
  ];
  const findings: SecretFinding[] = [];
  for (const path of regularFiles(stateDirectory)) {
    const size = statSync(path).size;
    const content = size <= SECRET_SCAN_MAX_BYTES
      ? readFileSync(path, "utf8")
      : `${readRange(path, 0, SECRET_SCAN_MAX_BYTES / 2).toString("utf8")}\n${readRange(path, size - SECRET_SCAN_MAX_BYTES / 2, SECRET_SCAN_MAX_BYTES / 2).toString("utf8")}`;
    for (const { rule, pattern } of rules) if (pattern.test(content)) findings.push({ file: portableRelative(stateDirectory, path), rule });
  }
  return findings;
}

export function verifyOperationalPermissions(stateDirectory: string, environmentFile: string): readonly PermissionFinding[] {
  const findings: PermissionFinding[] = [];
  if ((statSync(stateDirectory).mode & 0o077) !== 0) findings.push({ code: "state_dir_permissions", path: stateDirectory });
  if (!existsSync(environmentFile)) findings.push({ code: "environment_file_missing", path: environmentFile });
  else if ((statSync(environmentFile).mode & 0o077) !== 0) findings.push({ code: "environment_file_permissions", path: environmentFile });
  return findings;
}

function regularFiles(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && !entry.name.endsWith(".tmp") && !entry.name.endsWith(".apbackup.json")) output.push(path);
    }
  };
  visit(root);
  return output.sort();
}

function portableRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function safeArchivePath(path: string): boolean {
  return path.length > 0 && path.length <= 512 && !path.startsWith("/") && !path.includes("\\") && resolve("/restore", path).startsWith("/restore/");
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

function nextArchivePath(directory: string, name: string): string {
  const prefix = `${name}.${new Date().toISOString().replace(/[:.]/g, "-")}`;
  let index = 0;
  while (existsSync(join(directory, `${prefix}.${index}.archive`))) index += 1;
  return join(directory, `${prefix}.${index}.archive`);
}

function readRange(path: string, start: number, length: number): Buffer {
  if (length <= 0) return Buffer.alloc(0);
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(descriptor, buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}
