import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const systemdDir = join(process.cwd(), "ops", "systemd");

function readSystemdFile(name: string): string {
  return readFileSync(join(systemdDir, name), "utf8");
}

function activeServiceDirectives(source: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  let section = "";

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line;
      continue;
    }
    if (section !== "[Service]") continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    directives.set(key, [...(directives.get(key) ?? []), value]);
  }

  return directives;
}

function environmentValue(directives: Map<string, string[]>, name: string): string | undefined {
  const prefix = `${name}=`;
  return directives
    .get("Environment")
    ?.map((assignment) => assignment.startsWith(prefix) ? assignment.slice(prefix.length) : undefined)
    .find((value) => value !== undefined);
}

describe("systemd unit writable boundaries", () => {
  it("limits the control plane to managed state and the configured projects root", () => {
    const directives = activeServiceDirectives(readSystemdFile("autopilot-control-plane.service"));

    expect(directives.get("ProtectSystem")).toEqual(["strict"]);
    expect(directives.get("ProtectHome")).toEqual(["read-only"]);
    expect(directives.get("PrivateUsers")).toEqual(["true"]);
    expect(directives.get("ReadWritePaths")).toEqual(["%h/.local/state/autopilot %h/projects"]);

    const projectsRoot = environmentValue(directives, "AUTOPILOT_PROJECTS_DIR");
    expect(projectsRoot).toBe("%h/projects");
    expect(directives.get("ReadWritePaths")?.flatMap((value) => value.split(/\s+/))).toContain(projectsRoot);
  });

  it("keeps maintenance backups inside its only writable managed-state path", () => {
    const directives = activeServiceDirectives(readSystemdFile("autopilot-state-maintenance.service"));

    expect(directives.get("ProtectSystem")).toEqual(["strict"]);
    expect(directives.get("ProtectHome")).toEqual(["read-only"]);
    expect(directives.get("PrivateUsers")).toEqual(["true"]);
    expect(directives.get("ReadWritePaths")).toEqual(["%h/.local/state/autopilot"]);
    expect(directives.get("ExecStart")).toContain(
      "/home/radek/.local/bin/npm run ops:backup -- %h/.local/state/autopilot %h/.local/state/autopilot/backups"
    );
    expect(directives.get("ExecStart")?.join("\n")).not.toContain("autopilot-backups");
  });

  it("gives every protected user service the namespace prerequisite", () => {
    for (const name of [
      "autopilot-control-plane.service",
      "autopilot-control-plane-health.service",
      "autopilot-state-maintenance.service"
    ]) {
      const directives = activeServiceDirectives(readSystemdFile(name));

      expect(directives.get("ProtectSystem"), name).toEqual(["strict"]);
      expect(directives.get("ProtectHome"), name).toEqual(["read-only"]);
      expect(directives.get("PrivateUsers"), name).toEqual(["true"]);
    }
  });

  it("documents one authoritative custom-root assignment and matching writable path", () => {
    const readme = readSystemdFile("README.md");

    expect(readme).toContain("AUTOPILOT_PROJECTS_DIR=/srv/autopilot-projects");
    expect(readme).not.toContain("Environment=AUTOPILOT_PROJECTS_DIR=/srv/autopilot-projects");
    expect(readme).toContain("ReadWritePaths=\nReadWritePaths=%h/.local/state/autopilot /srv/autopilot-projects");
    expect(readme).toMatch(/resolved `AUTOPILOT_PROJECTS_DIR`.*equal.*`ReadWritePaths`/is);
    expect(readme).toMatch(/D3 acceptance.*positive\/negative write proof/is);
  });
});
