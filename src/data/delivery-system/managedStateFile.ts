import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  type BigIntStats
} from "node:fs";

export type ManagedStateTextFile =
  | { readonly status: "missing" }
  | { readonly status: "present"; readonly text: string };

export interface ManagedStateFileOptions {
  readonly maxBytes: number;
}

const MAX_ALLOWED_BYTES = 16 * 1024 * 1024;
const INVALID_FILE = "invalid_managed_state_file";
const IO_ERROR = "managed_state_file_io_error";

/** Reads one bounded regular managed-state file without following links or racing path replacement. */
export function readManagedStateTextFile(
  path: string,
  options: ManagedStateFileOptions
): ManagedStateTextFile {
  if (!path || !Number.isInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > MAX_ALLOWED_BYTES) {
    throw new Error(INVALID_FILE);
  }

  let pathBefore: BigIntStats;
  try {
    pathBefore = lstatSync(path, { bigint: true });
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return { status: "missing" };
    throw new Error(IO_ERROR);
  }
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.size > BigInt(options.maxBytes)) {
    throw new Error(INVALID_FILE);
  }

  let file: number;
  try {
    const safetyFlags = process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK;
    file = openSync(path, constants.O_RDONLY | safetyFlags);
  } catch (error) {
    if (["ENOENT", "ELOOP"].includes(nodeErrorCode(error))) throw new Error(INVALID_FILE);
    throw new Error(IO_ERROR);
  }

  let bytes: Buffer;
  try {
    const before = fstatSync(file, { bigint: true });
    if (!before.isFile() || !sameMetadata(pathBefore, before) || before.size > BigInt(options.maxBytes)) {
      throw new Error(INVALID_FILE);
    }
    const buffer = Buffer.alloc(options.maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(file, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    const after = fstatSync(file, { bigint: true });
    const pathAfter = lstatSync(path, { bigint: true });
    if (length > options.maxBytes || BigInt(length) !== after.size ||
      !sameMetadata(before, after) || !sameMetadata(after, pathAfter)) {
      throw new Error(INVALID_FILE);
    }
    bytes = buffer.subarray(0, length);
  } catch (error) {
    if (error instanceof Error && error.message === INVALID_FILE) throw error;
    if (["ENOENT", "ELOOP"].includes(nodeErrorCode(error))) throw new Error(INVALID_FILE);
    throw new Error(IO_ERROR);
  } finally {
    closeSync(file);
  }

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(INVALID_FILE);
  }
  try {
    return {
      status: "present",
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    };
  } catch {
    throw new Error(INVALID_FILE);
  }
}

function sameMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function nodeErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "";
}
