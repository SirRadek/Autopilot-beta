import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join, relative, sep } from "node:path";

import { recordOperationalIncident, ingestOperationalIncidentSpool } from "./operationalIncidents";
import {
  createStateBackup,
  isStateBackupFileName,
  pruneOperationalBackups,
  quarantineStateBackup,
  validateStateBackup
} from "./stateBackup";
import { withStateMaintenanceLock } from "./stateMaintenanceLock";

const SECRET_SCAN_MAX_BYTES = 2 * 1024 * 1024;

export interface PermissionFinding {
  readonly code: "state_dir_permissions" | "environment_file_permissions" | "environment_file_missing";
  readonly path: string;
}

export interface SecretFinding {
  readonly file: string;
  readonly rule: "bearer_token" | "api_key" | "private_key" | "environment_credential";
}

export interface StateMaintenanceResult {
  readonly ok: boolean;
  readonly mode: "dry_run" | "apply";
  readonly findings: readonly string[];
  readonly backup: null | { readonly path: string; readonly valid: boolean };
  readonly rotated: readonly string[];
  readonly incident_id: string | null;
}

export interface StateMaintenanceOptions {
  readonly stateDirectory: string;
  readonly backupDirectory: string;
  readonly environmentFile: string;
  readonly mode: "dry_run" | "apply";
}

export function performStateMaintenance(options: StateMaintenanceOptions): StateMaintenanceResult {
  if (options.mode === "dry_run") {
    const findings = preflightFindings(options);
    return { ok: findings.length === 0, mode: "dry_run", findings, backup: null, rotated: [], incident_id: null };
  }

  let backup: StateMaintenanceResult["backup"] = null;
  try {
    return withStateMaintenanceLock(options.stateDirectory, () => {
      const findings = preflightFindings(options);
      if (findings.length > 0) {
        return { ok: false, mode: "apply", findings, backup: null, rotated: [], incident_id: null };
      }

      ingestOperationalIncidentSpool(options.stateDirectory);
      const created = createStateBackup(options.stateDirectory, options.backupDirectory, { retention: "defer" });
      const validation = validateStateBackup(created.path);
      backup = { path: created.path, valid: validation.valid };
      if (!validation.valid
        || validation.file_count !== created.file_count
        || validation.total_bytes !== created.total_bytes) {
        const quarantined = quarantineStateBackup(created.path);
        backup = { path: quarantined, valid: false };
        throw new Error("backup_validation_failed");
      }

      const rotated = rotateStateLogs(options.stateDirectory);
      pruneOperationalBackups(options.backupDirectory);
      return { ok: true, mode: "apply", findings: [], backup, rotated, incident_id: null };
    });
  } catch (error) {
    let incidentId: string | null = null;
    try {
      incidentId = recordOperationalIncident(options.stateDirectory, { stage: "state_maintenance" }).incident_id;
    } catch {
      // A stable maintenance result is still required when incident persistence fails.
    }
    return {
      ok: false,
      mode: "apply",
      findings: [`maintenance_failed:${maintenanceErrorCode(error)}`],
      backup,
      rotated: [],
      incident_id: incidentId
    };
  }
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
    const temporaryPath = join(stateDirectory, `.${name}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
    let archiveCreated = false;
    try {
      if (archived.length > 0) {
        writeFileSync(archivePath, archived, { mode: 0o600, flag: "wx" });
        archiveCreated = true;
      }
      writeFileSync(temporaryPath, current, { mode: 0o600, flag: "wx" });
      renameSync(temporaryPath, path);
    } catch (error) {
      tryUnlink(temporaryPath);
      if (archiveCreated) tryUnlink(archivePath);
      throw error;
    }
    rotated.push(name);
    const archives = readdirSync(stateDirectory).filter((entry) => entry.startsWith(`${name}.`) && entry.endsWith(".archive")).sort().reverse();
    for (const stale of archives.slice(keepArchives)) unlinkSync(join(stateDirectory, stale));
  }
  return rotated;
}

export function scanOperationalSecrets(
  stateDirectory: string
): readonly SecretFinding[] {
  const rules = [
    { rule: "private_key" as const, pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { rule: "bearer_token" as const, pattern: /(?:authorization["']?\s*[:=]\s*["']?|\b)bearer\s+[A-Za-z0-9._~+\/-]{8,}/i },
    { rule: "api_key" as const, pattern: /\b(?:sk|or|ghp|github_pat|xoxb)-[A-Za-z0-9_-]{8,}\b/ },
    {
      rule: "environment_credential" as const,
      pattern: /^(?:[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)=[^\s#]{8,}$/m
    }
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

function preflightFindings(options: StateMaintenanceOptions): string[] {
  const permissions = verifyOperationalPermissions(options.stateDirectory, options.environmentFile)
    .map((finding) => finding.code);
  const secrets = scanOperationalSecrets(options.stateDirectory)
    .map((finding) => `secret:${finding.rule}`);
  return [...new Set([...permissions, ...secrets])].sort();
}

function maintenanceErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message.split(":", 1)[0] ?? "maintenance_failed" : "maintenance_failed";
  return new Set([
    "archive_too_large",
    "backup_file_count_exceeded",
    "backup_file_too_large",
    "backup_name_collision",
    "backup_total_too_large",
    "backup_validation_failed",
    "state_lock_invalid",
    "state_lock_timeout"
  ]).has(code) ? code : "maintenance_failed";
}

function regularFiles(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name === ".state-maintenance.lock"
          || entry.name.endsWith("-incident-spool")) continue;
        visit(path);
      } else if (entry.isFile()
        && !entry.name.endsWith(".tmp")
        && !entry.name.includes(".tmp-")
        && !entry.name.includes(".quarantine")
        && !isStateBackupFileName(entry.name)) {
        output.push(path);
      }
    }
  };
  visit(root);
  return output.sort();
}

function portableRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
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

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup preserves the original maintenance failure.
  }
}
