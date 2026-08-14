import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const systemdDir = join(process.cwd(), "ops", "systemd");
const operationsDocsDir = join(process.cwd(), "docs", "operations");

function readSystemdFile(name: string): string {
  return readFileSync(join(systemdDir, name), "utf8");
}

function regularFilesRecursively(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? regularFilesRecursively(path) : entry.isFile() ? [path] : [];
  }).sort();
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
  it("pins metadata, CI, and service execution to Node 24 from /usr/bin", () => {
    const rootPackage = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { engines?: { node?: string } };
    const cockpitPackage = JSON.parse(readFileSync(join(process.cwd(), "cockpit", "package.json"), "utf8")) as { engines?: { node?: string } };
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "verify.yml"), "utf8");

    expect(rootPackage.engines?.node).toBe(">=24 <25");
    expect(cockpitPackage.engines?.node).toBe(">=24 <25");
    expect(readFileSync(join(process.cwd(), ".nvmrc"), "utf8").trim()).toBe("24");
    expect(workflow).toContain("node-version: '24'");
    for (const name of [
      "autopilot-control-plane.service",
      "autopilot-control-plane-health.service",
      "autopilot-state-maintenance.service"
    ]) {
      const directives = activeServiceDirectives(readSystemdFile(name));
      expect(directives.get("Environment"), name).toContain("PATH=/usr/bin:/bin");
      expect(directives.get("ExecStart")?.every((command) => command.startsWith("/usr/bin/npm ")), name).toBe(true);
    }
  });

  it("limits the control plane to managed state and the configured projects root", () => {
    const directives = activeServiceDirectives(readSystemdFile("autopilot-control-plane.service"));

    expect(directives.get("User")).toEqual(["radek"]);
    expect(directives.get("Group")).toEqual(["radek"]);
    expect(directives.get("EnvironmentFile")).toEqual([
      "/home/radek/.config/autopilot/control-plane.env",
      "/etc/autopilot/control-plane-probes.env"
    ]);
    expect(environmentValue(directives, "PATH")).toBe("/usr/bin:/bin");
    expect(directives.get("ProtectSystem")).toEqual(["strict"]);
    expect(directives.get("ProtectHome")).toEqual(["read-only"]);
    expect(directives.get("PrivateTmp")).toEqual(["false"]);
    expect(directives.get("PrivateUsers")).toEqual(["true"]);
    expect(environmentValue(directives, "TMPDIR")).toBe("/home/radek/.local/state/.autopilot-runtime-tmp");
    expect(directives.get("ReadWritePaths")).toEqual([
      "/home/radek/.local/state/autopilot /home/radek/.local/state/.autopilot-incident-spool /home/radek/.local/state/.autopilot-runtime-tmp /home/radek/projects"
    ]);
    expect(directives.get("ExecStartPre")).toEqual([
      "+/usr/bin/install -d -o radek -g radek -m 0700 /home/radek/.local/state/.autopilot-runtime-tmp",
      "+/usr/bin/install -d -o radek -g radek -m 0700 /home/radek/.local/state/.autopilot-incident-spool",
      "/usr/bin/npm run ops:boundary-check -- /home/radek/autopilot-beta ${AUTOPILOT_STATE_DIR} ${AUTOPILOT_PROJECTS_DIR}"
    ]);

    const projectsRoot = environmentValue(directives, "AUTOPILOT_PROJECTS_DIR");
    expect(projectsRoot).toBe("/home/radek/projects");
    expect(directives.get("ReadWritePaths")?.flatMap((value) => value.split(/\s+/))).toContain(projectsRoot);
  });

  it("keeps the probe environment example nonsecret and allowlist-only", () => {
    const source = readFileSync(join(process.cwd(), "ops", "config", "control-plane-probes.env.example"), "utf8");
    const assignments = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));

    expect(assignments).toEqual(["CONTROL_PLANE_USAGE_PROBES="]);
  });

  it("uses the privileged system manager and fails closed when containment is ineffective", () => {
    const service = readSystemdFile("autopilot-control-plane.service");
    const directives = activeServiceDirectives(service);
    const readme = readSystemdFile("README.md");

    expect(service).toContain("WantedBy=multi-user.target");
    expect(directives.get("ExecStartPre")).toContain(
      "/usr/bin/npm run ops:boundary-check -- /home/radek/autopilot-beta ${AUTOPILOT_STATE_DIR} ${AUTOPILOT_PROJECTS_DIR}"
    );
    expect(readme).toContain("/etc/systemd/system");
    expect(readme).toContain("sudo systemctl enable --now autopilot-control-plane.service");
    expect(readme).not.toContain("systemctl --user enable");
    expect(readme).toContain("systemctl --user disable --now autopilot-control-plane.service");
  });

  it("keeps maintenance backups in managed state and grants only the external incident spool", () => {
    const directives = activeServiceDirectives(readSystemdFile("autopilot-state-maintenance.service"));

    expect(directives.get("ProtectSystem")).toEqual(["strict"]);
    expect(directives.get("ProtectHome")).toEqual(["read-only"]);
    expect(directives.get("PrivateUsers")).toEqual(["true"]);
    expect(directives.get("ReadWritePaths")).toEqual(["/home/radek/.local/state/autopilot /home/radek/.local/state/.autopilot-incident-spool"]);
    expect(directives.get("ExecStartPre")).toEqual(["+/usr/bin/install -d -o radek -g radek -m 0700 /home/radek/.local/state/.autopilot-incident-spool"]);
    expect(directives.get("ExecStart")).toEqual([
      "/usr/bin/npm run ops:maintenance -- /home/radek/.local/state/autopilot /home/radek/.local/state/autopilot/backups /home/radek/.config/autopilot/control-plane.env --apply"
    ]);
    expect(directives.get("ExecStart")?.join("\n")).not.toContain("autopilot-backups");
  });

  it("gives every protected system service the namespace prerequisite", () => {
    for (const name of [
      "autopilot-control-plane.service",
      "autopilot-control-plane-health.service",
      "autopilot-state-maintenance.service"
    ]) {
      const directives = activeServiceDirectives(readSystemdFile(name));

      expect(directives.get("User"), name).toEqual(["radek"]);
      expect(directives.get("Group"), name).toEqual(["radek"]);
      expect(directives.get("ProtectSystem"), name).toEqual(["strict"]);
      expect(directives.get("ProtectHome"), name).toEqual(["read-only"]);
      expect(directives.get("PrivateUsers"), name).toEqual(["true"]);
    }
  });

  it("uses explicit radek home paths in root-managed system units", () => {
    const protectedServices = readdirSync(systemdDir)
      .filter((name) => name.endsWith(".service"))
      .filter((name) => {
        const directives = activeServiceDirectives(readSystemdFile(name));
        return directives.get("User")?.includes("radek") === true && directives.has("ProtectHome");
      });

    expect(protectedServices).not.toEqual([]);
    for (const name of protectedServices) {
      expect(readSystemdFile(name), name).not.toContain("%h");
    }
  });

  it("provisions every external writable namespace path before protected services start", () => {
    const tmpfiles = readSystemdFile("autopilot-tmpfiles.conf");
    const readme = readSystemdFile("README.md");
    const installGuide = readFileSync(join(process.cwd(), "docs", "operations", "install-ubuntu-vm.md"), "utf8");

    expect(tmpfiles).toContain("d /home/radek/.local/state/.autopilot-runtime-tmp 0700 radek radek -");
    expect(tmpfiles).toContain("d /home/radek/.local/state/.autopilot-incident-spool 0700 radek radek -");
    for (const instructions of [readme, installGuide]) {
      expect(instructions).toContain("sudo install -m 0644 ops/systemd/autopilot-tmpfiles.conf /etc/tmpfiles.d/autopilot.conf");
      expect(instructions).toContain("sudo systemd-tmpfiles --create /etc/tmpfiles.d/autopilot.conf");
      expect(instructions.indexOf("sudo systemd-tmpfiles --create /etc/tmpfiles.d/autopilot.conf"))
        .toBeLessThan(instructions.indexOf("sudo systemctl enable --now autopilot-control-plane.service"));
    }
  });

  it("documents regenerating the protected environment without plaintext backup copies", () => {
    const providerInstall = readFileSync(
      join(process.cwd(), "docs", "operations", "provider-cli-install.md"),
      "utf8"
    );

    for (const path of regularFilesRecursively(operationsDocsDir)) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(/cp\s+-p[\s\S]*control-plane\.env[\s\S]*\.bak/);
    }
    expect(providerInstall).toMatch(/regenerat/i);
  });

  it("documents the retired control-plane token consistently", () => {
    const cockpitAuth = readFileSync(join(process.cwd(), "docs", "operations", "cockpit-production-auth.md"), "utf8");
    const overview = readFileSync(join(process.cwd(), "docs", "architecture", "system-overview.md"), "utf8");
    const installGuide = readFileSync(join(process.cwd(), "docs", "operations", "install-ubuntu-vm.md"), "utf8");
    const readme = readSystemdFile("README.md");

    for (const narrative of [cockpitAuth, overview]) {
      expect(narrative).toMatch(/`CONTROL_PLANE_TOKEN`[^.]*retired/is);
      expect(narrative).not.toMatch(/`CONTROL_PLANE_TOKEN`[^.]*remain(?:s)? accepted/is);
    }
    for (const procedure of [installGuide, readme]) {
      expect(procedure).not.toContain("printf 'CONTROL_PLANE_TOKEN=%s");
    }
  });

  it("documents one authoritative custom-root assignment and matching writable path", () => {
    const readme = readSystemdFile("README.md");

    expect(readme).toContain("AUTOPILOT_PROJECTS_DIR=/srv/autopilot-projects");
    expect(readme).not.toContain("Environment=AUTOPILOT_PROJECTS_DIR=/srv/autopilot-projects");
    expect(readme).toContain(
      "ReadWritePaths=\nReadWritePaths=/home/radek/.local/state/autopilot /home/radek/.local/state/.autopilot-incident-spool /home/radek/.local/state/.autopilot-runtime-tmp /srv/autopilot-projects"
    );
    expect(readme).toMatch(/resolved `AUTOPILOT_PROJECTS_DIR`.*equal.*`ReadWritePaths`/is);
    expect(readme).toMatch(/D3 acceptance.*positive\/negative write proof/is);
  });
});
