import { chmodSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const source = join(process.cwd(), "ops", "cockpit-proxy");
const roots: string[] = [];
const payloads = [
  "live-cutover.sh", "Caddyfile", "caddy-autopilot.conf", "autopilot-cockpit.nft",
  "autopilot-cockpit-firewall.sh", "autopilot-cockpit-firewall.service",
  "autopilot-cockpit-cutover-recovery.service", "autopilot-cockpit-cutover-recovery.timer",
  "autopilot-cockpit-recovery-verify.sh", "autopilot-cockpit-recovery-smoke.mjs",
];

function command(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "autopilot-launcher-")); roots.push(base);
  const root = join(base, "root"); const checkout = join(base, "checkout"); const bin = join(base, "bin");
  for (const path of [join(root, "usr/local/sbin"), join(root, "usr/local/libexec"), join(root, "var/lib/autopilot-cockpit"), join(root, "etc/systemd/system"), join(root, "etc/autopilot-cockpit"), join(checkout, "ops/cockpit-proxy"), bin]) { mkdirSync(path, { recursive: true }); chmodSync(path, 0o755); }
  for (const name of payloads) copyFileSync(join(source, name), join(checkout, "ops/cockpit-proxy", name));
  expect(command("git", ["init", "-q"], { cwd: checkout }).status).toBe(0);
  command("git", ["config", "user.email", "test@example.invalid"], { cwd: checkout });
  command("git", ["config", "user.name", "Test"], { cwd: checkout });
  command("git", ["remote", "add", "origin", "https://example.invalid/autopilot.git"], { cwd: checkout });
  command("git", ["add", "."], { cwd: checkout }); command("git", ["commit", "-qm", "payload"], { cwd: checkout });
  const sha = command("git", ["rev-parse", "HEAD"], { cwd: checkout }).stdout.trim();
  const authorization = join(root, "etc/autopilot-cockpit/cutover.authorization");
  const refreshAuthorization = (targetSha: string) => {
    const authorizationLines = [
      "version=autopilot-cockpit-authorization-v1", `sha=${targetSha}`, `checkout=${checkout}`,
      "origin=https://example.invalid/autopilot.git", `uid=${process.getuid!()}`, `gid=${process.getgid!()}`,
      `payload_count=${payloads.length}`,
      ...payloads.map((name) => `payload.${name}=${createHash("sha256").update(command("git", ["show", `${targetSha}:ops/cockpit-proxy/${name}`], { cwd: checkout }).stdout).digest("hex")}`),
    ];
    const authorizationBody = `${authorizationLines.join("\n")}\n`;
    chmodSync(authorization, 0o600);
    writeFileSync(authorization, `${authorizationBody}authorization_id=${createHash("sha256").update(authorizationBody).digest("hex")}\n`);
    chmodSync(authorization, 0o400);
  };
  writeFileSync(authorization, "", { mode: 0o600 }); refreshAuthorization(sha);
  const launcher = join(root, "usr/local/sbin/autopilot-cockpit-cutover");
  copyFileSync(join(source, "autopilot-cockpit-trusted-launcher.sh"), launcher); chmodSync(launcher, 0o755);
  const eventLog = join(base, "events.log"); writeFileSync(eventLog, "");
  writeFileSync(join(base, "enabled"), "disabled\n"); writeFileSync(join(base, "active"), "inactive\n");
  writeFileSync(join(bin, "systemctl"), `#!/usr/bin/env bash
set -eu
printf 'systemctl:%s\n' "$1" >> ${JSON.stringify(eventLog)}
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
[[ "\${!#}" == *recovery.service ]] && printf 'mv:recovery.service\n' >> ${JSON.stringify(eventLog)}
if [[ "\${FAIL_ON:-}" == mv && "\${!#}" == *recovery.service ]]; then exit 88; fi
if [[ "\${DELAY_WORKER_MV:-0}" == 1 && "\${!#}" == *autopilot-cockpit-live-cutover ]]; then sleep 1.1; fi
exec /usr/bin/mv "$@"
`, { mode: 0o755 });
  const env = { ...process.env, AUTOPILOT_LAUNCHER_TEST_ROOT: root, AUTOPILOT_LAUNCHER_TEST_BIN: bin };
  return { base, root, checkout, sha, launcher, env, authorization, refreshAuthorization, eventLog };
}

function replaceInstalledWorkerWithNoop(f: ReturnType<typeof fixture>): void {
  const worker = join(f.root, "usr/local/libexec/autopilot-cockpit-live-cutover");
  const manifest = join(f.root, "var/lib/autopilot-cockpit/trusted-payload.manifest");
  writeFileSync(worker, "#!/bin/bash\nexit 0\n"); chmodSync(worker, 0o755);
  const hash = createHash("sha256").update(readFileSync(worker)).digest("hex");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace(new RegExp(`^[a-f0-9]{64} 755 ${worker}$`, "m"), `${hash} 755 ${worker}`));
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("trusted cockpit cutover launcher", () => {
  it("refuses watchdog publication while a live cutover transaction exists", () => {
    const f = fixture(); const active = join(f.root, "var/lib/autopilot-cockpit/transactions/active");
    mkdirSync(active, { recursive: true }); chmodSync(dirname(active), 0o700); chmodSync(active, 0o700); writeFileSync(join(active, "transaction.ledger"), "state=waiting\n", { mode: 0o600 });
    expect(command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: f.env }).status).not.toBe(0);
    expect(existsSync(join(f.root, "usr/local/libexec/autopilot-cockpit-live-cutover"))).toBe(false);
  });

  it("serializes concurrent watchdog publishers with a root-owned lock", async () => {
    const f = fixture();
    const run = () => new Promise<number | null>((resolve) => {
      const child = spawn(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: { ...f.env, AUTOPILOT_LAUNCHER_TEST_HOLD_LOCK: "1" } });
      child.once("close", resolve);
    });
    const [a, b] = await Promise.all([run(), run()]);
    expect([a, b].filter((status) => status === 0)).toHaveLength(1);
  });

  it("recovers an install killed after worker publication", () => {
    const f = fixture();
    const killed = command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: { ...f.env, AUTOPILOT_LAUNCHER_TEST_KILL_AFTER: "worker" } });
    expect(killed.status).not.toBe(0);
    expect(existsSync(join(f.root, "var/lib/autopilot-cockpit/install-transaction/transaction.ledger"))).toBe(true);
    const recovered = command(f.launcher, ["--recover-install"], { env: f.env });
    expect(recovered.status, `${recovered.stdout}\n${recovered.stderr}`).toBe(0);
    expect(existsSync(join(f.root, "usr/local/libexec/autopilot-cockpit-live-cutover"))).toBe(false);
    expect(readFileSync(join(f.base, "enabled"), "utf8")).toBe("disabled\n");
    expect(readFileSync(join(f.base, "active"), "utf8")).toBe("inactive\n");
  });

  it("removes its stable-identity payload directory after a payload publication crash", () => {
    const f = fixture();
    const payload = join(f.root, "usr/local/libexec/autopilot-cockpit-payload");
    const killed = command(f.launcher, ["--install-watchdog", f.checkout, f.sha], {
      env: { ...f.env, AUTOPILOT_LAUNCHER_TEST_KILL_AFTER: "Caddyfile" },
    });
    expect(killed.status).not.toBe(0);
    expect(existsSync(join(payload, "Caddyfile"))).toBe(true);
    const recovered = command(f.launcher, ["--recover-install"], { env: f.env });
    expect(recovered.status, `${recovered.stdout}\n${recovered.stderr}`).toBe(0);
    expect(existsSync(payload)).toBe(false);
  });

  it.each([
    "before-first-ledger",
    "after-intent-next-create",
    "after-intent-next-partial-write",
    "after-intent-next-fsync",
    "after-intent-publish",
    "after-intent-parent-fsync",
    "after-first-ledger",
    "after-transaction-mkdir",
    "after-backups-mkdir",
    "after-first-backup",
    "after-meta-mkdir",
    "after-first-meta",
    "after-first-temp",
    "after-payload-mkdir",
    "after-terminal-ledger",
  ])("recovers a SIGKILL at install initialization boundary %s and permits a subsequent install", (phase) => {
    const f = fixture();
    const killed = command(f.launcher, ["--install-watchdog", f.checkout, f.sha], {
      env: { ...f.env, AUTOPILOT_LAUNCHER_TEST_KILL_INIT: phase },
    });
    expect(killed.status, `${killed.stdout}\n${killed.stderr}`).not.toBe(0);
    const recovered = command(f.launcher, ["--recover-install"], { env: f.env });
    expect(recovered.status, `${phase}\n${recovered.stdout}\n${recovered.stderr}`).toBe(0);
    if (phase === "after-terminal-ledger") {
      expect(existsSync(join(f.root, "usr/local/libexec/autopilot-cockpit-live-cutover"))).toBe(true);
      expect(existsSync(join(f.root, "var/lib/autopilot-cockpit/trusted-payload.manifest"))).toBe(true);
    }
    const installed = command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: f.env });
    expect(installed.status, `${phase}\n${installed.stdout}\n${installed.stderr}`).toBe(0);
  }, 15_000);

  it.each(["foreign-content", "foreign-valid-schema", "foreign-hardlink", "foreign-symlink"])("rejects and preserves a %s install intent.next orphan", (kind) => {
    const f = fixture();
    const next = join(f.root, "var/lib/autopilot-cockpit/install-transaction.ledger.next");
    if (kind === "foreign-content") writeFileSync(next, "foreign=true\n", { mode: 0o600 });
    else if (kind === "foreign-valid-schema") writeFileSync(next, "version=autopilot-cockpit-install-intent-v1\nphase=initializing\nold_enabled=foreign\nold_active=inactive\npayload_dir_existed=0\npayload_dir_identity=\n", { mode: 0o600 });
    else if (kind === "foreign-hardlink") {
      const foreign = join(f.root, "var/lib/autopilot-cockpit/foreign-intent");
      writeFileSync(foreign, "version=autopilot-cockpit-install-intent-v1\nphase=initializing\nold_enabled=disabled\nold_active=inactive\npayload_dir_existed=0\npayload_dir_identity=\n", { mode: 0o600 });
      linkSync(foreign, next);
    }
    else symlinkSync(f.authorization, next);
    const recovered = command(f.launcher, ["--recover-install"], { env: f.env });
    expect(recovered.status).not.toBe(0);
    expect(existsSync(next)).toBe(true);
    if (kind === "foreign-symlink") expect(lstatSync(next).isSymbolicLink()).toBe(true);
    else if (kind === "foreign-hardlink") expect(lstatSync(next).nlink).toBe(2);
    else expect(readFileSync(next, "utf8")).toContain(kind === "foreign-content" ? "foreign=true" : "old_enabled=foreign");
  });

  it("preserves a foreign replacement encountered by install recovery", () => {
    const f = fixture(); const worker = join(f.root, "usr/local/libexec/autopilot-cockpit-live-cutover");
    command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: { ...f.env, AUTOPILOT_LAUNCHER_TEST_KILL_AFTER: "worker" } });
    writeFileSync(worker, "foreign\n", { mode: 0o755 });
    expect(command(f.launcher, ["--recover-install"], { env: f.env }).status).not.toBe(0);
    expect(readFileSync(worker, "utf8")).toBe("foreign\n");
  });

  it.each(["hardlink", "same-size-mutation"])("preserves and rejects a foreign %s of the newly published worker", (kind) => {
    const f = fixture(); const worker = join(f.root, "usr/local/libexec/autopilot-cockpit-live-cutover");
    command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: { ...f.env, AUTOPILOT_LAUNCHER_TEST_KILL_AFTER: "worker" } });
    if (kind === "hardlink") linkSync(worker, join(f.base, "foreign-worker-link"));
    else {
      const before = readFileSync(worker); const stat = statSync(worker); const mutated = Buffer.from(before); mutated[0] = mutated[0] === 35 ? 36 : 35;
      writeFileSync(worker, mutated); utimesSync(worker, stat.atime, stat.mtime);
    }
    const foreign = readFileSync(worker);
    expect(command(f.launcher, ["--recover-install"], { env: f.env }).status).not.toBe(0);
    expect(readFileSync(worker)).toEqual(foreign);
  });

  it("hash-checks the prior worker branch before accepting an in-place same-size mutation", () => {
    const f = fixture(); const worker = join(f.root, "usr/local/libexec/autopilot-cockpit-live-cutover");
    expect(command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: f.env }).status).toBe(0);
    writeFileSync(join(f.checkout, "ops/cockpit-proxy/live-cutover.sh"), `${readFileSync(join(f.checkout, "ops/cockpit-proxy/live-cutover.sh"), "utf8")}\n# revision\n`);
    command("git", ["add", "."], { cwd: f.checkout }); command("git", ["commit", "-qm", "revision"], { cwd: f.checkout });
    const revised = command("git", ["rev-parse", "HEAD"], { cwd: f.checkout }).stdout.trim(); f.refreshAuthorization(revised);
    command(f.launcher, ["--install-watchdog", f.checkout, revised], { env: { ...f.env, AUTOPILOT_LAUNCHER_TEST_KILL_INIT: "after-first-temp" } });
    const stat = statSync(worker); const mutated = Buffer.from(readFileSync(worker)); mutated[0] = mutated[0] === 35 ? 36 : 35; writeFileSync(worker, mutated); utimesSync(worker, stat.atime, stat.mtime);
    expect(command(f.launcher, ["--recover-install"], { env: f.env }).status).not.toBe(0);
    expect(readFileSync(worker)).toEqual(mutated);
  }, 15_000);
  it("requires a pre-provisioned authorization record", () => {
    const f = fixture(); unlinkSync(f.authorization);
    expect(command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: f.env }).status).not.toBe(0);
  });

  it.each([
    ["wrong mode", (f: ReturnType<typeof fixture>) => chmodSync(f.authorization, 0o600)],
    ["foreign symlink", (f: ReturnType<typeof fixture>) => { unlinkSync(f.authorization); const foreign = join(f.base, "foreign-auth"); writeFileSync(foreign, "foreign\n"); symlinkSync(foreign, f.authorization); }],
    ["wrong payload hash", (f: ReturnType<typeof fixture>) => { const body = readFileSync(f.authorization, "utf8"); chmodSync(f.authorization, 0o600); writeFileSync(f.authorization, body.replace(/payload\.Caddyfile=[a-f0-9]{64}/, `payload.Caddyfile=${"0".repeat(64)}`)); chmodSync(f.authorization, 0o400); }],
    ["wrong uid", (f: ReturnType<typeof fixture>) => { const body = readFileSync(f.authorization, "utf8"); chmodSync(f.authorization, 0o600); writeFileSync(f.authorization, body.replace(`uid=${process.getuid!()}`, `uid=${process.getuid!() + 1}`)); chmodSync(f.authorization, 0o400); }],
  ])("refuses %s authorization", (_name, mutate) => {
    const f = fixture(); mutate(f);
    expect(command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: f.env }).status).not.toBe(0);
  });

  it.each([
    ["dirty checkout", (f: ReturnType<typeof fixture>) => writeFileSync(join(f.checkout, "dirty"), "x")],
    ["wrong origin", (f: ReturnType<typeof fixture>) => command("git", ["remote", "set-url", "origin", "https://evil.invalid/repo.git"], { cwd: f.checkout })],
    ["wrong HEAD", (f: ReturnType<typeof fixture>) => { writeFileSync(join(f.checkout, "new"), "x"); command("git", ["add", "."], { cwd: f.checkout }); command("git", ["commit", "-qm", "new"], { cwd: f.checkout }); }],
  ])("refuses an authorized SHA from a %s", (_name, mutate) => {
    const f = fixture(); mutate(f);
    expect(command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: f.env }).status).not.toBe(0);
  });

  it("refuses a caller-selected repository path", () => {
    const f = fixture(); const other = join(f.base, "other");
    expect(command("git", ["clone", "-q", f.checkout, other]).status).toBe(0);
    expect(command(f.launcher, ["--install-watchdog", other, f.sha], { env: f.env }).status).not.toBe(0);
  });
  it("uses a fixed interpreter and refuses a foreign payload directory", () => {
    const f = fixture(); const payload = join(f.root, "usr/local/libexec/autopilot-cockpit-payload");
    expect(readFileSync(f.launcher, "utf8").startsWith("#!/bin/bash\n")).toBe(true);
    mkdirSync(payload); chmodSync(payload, 0o777);
    const result = command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: f.env });
    expect(result.status).not.toBe(0); expect(statSync(payload).mode & 0o777).toBe(0o777);
  });

  it.each(["substituted", "extra"])("rejects a manifest with an %s managed path", (kind) => {
    const f = fixture();
    expect(command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: f.env }).status).toBe(0);
    replaceInstalledWorkerWithNoop(f);
    const manifest = join(f.root, "var/lib/autopilot-cockpit/trusted-payload.manifest");
    const payload = join(f.root, "usr/local/libexec/autopilot-cockpit-payload");
    const substitute = join(payload, "substitute");
    copyFileSync(join(payload, "Caddyfile"), substitute); chmodSync(substitute, 0o644);
    const original = readFileSync(manifest, "utf8");
    if (kind === "substituted") writeFileSync(manifest, original.replace(`${payload}/Caddyfile`, substitute));
    else {
      const hash = createHash("sha256").update(readFileSync(substitute)).digest("hex");
      writeFileSync(manifest, `${original}${hash} 644 ${substitute}\n`);
    }
    expect(command(f.launcher, ["--recover"], { env: f.env }).status).not.toBe(0);
  });

  it("rejects a hardlinked installed trusted payload file", () => {
    const f = fixture();
    expect(command(f.launcher, ["--install-watchdog", f.checkout, f.sha], { env: f.env }).status).toBe(0);
    replaceInstalledWorkerWithNoop(f);
    const worker = join(f.root, "usr/local/libexec/autopilot-cockpit-live-cutover");
    linkSync(worker, join(f.base, "foreign-worker-link"));
    expect(command(f.launcher, ["--recover"], { env: f.env }).status).not.toBe(0);
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
    f.refreshAuthorization(revised);
    const result = command(f.launcher, ["--install-watchdog", f.checkout, revised], { env: { ...f.env, FAIL_ON: failure, DELAY_WORKER_MV: "1" } });
    expect(result.status).not.toBe(0);
    const events = readFileSync(f.eventLog, "utf8");
    expect(events).toContain(failure === "mv" ? "mv:recovery.service" : `systemctl:${failure === "reload" ? "daemon-reload" : failure}`);
    paths.forEach((path, index) => {
      const meta = join(f.root, "var/lib/autopilot-cockpit/install-transaction/meta", basename(path));
      const backup = join(f.root, "var/lib/autopilot-cockpit/install-transaction/backups", basename(path));
      const liveIdentity = command("stat", ["-Lc", "%d:%i:%u:%g:%a:%s:%Y:%h", path]).stdout.trim();
      const liveHash = createHash("sha256").update(readFileSync(path)).digest("hex");
      const backupHash = existsSync(backup) ? createHash("sha256").update(readFileSync(backup)).digest("hex") : "absent";
      const diagnostics = existsSync(meta) ? `${result.stdout}\n${result.stderr}\n${readFileSync(meta, "utf8")}live_identity=${liveIdentity}\nlive_hash=${liveHash}\nbackup_hash=${backupHash}` : `${result.stdout}\n${result.stderr}\ntransaction-cleaned`;
      expect(readFileSync(path), diagnostics).toEqual(before[index]);
      expect(statSync(path).mode & 0o777).toBe(index === 0 ? 0o755 : 0o644);
    });
    expect(readFileSync(join(f.base, "enabled"), "utf8")).toBe("disabled\n");
    expect(readFileSync(join(f.base, "active"), "utf8")).toBe("inactive\n");
    expect(existsSync(join(f.root, "var/lib/autopilot-cockpit/trusted-payload.manifest"))).toBe(true);
  }, 15_000);
});
