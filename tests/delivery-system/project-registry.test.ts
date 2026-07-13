import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  readProjectRegistry,
  resolveEnabledProject,
  writeProjectRegistry
} from "../../src/data/delivery-system/projectRegistry";

const stateDirs: string[] = [];

function linkDirectory(target: string, path: string): void {
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}

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
  it("returns a canonical project path strictly inside the configured root", () => {
    const stateDir = createStateDir();
    const projectRoot = join(stateDir, "projects");
    const inside = join(projectRoot, "inside");
    mkdirSync(inside, { recursive: true });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{
      schema_version: "v1", project_id: "inside", name: "Inside", cwd: inside, enabled: true
    }] });

    expect(resolveEnabledProject(stateDir, "inside", { projectRoot }).cwd).toBe(realpathSync(inside));
  });

  it("rejects the configured root itself and projects outside it", () => {
    const stateDir = createStateDir();
    const projectRoot = join(stateDir, "projects");
    const outside = join(stateDir, "outside");
    mkdirSync(projectRoot);
    mkdirSync(outside);
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [
      { schema_version: "v1", project_id: "root", name: "Root", cwd: projectRoot, enabled: true },
      { schema_version: "v1", project_id: "outside", name: "Outside", cwd: outside, enabled: true }
    ] });

    expect(() => resolveEnabledProject(stateDir, "root", { projectRoot })).toThrow("project_path_outside_root");
    expect(() => resolveEnabledProject(stateDir, "outside", { projectRoot })).toThrow("project_path_outside_root");
  });

  it("rejects a registered symlink that escapes the configured root", () => {
    const stateDir = createStateDir();
    const projectRoot = join(stateDir, "projects");
    const outside = join(stateDir, "outside");
    const escapedLink = join(projectRoot, "escaped-link");
    mkdirSync(projectRoot);
    mkdirSync(outside);
    linkDirectory(outside, escapedLink);
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{
      schema_version: "v1", project_id: "escaped-link", name: "Escaped link", cwd: escapedLink, enabled: true
    }] });

    expect(() => resolveEnabledProject(stateDir, "escaped-link", { projectRoot })).toThrow("project_path_outside_root");
  });

  it("reports bounded errors for missing project and configured root paths", () => {
    const stateDir = createStateDir();
    const projectRoot = join(stateDir, "projects");
    const missingProject = join(projectRoot, "missing");
    mkdirSync(projectRoot);
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{
      schema_version: "v1", project_id: "missing", name: "Missing", cwd: missingProject, enabled: true
    }] });

    expect(() => resolveEnabledProject(stateDir, "missing", { projectRoot })).toThrow("project_path_missing");
    expect(() => resolveEnabledProject(stateDir, "missing", { projectRoot: join(stateDir, "missing-root") }))
      .toThrow("invalid_project_root");
  });

  it("converts malformed persisted JSON to a stable registry error", () => {
    const stateDir = createStateDir();
    writeFileSync(join(stateDir, "projects.json"), "not json");

    expect(() => readProjectRegistry(stateDir)).toThrow("invalid_project_registry");
  });

  it("converts unexpected registry write failures to a fixed internal error", () => {
    const stateDir = createStateDir();
    const notDirectory = join(stateDir, "not-a-directory");
    writeFileSync(notDirectory, "occupied");

    expect(() => writeProjectRegistry(notDirectory, { schema_version: "v1", projects: [] }))
      .toThrow("project_registry_io_error");
  });

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

  it("bounds project IDs, names, and canonical paths", () => {
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
      projects: [{ ...project, project_id: `p${"a".repeat(80)}` }]
    })).toThrow("invalid_project_registry");
    expect(() => writeProjectRegistry(stateDir, {
      schema_version: "v1",
      projects: [{ ...project, name: "n".repeat(161) }]
    })).toThrow("invalid_project_registry");
    expect(() => writeProjectRegistry(stateDir, {
      schema_version: "v1",
      projects: [{ ...project, cwd: `/${"a".repeat(1_024)}` }]
    })).toThrow("invalid_project_registry");
  });

  it("rejects an oversized on-disk registry before parsing", () => {
    const stateDir = createStateDir();
    writeFileSync(join(stateDir, "projects.json"), Buffer.alloc(128 * 1_024 + 1, 0x20));

    expect(() => readProjectRegistry(stateDir)).toThrow("invalid_project_registry");
  });

  it("rejects a registry whose serialized representation exceeds the byte limit", () => {
    const stateDir = createStateDir();
    const projects = Array.from({ length: 64 }, (_, index) => ({
      schema_version: "v1" as const,
      project_id: `project-${index}`,
      name: "Valid Project",
      cwd: `/${"€".repeat(1_023)}`,
      enabled: true
    }));

    expect(() => writeProjectRegistry(stateDir, { schema_version: "v1", projects }))
      .toThrow("invalid_project_registry");
  });
});
