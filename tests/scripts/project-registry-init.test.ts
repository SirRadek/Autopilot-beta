import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("project registry init CLI", () => {
  it("prints a bounded result and does not auto-register discovered directories", () => {
    const root = mkdtempSync(join(tmpdir(), "project-registry-init-"));
    roots.push(root);
    const stateDir = join(root, "state");
    const projectRoot = join(root, "projects");
    mkdirSync(join(projectRoot, "existing-project"), { recursive: true });

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/project-registry-init.ts", stateDir, projectRoot],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual({
      state_dir: stateDir,
      project_root: projectRoot,
      state_dir_created: true,
      project_root_created: false,
      registry_created: true
    });
    expect(JSON.parse(readFileSync(join(stateDir, "projects.json"), "utf8"))).toEqual({
      schema_version: "v1",
      projects: []
    });
  });

  it("preserves the registry bytes on repeated initialization", () => {
    const root = mkdtempSync(join(tmpdir(), "project-registry-init-repeat-"));
    roots.push(root);
    const stateDir = join(root, "state");
    const projectRoot = join(root, "projects");

    const first = runCli([stateDir, projectRoot]);
    const registryPath = join(stateDir, "projects.json");
    const bytes = readFileSync(registryPath, "utf8");
    const second = runCli([stateDir, projectRoot]);

    expect(JSON.parse(first.stdout).registry_created).toBe(true);
    expect(JSON.parse(second.stdout).registry_created).toBe(false);
    expect(readFileSync(registryPath, "utf8")).toBe(bytes);
  });

  it("uses the isolated home projects directory when project root is omitted", () => {
    const root = mkdtempSync(join(tmpdir(), "project-registry-init-home-"));
    roots.push(root);
    const home = join(root, "home");
    const stateDir = join(root, "state");
    const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
    delete environment.AUTOPILOT_PROJECTS_DIR;

    const result = runCli([stateDir], environment);

    expect(JSON.parse(result.stdout)).toEqual({
      state_dir: stateDir,
      project_root: join(home, "projects"),
      state_dir_created: true,
      project_root_created: true,
      registry_created: true
    });
  });

  it("requires a state directory argument", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/project-registry-init.ts"],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("usage: npm run projects:init -- STATE_DIR [PROJECT_ROOT]");
  });
});

function runCli(args: readonly string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/project-registry-init.ts", ...args],
    { cwd: process.cwd(), encoding: "utf8", env }
  );
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
  return result;
}
