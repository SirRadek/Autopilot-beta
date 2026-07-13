import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  AUTOPILOT_PROJECTS_DIR_ENV,
  resolveConfiguredProjectRoot
} from "../../src/data/delivery-system/runtimePaths";
import {
  loadProjectDecisionMeshFromRoot,
  resolveProjectMeshRoot
} from "../../src/lib/decision-mesh";

const here = dirname(fileURLToPath(import.meta.url));
const projectsDir = join(here, "../fixtures/decision-mesh/projects-dir");
const controlPlaneRoot = join(here, "../fixtures/decision-mesh/control-plane");
const originalProjectsDir = process.env.AUTOPILOT_PROJECTS_DIR;

describe("configured project root", () => {
  it("defaults to the projects directory under the user's home", () => {
    expect(resolveConfiguredProjectRoot({}, "/home/radek")).toBe("/home/radek/projects");
  });

  it("honors the canonical environment override", () => {
    expect(AUTOPILOT_PROJECTS_DIR_ENV).toBe("AUTOPILOT_PROJECTS_DIR");
    expect(
      resolveConfiguredProjectRoot(
        { AUTOPILOT_PROJECTS_DIR: "/srv/autopilot-projects" },
        "/home/radek"
      )
    ).toBe("/srv/autopilot-projects");
  });

  it("rejects a relative configured root", () => {
    expect(() =>
      resolveConfiguredProjectRoot({ AUTOPILOT_PROJECTS_DIR: "relative" }, "/home/radek")
    ).toThrow("invalid_project_root");
  });
});

describe("project Decision Mesh root resolution", () => {
  afterEach(() => {
    if (originalProjectsDir === undefined) {
      delete process.env.AUTOPILOT_PROJECTS_DIR;
      return;
    }

    process.env.AUTOPILOT_PROJECTS_DIR = originalProjectsDir;
  });

  it("resolves and loads a sibling project repo mesh", () => {
    process.env.AUTOPILOT_PROJECTS_DIR = projectsDir;

    const projectRoot = resolveProjectMeshRoot(controlPlaneRoot, "demo-proj");

    expect(projectRoot).toBe(join(projectsDir, "demo-proj"));
    const projectMesh = loadProjectDecisionMeshFromRoot(projectRoot, "demo-proj");
    expect(projectMesh.nodes.map((node) => node.id)).toContain("sibling_project_mesh");
  });

  it("falls back to the control-plane root when no sibling mesh exists", () => {
    process.env.AUTOPILOT_PROJECTS_DIR = projectsDir;

    expect(resolveProjectMeshRoot(controlPlaneRoot, "missing-proj")).toBe(controlPlaneRoot);
  });

  it("rejects traversal slugs before resolving a sibling path", () => {
    process.env.AUTOPILOT_PROJECTS_DIR = projectsDir;

    expect(() => resolveProjectMeshRoot(controlPlaneRoot, "../evil")).toThrow(
      "Invalid project mesh slug: ../evil"
    );
  });
});
