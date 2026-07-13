import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { validateStateBackup } from "./stateBackup";

interface RestoreArchiveFile {
  readonly path: string;
  readonly data: string;
}

interface RestoreArchive {
  readonly files: readonly RestoreArchiveFile[];
}

export interface RestoreResult {
  readonly applied: boolean;
  readonly file_count: number;
  readonly total_bytes: number;
}

export interface RecoveryValidation {
  readonly ready: boolean;
  readonly reconciled: boolean;
  readonly errors: readonly string[];
}

export interface RecoveryDrillResult {
  readonly ok: boolean;
  readonly validation: RecoveryValidation;
  readonly restored_file_count: number;
}

export function restoreStateBackup(
  archivePath: string,
  targetDirectory: string,
  options: { readonly apply?: boolean } = {}
): RestoreResult {
  if (options.apply !== true) {
    const validation = validateStateBackup(archivePath);
    if (!validation.valid) throw new Error(`backup_validation_failed:${validation.errors.join(",")}`);
    return { applied: false, file_count: validation.file_count, total_bytes: validation.total_bytes };
  }

  const target = validateRestoreTarget(targetDirectory);
  const staging = mkdtempSync(join(target.parent, ".restore-staging-"));
  chmodSync(staging, 0o700);
  let targetRemoved = false;
  try {
    const archiveSnapshot = join(staging, ".validated-archive.json");
    copyFileSync(archivePath, archiveSnapshot, constants.COPYFILE_EXCL);
    chmodSync(archiveSnapshot, 0o600);
    fsyncFile(archiveSnapshot);
    const validation = validateStateBackup(archiveSnapshot);
    if (!validation.valid) throw new Error(`backup_validation_failed:${validation.errors.join(",")}`);
    const archive = JSON.parse(readFileSync(archiveSnapshot, "utf8")) as RestoreArchive;
    rmSync(archiveSnapshot, { force: true });
    for (const file of archive.files) materializeRestoreFile(staging, file);
    fsyncDirectoryTree(staging);
    if (target.exists) {
      rmdirSync(target.path);
      targetRemoved = true;
    }
    renameSync(staging, target.path);
    fsyncDirectory(target.parent);
    return { applied: true, file_count: validation.file_count, total_bytes: validation.total_bytes };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (targetRemoved && !existsSync(target.path)) mkdirSync(target.path, { mode: 0o700 });
    throw error;
  }
}

function fsyncFile(path: string): void {
  const descriptor = openSync(path, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function drillStateRecovery(
  archivePath: string,
  options: {
    readonly validateRestoredState: (stateDir: string) => RecoveryValidation;
    readonly temporaryRoot?: string;
  }
): RecoveryDrillResult {
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
  const drillRoot = mkdtempSync(join(temporaryRoot, "autopilot-recovery-drill-"));
  const restoredState = join(drillRoot, "state");
  let restoredFileCount = 0;
  try {
    const restored = restoreStateBackup(archivePath, restoredState, { apply: true });
    restoredFileCount = restored.file_count;
    const validation = normalizeRecoveryValidation(options.validateRestoredState(restoredState));
    return {
      ok: validation.ready && validation.reconciled && validation.errors.length === 0,
      validation,
      restored_file_count: restoredFileCount
    };
  } catch {
    return {
      ok: false,
      validation: { ready: false, reconciled: false, errors: ["recovery_failed"] },
      restored_file_count: restoredFileCount
    };
  } finally {
    rmSync(drillRoot, { recursive: true, force: true });
  }
}

function validateRestoreTarget(targetDirectory: string): {
  readonly path: string;
  readonly parent: string;
  readonly exists: boolean;
} {
  const path = resolve(targetDirectory);
  const parent = dirname(path);
  if (!existsSync(parent) || realpathSync(parent) !== parent) throw new Error("unsafe_restore_target");
  if (!existsSync(path)) return { path, parent, exists: false };
  const status = lstatSync(path);
  if (!status.isDirectory() || status.isSymbolicLink() || realpathSync(path) !== path) {
    throw new Error("unsafe_restore_target");
  }
  if (readdirSync(path).length > 0) throw new Error("restore_target_not_empty");
  return { path, parent, exists: true };
}

function materializeRestoreFile(staging: string, file: RestoreArchiveFile): void {
  const outputPath = join(staging, ...file.path.split("/"));
  mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
  const descriptor = openSync(outputPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, Buffer.from(file.data, "base64"));
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectoryTree(root: string): void {
  const directories: string[] = [];
  const visit = (directory: string): void => {
    directories.push(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(directory, entry.name));
    }
  };
  visit(root);
  for (const directory of directories.reverse()) fsyncDirectory(directory);
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

function normalizeRecoveryValidation(value: RecoveryValidation): RecoveryValidation {
  const allowedErrors = new Set(["readiness_failed", "reconciliation_failed", "validation_failed"]);
  const errors = Array.isArray(value.errors)
    ? value.errors.slice(0, 16).map((error) => allowedErrors.has(error) ? error : "validation_failed")
    : ["validation_failed"];
  return {
    ready: value.ready === true,
    reconciled: value.reconciled === true,
    errors: [...new Set(errors)]
  };
}
