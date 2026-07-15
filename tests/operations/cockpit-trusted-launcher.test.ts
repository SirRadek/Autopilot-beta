import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const source = join(process.cwd(), "ops", "cockpit-proxy");
const roots: string[] = [];
const payloads = [
  "live-cutover.sh", "Caddyfile", "caddy-autopilot.conf", "autopilot-cockpit.nft",
  "autopilot-cockpit-firewall.sh", "autopilot-cockpit-firewall.service",
  "autopilot-cockpit-cutover-recovery.service", "autopilot-cockpit-cutover-recovery.timer",
];

function command(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "autopilot-launcher-")); roots.push(base);
  const root = join(base, "root"); const checkout = join(base, "checkout"); const bin = join(base, "bin");
  for (const path of [join(root, "usr/local/sbin"), join(root, "usr/local/libexec"), join(root, "var/lib/autopilot-cockpit"), join(root, "etc/systemd/system"), join(checkout, "ops/cockpit-proxy"), bin]) { mkdirSync(path, { recursive: true }); chmodSync(path, 0o755); }
  for (const name of payloads) copyFileSync(join(source, name), join(checkout, "ops/cockpit-proxy", name));
  expect(command("git", ["init", "-q"], { cwd: checkout }).status).toBe(0);
  command("git", ["config", "user.email", "test@example.invalid"], { cwd: checkout });
  command("git", ["config", "user.name", "Test"], { cwd: checkout });
  command("git", ["add", "."], { cwd: checkout }); command("git", ["commit", "-qm", "payload"], { cwd: checkout });
  const sha = command("git", ["rev-parse", "HEAD"], { cwd: checkout }).stdout.trim();
  const launcher = join(root, "usr/local/sbin/autopilot-cockpit-cutover");
  copyFileSync(join(source, "autopilot-cockpit-trusted-launcher.sh"), launcher); chmodSync(launcher, 0o755);
  writeFileSync(join(base, "enabled"), "disabled\n"); writeFileSync(join(base, "active"), "inactive\n");
  writeFileSync(join(bin, "systemctl"), `#!/usr/bin/env bash
set -eu
case "$1" in
is-enabled) cat ${JSON.stringify(join(base, "enabled"))}; [[ "$(cat ${JSON.stringify(join(base, "enabled"))})" == enabled ]] ;;
is-active) cat ${JSON.stringify(join(base, "active"))}; [[ "$(cat ${JSON.stringify(join(base, "active"))})" == active ]] ;;
daemon-reload) [[ "\${FAIL_ON:-}" != reload ]] ;;
enable) [[ "\${FAIL_ON:-}" != enable ]] && printf 'enabled\n' > ${JSON.stringify(join(base, "enabled"))} ;;
disable) printf 'disabled\n' > ${JSON.stringify(join(base, "enabled"))} ;;
start) [[ "\${FAIL_ON:-}" != start ]] && printf 'active\n' > ${JSON.stringify(join(base, "active"))} ;;
stop) printf 'inactive\n' > ${JSON.stringify(join(base, "active"))} ;;
unmask|mask|reset-failed) : ;;
*) exit 2 ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(bin, "mv"), `#!/usr/bin/env bash
if [[ "\${FAIL_ON:-}" == mv && "\${!#}" == *recovery.service ]]; then exit 88; fi
exec /usr/bin/mv "$@"
`, { mode: 0o755 });
  const env = { ...process.env, AUTOPILOT_LAUNCHER_TEST_ROOT: root, AUTOPILOT_LAUNCHER_TEST_BIN: bin };
  return { base, root, checkout, sha, launcher, env };
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("trusted cockpit cutover launcher", () => {
  it("uses a fixed interpreter and refuses a foreign payload directory", () => {
    const f = fixture(); const payload = join(f.root, "usr/local/libexec/autopilot-cockpit-payload");
    expect(readFileSync(f.launcher, "utf8").startsWith("#!/bin/bash\n")).toBe(true);
    mkdirSync(payload); chmodSync(payload, 0o777);
    const result = command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: f.env });
    expect(result.status).not.toBe(0); expect(statSync(payload).mode & 0o777).toBe(0o777);
  });

  it("refuses a foreign watchdog file without changing it", () => {
    const f = fixture(); const worker = join(f.root, "usr/local/libexec/autopilot-cockpit-live-cutover");
    writeFileSync(worker, "foreign\n", { mode: 0o755 });
    const result = command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: f.env });
    expect(result.status).not.toBe(0); expect(readFileSync(worker, "utf8")).toBe("foreign\n");
  });

  it.each(["mv", "reload", "enable", "start"])("rolls back files and unit state after %s failure", (failure) => {
    const f = fixture();
    const initial = command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: f.env });
    expect(initial.status, `${initial.stdout}\n${initial.stderr}`).toBe(0);
    const paths = [join(f.root, "usr/local/libexec/autopilot-cockpit-live-cutover"), join(f.root, "etc/systemd/system/autopilot-cockpit-cutover-recovery.service"), join(f.root, "etc/systemd/system/autopilot-cockpit-cutover-recovery.timer")];
    const before = paths.map((path) => readFileSync(path));
    writeFileSync(join(f.base, "enabled"), "disabled\n"); writeFileSync(join(f.base, "active"), "inactive\n");
    writeFileSync(join(f.checkout, "ops/cockpit-proxy/live-cutover.sh"), `${readFileSync(join(f.checkout, "ops/cockpit-proxy/live-cutover.sh"), "utf8")}\n# revision\n`);
    command("git", ["add", "."], { cwd: f.checkout }); command("git", ["commit", "-qm", "revision"], { cwd: f.checkout });
    const revised = command("git", ["rev-parse", "HEAD"], { cwd: f.checkout }).stdout.trim();
    const result = command(f.launcher, ["--install-watchdog", f.checkout, revised], { env: { ...f.env, FAIL_ON: failure } });
    expect(result.status).not.toBe(0);
    paths.forEach((path, index) => { expect(readFileSync(path)).toEqual(before[index]); expect(statSync(path).mode & 0o777).toBe(index === 0 ? 0o755 : 0o644); });
    expect(readFileSync(join(f.base, "enabled"), "utf8")).toBe("disabled\n");
    expect(readFileSync(join(f.base, "active"), "utf8")).toBe("inactive\n");
    expect(existsSync(join(f.root, "var/lib/autopilot-cockpit/trusted-payload.manifest"))).toBe(true);
  });
});
