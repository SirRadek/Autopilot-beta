import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveProviderCliRuntime } from "../../src/data/delivery-system/providerCliRuntime";

const PROVIDERS = [
  ["codex_cli", "codex"],
  ["claude_cli", "claude"],
  ["agy_cli", "agy"]
] as const;

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "provider-cli-runtime-"));
  roots.push(root);
  return root;
}

function executable(path: string): void {
  writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  chmodSync(path, 0o700);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.doUnmock("node:fs");
  vi.resetModules();
});

describe("resolveProviderCliRuntime", () => {
  it.each(PROVIDERS)("uses only the fixed %s development basename when no directory is configured", (provider, basename) => {
    expect(resolveProviderCliRuntime(provider, {}, "linux")).toEqual({
      status: "available",
      executable: basename
    });
    expect(resolveProviderCliRuntime(provider, {}, "win32")).toEqual({
      status: "available",
      executable: `${basename}.cmd`
    });
  });

  it.each(PROVIDERS)("resolves the configured %s executable without consulting PATH", (provider, basename) => {
    const binDir = join(temporaryRoot(), "bin");
    mkdirSync(binDir, { mode: 0o700 });
    const path = join(binDir, basename);
    executable(path);

    expect(resolveProviderCliRuntime(provider, {
      AUTOPILOT_PROVIDER_CLI_BIN_DIR: binDir,
      PATH: "/untrusted/path"
    }, "linux")).toEqual({ status: "available", executable: path });
    expect(resolveProviderCliRuntime(provider, {
      AUTOPILOT_PROVIDER_CLI_BIN_DIR: binDir,
      PATH: "/untrusted/path"
    }, "win32")).toEqual({ status: "available", executable: path });
  });

  it("rejects relative and non-normalized configured directories", () => {
    const root = temporaryRoot();
    const binDir = join(root, "bin");
    mkdirSync(binDir, { mode: 0o700 });
    executable(join(binDir, "codex"));

    expect(resolveProviderCliRuntime("codex_cli", {
      AUTOPILOT_PROVIDER_CLI_BIN_DIR: "relative/bin"
    }, "linux")).toEqual({ status: "unavailable", error_code: "provider_runtime_denied" });
    expect(resolveProviderCliRuntime("codex_cli", {
      AUTOPILOT_PROVIDER_CLI_BIN_DIR: `${binDir}/../bin`
    }, "linux")).toEqual({ status: "unavailable", error_code: "provider_runtime_denied" });
  });

  it("fails closed without a PATH fallback when the configured executable is missing", () => {
    const binDir = join(temporaryRoot(), "bin");
    mkdirSync(binDir, { mode: 0o700 });

    const result = resolveProviderCliRuntime("claude_cli", {
      AUTOPILOT_PROVIDER_CLI_BIN_DIR: binDir,
      PATH: "/path/containing/claude"
    }, "linux");

    expect(result).toEqual({ status: "unavailable", error_code: "provider_executable_missing" });
    expect(JSON.stringify(result)).not.toContain(binDir);
  });

  it.runIf(process.platform !== "win32")("classifies a non-executable provider file as missing", () => {
    const binDir = join(temporaryRoot(), "bin");
    mkdirSync(binDir, { mode: 0o700 });
    const path = join(binDir, "agy");
    writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o600 });
    chmodSync(path, 0o600);

    expect(resolveProviderCliRuntime("agy_cli", {
      AUTOPILOT_PROVIDER_CLI_BIN_DIR: binDir
    }, "linux")).toEqual({ status: "unavailable", error_code: "provider_executable_missing" });
  });

  it("classifies executable metadata permission failures as runtime denied without leaking details", async () => {
    const binDir = join(temporaryRoot(), "bin");
    mkdirSync(binDir, { mode: 0o700 });
    const path = join(binDir, "codex");
    executable(path);
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        statSync: (candidate: string) => {
          if (candidate === path) {
            throw Object.assign(new Error(`permission denied: ${path}`), { code: "EACCES" });
          }
          return actual.statSync(candidate);
        }
      };
    });
    const { resolveProviderCliRuntime: resolveWithDeniedMetadata } = await import("../../src/data/delivery-system/providerCliRuntime");

    const result = resolveWithDeniedMetadata("codex_cli", {
      AUTOPILOT_PROVIDER_CLI_BIN_DIR: binDir
    }, "linux");

    expect(result).toEqual({ status: "unavailable", error_code: "provider_runtime_denied" });
    expect(JSON.stringify(result)).not.toContain(path);
    expect(JSON.stringify(result)).not.toContain("permission denied");
  });

  it.runIf(process.platform !== "win32")("rejects an executable whose real path escapes the configured directory", () => {
    const root = temporaryRoot();
    const binDir = join(root, "bin");
    mkdirSync(binDir, { mode: 0o700 });
    const outside = join(root, "outside-codex");
    executable(outside);
    symlinkSync(outside, join(binDir, "codex"), "file");

    const result = resolveProviderCliRuntime("codex_cli", {
      AUTOPILOT_PROVIDER_CLI_BIN_DIR: binDir
    }, "linux");

    expect(result).toEqual({ status: "unavailable", error_code: "provider_runtime_denied" });
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it.runIf(process.platform !== "win32")("accepts a symlink whose real path remains inside the configured directory", () => {
    const binDir = join(temporaryRoot(), "bin");
    const versionDir = join(binDir, "versions");
    mkdirSync(versionDir, { recursive: true, mode: 0o700 });
    const target = join(versionDir, "claude");
    const published = join(binDir, "claude");
    executable(target);
    symlinkSync(target, published, "file");

    expect(resolveProviderCliRuntime("claude_cli", {
      AUTOPILOT_PROVIDER_CLI_BIN_DIR: binDir
    }, "linux")).toEqual({ status: "available", executable: published });
  });
});
