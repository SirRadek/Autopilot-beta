import { accessSync, constants, realpathSync, statSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";

type ProviderCli = "codex_cli" | "claude_cli" | "agy_cli";
type ProviderCliRuntimeError = "provider_executable_missing" | "provider_runtime_denied";

export type ProviderCliRuntimeResult =
  | { readonly status: "available"; readonly executable: string }
  | { readonly status: "unavailable"; readonly error_code: ProviderCliRuntimeError };

const PROVIDER_EXECUTABLES: Readonly<Record<ProviderCli, "codex" | "claude" | "agy">> = {
  codex_cli: "codex",
  claude_cli: "claude",
  agy_cli: "agy"
};

/**
 * Resolves only the fixed executable assigned to the provider. A configured directory is a
 * fail-closed production boundary; the bare-name result exists solely for unconfigured dev use.
 */
export function resolveProviderCliRuntime(
  provider: ProviderCli,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform
): ProviderCliRuntimeResult {
  const basename = PROVIDER_EXECUTABLES[provider];
  const configuredDirectory = environment.AUTOPILOT_PROVIDER_CLI_BIN_DIR;

  if (configuredDirectory === undefined) {
    return {
      status: "available",
      executable: platform === "win32" ? `${basename}.cmd` : basename
    };
  }

  if (
    configuredDirectory.length === 0
    || !isAbsolute(configuredDirectory)
    || normalize(configuredDirectory) !== configuredDirectory
  ) {
    return unavailable("provider_runtime_denied");
  }

  const configuredInstallRoot = dirname(configuredDirectory);
  let realInstallRoot: string;
  let realDirectory: string;
  try {
    if (!statSync(configuredDirectory).isDirectory()) {
      return unavailable("provider_runtime_denied");
    }
    realInstallRoot = realpathSync(configuredInstallRoot);
    realDirectory = realpathSync(configuredDirectory);
  } catch (error) {
    return unavailable(runtimePathError(error));
  }

  if (configuredInstallRoot !== realInstallRoot || !isContainedPath(realInstallRoot, realDirectory)) {
    return unavailable("provider_runtime_denied");
  }

  const executable = join(configuredDirectory, basename);
  let realExecutable: string;
  try {
    realExecutable = realpathSync(executable);
  } catch (error) {
    return unavailable(runtimePathError(error));
  }

  if (!isContainedPath(realInstallRoot, realExecutable)) {
    return unavailable("provider_runtime_denied");
  }

  const expectedOwnerUid = trustedOwnerUid(environment, realInstallRoot);
  const publishedDirectories = containedDirectories(realInstallRoot, realDirectory);
  const targetDirectories = containedDirectories(realInstallRoot, dirname(realExecutable));
  if (publishedDirectories === null || targetDirectories === null) {
    return unavailable("provider_runtime_denied");
  }
  const trustedDirectories = new Set([
    ...publishedDirectories,
    ...targetDirectories
  ]);
  try {
    for (const directory of trustedDirectories) {
      const metadata = statSync(directory);
      if (!metadata.isDirectory() || !hasTrustedOwnershipAndMode(metadata, expectedOwnerUid)) {
        return unavailable("provider_runtime_denied");
      }
    }
  } catch (error) {
    return unavailable(runtimePathError(error));
  }

  let executableMetadata: Stats;
  try {
    executableMetadata = statSync(realExecutable);
  } catch (error) {
    return unavailable(runtimePathError(error));
  }
  if (!executableMetadata.isFile()) {
    return unavailable("provider_executable_missing");
  }
  if (!hasTrustedOwnershipAndMode(executableMetadata, expectedOwnerUid)) {
    return unavailable("provider_runtime_denied");
  }

  try {
    accessSync(realExecutable, constants.X_OK);
  } catch (error) {
    const code = errorCode(error);
    // A present but non-executable file reports EACCES; a concurrently vanished file reports
    // ENOENT/ENOTDIR. Both are the bounded executable-missing capability state from the contract.
    return unavailable(code === "EACCES" || code === "ENOENT" || code === "ENOTDIR"
      ? "provider_executable_missing"
      : runtimePathError(error));
  }

  return { status: "available", executable };
}

function isContainedPath(directory: string, candidate: string): boolean {
  const child = relative(directory, candidate);
  return child.length > 0
    && child !== ".."
    && !child.startsWith(`..${sep}`)
    && !isAbsolute(child);
}

function containedDirectories(root: string, directory: string): readonly string[] | null {
  const child = relative(root, directory);
  if (child.length === 0) return [root];
  if (!isContainedPath(root, directory)) return null;

  const directories = [root];
  let current = root;
  for (const segment of child.split(sep)) {
    current = join(current, segment);
    directories.push(current);
  }
  return directories;
}

function trustedOwnerUid(
  environment: Readonly<Record<string, string | undefined>>,
  realInstallRoot: string
): number {
  const testRoot = environment.AUTOPILOT_PROVIDER_CLI_TEST_ROOT;
  if (
    environment.AUTOPILOT_PROVIDER_CLI_TEST_MODE !== "1"
    || testRoot === undefined
    || testRoot.length === 0
    || !isAbsolute(testRoot)
    || normalize(testRoot) !== testRoot
  ) {
    return 0;
  }

  try {
    if (realpathSync(testRoot) !== realInstallRoot) return 0;
  } catch {
    return 0;
  }
  return process.getuid?.() ?? 0;
}

function hasTrustedOwnershipAndMode(metadata: Stats, expectedOwnerUid: number): boolean {
  return metadata.uid === expectedOwnerUid && (metadata.mode & 0o022) === 0;
}

function runtimePathError(error: unknown): ProviderCliRuntimeError {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR"
    ? "provider_executable_missing"
    : "provider_runtime_denied";
}

function errorCode(error: unknown): string {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
    ? error.code
    : "";
}

function unavailable(errorCode: ProviderCliRuntimeError): ProviderCliRuntimeResult {
  return { status: "unavailable", error_code: errorCode };
}
