import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { validateStateBackup } from "./stateBackup";

export * from "./stateBackup.js";
export * from "./stateMaintenance.js";
export * from "./stateMaintenanceLock.js";

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

/** Compatibility restore entrypoint; failure-atomic publication is implemented in S6. */
export function restoreStateBackup(
  archivePath: string,
  targetDirectory: string,
  options: { readonly apply?: boolean } = {}
): RestoreResult {
  const validation = validateStateBackup(archivePath);
  if (!validation.valid) throw new Error(`backup_validation_failed:${validation.errors.join(",")}`);
  if (options.apply !== true) return { applied: false, file_count: validation.file_count, total_bytes: validation.total_bytes };
  if (existsSync(targetDirectory) && readdirSync(targetDirectory).length > 0) throw new Error("restore_target_not_empty");
  const archive = JSON.parse(readFileSync(archivePath, "utf8")) as RestoreArchive;
  mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
  chmodSync(targetDirectory, 0o700);
  for (const file of archive.files) {
    if (!safeArchivePath(file.path)) throw new Error("backup_validation_failed:invalid_file_entry");
    const outputPath = join(targetDirectory, ...file.path.split("/"));
    mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
    writeFileSync(outputPath, Buffer.from(file.data, "base64"), { mode: 0o600, flag: "wx" });
  }
  return { applied: true, file_count: validation.file_count, total_bytes: validation.total_bytes };
}

function safeArchivePath(path: string): boolean {
  return path.length > 0
    && path.length <= 512
    && !path.startsWith("/")
    && !path.includes("\\")
    && resolve("/restore", path).startsWith("/restore/");
}
