import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const stageRelease = join(process.cwd(), "ops", "cockpit-proxy", "stage-release.sh");
const releaseUpdate = join(process.cwd(), "ops", "cockpit-proxy", "release-update.sh");
const installReleaseUpdate = join(process.cwd(), "ops", "cockpit-proxy", "install-release-update.sh");
const releaseUpdateProvenance = join(process.cwd(), "ops", "cockpit-proxy", "release-update.provenance.json");
const realGit = execFileSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const proxyPayloadNames = [
  "Caddyfile",
  "caddy-autopilot.conf",
  "autopilot-cockpit.nft",
  "autopilot-cockpit-firewall.service",
  "autopilot-cockpit-firewall.sh",
];
const node24 = process.env.AUTOPILOT_NODE_BIN ?? process.execPath;
const installedAck = "a".repeat(64);
const previousTargetSha = "1".repeat(40);
const tempRoots: string[] = [];
const alternateGid = process.getgroups?.().find((gid) => gid !== process.getgid?.());

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "autopilot-cockpit-release-update-"));
  tempRoots.push(dir);
  return dir;
}

function git(checkout: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", checkout, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function stubExecutable(directory: string, name: string, source: string): void {
  const path = join(directory, name);
  writeFileSync(path, `#!/usr/bin/env bash\nset -Eeuo pipefail\n${source}\n`);
  chmodSync(path, 0o755);
}

function fakeNode24(): string {
  const bin = join(makeTempDir(), "node");
  writeFileSync(
    bin,
    `#!/usr/bin/env bash\nif [[ "\${1:-}" == --version ]]; then printf 'v24.0.0\\n'; else exec ${JSON.stringify(process.execPath)} "$@"; fi\n`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

function makeStagedCheckout(runtime: string): { checkout: string; sha: string; releaseRoot: string } {
  const checkout = join(makeTempDir(), "checkout");
  const dist = join(checkout, "cockpit", "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "cockpit-next\n");
  writeFileSync(join(dist, "assets", "app.js"), "app-next\n");
  mkdirSync(join(checkout, "ops", "cockpit-proxy"), { recursive: true });
  for (const name of proxyPayloadNames) {
    writeFileSync(
      join(checkout, "ops", "cockpit-proxy", name),
      readFileSync(join(process.cwd(), "ops", "cockpit-proxy", name)),
    );
  }
  git(checkout, "init", "-q");
  git(checkout, "config", "user.name", "Release Update Test");
  git(checkout, "config", "user.email", "release-update@example.invalid");
  git(checkout, "add", ".");
  git(checkout, "commit", "-qm", "build next cockpit release");
  git(checkout, "remote", "add", "origin", "https://example.invalid/autopilot.git");
  const sha = git(checkout, "rev-parse", "HEAD");

  const releaseRoot = join(makeTempDir(), "release-root");
  mkdirSync(releaseRoot, { mode: 0o755 });
  chmodSync(releaseRoot, 0o755);
  const staged = spawnSync("bash", [stageRelease, checkout, releaseRoot], {
    encoding: "utf8",
    env: {
      ...process.env,
      AUTOPILOT_NODE_BIN: runtime,
      AUTOPILOT_RELEASE_TEST_MODE: "1",
    },
  });
  if (staged.status !== 0) throw new Error(`stage fixture failed: ${staged.stdout}\n${staged.stderr}`);
  return { checkout, sha, releaseRoot };
}

interface UpdateFixture {
  root: string;
  checkout: string;
  releaseRoot: string;
  sha: string;
  envPath: string;
  currentPath: string;
  caddyConfigPath: string;
  stubLog: string;
  stubDir: string;
  previousTarget: string;
  env: NodeJS.ProcessEnv;
}

function prepareUpdate(options: { secureLine?: string; alreadyCurrent?: boolean } = {}): UpdateFixture {
  const runtime = fakeNode24();
  const { checkout, sha, releaseRoot } = makeStagedCheckout(runtime);

  const root = join(makeTempDir(), "fake-root");
  mkdirSync(join(root, "run"), { recursive: true });

  const envPath = join(root, "home", "radek", ".config", "autopilot", "control-plane.env");
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(
    envPath,
    `${options.secureLine ?? "CONTROL_PLANE_SECURE_COOKIES=true"}\nAUTOPILOT_STATE_DIR=/state\nAUTOPILOT_PROJECTS_DIR=/projects\n`,
    { mode: 0o600 },
  );
  chmodSync(envPath, 0o600);

  const previousTarget = `releases/${previousTargetSha}`;
  mkdirSync(join(releaseRoot, previousTarget), { recursive: true });
  const currentPath = join(releaseRoot, "current");
  symlinkSync(options.alreadyCurrent ? `releases/${sha}` : previousTarget, currentPath);

  // Live proxy artifacts installed by the original cutover.
  const caddyConfigPath = join(root, "etc", "caddy", "Caddyfile");
  mkdirSync(dirname(caddyConfigPath), { recursive: true });
  chmodSync(dirname(caddyConfigPath), 0o755);
  writeInstalled(caddyConfigPath, join(checkout, "ops", "cockpit-proxy", "Caddyfile"), 0o644);

  const caddyDropinPath = join(root, "etc", "systemd", "system", "caddy.service.d", "autopilot.conf");
  mkdirSync(dirname(caddyDropinPath), { recursive: true });
  writeInstalled(caddyDropinPath, join(checkout, "ops", "cockpit-proxy", "caddy-autopilot.conf"), 0o644);

  const packageCaddyUnit = join(root, "usr", "lib", "systemd", "system", "caddy.service");
  mkdirSync(dirname(packageCaddyUnit), { recursive: true });
  writeFileSync(packageCaddyUnit, "[Service]\nExecStart=/usr/bin/caddy run\n", { mode: 0o644 });

  const firewallUnit = join(root, "etc", "systemd", "system", "autopilot-cockpit-firewall.service");
  mkdirSync(dirname(firewallUnit), { recursive: true });
  writeInstalled(firewallUnit, join(checkout, "ops", "cockpit-proxy", "autopilot-cockpit-firewall.service"), 0o644);

  const nftConfig = join(root, "etc", "nftables.d", "autopilot-cockpit.nft");
  mkdirSync(dirname(nftConfig), { recursive: true });
  writeInstalled(nftConfig, join(checkout, "ops", "cockpit-proxy", "autopilot-cockpit.nft"), 0o644);

  const firewallHelper = join(root, "usr", "local", "libexec", "autopilot-cockpit-firewall");
  mkdirSync(dirname(firewallHelper), { recursive: true });
  writeInstalled(firewallHelper, join(checkout, "ops", "cockpit-proxy", "autopilot-cockpit-firewall.sh"), 0o755);

  const firewallIdentity = join(root, "var", "lib", "autopilot-cockpit", "firewall.identity");
  mkdirSync(dirname(firewallIdentity), { recursive: true });
  chmodSync(join(root, "var", "lib", "autopilot-cockpit"), 0o755);
  writeFileSync(firewallIdentity, `${installedAck}\n`, { mode: 0o600 });
  chmodSync(firewallIdentity, 0o600);

  const recoveryProgram = join(root, "usr", "local", "libexec", "autopilot-cockpit-release-update");
  writeFileSync(recoveryProgram, readFileSync(releaseUpdate), { mode: 0o755 });

  const stubDir = join(makeTempDir(), "bin");
  mkdirSync(stubDir);
  const stubLog = join(makeTempDir(), "events.log");
  writeFileSync(stubLog, "");
  const nftState = join(root, "nft-state");
  writeFileSync(nftState, `${installedAck}\n`);

  const log = 'printf "%s\\n" "${0##*/}:$*" >> "$STUB_LOG"';
  stubExecutable(stubDir, "mktemp", `${log}\nexec /usr/bin/mktemp "$@"`);
  stubExecutable(stubDir, "setpriv", `${log}\nwhile (($#)); do [[ "$1" == -- ]] && { shift; break; }; shift; done\nexec "$@"`);
  stubExecutable(stubDir, "systemd-run", `${log}\nexit 0`);
  stubExecutable(stubDir, "caddy", `${log}\n[[ "$1" == validate ]]`);
  stubExecutable(
    stubDir,
    "dpkg",
    `${log}\n[[ "$1" == -s && "$2" == caddy ]] && exit 0\nif [[ "$1" == -V && "$2" == caddy ]]; then [[ "\${STUB_DPKG_VERIFY_ERROR:-0}" == 1 ]] && exit 2; exit 0; fi\nexit 1`,
  );
  stubExecutable(
    stubDir,
    "ss",
    `${log}\n` +
      `[[ -n "\${STUB_SS_ERROR_PORT:-}" && "$*" == *":$STUB_SS_ERROR_PORT"* ]] && exit 2\n` +
      `case "\${STUB_OCCUPIED_PORT:-}" in 8443|8877) [[ "$*" == *":$STUB_OCCUPIED_PORT"* ]] && printf 'LISTEN occupied\\n'; exit 0 ;; esac\n` +
      `if [[ "$*" == *":8787"* ]]; then if [[ "\${STUB_UNSAFE_CP_LISTENER:-0}" == 1 ]]; then printf 'LISTEN 0 511 0.0.0.0:8787 0.0.0.0:*\\n'; else printf 'LISTEN 0 511 127.0.0.1:8787 0.0.0.0:*\\n'; fi; exit 0; fi\n` +
      `if [[ "\${STUB_CADDY_PORTS_DOWN:-0}" != 1 ]]; then case "$*" in *':80'*) printf 'LISTEN 0 511 192.168.122.99:80 0.0.0.0:*\\n' ;; *':443'*) printf 'LISTEN 0 511 192.168.122.99:443 0.0.0.0:*\\n' ;; esac; fi`,
  );
  stubExecutable(
    stubDir,
    "nft",
    `${log}\nstate="$STUB_NFT_STATE"\n` +
      `if [[ "$*" == --check* ]]; then exit 0; fi\n` +
      `if [[ "$*" == '-j list tables' ]]; then [[ "\${STUB_NFT_INSPECTION_ERROR:-0}" == 1 ]] && exit 2; if [[ "\${STUB_NFT_ABSENT:-0}" == 1 || ! -f "$state" ]]; then printf '%s' '{"nftables":[]}'; else printf '%s' '{"nftables":[{"table":{"family":"inet","name":"autopilot_cockpit"}}]}'; fi; exit 0; fi\n` +
      `if [[ "$*" == '-j list table inet autopilot_cockpit' ]]; then nonce="$(cat "$state" 2>/dev/null || true)"; comment="autopilot-cockpit:$nonce"; [[ "\${STUB_NFT_FOREIGN:-0}" == 1 ]] && comment=foreign; printf '{"nftables":[{"table":{"family":"inet","name":"autopilot_cockpit","comment":"%s"}},{"chain":{"family":"inet","table":"autopilot_cockpit","name":"input","type":"filter","hook":"input","prio":-10,"policy":"accept","comment":"%s"}},{"rule":{"family":"inet","table":"autopilot_cockpit","chain":"input","expr":[{"match":{"op":"==","left":{"payload":{"protocol":"tcp","field":"dport"}},"right":{"set":[80,443]}}},{"match":{"op":"!=","left":{"payload":{"protocol":"ip","field":"saddr"}},"right":"192.168.122.1"}},{"drop":null}],"comment":"%s"}}]}' "$comment" "$comment" "$comment"; exit 0; fi\nexit 0`,
  );
  stubExecutable(
    stubDir,
    "systemctl",
    `${log}\n` +
      `case "$*" in\n` +
      `'is-active caddy.service') if [[ "\${STUB_CADDY_INACTIVE:-0}" == 1 ]]; then printf 'inactive\\n'; exit 3; fi; printf 'active\\n' ;;\n` +
      `'is-enabled caddy.service') if [[ "\${STUB_CADDY_NOT_ENABLED:-0}" == 1 ]]; then printf 'masked\\n'; exit 1; fi; printf 'enabled\\n' ;;\n` +
      `'is-active autopilot-cockpit-firewall.service') if [[ "\${STUB_FIREWALL_INACTIVE:-0}" == 1 ]]; then printf 'inactive\\n'; exit 3; fi; printf 'active\\n' ;;\n` +
      `'is-active autopilot-control-plane.service') printf 'active\\n' ;;\n` +
      `'is-active autopilot-control-plane-health.timer') printf 'active\\n' ;;\n` +
      `'is-active autopilot-state-maintenance.timer') printf 'active\\n' ;;\n` +
      `*) exit 0 ;;\n` +
      `esac`,
  );
  stubExecutable(
    stubDir,
    "curl",
    `${log}\nout=''; url=''; while (($#)); do case "$1" in --output) out="$2"; shift 2;; http://*) url="$1"; shift;; *) shift;; esac; done\n` +
      `if [[ "$url" == */ready ]]; then printf '%s' '{"ready":true,"components":{"configuration":{"status":"ready","error_code":null},"managed_state":{"status":"ready","error_code":null},"project_registry":{"status":"ready","error_code":null},"supervisor":{"status":"ready","error_code":null},"token_gateway":{"status":"ready","error_code":null}}}' > "$out"; else printf '%s' '{"ok":true}' > "$out"; fi\nprintf 200`,
  );
  stubExecutable(
    stubDir,
    "npm",
    `${log}\n[[ "\${AUTOPILOT_PRIVDROP_ACTIVE:-0}" == 1 ]] || exit 96\ncase "$*" in\n` +
      `*ops:backup*) archive="$AUTOPILOT_RELEASE_UPDATE_TEST_ROOT/backup.apbackup.json"; printf '{}\\n' > "$archive"; printf '{"path":"%s","validation":{"valid":true}}\\n' "$archive" ;;\n` +
      `*ops:recovery-drill*) printf '{"ok":true,"validation":{"ready":true,"reconciled":true,"errors":[]}}\\n' ;;\n` +
      `*ops:boundary-check*) printf '{"ok":true}\\n' ;;\n` +
      `*smoke:cockpit-run*) printf '{"mode":"dry-run","provider_invoked":false,"run_status":"completed"}\\n' ;;\n` +
      `*) exit 1 ;;\nesac`,
  );

  return {
    root,
    checkout,
    releaseRoot,
    sha,
    envPath,
    currentPath,
    caddyConfigPath,
    stubLog,
    stubDir,
    previousTarget,
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      STUB_LOG: stubLog,
      STUB_NFT_STATE: nftState,
      AUTOPILOT_RELEASE_UPDATE_TEST_MODE: "1",
      AUTOPILOT_RELEASE_UPDATE_TEST_ROOT: root,
      AUTOPILOT_RELEASE_UPDATE_TEST_AUTO_ACK: "1",
      AUTOPILOT_RELEASE_UPDATE_TEST_ACK_TIMEOUT: "1",
      AUTOPILOT_NODE_BIN: runtime,
    },
  };
}

function writeInstalled(dest: string, source: string, mode: number): void {
  writeFileSync(dest, readFileSync(source));
  chmodSync(dest, mode);
}

function runUpdate(fixture: UpdateFixture, extraEnv: NodeJS.ProcessEnv = {}, cwd?: string) {
  return spawnSync("bash", [releaseUpdate, fixture.checkout, fixture.releaseRoot, fixture.sha], {
    encoding: "utf8",
    env: { ...fixture.env, ...extraEnv },
    cwd,
    timeout: 15_000,
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    spawnSync("chmod", ["-R", "u+w", root]);
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Cockpit second-and-later release update", () => {
  it("atomically switches current and completes on host acceptance without touching live services", () => {
    const fixture = prepareUpdate();
    const originalEnv = readFileSync(fixture.envPath);

    const result = runUpdate(fixture);

    if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}\n${readFileSync(fixture.stubLog, "utf8")}`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`RELEASE_UPDATE_WAITING_FOR_HOST_ACCEPTANCE ACK_ID=`);
    expect(result.stdout).toContain("RELEASE_UPDATE_OK");
    expect(result.stdout).not.toContain("secret-do-not-print");
    expect(readlinkSync(fixture.currentPath)).toBe(`releases/${fixture.sha}`);
    // Live state is preserved: no control-plane restart, no env change, no firewall/caddy mutation.
    const log = readFileSync(fixture.stubLog, "utf8");
    expect(log).not.toContain("systemctl:restart autopilot-control-plane.service");
    expect(log).not.toContain("systemctl:start caddy.service");
    expect(log).not.toContain("systemctl:reload caddy.service");
    expect(log).not.toContain("systemctl:stop autopilot-cockpit-firewall.service");
    expect(log).not.toContain("nft add table");
    expect(readFileSync(fixture.envPath)).toEqual(originalEnv);
  });

  it("is an idempotent no-op when current already targets the accepted release", () => {
    const fixture = prepareUpdate({ alreadyCurrent: true });

    const result = runUpdate(fixture, { AUTOPILOT_RELEASE_UPDATE_TEST_AUTO_ACK: "0" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("RELEASE_UPDATE_ALREADY_CURRENT");
    expect(result.stdout).not.toContain("RELEASE_UPDATE_WAITING_FOR_HOST_ACCEPTANCE");
    expect(readlinkSync(fixture.currentPath)).toBe(`releases/${fixture.sha}`);
    expect(existsSync(join(fixture.root, "var", "lib", "autopilot-cockpit", "release-update-transactions", "active"))).toBe(false);
  });

  it("rolls back to the previous release when host acceptance times out", () => {
    const fixture = prepareUpdate();

    const result = runUpdate(fixture, { AUTOPILOT_RELEASE_UPDATE_TEST_AUTO_ACK: "0", AUTOPILOT_RELEASE_UPDATE_TEST_ACK_TIMEOUT: "1" });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("ROLLBACK_OK");
    expect(readlinkSync(fixture.currentPath)).toBe(fixture.previousTarget);
  });

  it("rolls back to the previous release when a post-switch check fails", () => {
    const fixture = prepareUpdate();

    const result = runUpdate(fixture, { AUTOPILOT_RELEASE_UPDATE_TEST_FAIL_AFTER: "current" });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("ROLLBACK_OK");
    expect(readlinkSync(fixture.currentPath)).toBe(fixture.previousTarget);
  });

  it("recovers an interrupted switch by restoring the previous release", () => {
    const fixture = prepareUpdate();

    const killed = runUpdate(fixture, { AUTOPILOT_RELEASE_UPDATE_TEST_KILL_AFTER: "current-mv", AUTOPILOT_RELEASE_UPDATE_TEST_AUTO_ACK: "0" });
    expect(killed.status).not.toBe(0);
    // The atomic swap completed before the interruption.
    expect(readlinkSync(fixture.currentPath)).toBe(`releases/${fixture.sha}`);

    const recovered = spawnSync("bash", [releaseUpdate, "--recover"], { encoding: "utf8", env: fixture.env, timeout: 15_000 });
    expect(recovered.stdout).toContain("ROLLBACK_OK");
    expect(readlinkSync(fixture.currentPath)).toBe(fixture.previousTarget);
    // A second recovery is a clean no-op.
    const again = spawnSync("bash", [releaseUpdate, "--recover"], { encoding: "utf8", env: fixture.env, timeout: 15_000 });
    expect(again.stdout).toContain("RECOVERY_NOT_NEEDED");
  });

  it("terminates and rolls back when signalled during the acceptance wait", () => {
    const fixture = prepareUpdate();
    const child = spawn("bash", [releaseUpdate, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_RELEASE_UPDATE_TEST_AUTO_ACK: "0", AUTOPILOT_RELEASE_UPDATE_TEST_ACK_TIMEOUT: "5" },
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("RELEASE_UPDATE_WAITING_FOR_HOST_ACCEPTANCE")) child.kill("SIGTERM");
    });
    const status = new Promise<number>((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? 143 : 0))));
    return status.then((code) => {
      expect(code).not.toBe(0);
      expect(readlinkSync(fixture.currentPath)).toBe(fixture.previousTarget);
    });
  }, 15_000);

  it("accepts an out-of-band acknowledgement id and completes", () => {
    const fixture = prepareUpdate();
    const child = spawn("bash", [releaseUpdate, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_RELEASE_UPDATE_TEST_AUTO_ACK: "0", AUTOPILOT_RELEASE_UPDATE_TEST_ACK_TIMEOUT: "5" },
    });
    let stdout = "";
    let ackId: string | undefined;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const captured = stdout.match(/ACK_ID=([a-f0-9]{64})/)?.[1];
      if (captured && !ackId) {
        ackId = captured;
        const accepted = spawnSync("bash", [releaseUpdate, "--accept", captured], { encoding: "utf8", env: fixture.env });
        expect(accepted.stdout).toContain("RELEASE_UPDATE_HOST_ACCEPTANCE_ACKNOWLEDGED");
      }
    });
    const done = new Promise<{ code: number; out: string }>((resolve) =>
      child.on("exit", (code) => resolve({ code: code ?? 0, out: stdout })),
    );
    return done.then(({ code, out }) => {
      expect(code).toBe(0);
      expect(out).toContain("RELEASE_UPDATE_OK");
      expect(readlinkSync(fixture.currentPath)).toBe(`releases/${fixture.sha}`);
    });
  }, 15_000);

  describe("fail-closed preconditions", () => {
    const unchanged = (fixture: UpdateFixture) =>
      expect(readlinkSync(fixture.currentPath)).toBe(fixture.previousTarget);

    it("rejects a dirty checkout", () => {
      const fixture = prepareUpdate();
      writeFileSync(join(fixture.checkout, "cockpit", "dist", "index.html"), "dirty\n");
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });

    it("rejects a checkout whose HEAD is not the accepted sha", () => {
      const fixture = prepareUpdate();
      const result = spawnSync("bash", [releaseUpdate, fixture.checkout, fixture.releaseRoot, "b".repeat(40)], {
        encoding: "utf8",
        env: fixture.env,
        timeout: 15_000,
      });
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });

    it("rejects a checkout without an origin remote", () => {
      const fixture = prepareUpdate();
      git(fixture.checkout, "remote", "remove", "origin");
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });

    it("rejects a runtime other than Node 24", () => {
      const fixture = prepareUpdate();
      const fakeNode = join(makeTempDir(), "node");
      writeFileSync(fakeNode, "#!/bin/sh\nprintf 'v23.0.0\\n'\n");
      chmodSync(fakeNode, 0o755);
      const result = runUpdate(fixture, { AUTOPILOT_NODE_BIN: fakeNode });
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });

    it("refuses when secure cookies are not yet enabled (initial cutover incomplete)", () => {
      const fixture = prepareUpdate({ secureLine: "CONTROL_PLANE_SECURE_COOKIES=false" });
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });

    it.each([
      ["Caddy inactive", { STUB_CADDY_INACTIVE: "1" }],
      ["Caddy not enabled", { STUB_CADDY_NOT_ENABLED: "1" }],
      ["firewall inactive", { STUB_FIREWALL_INACTIVE: "1" }],
      ["nft table absent", { STUB_NFT_ABSENT: "1" }],
      ["nft table inspection errors", { STUB_NFT_INSPECTION_ERROR: "1" }],
      ["nft identity foreign", { STUB_NFT_FOREIGN: "1" }],
      ["caddy ports down", { STUB_CADDY_PORTS_DOWN: "1" }],
      ["acceptance port 8443 occupied", { STUB_OCCUPIED_PORT: "8443" }],
      ["loopback bound to wildcard", { STUB_UNSAFE_CP_LISTENER: "1" }],
    ])("refuses when %s", (_label, env) => {
      const fixture = prepareUpdate();
      const result = runUpdate(fixture, env);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
      expect(existsSync(join(fixture.root, "var", "lib", "autopilot-cockpit", "release-update-transactions", "active"))).toBe(false);
    });

    it("refuses when the installed Caddyfile differs from the accepted release (needs a config cutover)", () => {
      const fixture = prepareUpdate();
      writeFileSync(fixture.caddyConfigPath, `${readFileSync(fixture.caddyConfigPath, "utf8")}\n# drift\n`, { mode: 0o644 });
      chmodSync(fixture.caddyConfigPath, 0o644);
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });

    it("refuses a symlinked control-plane.env (mutable indirection to a compliant target)", () => {
      const fixture = prepareUpdate();
      const realEnv = `${fixture.envPath}.real`;
      renameSync(fixture.envPath, realEnv);
      symlinkSync(realEnv, fixture.envPath);
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
      expect(existsSync(join(fixture.root, "var", "lib", "autopilot-cockpit", "release-update-transactions", "active"))).toBe(false);
    });

    it("refuses a symlinked installed Caddyfile even when its target matches the accepted release", () => {
      const fixture = prepareUpdate();
      const realCfg = `${fixture.caddyConfigPath}.real`;
      renameSync(fixture.caddyConfigPath, realCfg);
      symlinkSync(realCfg, fixture.caddyConfigPath);
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
      expect(existsSync(join(fixture.root, "var", "lib", "autopilot-cockpit", "release-update-transactions", "active"))).toBe(false);
    });

    it("refuses when there is no live current symlink", () => {
      const fixture = prepareUpdate();
      rmSync(fixture.currentPath);
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      expect(existsSync(fixture.currentPath)).toBe(false);
    });

    it("refuses a writable (mutable) accepted release tree", () => {
      const fixture = prepareUpdate();
      chmodSync(join(fixture.releaseRoot, "releases", fixture.sha, "index.html"), 0o644);
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });

    it.runIf(alternateGid !== undefined)("refuses an accepted release with wrong ownership", () => {
      const fixture = prepareUpdate();
      chownSync(join(fixture.releaseRoot, "releases", fixture.sha, "index.html"), process.getuid!(), alternateGid!);
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });

    it("refuses a symlinked current target outside the release store", () => {
      const fixture = prepareUpdate();
      rmSync(fixture.currentPath);
      symlinkSync("/etc", fixture.currentPath);
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
    });

    it("refuses an accepted sha that is not staged", () => {
      const fixture = prepareUpdate();
      spawnSync("chmod", ["-R", "u+w", join(fixture.releaseRoot, "releases", fixture.sha)]);
      rmSync(join(fixture.releaseRoot, "releases", fixture.sha), { recursive: true, force: true });
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });

    // M1: a failed `git status --porcelain` probe must fail closed, not read as a clean
    // checkout via an empty command substitution.
    it("refuses when the porcelain status probe fails rather than treating it as clean", () => {
      const fixture = prepareUpdate();
      // Shadow git only for the status subcommand; every other git op runs the real binary
      // (via an absolute exec, so the privileged PATH cannot recurse into this stub).
      stubExecutable(
        fixture.stubDir,
        "git",
        `found=0\nfor a in "$@"; do [ "$a" = status ] && found=1; done\n` +
          `if [ "$found" = 1 ]; then exit 3; fi\nexec ${JSON.stringify(realGit)} "$@"`,
      );
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });

    // M4: the served release must be byte-for-byte the reviewed checkout build, not merely a
    // tree with matching entry names plus a self-consistent manifest.
    it("refuses a staged release whose bytes differ from the checkout dist (matching names only)", () => {
      const fixture = prepareUpdate();
      const releaseDir = join(fixture.releaseRoot, "releases", fixture.sha);
      const manifest = join(fixture.releaseRoot, "manifests", `${fixture.sha}.sha256`);
      const tampered = join(releaseDir, "index.html");
      // Rewrite a released file's content and rebuild the manifest so the release tree stays
      // internally consistent (release_tree_valid still passes) while diverging from the
      // clean checkout dist bytes.
      chmodSync(tampered, 0o644);
      writeFileSync(tampered, "tampered-not-the-reviewed-build\n");
      chmodSync(tampered, 0o444);
      chmodSync(manifest, 0o644);
      const rebuilt = execFileSync(
        "bash",
        ["-c", `cd ${JSON.stringify(releaseDir)} && find -P . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum`],
        { encoding: "utf8" },
      );
      writeFileSync(manifest, rebuilt);
      chmodSync(manifest, 0o444);
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });
  });

  // The reviewed Caddyfile is deployed over the packaged default, so `dpkg -V caddy`
  // reports exactly one intentional conffile divergence. That single
  // known record must be permitted; any other drift, extra line, or malformed output must
  // still fail closed. The same installed Caddyfile bytes are separately pinned to the
  // accepted release above, so permitting this record does not weaken config verification.
  describe("package verification conffile drift", () => {
    const unchanged = (fixture: UpdateFixture) => {
      expect(readlinkSync(fixture.currentPath)).toBe(fixture.previousTarget);
      expect(existsSync(join(fixture.root, "var", "lib", "autopilot-cockpit", "release-update-transactions", "active"))).toBe(false);
    };

    // Override the dpkg stub so `-V caddy` emits a chosen verification output and status,
    // while `-s caddy` still succeeds (both are required by the worker).
    function stubDpkgVerify(fixture: UpdateFixture, verifyBody: string): void {
      stubExecutable(
        fixture.stubDir,
        "dpkg",
        `[[ "$1" == -s && "$2" == caddy ]] && exit 0\n` +
          `if [[ "$1" == -V && "$2" == caddy ]]; then ${verifyBody}\nfi\nexit 1`,
      );
    }

    it("permits exactly the known intentional Caddyfile conffile drift record", () => {
      const fixture = prepareUpdate();
      // Real production output: md5 differs on the intentionally managed conffile.
      stubDpkgVerify(fixture, `printf '??5?????? c /etc/caddy/Caddyfile\\n'; exit 0`);
      const result = runUpdate(fixture);
      if (result.status !== 0) {
        throw new Error(`${result.stdout}\n${result.stderr}\n${readFileSync(fixture.stubLog, "utf8")}`);
      }
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("RELEASE_UPDATE_OK");
      expect(readlinkSync(fixture.currentPath)).toBe(`releases/${fixture.sha}`);
    });

    it("refuses drift on a different package file alongside the known Caddyfile record", () => {
      const fixture = prepareUpdate();
      stubDpkgVerify(
        fixture,
        `printf '??5?????? c /etc/caddy/Caddyfile\\n??5??????   /usr/bin/caddy\\n'; exit 0`,
      );
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });

    it("refuses the known record when package verification itself errors", () => {
      const fixture = prepareUpdate();
      stubDpkgVerify(fixture, `printf '??5?????? c /etc/caddy/Caddyfile\\n'; exit 2`);
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });

    it("refuses a single verification record for a file other than the Caddyfile", () => {
      const fixture = prepareUpdate();
      stubDpkgVerify(fixture, `printf '??5?????? c /etc/caddy/Caddyfile.decoy\\n'; exit 0`);
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });

    it("refuses a malformed verification record that only resembles the known drift", () => {
      const fixture = prepareUpdate();
      // Extra trailing content on the same line must not be accepted as the known record.
      stubDpkgVerify(fixture, `printf '??5?????? c /etc/caddy/Caddyfile extra\\n'; exit 0`);
      const result = runUpdate(fixture);
      expect(result.status).not.toBe(0);
      unchanged(fixture);
    });
  });

  // I2: the production trusted-path/root boundary. These exercise the real
  // assert_trusted_invocation enforcement (owner/mode/symlink/$0) via a root-relative
  // installed copy, without EUID 0 and without simply bypassing it in test mode.
  describe("trusted-path invocation boundary", () => {
    const trustedWorker = (fixture: UpdateFixture) =>
      join(fixture.root, "usr", "local", "libexec", "autopilot-cockpit-release-update");

    function runTrusted(fixture: UpdateFixture, invokePath: string, extraEnv: NodeJS.ProcessEnv = {}) {
      return spawnSync("bash", [invokePath, fixture.checkout, fixture.releaseRoot, fixture.sha], {
        encoding: "utf8",
        env: {
          ...fixture.env,
          AUTOPILOT_RELEASE_UPDATE_TEST_TRUSTED_PATH: trustedWorker(fixture),
          ...extraEnv,
        },
        timeout: 15_000,
      });
    }

    it("accepts execution from the installed root-relative trusted path", () => {
      const fixture = prepareUpdate();
      const result = runTrusted(fixture, trustedWorker(fixture));
      if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}\n${readFileSync(fixture.stubLog, "utf8")}`);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("RELEASE_UPDATE_OK");
      expect(readlinkSync(fixture.currentPath)).toBe(`releases/${fixture.sha}`);
    });

    it("refuses when $0 is not the trusted path (checkout copy run as if trusted)", () => {
      const fixture = prepareUpdate();
      const result = runTrusted(fixture, releaseUpdate);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("refusing mutable release-update worker");
      expect(readlinkSync(fixture.currentPath)).toBe(fixture.previousTarget);
    });

    it("refuses a symlinked trusted worker even when its target is the real worker", () => {
      const fixture = prepareUpdate();
      const target = trustedWorker(fixture);
      const real = `${target}.real`;
      renameSync(target, real);
      symlinkSync(real, target);
      const result = runTrusted(fixture, target);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("refusing mutable release-update worker");
      expect(readlinkSync(fixture.currentPath)).toBe(fixture.previousTarget);
    });

    it("refuses a world-writable (mutable) trusted worker", () => {
      const fixture = prepareUpdate();
      const target = trustedWorker(fixture);
      chmodSync(target, 0o777);
      const result = runTrusted(fixture, target);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("refusing mutable release-update worker");
      expect(readlinkSync(fixture.currentPath)).toBe(fixture.previousTarget);
    });

    // I2: real privilege-drop command construction. A successful run must build the exact
    // setpriv reuid/regid/clear-groups drop into a clean env, and the npm stub proves the
    // drop actually took effect (it exits 96 unless AUTOPILOT_PRIVDROP_ACTIVE is set).
    it("drops privileges to the checkout owner with a clean environment for project commands", () => {
      const fixture = prepareUpdate();
      const result = runTrusted(fixture, trustedWorker(fixture));
      expect(result.status).toBe(0);
      const log = readFileSync(fixture.stubLog, "utf8");
      const uid = process.getuid?.() ?? 0;
      const gid = process.getgid?.() ?? 0;
      const drop = log.split("\n").filter((line) => line.startsWith("setpriv:"));
      expect(drop.length).toBeGreaterThan(0);
      for (const line of drop) {
        expect(line).toContain(`--reuid ${uid} --regid ${gid} --clear-groups --`);
        expect(line).toContain(" -i ");
        expect(line).toContain("AUTOPILOT_PRIVDROP_ACTIVE=1");
        expect(line).not.toContain("secret-do-not-print");
      }
    });
  });

  // I1: the integrity-pinned installer that publishes the worker to its trusted path.
  describe("release-update worker installer", () => {
    function installRoot(): string {
      const root = join(makeTempDir(), "install-root");
      mkdirSync(join(root, "usr", "local", "libexec"), { recursive: true });
      return root;
    }
    const target = (root: string) => join(root, "usr", "local", "libexec", "autopilot-cockpit-release-update");
    function runInstaller(sourceScript: string, root: string, extraEnv: NodeJS.ProcessEnv = {}) {
      return spawnSync("bash", [sourceScript], {
        encoding: "utf8",
        env: { ...process.env, AUTOPILOT_RELEASE_UPDATE_INSTALL_TEST_ROOT: root, ...extraEnv },
        timeout: 15_000,
      });
    }

    it("installs the committed worker matching pinned provenance, then is idempotent", () => {
      const root = installRoot();
      const first = runInstaller(installReleaseUpdate, root);
      if (first.status !== 0) throw new Error(`${first.stdout}\n${first.stderr}`);
      expect(first.stdout).toContain("RELEASE_UPDATE_WORKER_INSTALLED");
      const installed = target(root);
      expect(statSync(installed).isSymbolicLink()).toBe(false);
      expect(statSync(installed).mode & 0o777).toBe(0o755);
      // The installed bytes equal the reviewed worker; the committed provenance is in sync.
      expect(readFileSync(installed)).toEqual(readFileSync(releaseUpdate));
      const second = runInstaller(installReleaseUpdate, root);
      expect(second.status).toBe(0);
      expect(second.stdout).toContain("RELEASE_UPDATE_WORKER_ALREADY_INSTALLED");
    });

    it("refuses worker bytes that do not match the pinned provenance", () => {
      const src = makeTempDir();
      writeFileSync(join(src, "install-release-update.sh"), readFileSync(installReleaseUpdate));
      chmodSync(join(src, "install-release-update.sh"), 0o755);
      // Tamper the worker while keeping the real (now-stale) provenance hash.
      writeFileSync(join(src, "release-update.sh"), `${readFileSync(releaseUpdate, "utf8")}\n# tampered\n`);
      writeFileSync(join(src, "release-update.provenance.json"), readFileSync(releaseUpdateProvenance));
      const root = installRoot();
      const result = runInstaller(join(src, "install-release-update.sh"), root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("does not match pinned provenance");
      expect(existsSync(target(root))).toBe(false);
    });

    it("refuses a symlinked trusted worker target", () => {
      const root = installRoot();
      const decoy = join(makeTempDir(), "decoy");
      writeFileSync(decoy, "decoy\n");
      symlinkSync(decoy, target(root));
      const result = runInstaller(installReleaseUpdate, root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("refusing symlinked trusted worker target");
      expect(lstatSync(target(root)).isSymbolicLink()).toBe(true);
      expect(readFileSync(decoy, "utf8")).toBe("decoy\n");
    });
  });

  // M3: recovery/rollback must refuse to restore against a missing/symlinked prior release
  // and report ROLLBACK_FAILED instead of falsely claiming ROLLBACK_OK.
  describe("rollback integrity", () => {
    it("fails recovery when the prior release directory is missing", () => {
      const fixture = prepareUpdate();
      const killed = runUpdate(fixture, {
        AUTOPILOT_RELEASE_UPDATE_TEST_KILL_AFTER: "current-mv",
        AUTOPILOT_RELEASE_UPDATE_TEST_AUTO_ACK: "0",
      });
      expect(killed.status).not.toBe(0);
      expect(readlinkSync(fixture.currentPath)).toBe(`releases/${fixture.sha}`);
      // The prior release directory disappears before recovery runs.
      rmSync(join(fixture.releaseRoot, fixture.previousTarget), { recursive: true, force: true });
      const recovered = spawnSync("bash", [releaseUpdate, "--recover"], { encoding: "utf8", env: fixture.env, timeout: 15_000 });
      expect(recovered.status).not.toBe(0);
      expect(recovered.stdout).toContain("ROLLBACK_FAILED");
      expect(recovered.stdout).not.toContain("ROLLBACK_OK");
      // current is not repointed at an absent target.
      expect(readlinkSync(fixture.currentPath)).toBe(`releases/${fixture.sha}`);
    });
  });
});
