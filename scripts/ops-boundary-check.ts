import { randomBytes } from "node:crypto";
import { closeSync, openSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export interface RuntimeWriteBoundaryOptions {
  readonly installationDirectory: string;
  readonly writableDirectories: readonly string[];
}

export interface RuntimeWriteBoundaryReport {
  readonly ok: true;
  readonly installation_read_only: true;
  readonly managed_write_roots: number;
}

const EXPECTED_READ_ONLY_ERRORS = new Set(["EACCES", "EPERM", "EROFS"]);

/** Verifies the service mount boundary with disposable exclusive-create probes. */
export function verifyRuntimeWriteBoundary(
  options: RuntimeWriteBoundaryOptions
): RuntimeWriteBoundaryReport {
  const installationDirectory = checkedDirectory(options.installationDirectory);
  const writableDirectories = options.writableDirectories.map(checkedDirectory);
  if (writableDirectories.length === 0) throw new Error("managed_write_root_missing");
  for (const directory of writableDirectories) {
    if (containsPath(directory, installationDirectory) || containsPath(installationDirectory, directory)) {
      throw new Error("runtime_write_boundaries_overlap");
    }
    probeWritable(directory);
  }
  probeReadOnly(installationDirectory);
  return {
    ok: true,
    installation_read_only: true,
    managed_write_roots: writableDirectories.length
  };
}

function checkedDirectory(path: string): string {
  if (!isAbsolute(path)) throw new Error("runtime_boundary_path_not_absolute");
  const resolved = realpathSync(resolve(path));
  if (!statSync(resolved).isDirectory()) throw new Error("runtime_boundary_path_not_directory");
  return resolved;
}

function containsPath(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function markerPath(directory: string): string {
  return resolve(directory, `.autopilot-boundary-${process.pid}-${randomBytes(8).toString("hex")}`);
}

function probeWritable(directory: string): void {
  const marker = markerPath(directory);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(marker, "wx", 0o600);
  } catch (error) {
    throw new Error(`managed_write_boundary_unavailable:${nodeErrorCode(error)}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    tryUnlink(marker);
  }
}

function probeReadOnly(directory: string): void {
  const marker = markerPath(directory);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(marker, "wx", 0o600);
  } catch (error) {
    const code = nodeErrorCode(error);
    if (EXPECTED_READ_ONLY_ERRORS.has(code)) return;
    throw new Error(`installation_boundary_probe_failed:${code}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    tryUnlink(marker);
  }
  throw new Error("installation_write_boundary_not_enforced");
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Probe cleanup must preserve the original boundary result.
  }
}

function nodeErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}

async function main(): Promise<void> {
  const [installationDirectory, ...writableDirectories] = process.argv.slice(2);
  if (installationDirectory === undefined || writableDirectories.length === 0) {
    throw new Error("usage: ops-boundary-check INSTALLATION_DIR WRITABLE_DIR...");
  }
  console.log(JSON.stringify(verifyRuntimeWriteBoundary({
    installationDirectory,
    writableDirectories
  })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
