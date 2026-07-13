import { spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  appendFileSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { readManagedStateTextFile } from "../../src/data/delivery-system/managedStateFile";

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), "managed-state-file-"));
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("readManagedStateTextFile", () => {
  it("distinguishes a missing file from a bounded present file", () => {
    const directory = root();
    const path = join(directory, "state.json");

    expect(readManagedStateTextFile(path, { maxBytes: 32 })).toEqual({ status: "missing" });
    writeFileSync(path, "{}\n");
    expect(readManagedStateTextFile(path, { maxBytes: 32 })).toEqual({ status: "present", text: "{}\n" });
  });

  it("rejects oversized, BOM-prefixed, and invalid UTF-8 content with a stable error", () => {
    const path = join(root(), "state.json");
    writeFileSync(path, Buffer.alloc(33, 0x20));
    expect(() => readManagedStateTextFile(path, { maxBytes: 32 })).toThrow("invalid_managed_state_file");

    writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")]))
    expect(() => readManagedStateTextFile(path, { maxBytes: 32 })).toThrow("invalid_managed_state_file");

    writeFileSync(path, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]));
    expect(() => readManagedStateTextFile(path, { maxBytes: 32 })).toThrow("invalid_managed_state_file");
  });

  it.runIf(process.platform !== "win32")("rejects symlinks and devices without following them", () => {
    const directory = root();
    const target = join(directory, "target.json");
    const link = join(directory, "state.json");
    writeFileSync(target, "{}\n");
    symlinkSync(target, link, "file");

    expect(() => readManagedStateTextFile(link, { maxBytes: 32 })).toThrow("invalid_managed_state_file");
    expect(() => readManagedStateTextFile("/dev/null", { maxBytes: 32 })).toThrow("invalid_managed_state_file");
  });

  it.runIf(process.platform !== "win32")("rejects a FIFO in a timeout-bounded child without blocking", () => {
    const path = join(root(), "state.json");
    const fifo = spawnSync("mkfifo", [path], { encoding: "utf8" });
    expect(fifo).toMatchObject({ status: 0, signal: null });

    const moduleUrl = pathToFileURL(join(process.cwd(), "src/data/delivery-system/managedStateFile.ts")).href;
    const child = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `const { readManagedStateTextFile } = await import(${JSON.stringify(moduleUrl)});` +
        `try { readManagedStateTextFile(${JSON.stringify(path)}, { maxBytes: 32 }); } ` +
        `catch (error) { console.log(error.message); }`
    ], { encoding: "utf8", timeout: 2_000 });

    expect(child.error).toBeUndefined();
    expect(child).toMatchObject({ status: 0, signal: null });
    expect(child.stdout.trim()).toBe("invalid_managed_state_file");
  });

  it("rejects a file that grows while its descriptor is being read", () => {
    const path = join(root(), "state.json");
    writeFileSync(path, "{}\n");

    expect(() => withReadContention(() => appendFileSync(path, " "), () =>
      readManagedStateTextFile(path, { maxBytes: 32 })
    )).toThrow("invalid_managed_state_file");
  });

  it.runIf(process.platform !== "win32")("rejects a path replaced while its descriptor is being read", () => {
    const directory = root();
    const path = join(directory, "state.json");
    const replacement = join(directory, "replacement.json");
    writeFileSync(path, "{}\n");
    writeFileSync(replacement, "{}\n");

    expect(() => withReadContention(() => renameSync(replacement, path), () =>
      readManagedStateTextFile(path, { maxBytes: 32 })
    )).toThrow("invalid_managed_state_file");
  });
});

function withReadContention<T>(contend: () => void, action: () => T): T {
  const readSync = fs.readSync;
  let contended = false;
  fs.readSync = ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | bigint | null) => {
    if (!contended) {
      contended = true;
      contend();
    }
    return readSync(fd, buffer, offset, length, position);
  }) as typeof fs.readSync;
  syncBuiltinESMExports();
  try {
    return action();
  } finally {
    fs.readSync = readSync;
    syncBuiltinESMExports();
  }
}
