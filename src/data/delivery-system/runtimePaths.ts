import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

export const AUTOPILOT_PROJECTS_DIR_ENV = "AUTOPILOT_PROJECTS_DIR";

export function resolveConfiguredProjectRoot(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  homeDirectory: string = homedir()
): string {
  const configured = environment[AUTOPILOT_PROJECTS_DIR_ENV] ?? join(homeDirectory, "projects");
  if (!isAbsolute(configured) || normalize(configured) !== configured) {
    throw new Error("invalid_project_root");
  }
  return configured;
}
