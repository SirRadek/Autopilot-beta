import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveProviderCliRuntime } from "../../src/data/delivery-system/providerCliRuntime";

const PROVIDERS = [
  ["codex_cli", "codex"],
  ["claude_cli", "claude"],
  ["agy_cli", "agy"]
] as const;

const roots: string[] = [];

function temporaryRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "provider-cli-runtime-")));
  roots.push(root);
  return root;
}

function executable(path: string): void {
  writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  chmodSync(path, 0o700);
}

function configuredEnvironment(
  binDir: string,
  overrides: Readonly<Record<string, string | undefined>> = {}
): Readonly<Record<string, string | undefined>> {
  return {
    AUTOPILOT_PROVIDER_CLI_BIN_DIR: binDir,
    AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
    AUTOPILOT_PROVIDER_CLI_TEST_ROOT: dirname(binDir),
    ...overrides
  };
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

    expect(resolveProviderCliRuntime(provider, configuredEnvironment(binDir, {
      PATH: "/untrusted/path"
    }), "linux")).toEqual({ status: "available", executable: path });
    expect(resolveProviderCliRuntime(provider, configuredEnvironment(binDir, {
      PATH: "/untrusted/path"
    }), "win32")).toEqual({ status: "available", executable: path });
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

    const result = resolveProviderCliRuntime("claude_cli", configuredEnvironment(binDir, {
      PATH: "/path/containing/claude"
    }), "linux");

    expect(result).toEqual({ status: "unavailable", error_code: "provider_executable_missing" });
    expect(JSON.stringify(result)).not.toContain(binDir);
  });

  it.runIf(process.platform !== "win32")("classifies a non-executable provider file as missing", () => {
    const binDir = join(temporaryRoot(), "bin");
    mkdirSync(binDir, { mode: 0o700 });
    const path = join(binDir, "agy");
    writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o600 });
    chmodSync(path, 0o600);

    expect(resolveProviderCliRuntime("agy_cli", configuredEnvironment(binDir), "linux"))
      .toEqual({ status: "unavailable", error_code: "provider_executable_missing" });
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

    const result = resolveWithDeniedMetadata("codex_cli", configuredEnvironment(binDir), "linux");

    expect(result).toEqual({ status: "unavailable", error_code: "provider_runtime_denied" });
    expect(JSON.stringify(result)).not.toContain(path);
    expect(JSON.stringify(result)).not.toContain("permission denied");
  });

  it.runIf(process.platform !== "win32")("accepts the published versioned symlink layout inside the install root", () => {
    const installRoot = temporaryRoot();
    const binDir = join(installRoot, "bin");
    const versionDir = join(installRoot, "codex", "0.144.5");
    mkdirSync(binDir, { mode: 0o700 });
    mkdirSync(versionDir, { recursive: true, mode: 0o700 });
    const target = join(versionDir, "codex");
    const published = join(binDir, "codex");
    executable(target);
    symlinkSync("../codex/0.144.5/codex", published, "file");

    expect(resolveProviderCliRuntime("codex_cli", configuredEnvironment(binDir), "linux"))
      .toEqual({ status: "available", executable: published });
  });

  it.runIf(process.platform !== "win32")("rejects an executable whose real path escapes the install root", () => {
    const installRoot = temporaryRoot();
    const outsideRoot = temporaryRoot();
    const binDir = join(installRoot, "bin");
    mkdirSync(binDir, { mode: 0o700 });
    const outside = join(outsideRoot, "codex");
    executable(outside);
    symlinkSync(outside, join(binDir, "codex"), "file");

    const result = resolveProviderCliRuntime("codex_cli", configuredEnvironment(binDir), "linux");

    expect(result).toEqual({ status: "unavailable", error_code: "provider_runtime_denied" });
    expect(JSON.stringify(result)).not.toContain(installRoot);
    expect(JSON.stringify(result)).not.toContain(outsideRoot);
  });

  it.runIf(process.platform !== "win32")("rejects a configured install root reached through a symlink", () => {
    const installRoot = temporaryRoot();
    const binDir = join(installRoot, "bin");
    mkdirSync(binDir, { mode: 0o700 });
    executable(join(binDir, "codex"));
    const aliasRoot = join(temporaryRoot(), "providers");
    symlinkSync(installRoot, aliasRoot, "dir");
    const aliasedBinDir = join(aliasRoot, "bin");

    expect(resolveProviderCliRuntime("codex_cli", configuredEnvironment(aliasedBinDir), "linux"))
      .toEqual({ status: "unavailable", error_code: "provider_runtime_denied" });
  });

  it.runIf(process.platform !== "win32")("accepts a symlink whose real path remains inside the configured directory", () => {
    const binDir = join(temporaryRoot(), "bin");
    const versionDir = join(binDir, "versions");
    mkdirSync(versionDir, { recursive: true, mode: 0o700 });
    const target = join(versionDir, "claude");
    const published = join(binDir, "claude");
    executable(target);
    symlinkSync(target, published, "file");

    expect(resolveProviderCliRuntime("claude_cli", configuredEnvironment(binDir), "linux"))
      .toEqual({ status: "available", executable: published });
  });

  it.runIf(process.platform !== "win32")("rejects a resolved executable owned by another uid", async () => {
    const installRoot = temporaryRoot();
    const binDir = join(installRoot, "bin");
    const versionDir = join(installRoot, "agy", "1.1.5");
    mkdirSync(binDir, { mode: 0o700 });
    mkdirSync(versionDir, { recursive: true, mode: 0o700 });
    const target = join(versionDir, "agy");
    executable(target);
    symlinkSync("../agy/1.1.5/agy", join(binDir, "agy"), "file");
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        statSync: (candidate: string) => {
          const metadata = actual.statSync(candidate);
          return candidate === target
            ? Object.assign(metadata, { uid: (process.getuid?.() ?? 0) + 1 })
            : metadata;
        }
      };
    });
    const { resolveProviderCliRuntime: resolveWithForeignOwner } = await import("../../src/data/delivery-system/providerCliRuntime");

    expect(resolveWithForeignOwner("agy_cli", configuredEnvironment(binDir), "linux"))
      .toEqual({ status: "unavailable", error_code: "provider_runtime_denied" });
  });

  it.runIf(process.platform !== "win32")("rejects group- or world-writable resolved executables", () => {
    for (const mode of [0o720, 0o702]) {
      const binDir = join(temporaryRoot(), "bin");
      mkdirSync(binDir, { mode: 0o700 });
      const path = join(binDir, "codex");
      executable(path);
      chmodSync(path, mode);

      expect(resolveProviderCliRuntime("codex_cli", configuredEnvironment(binDir), "linux"))
        .toEqual({ status: "unavailable", error_code: "provider_runtime_denied" });
    }
  });

  it.runIf(process.platform !== "win32")("rejects a group-writable directory on the resolved executable path", () => {
    const installRoot = temporaryRoot();
    const binDir = join(installRoot, "bin");
    const providerDir = join(installRoot, "claude");
    const versionDir = join(providerDir, "2.1.216");
    mkdirSync(binDir, { mode: 0o700 });
    mkdirSync(versionDir, { recursive: true, mode: 0o700 });
    const target = join(versionDir, "claude");
    executable(target);
    chmodSync(providerDir, 0o720);
    symlinkSync("../claude/2.1.216/claude", join(binDir, "claude"), "file");

    expect(resolveProviderCliRuntime("claude_cli", configuredEnvironment(binDir), "linux"))
      .toEqual({ status: "unavailable", error_code: "provider_runtime_denied" });
  });

  it.runIf(process.platform !== "win32")("rejects a group-writable configured bin directory", () => {
    const binDir = join(temporaryRoot(), "bin");
    mkdirSync(binDir, { mode: 0o700 });
    executable(join(binDir, "agy"));
    chmodSync(binDir, 0o720);

    expect(resolveProviderCliRuntime("agy_cli", configuredEnvironment(binDir), "linux"))
      .toEqual({ status: "unavailable", error_code: "provider_runtime_denied" });
  });

  it.runIf((process.getuid?.() ?? 0) !== 0)("does not relax ownership for a mismatched test root", () => {
    const binDir = join(temporaryRoot(), "bin");
    mkdirSync(binDir, { mode: 0o700 });
    executable(join(binDir, "codex"));
    const mismatchedRoot = temporaryRoot();

    expect(resolveProviderCliRuntime("codex_cli", configuredEnvironment(binDir, {
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: mismatchedRoot
    }), "linux")).toEqual({ status: "unavailable", error_code: "provider_runtime_denied" });
  });
});
