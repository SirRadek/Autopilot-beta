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
