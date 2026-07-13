import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const systemdDir = join(process.cwd(), "ops", "systemd");

function readSystemdFile(name: string): string {
  return readFileSync(join(systemdDir, name), "utf8");
}

describe("systemd unit writable boundaries", () => {
  it("limits the control plane to managed state and the default projects root", () => {
    const controlPlane = readSystemdFile("autopilot-control-plane.service");

    expect(controlPlane).toContain("Environment=AUTOPILOT_PROJECTS_DIR=%h/projects");
    expect(controlPlane).toContain("ProtectHome=read-only");
    expect(controlPlane).toContain("ReadWritePaths=%h/.local/state/autopilot %h/projects");
    expect(controlPlane).not.toMatch(/ReadWritePaths=.*autopilot-beta/);
  });

  it("keeps maintenance backups inside managed state", () => {
    const maintenance = readSystemdFile("autopilot-state-maintenance.service");

    expect(maintenance).toContain(
      "ExecStart=/home/radek/.local/bin/npm run ops:backup -- %h/.local/state/autopilot %h/.local/state/autopilot/backups"
    );
    expect(maintenance).toContain("ProtectHome=read-only");
    expect(maintenance).toContain("ReadWritePaths=%h/.local/state/autopilot");
    expect(maintenance).not.toContain("autopilot-backups");
  });

  it("documents the reviewed custom-root drop-in", () => {
    const readme = readSystemdFile("README.md");

    expect(readme).toContain("ReadWritePaths=");
    expect(readme).toContain("AUTOPILOT_PROJECTS_DIR");
    expect(readme).toMatch(/reviewed drop-in/i);
  });
});
