import { accessSync, constants, realpathSync, statSync, type Stats } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

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

  let realDirectory: string;
  try {
    if (!statSync(configuredDirectory).isDirectory()) {
      return unavailable("provider_runtime_denied");
    }
    realDirectory = realpathSync(configuredDirectory);
  } catch (error) {
    return unavailable(runtimePathError(error));
  }

  const executable = join(configuredDirectory, basename);
  let realExecutable: string;
  try {
    realExecutable = realpathSync(executable);
  } catch (error) {
    return unavailable(runtimePathError(error));
  }

  if (!isContainedPath(realDirectory, realExecutable)) {
    return unavailable("provider_runtime_denied");
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
