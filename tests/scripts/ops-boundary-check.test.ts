import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyRuntimeWriteBoundary } from "../../scripts/ops-boundary-check";

describe("runtime write boundary", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("accepts writable managed roots and a read-only installation", () => {
    const root = mkdtempSync(join(tmpdir(), "autopilot-boundary-"));
    roots.push(root);
    const installationDirectory = join(root, "installation");
    const stateDirectory = join(root, "state");
    const projectsDirectory = join(root, "projects");
    for (const directory of [installationDirectory, stateDirectory, projectsDirectory]) {
      mkdirSync(directory);
    }
    chmodSync(installationDirectory, 0o555);

    expect(verifyRuntimeWriteBoundary({
      installationDirectory,
      writableDirectories: [stateDirectory, projectsDirectory]
    })).toEqual({
      ok: true,
      installation_read_only: true,
      managed_write_roots: 2
    });
    expect(readdirSync(stateDirectory)).toEqual([]);
    expect(readdirSync(projectsDirectory)).toEqual([]);
  });

  it("fails closed and removes its marker when the installation is writable", () => {
    const root = mkdtempSync(join(tmpdir(), "autopilot-boundary-"));
    roots.push(root);
    const installationDirectory = join(root, "installation");
    const stateDirectory = join(root, "state");
    mkdirSync(installationDirectory);
    mkdirSync(stateDirectory);

    expect(() => verifyRuntimeWriteBoundary({
      installationDirectory,
      writableDirectories: [stateDirectory]
    })).toThrow("installation_write_boundary_not_enforced");
    expect(readdirSync(installationDirectory)).toEqual([]);
    expect(readdirSync(stateDirectory)).toEqual([]);
  });
});
