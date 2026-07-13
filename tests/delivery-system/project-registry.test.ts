import { spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  initializeProjectRegistry,
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
  it("initializes an empty registry once without discovering projects", () => {
    const root = createStateDir();
    const stateDir = join(root, "state");
    const projectRoot = join(root, "projects");
    mkdirSync(join(projectRoot, "existing-project"), { recursive: true, mode: 0o700 });

    const first = initializeProjectRegistry(stateDir, { projectRoot });
    const registryPath = join(stateDir, "projects.json");
    const bytes = readFileSync(registryPath, "utf8");
    const second = initializeProjectRegistry(stateDir, { projectRoot });

    expect(first).toEqual({
      state_dir: stateDir,
      project_root: projectRoot,
      state_dir_created: true,
      project_root_created: false,
      registry_created: true
    });
    expect(second).toEqual({
      state_dir: stateDir,
      project_root: projectRoot,
      state_dir_created: false,
      project_root_created: false,
      registry_created: false
    });
    expect(readFileSync(registryPath, "utf8")).toBe(bytes);
    expect(JSON.parse(bytes)).toEqual({ schema_version: "v1", projects: [] });
    expect(readdirSync(stateDir)).toEqual(["projects.json"]);
  });

  it("reports which directory creation actually won when roots coincide", () => {
    const root = createStateDir();
    const sharedRoot = join(root, "shared");

    expect(initializeProjectRegistry(sharedRoot, { projectRoot: sharedRoot })).toEqual({
      state_dir: sharedRoot,
      project_root: sharedRoot,
      state_dir_created: true,
      project_root_created: false,
      registry_created: true
    });
  });

  it.runIf(process.platform !== "win32")("uses private permissions for newly created registry paths", () => {
    const root = createStateDir();
    const stateDir = join(root, "state");
    const projectRoot = join(root, "projects");

    initializeProjectRegistry(stateDir, { projectRoot });

    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
    expect(statSync(projectRoot).mode & 0o777).toBe(0o700);
    expect(statSync(join(stateDir, "projects.json")).mode & 0o777).toBe(0o600);
  });

  it.runIf(process.platform !== "win32")("rejects existing managed directories with public permissions", () => {
    const root = createStateDir();
    const stateDir = join(root, "state");
    const projectRoot = join(root, "projects");
    mkdirSync(stateDir, { mode: 0o755 });
    mkdirSync(projectRoot, { mode: 0o755 });

    expect(() => initializeProjectRegistry(stateDir, { projectRoot })).toThrow("insecure_project_registry_permissions");
  });

  it.runIf(process.platform !== "win32")("publishes replacement registries with mode 0600", () => {
    const stateDir = createStateDir();
    const registryPath = join(stateDir, "projects.json");
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [] });
    chmodSync(registryPath, 0o644);

    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [] });

    expect(statSync(registryPath).mode & 0o777).toBe(0o600);
  });

  it("validates and never replaces a malformed existing registry", () => {
    const root = createStateDir();
    const stateDir = join(root, "state");
    const projectRoot = join(root, "projects");
    mkdirSync(stateDir, { mode: 0o700 });
    const registryPath = join(stateDir, "projects.json");
    writeFileSync(registryPath, "malformed\n");
    if (process.platform !== "win32") chmodSync(registryPath, 0o640);

    expect(() => initializeProjectRegistry(stateDir, { projectRoot })).toThrow("invalid_project_registry");
    expect(readFileSync(registryPath, "utf8")).toBe("malformed\n");
    if (process.platform !== "win32") expect(statSync(registryPath).mode & 0o777).toBe(0o640);
  });

  it("preserves an independently formatted populated valid registry", () => {
    const root = createStateDir();
    const stateDir = join(root, "state");
    const projectRoot = join(root, "projects");
    mkdirSync(stateDir, { mode: 0o700 });
    const registryPath = join(stateDir, "projects.json");
    const bytes = `${JSON.stringify({
      schema_version: "v1",
      projects: [{
        schema_version: "v1",
        project_id: "existing",
        name: "Existing",
        cwd: join(projectRoot, "existing"),
        enabled: false
      }]
    })}\n\n`;
    writeFileSync(registryPath, bytes);

    const result = initializeProjectRegistry(stateDir, { projectRoot });

    expect(result.registry_created).toBe(false);
    expect(readFileSync(registryPath, "utf8")).toBe(bytes);
  });

  it("preserves a valid registry published while initialization is contending", () => {
    const root = createStateDir();
    const stateDir = join(root, "state");
    const projectRoot = join(root, "projects");
    const registryPath = join(stateDir, "projects.json");
    const bytes = `${JSON.stringify({
      schema_version: "v1",
      projects: [{
        schema_version: "v1",
        project_id: "winner",
        name: "Winning Registry",
        cwd: join(projectRoot, "winner"),
        enabled: true
      }]
    })}\n\n`;

    const result = withRegistryPublishContention(registryPath, bytes, () =>
      initializeProjectRegistry(stateDir, { projectRoot })
    );

    expect(result).toEqual({
      state_dir: stateDir,
      project_root: projectRoot,
      state_dir_created: true,
      project_root_created: true,
      registry_created: false
    });
    expect(readFileSync(registryPath, "utf8")).toBe(bytes);
    expect(readdirSync(stateDir)).toEqual(["projects.json"]);
  });

  it("refuses a malformed registry published while initialization is contending", () => {
    const root = createStateDir();
    const stateDir = join(root, "state");
    const projectRoot = join(root, "projects");
    const registryPath = join(stateDir, "projects.json");
    const bytes = "malformed contender\n";

    expect(() => withRegistryPublishContention(registryPath, bytes, () =>
      initializeProjectRegistry(stateDir, { projectRoot })
    )).toThrow("invalid_project_registry");
    expect(readFileSync(registryPath, "utf8")).toBe(bytes);
    expect(readdirSync(stateDir)).toEqual(["projects.json"]);
  });

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
    const projectRoot = join(stateDir, "projects");
    const projectPath = join(projectRoot, "autopilot-beta");
    mkdirSync(projectPath, { recursive: true });
    const project = {
      schema_version: "v1" as const,
      project_id: "autopilot-beta",
      name: "Autopilot Beta",
      cwd: projectPath,
      enabled: true
    };

    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [project] });

    expect(resolveEnabledProject(stateDir, "autopilot-beta", { projectRoot })).toEqual(project);
    expect(() => resolveEnabledProject(stateDir, "/tmp/escape")).toThrow("project_not_found");
  });

  it("enforces the configured project root when resolver options are omitted", () => {
    const root = createStateDir();
    const stateDir = join(root, "state");
    const projectRoot = join(root, "projects");
    const outside = join(root, "outside");
    mkdirSync(stateDir);
    mkdirSync(projectRoot);
    mkdirSync(outside);
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{
      schema_version: "v1", project_id: "outside", name: "Outside", cwd: outside, enabled: true
    }] });
    const previous = process.env.AUTOPILOT_PROJECTS_DIR;
    process.env.AUTOPILOT_PROJECTS_DIR = projectRoot;
    try {
      expect(() => resolveEnabledProject(stateDir, "outside")).toThrow("project_path_outside_root");
    } finally {
      if (previous === undefined) delete process.env.AUTOPILOT_PROJECTS_DIR;
      else process.env.AUTOPILOT_PROJECTS_DIR = previous;
    }
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

  it.runIf(process.platform !== "win32")("rejects a symlink registry without following it", () => {
    const root = createStateDir();
    const target = join(root, "target.json");
    writeFileSync(target, JSON.stringify({ schema_version: "v1", projects: [] }));
    symlinkSync(target, join(root, "projects.json"), "file");
    expect(() => readProjectRegistry(root)).toThrow("invalid_project_registry");
  });

  it("rejects a non-regular registry file without blocking", () => {
    const nonregular = createStateDir();
    mkdirSync(join(nonregular, "projects.json"));
    expect(() => readProjectRegistry(nonregular)).toThrow("invalid_project_registry");
  });

  it.runIf(process.platform !== "win32")("rejects a FIFO registry without blocking", () => {
    const stateDir = createStateDir();
    const fifo = spawnSync("mkfifo", [join(stateDir, "projects.json")], { encoding: "utf8" });
    expect(fifo).toMatchObject({ status: 0, signal: null });

    const moduleUrl = pathToFileURL(join(process.cwd(), "src/data/delivery-system/projectRegistry.ts")).href;
    const child = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `const { readProjectRegistry } = await import(${JSON.stringify(moduleUrl)});` +
        `try { readProjectRegistry(${JSON.stringify(stateDir)}); } catch (error) { console.log(error.message); }`
    ], { encoding: "utf8", timeout: 2_000 });

    expect(child.error).toBeUndefined();
    expect(child).toMatchObject({ status: 0, signal: null });
    expect(child.stdout.trim()).toBe("invalid_project_registry");
  });

  it("rejects BOM-prefixed and invalid UTF-8 registry bytes", () => {
    const stateDir = createStateDir();
    const registryPath = join(stateDir, "projects.json");
    writeFileSync(registryPath, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(JSON.stringify({ schema_version: "v1", projects: [] }))
    ]));
    expect(() => readProjectRegistry(stateDir)).toThrow("invalid_project_registry");

    writeFileSync(registryPath, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]));
    expect(() => readProjectRegistry(stateDir)).toThrow("invalid_project_registry");
  });

  it("rejects a registry that grows while its descriptor is being read", () => {
    const stateDir = createStateDir();
    const registryPath = join(stateDir, "projects.json");
    writeFileSync(registryPath, JSON.stringify({ schema_version: "v1", projects: [] }));

    expect(() => withRegistryReadContention(() => appendFileSync(registryPath, " "), () =>
      readProjectRegistry(stateDir)
    )).toThrow("invalid_project_registry");
  });

  it.runIf(process.platform !== "win32")("rejects a registry path replaced while its descriptor is being read", () => {
    const stateDir = createStateDir();
    const registryPath = join(stateDir, "projects.json");
    const replacementPath = join(stateDir, "replacement.json");
    writeFileSync(registryPath, JSON.stringify({ schema_version: "v1", projects: [] }));
    writeFileSync(replacementPath, JSON.stringify({ schema_version: "v1", projects: [] }));

    expect(() => withRegistryReadContention(() => renameSync(replacementPath, registryPath), () =>
      readProjectRegistry(stateDir)
    )).toThrow("invalid_project_registry");
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

function withRegistryPublishContention<T>(registryPath: string, bytes: string, action: () => T): T {
  const linkSync = fs.linkSync;
  fs.linkSync = (existingPath, newPath) => {
    writeFileSync(registryPath, bytes, { flag: "wx" });
    linkSync(existingPath, newPath);
  };
  syncBuiltinESMExports();
  try {
    return action();
  } finally {
    fs.linkSync = linkSync;
    syncBuiltinESMExports();
  }
}

function withRegistryReadContention<T>(contend: () => void, action: () => T): T {
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
