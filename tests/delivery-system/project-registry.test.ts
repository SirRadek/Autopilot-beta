import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  readProjectRegistry,
  resolveEnabledProject,
  writeProjectRegistry
} from "../../src/data/delivery-system/projectRegistry";

const stateDirs: string[] = [];

function createStateDir(): string {
  const stateDir = mkdtempSync(join(tmpdir(), "project-registry-"));
  stateDirs.push(stateDir);
  return stateDir;
}

afterEach(() => {
  for (const stateDir of stateDirs.splice(0)) {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

describe("project registry", () => {
  it("resolves only an enabled registered project", () => {
    const stateDir = createStateDir();
    const project = {
      schema_version: "v1" as const,
      project_id: "autopilot-beta",
      name: "Autopilot Beta",
      cwd: "/home/radek/autopilot-beta",
      enabled: true
    };

    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [project] });

    expect(resolveEnabledProject(stateDir, "autopilot-beta")).toEqual(project);
    expect(() => resolveEnabledProject(stateDir, "/tmp/escape")).toThrow("project_not_found");
  });

  it("rejects invalid, duplicate, and oversized registries", () => {
    const stateDir = createStateDir();
    const project = {
      schema_version: "v1" as const,
      project_id: "valid-project",
      name: "Valid Project",
      cwd: "/srv/valid-project",
      enabled: true
    };

    expect(() => writeProjectRegistry(stateDir, {
      schema_version: "v1",
      projects: [{ ...project, project_id: "Invalid Project" }]
    })).toThrow("invalid_project_registry");
    expect(() => writeProjectRegistry(stateDir, {
      schema_version: "v1",
      projects: [project, project]
    })).toThrow("invalid_project_registry");
    expect(() => writeProjectRegistry(stateDir, {
      schema_version: "v1",
      projects: Array.from({ length: 65 }, (_, index) => ({
        ...project,
        project_id: `project-${index}`
      }))
    })).toThrow("invalid_project_registry");
  });

  it("validates persisted registries when reading", () => {
    const stateDir = createStateDir();

    expect(readProjectRegistry(stateDir)).toEqual({ schema_version: "v1", projects: [] });
    expect(() => writeProjectRegistry(stateDir, {
      schema_version: "v1",
      projects: [{
        schema_version: "v1",
        project_id: "relative-project",
        name: "Relative Project",
        cwd: "relative/path",
        enabled: true
      }]
    })).toThrow("invalid_project_registry");
  });
});
