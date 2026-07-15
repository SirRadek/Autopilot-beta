import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const stageRelease = join(process.cwd(), "ops", "cockpit-proxy", "stage-release.sh");
const isolatedAcceptance = join(process.cwd(), "ops", "cockpit-proxy", "isolated-acceptance.sh");
const hostAcceptance = join(process.cwd(), "ops", "cockpit-proxy", "host-acceptance.sh");
const liveCutover = join(process.cwd(), "ops", "cockpit-proxy", "live-cutover.sh");
const node24 = process.env.AUTOPILOT_NODE_BIN ?? process.execPath;
const tempRoots: string[] = [];
const alternateGid = process.getgroups?.().find((gid) => gid !== process.getgid?.());

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "autopilot-cockpit-release-"));
  tempRoots.push(dir);
  return dir;
}

function git(checkout: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", checkout, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return result.stdout.trim();
}

function makeCheckout(
  options: { distRootSymlink?: boolean; distSymlink?: boolean; emptyDistDir?: boolean } = {},
): { checkout: string; sha: string } {
  const checkout = join(makeTempDir(), "checkout");
  const dist = options.distRootSymlink ? join(makeTempDir(), "external-dist") : join(checkout, "cockpit", "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), options.distRootSymlink ? "external\n" : "cockpit\n");
  writeFileSync(join(dist, "assets", "app.js"), "app\n");
  if (options.emptyDistDir) {
    mkdirSync(join(dist, "empty"));
  }
  if (options.distRootSymlink) {
    mkdirSync(join(checkout, "cockpit"), { recursive: true });
    symlinkSync(dist, join(checkout, "cockpit", "dist"));
  }
  if (options.distSymlink) {
    symlinkSync("index.html", join(checkout, "cockpit", "dist", "linked.html"));
  }
  git(checkout, "init", "-q");
  git(checkout, "config", "user.name", "Cockpit Release Test");
  git(checkout, "config", "user.email", "cockpit-release@example.invalid");
  git(checkout, "add", ".");
  git(checkout, "commit", "-qm", "build cockpit");
  return { checkout, sha: git(checkout, "rev-parse", "HEAD") };
}

function makeReleaseRoot(): string {
  const root = join(makeTempDir(), "release-root");
  mkdirSync(root, { mode: 0o755 });
  chmodSync(root, 0o755);
  return root;
}

function runStage(checkout: string, root: string, runtime = node24) {
  return spawnSync("bash", [stageRelease, checkout, root], {
    encoding: "utf8",
    env: {
      ...process.env,
      AUTOPILOT_NODE_BIN: runtime,
      AUTOPILOT_RELEASE_TEST_MODE: "1",
      AUTOPILOT_STAGE_TEST_FAIL_DURING_EARLY_SETUP: "0",
      AUTOPILOT_STAGE_TEST_FAIL_AFTER_RELEASE: "0",
      AUTOPILOT_STAGE_TEST_FAIL_AFTER_MANIFEST: "0",
      AUTOPILOT_STAGE_TEST_CORRUPT_MANIFEST: "0",
    },
  });
}

function runStageWithEnv(checkout: string, root: string, env: NodeJS.ProcessEnv) {
  return spawnSync("bash", [stageRelease, checkout, root], {
    encoding: "utf8",
    env: {
      ...process.env,
      AUTOPILOT_NODE_BIN: node24,
      AUTOPILOT_RELEASE_TEST_MODE: "1",
      AUTOPILOT_STAGE_TEST_FAIL_DURING_EARLY_SETUP: "0",
      AUTOPILOT_STAGE_TEST_FAIL_AFTER_RELEASE: "0",
      AUTOPILOT_STAGE_TEST_FAIL_AFTER_MANIFEST: "0",
      AUTOPILOT_STAGE_TEST_CORRUPT_MANIFEST: "0",
      ...env,
    },
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    spawnSync("chmod", ["-R", "u+w", root]);
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Cockpit immutable release staging", () => {
  it("stages a read-only release and manifest without creating current", () => {
    const { checkout, sha } = makeCheckout();
    const root = makeReleaseRoot();

    const result = runStage(checkout, root);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, sha });
    expect(readFileSync(join(root, "releases", sha, "index.html"), "utf8")).toBe("cockpit\n");
    expect(readFileSync(join(root, "manifests", `${sha}.sha256`), "utf8")).toMatch(/assets\/app\.js/);
    expect(existsSync(join(root, "current"))).toBe(false);
    expect(statSync(join(root, "releases", sha, "index.html")).mode & 0o777).toBe(0o444);
    expect(statSync(join(root, "releases", sha)).mode & 0o777).toBe(0o555);
    expect(statSync(join(root, "releases", sha, "assets")).mode & 0o777).toBe(0o555);
    expect(statSync(join(root, "releases", sha, "assets", "app.js")).mode & 0o777).toBe(0o444);
    expect(statSync(join(root, "manifests", `${sha}.sha256`)).mode & 0o777).toBe(0o444);
    for (const published of [
      join(root, "releases", sha),
      join(root, "releases", sha, "index.html"),
      join(root, "releases", sha, "assets"),
      join(root, "releases", sha, "assets", "app.js"),
      join(root, "manifests", `${sha}.sha256`),
    ]) {
      expect(statSync(published).uid).toBe(process.getuid!());
      expect(statSync(published).gid).toBe(process.getgid!());
    }
    expect(statSync(root).mode & 0o777).toBe(0o755);
    expect(statSync(join(root, "releases")).mode & 0o777).toBe(0o755);
    expect(statSync(join(root, "manifests")).mode & 0o777).toBe(0o755);
    for (const store of [root, join(root, "releases"), join(root, "manifests")]) {
      expect(statSync(store).uid).toBe(process.getuid!());
      expect(statSync(store).gid).toBe(process.getgid!());
      expect(statSync(store).mode & 0o200).toBe(0o200);
    }
  });

  it("is idempotent for an identical existing release", () => {
    const { checkout, sha } = makeCheckout();
    const root = makeReleaseRoot();
    expect(runStage(checkout, root).status).toBe(0);

    const result = runStage(checkout, root);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, sha });
  });

  it("leaves an existing current symlink untouched", () => {
    const { checkout } = makeCheckout();
    const root = makeReleaseRoot();
    mkdirSync(join(root, "releases", "previous"), { mode: 0o755, recursive: true });
    chmodSync(join(root, "releases"), 0o755);
    symlinkSync("releases/previous", join(root, "current"));

    expect(runStage(checkout, root).status).toBe(0);

    expect(readlinkSync(join(root, "current"))).toBe("releases/previous");
  });

  it("rejects a dirty checkout", () => {
    const { checkout } = makeCheckout();
    const root = makeReleaseRoot();
    writeFileSync(join(checkout, "cockpit", "dist", "index.html"), "dirty\n");

    expect(runStage(checkout, root).status).not.toBe(0);
    expect(existsSync(join(root, "releases"))).toBe(false);
  });

  it("rejects a runtime other than Node 24", () => {
    const { checkout } = makeCheckout();
    const root = makeReleaseRoot();
    const fakeNode = join(makeTempDir(), "node");
    writeFileSync(fakeNode, "#!/bin/sh\nprintf 'v23.0.0\\n'\n");
    chmodSync(fakeNode, 0o755);

    expect(runStage(checkout, root, fakeNode).status).not.toBe(0);
    expect(existsSync(join(root, "releases"))).toBe(false);
  });

  it("rejects a symlink in cockpit/dist", () => {
    const { checkout } = makeCheckout({ distSymlink: true });
    const root = makeReleaseRoot();

    expect(runStage(checkout, root).status).not.toBe(0);
    expect(existsSync(join(root, "releases"))).toBe(false);
  });

  it("rejects cockpit/dist itself when it symlinks outside the checkout", () => {
    const { checkout } = makeCheckout({ distRootSymlink: true });
    const root = makeReleaseRoot();

    const result = runStage(checkout, root);

    expect(result.status).not.toBe(0);
    expect(existsSync(join(root, "releases"))).toBe(false);
  });

  it("rejects a symlink release root", () => {
    const { checkout } = makeCheckout();
    const root = makeReleaseRoot();
    const linkedRoot = join(dirname(root), "linked-release-root");
    symlinkSync(root, linkedRoot);

    expect(runStage(checkout, linkedRoot).status).not.toBe(0);
    expect(existsSync(join(root, "releases"))).toBe(false);
  });

  it.each(["releases", "manifests"])("rejects a symlinked %s child directory", (child) => {
    const { checkout } = makeCheckout();
    const root = makeReleaseRoot();
    const outside = join(makeTempDir(), "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(root, child));

    const result = runStage(checkout, root);

    expect(result.status).not.toBe(0);
    expect(existsSync(join(outside, "current"))).toBe(false);
    expect(existsSync(join(outside, "index.html"))).toBe(false);
  });

  it("does not follow a predictable temporary-manifest symlink", () => {
    const { checkout, sha } = makeCheckout();
    const root = makeReleaseRoot();
    const outside = join(makeTempDir(), "outside.txt");
    mkdirSync(join(root, "manifests"), { mode: 0o755 });
    writeFileSync(outside, "sentinel\n");
    symlinkSync(outside, join(root, "manifests", `${sha}.sha256.tmp`));

    const result = runStage(checkout, root);

    expect(result.status).toBe(0);
    expect(readFileSync(outside, "utf8")).toBe("sentinel\n");
    expect(lstatSync(join(root, "manifests", `${sha}.sha256.tmp`)).isSymbolicLink()).toBe(true);
  });

  it("rejects an existing release with a different manifest", () => {
    const { checkout, sha } = makeCheckout();
    const root = makeReleaseRoot();
    mkdirSync(join(root, "releases", sha), { recursive: true });
    mkdirSync(join(root, "manifests"), { recursive: true });
    writeFileSync(join(root, "releases", sha, "index.html"), "different\n");
    writeFileSync(join(root, "manifests", `${sha}.sha256`), `${"0".repeat(64)}  ./index.html\n`);

    expect(runStage(checkout, root).status).not.toBe(0);
    expect(readFileSync(join(root, "releases", sha, "index.html"), "utf8")).toBe("different\n");
  });

  it("rejects an extra file omitted from an existing manifest", () => {
    const { checkout, sha } = makeCheckout();
    const root = makeReleaseRoot();
    expect(runStage(checkout, root).status).toBe(0);
    chmodSync(join(root, "releases", sha), 0o755);
    writeFileSync(join(root, "releases", sha, "extra.txt"), "untracked\n");
    chmodSync(join(root, "releases", sha, "extra.txt"), 0o444);
    chmodSync(join(root, "releases", sha), 0o555);

    expect(runStage(checkout, root).status).not.toBe(0);
  });

  it("rejects an extra exact-mode empty directory in an existing release", () => {
    const { checkout, sha } = makeCheckout();
    const root = makeReleaseRoot();
    expect(runStage(checkout, root).status).toBe(0);
    chmodSync(join(root, "releases", sha), 0o755);
    mkdirSync(join(root, "releases", sha, "extra-empty"), { mode: 0o555 });
    chmodSync(join(root, "releases", sha), 0o555);

    expect(runStage(checkout, root).status).not.toBe(0);
  });

  it("rejects an existing release missing an empty candidate directory", () => {
    const { checkout, sha } = makeCheckout({ emptyDistDir: true });
    const root = makeReleaseRoot();
    expect(runStage(checkout, root).status).toBe(0);
    chmodSync(join(root, "releases", sha), 0o755);
    chmodSync(join(root, "releases", sha, "empty"), 0o755);
    rmSync(join(root, "releases", sha, "empty"), { recursive: true });
    chmodSync(join(root, "releases", sha), 0o555);

    expect(runStage(checkout, root).status).not.toBe(0);
  });

  it("rejects a symlink added to an existing release", () => {
    const { checkout, sha } = makeCheckout();
    const root = makeReleaseRoot();
    const outside = join(makeTempDir(), "outside.txt");
    writeFileSync(outside, "app\n");
    expect(runStage(checkout, root).status).toBe(0);
    chmodSync(join(root, "releases", sha), 0o755);
    symlinkSync(outside, join(root, "releases", sha, "external.js"));
    chmodSync(join(root, "releases", sha), 0o555);

    expect(runStage(checkout, root).status).not.toBe(0);
  });

  it("rejects writable existing release content", () => {
    const { checkout, sha } = makeCheckout();
    const root = makeReleaseRoot();
    expect(runStage(checkout, root).status).toBe(0);
    chmodSync(join(root, "releases", sha, "index.html"), 0o644);

    expect(runStage(checkout, root).status).not.toBe(0);
  });

  it.runIf(alternateGid !== undefined)("rejects existing release content with wrong ownership", () => {
    const { checkout, sha } = makeCheckout();
    const root = makeReleaseRoot();
    expect(runStage(checkout, root).status).toBe(0);
    chownSync(join(root, "releases", sha, "index.html"), process.getuid!(), alternateGid!);

    expect(runStage(checkout, root).status).not.toBe(0);
  });

  it("recovers a valid release left by interruption before manifest publication", () => {
    const { checkout, sha } = makeCheckout();
    const root = makeReleaseRoot();

    const interrupted = runStageWithEnv(checkout, root, {
      AUTOPILOT_STAGE_TEST_FAIL_AFTER_RELEASE: "1",
    });
    expect(interrupted.status).not.toBe(0);
    expect(existsSync(join(root, "releases", sha))).toBe(true);
    expect(existsSync(join(root, "manifests", `${sha}.sha256`))).toBe(false);

    const recovered = runStage(checkout, root);
    expect(recovered.status).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({ ok: true, sha });
    expect(existsSync(join(root, "manifests", `${sha}.sha256`))).toBe(true);
  });

  it("recovers a valid manifest left by interruption before release publication", () => {
    const { checkout, sha } = makeCheckout();
    const root = makeReleaseRoot();

    const interrupted = runStageWithEnv(checkout, root, {
      AUTOPILOT_STAGE_TEST_FAIL_AFTER_MANIFEST: "1",
    });
    expect(interrupted.status).not.toBe(0);
    expect(existsSync(join(root, "releases", sha))).toBe(false);
    expect(existsSync(join(root, "manifests", `${sha}.sha256`))).toBe(true);

    const recovered = runStage(checkout, root);
    expect(recovered.status).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({ ok: true, sha });
    expect(existsSync(join(root, "releases", sha))).toBe(true);
  });

  it("cleans an early setup failure and leaves the store reusable", () => {
    const { checkout } = makeCheckout();
    const root = makeReleaseRoot();

    const interrupted = runStageWithEnv(checkout, root, {
      AUTOPILOT_STAGE_TEST_FAIL_DURING_EARLY_SETUP: "1",
    });
    expect(interrupted.status).not.toBe(0);
    expect(statSync(join(root, "releases")).mode & 0o777).toBe(0o755);
    expect(statSync(join(root, "manifests")).mode & 0o777).toBe(0o755);
    expect(runStage(checkout, root).status).toBe(0);
  });

  it("does not trust TMPDIR to expand test-mode confinement", () => {
    const { checkout } = makeCheckout();
    const hostileParent = mkdtempSync(join(process.cwd(), ".autopilot-cockpit-release-"));
    tempRoots.push(hostileParent);
    const root = join(hostileParent, "release-root");
    mkdirSync(root, { mode: 0o755 });

    const result = runStageWithEnv(checkout, root, { TMPDIR: hostileParent });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(root, "releases"))).toBe(false);
  });

  it("refuses publication when the generated manifest fails checksum verification", () => {
    const { checkout, sha } = makeCheckout();
    const root = makeReleaseRoot();

    const result = runStageWithEnv(checkout, root, {
      AUTOPILOT_STAGE_TEST_CORRUPT_MANIFEST: "1",
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(root, "releases", sha))).toBe(false);
    expect(existsSync(join(root, "manifests", `${sha}.sha256`))).toBe(false);
  });

  it("refuses the test-mode bypass for the production release root", () => {
    const { checkout } = makeCheckout();

    const result = runStage(checkout, "/srv/autopilot-cockpit");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("test mode is forbidden for /srv/autopilot-cockpit");
  });

  it.runIf(process.getuid?.() !== 0)("requires EUID 0 for the production release root", () => {
    const { checkout } = makeCheckout();

    const result = runStageWithEnv(checkout, "/srv/autopilot-cockpit", {
      AUTOPILOT_RELEASE_TEST_MODE: "0",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("production staging requires EUID 0");
  });
});

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, `#!/bin/bash\nset -eu\n${body}`);
  chmodSync(path, 0o755);
}

function makeIsolatedStubs(): { bin: string; log: string } {
  const root = makeTempDir();
  const bin = join(root, "bin");
  const log = join(root, "commands.log");
  mkdirSync(bin);
  writeExecutable(join(bin, "mkdir"), `
if [[ -n "\${STUB_RACE_RUNTIME:-}" && "\${*: -1}" == "$STUB_RACE_RUNTIME" ]]; then
  ln -s "$STUB_RACE_TARGET" "$STUB_RACE_RUNTIME"
  exit 0
fi
exec /usr/bin/mkdir "$@"
`);
  writeExecutable(join(bin, "install"), `
if [[ -n "\${STUB_RACE_RUNTIME:-}" && "\${*: -1}" == "$STUB_RACE_RUNTIME" ]]; then
  ln -s "$STUB_RACE_TARGET" "$STUB_RACE_RUNTIME"
fi
exec /usr/bin/install "$@"
`);
  writeExecutable(join(bin, "ss"), `
printf 'ss %s\\n' "$*" >> "$STUB_LOG"
[[ "\${STUB_SS_FAIL:-0}" != 1 ]] || exit 2
case "\${STUB_OCCUPIED_PORT:-}" in
  8443) [[ "$*" == *8443* ]] && printf 'LISTEN 0 1 192.168.122.99:8443\\n' ;;
  8877) [[ "$*" == *8877* ]] && printf 'LISTEN 0 1 127.0.0.1:8877\\n' ;;
esac
if [[ "\${STUB_CLEANUP_OCCUPIED:-0}" == 1 ]] && grep -q 'systemctl stop' "$STUB_LOG"; then
  printf 'LISTEN 0 1 192.168.122.99:8443\\n'
fi
`);
  writeExecutable(join(bin, "nft"), `
printf 'nft %s\\n' "$*" >> "$STUB_LOG"
if [[ "$*" == *list* && "\${STUB_NFT_INSPECT_FAIL:-0}" == 1 ]]; then exit 2; fi
if [[ "$*" == "-f -" ]]; then
  batch="$(cat)"
  printf '%s\\n' "$batch" >> "$STUB_LOG"
  nonce="$(sed -n 's/.*autopilot-isolated:\\([a-f0-9]\\{64\\}\\).*/\\1/p' <<< "$batch" | head -1)"
  printf '%s' "$nonce" > "$STUB_LOG.nonce"
  printf '%s\\n' 'nft add table inet autopilot_cockpit_isolated' >> "$STUB_LOG"
  if [[ "\${STUB_NFT_CREATE_RACE:-0}" == 1 ]]; then printf '%064d' 8 > "$STUB_LOG.nonce"; exit 1; fi
  exit 0
fi
present=0
if [[ "\${STUB_TABLE_EXISTS:-0}" == 1 ]]; then present=1
elif [[ -f "$STUB_LOG.nonce" ]] && ! grep -q '^nft delete table inet autopilot_cockpit_isolated$' "$STUB_LOG"; then present=1
fi
if [[ "$*" == "-j list tables" ]]; then
  if [[ "$present" == 1 ]]; then printf '%s' '{"nftables":[{"table":{"family":"inet","name":"autopilot_cockpit_isolated"}}]}'
  else printf '%s' '{"nftables":[]}' ; fi
  exit 0
fi
if [[ "$*" == "-j list table inet autopilot_cockpit_isolated" ]]; then
  [[ "$present" == 1 ]] || exit 1
  nonce="$(cat "$STUB_LOG.nonce" 2>/dev/null || printf '%064d' 9)"
  post_started=0
  grep -q '^systemd-run --unit=autopilot-cockpit-isolated-control-plane' "$STUB_LOG" && \
    grep -q '^systemd-run --unit=autopilot-cockpit-isolated-proxy' "$STUB_LOG" && post_started=1
  nft_checks=0
  if [[ "$post_started" == 1 ]]; then nft_checks=$(( $(cat "$STUB_LOG.nft-checks" 2>/dev/null || printf 0) + 1 )); printf '%s' "$nft_checks" > "$STUB_LOG.nft-checks"; fi
  if [[ "\${STUB_FOREIGN_REPLACEMENT:-}" == nft ]] || [[ "\${STUB_POST_START_REPLACEMENT:-}" == nft && "$post_started" == 1 ]] || \
    [[ "\${STUB_POST_START_REPLACEMENT:-}" == nft-late && "$nft_checks" -ge 2 ]]; then nonce="$(printf '%064d' 8)"; fi
  comment="autopilot-isolated:$nonce"
  printf '{"nftables":[{"table":{"family":"inet","name":"autopilot_cockpit_isolated","comment":"%s"}},{"chain":{"family":"inet","table":"autopilot_cockpit_isolated","name":"input","type":"filter","hook":"input","prio":-10,"policy":"accept","comment":"%s"}},{"rule":{"family":"inet","table":"autopilot_cockpit_isolated","chain":"input","expr":[{"match":{"op":"==","left":{"payload":{"protocol":"tcp","field":"dport"}},"right":8443}},{"match":{"op":"!=","left":{"payload":{"protocol":"ip","field":"saddr"}},"right":"192.168.122.1"}},{"drop":null}],"comment":"%s"}}]}' "$comment" "$comment" "$comment"
  exit 0
fi
exit 0
`);
  writeExecutable(join(bin, "caddy"), `
printf 'caddy %s\\n' "$*" >> "$STUB_LOG"
[[ "\${STUB_CADDY_VALIDATE_FAIL:-0}" != 1 ]]
`);
  writeExecutable(join(bin, "systemctl"), `
printf 'systemctl %s\\n' "$*" >> "$STUB_LOG"
if [[ "\${1:-}" == show ]]; then
  [[ "\${STUB_SYSTEMCTL_INSPECT_FAIL:-0}" != 1 ]] || exit 2
  if [[ "$*" == *--property=Description* ]]; then
    post_started=0
    grep -q '^systemd-run --unit=autopilot-cockpit-isolated-control-plane' "$STUB_LOG" && \
      grep -q '^systemd-run --unit=autopilot-cockpit-isolated-proxy' "$STUB_LOG" && post_started=1
    unit_checks=0
    if [[ "$post_started" == 1 ]]; then unit_checks=$(( $(cat "$STUB_LOG.unit-checks" 2>/dev/null || printf 0) + 1 )); printf '%s' "$unit_checks" > "$STUB_LOG.unit-checks"; fi
    if [[ "\${STUB_FOREIGN_REPLACEMENT:-}" == unit ]] || [[ "\${STUB_POST_START_REPLACEMENT:-}" == unit && "$post_started" == 1 ]] || \
      [[ "\${STUB_POST_START_REPLACEMENT:-}" == unit-late && "$unit_checks" -ge 3 ]]; then printf 'Autopilot isolated %064d\\n' 8
    else sed -n 's/.*--property=Description=Autopilot isolated \\([a-f0-9]\\{64\\}\\).*/Autopilot isolated \\1/p' "$STUB_LOG" | tail -1; fi
    exit 0
  fi
  if [[ "$*" == *--property=ActiveState* ]]; then printf 'active\\n'; exit 0; fi
  case "$*" in
    *autopilot-cockpit-isolated-proxy.service*)
      if [[ "\${STUB_PROXY_UNIT_EXISTS:-0}" == 1 ]]; then printf 'loaded\\n'
      elif grep -q '^systemctl stop autopilot-cockpit-isolated-proxy.service$' "$STUB_LOG"; then printf 'not-found\\n'
      elif grep -q '^systemd-run --unit=autopilot-cockpit-isolated-proxy' "$STUB_LOG"; then printf 'loaded\\n'
      else printf 'not-found\\n'; fi ;;
    *autopilot-cockpit-isolated-control-plane.service*)
      if [[ "\${STUB_CONTROL_UNIT_EXISTS:-0}" == 1 ]]; then printf 'loaded\\n'
      elif grep -q '^systemctl stop autopilot-cockpit-isolated-control-plane.service$' "$STUB_LOG"; then printf 'not-found\\n'
      elif grep -q '^systemd-run --unit=autopilot-cockpit-isolated-control-plane' "$STUB_LOG"; then printf 'loaded\\n'
      else printf 'not-found\\n'; fi ;;
  esac
fi
`);
  writeExecutable(join(bin, "systemd-run"), `
printf 'systemd-run %s\\n' "$*" >> "$STUB_LOG"
if [[ "$*" == *autopilot-cockpit-isolated-control-plane* ]]; then
  [[ "\${STUB_CONTROL_START_FAIL:-0}" != 1 ]] || exit 1
fi
if [[ "$*" == *autopilot-cockpit-isolated-proxy* ]]; then
  [[ "\${STUB_PROXY_START_FAIL:-0}" != 1 ]] || exit 1
  for argument in "$@"; do
    case "$argument" in
      --setenv=XDG_DATA_HOME=*) data_home="\${argument#--setenv=XDG_DATA_HOME=}" ;;
    esac
  done
  mkdir -p "$data_home/caddy/pki/authorities/local"
  printf '%s\\n' '-----BEGIN CERTIFICATE-----' 'cHVibGljLW9ubHktdGVzdC1yb290' '-----END CERTIFICATE-----' > "$data_home/caddy/pki/authorities/local/root.crt"
  case "\${STUB_CA_PAYLOAD_MODE:-}" in
    private) printf '%s\\n' '-----BEGIN PRIVATE KEY-----' 'must-not-export' '-----END PRIVATE KEY-----' >> "$data_home/caddy/pki/authorities/local/root.crt" ;;
    appended-der) printf '\\060\\202\\001\\000' >> "$data_home/caddy/pki/authorities/local/root.crt" ;;
    arbitrary) printf '%s\\n' 'trailing arbitrary data' >> "$data_home/caddy/pki/authorities/local/root.crt" ;;
    multiple) printf '%s\\n' '-----BEGIN CERTIFICATE-----' 'c2Vjb25kLXJvb3Q=' '-----END CERTIFICATE-----' >> "$data_home/caddy/pki/authorities/local/root.crt" ;;
  esac
fi
`);
  writeExecutable(join(bin, "curl"), `
printf 'curl %s\\n' "$*" >> "$STUB_LOG"
[[ "$*" == *'--connect-timeout 2'* && "$*" == *'--max-time 5'* ]] || exit 92
if [[ "\${STUB_SIGNAL_ON_CURL:-}" == TERM ]]; then kill -TERM "$PPID"; sleep 1; fi
output=
while [[ $# -gt 0 ]]; do
  case "$1" in --output) output="$2"; shift 2 ;; *) shift ;; esac
done
if [[ -n "$output" && "$output" == */health.json ]]; then
  case "\${STUB_HEALTH_MODE:-healthy}" in
    healthy) printf '%s' '{"ok":true}' > "$output"; printf 200 ;;
    503) printf '{}' > "$output"; printf 503 ;;
    malformed) printf '{' > "$output"; printf 200 ;;
    wrong) printf '%s' '{"ok":false}' > "$output"; printf 200 ;;
  esac
elif [[ -n "$output" && "$output" == */ready.json ]]; then
  case "\${STUB_READY_MODE:-ready}" in
    ready) printf '%s' '{"ready":true,"components":{"configuration":{"status":"ready","error_code":null},"managed_state":{"status":"ready","error_code":null},"project_registry":{"status":"ready","error_code":null},"supervisor":{"status":"ready","error_code":null},"token_gateway":{"status":"ready","error_code":null}}}' > "$output"; printf 200 ;;
    503) printf '{}' > "$output"; printf 503 ;;
    malformed) printf '{' > "$output"; printf 200 ;;
    missing) printf '%s' '{"ready":true,"components":{"configuration":{"status":"ready","error_code":null}}}' > "$output"; printf 200 ;;
    not-ready) printf '%s' '{"ready":false,"components":{"configuration":{"status":"ready","error_code":null},"managed_state":{"status":"ready","error_code":null},"project_registry":{"status":"ready","error_code":null},"supervisor":{"status":"degraded","error_code":"degraded"},"token_gateway":{"status":"ready","error_code":null}}}' > "$output"; printf 200 ;;
    error-code) printf '%s' '{"ready":true,"components":{"configuration":{"status":"ready","error_code":"unexpected"},"managed_state":{"status":"ready","error_code":null},"project_registry":{"status":"ready","error_code":null},"supervisor":{"status":"ready","error_code":null},"token_gateway":{"status":"ready","error_code":null}}}' > "$output"; printf 200 ;;
  esac
fi
`);
  writeExecutable(join(bin, "openssl"), `
printf 'openssl %s\\n' "$*" >> "$STUB_LOG"
if [[ "\${1:-}" == rand ]]; then
  printf '%064d\\n' 0
elif [[ "$*" == *' -out '* ]]; then
  output=
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == -out ]]; then output="$2"; break; fi
    shift
  done
  printf '%s\\n' '-----BEGIN CERTIFICATE-----' 'bm9ybWFsaXplZC1wdWJsaWMtcm9vdA==' '-----END CERTIFICATE-----' > "$output"
elif [[ "$*" == *-fingerprint* ]]; then
  printf 'sha256 Fingerprint=AA:BB:CC:DD\\n'
fi
`);
  return { bin, log };
}

function prepareIsolatedRun() {
  const { checkout, sha } = makeCheckout();
  const releaseRoot = makeReleaseRoot();
  const node24ForStaging = join(makeTempDir(), "node24");
  writeExecutable(node24ForStaging, `
if [[ "\${1:-}" == --version ]]; then printf 'v24.0.0\\n'; else exec ${JSON.stringify(process.execPath)} "$@"; fi
`);
  expect(runStage(checkout, releaseRoot, node24ForStaging).status).toBe(0);
  const runtime = join(makeTempDir(), "isolated-runtime");
  const stubs = makeIsolatedStubs();
  const env = {
    ...process.env,
    PATH: `${stubs.bin}:${process.env.PATH ?? ""}`,
    STUB_LOG: stubs.log,
    AUTOPILOT_PROXY_TEST_MODE: "1",
  };
  return { checkout, sha, releaseRoot, runtime, stubs, env };
}

function runIsolated(
  prepared: ReturnType<typeof prepareIsolatedRun>,
  extraEnv: NodeJS.ProcessEnv = {},
) {
  return spawnSync(
    "bash",
    [isolatedAcceptance, prepared.checkout, prepared.releaseRoot, prepared.runtime],
    { encoding: "utf8", env: { ...prepared.env, ...extraEnv } },
  );
}

describe("Cockpit isolated proxy acceptance", () => {
  it("starts the isolated firewall before Caddy and retains services until explicit cleanup", () => {
    const prepared = prepareIsolatedRun();

    const result = runIsolated(prepared);

    if (result.status !== 0) {
      throw new Error(`${result.stderr}\n${existsSync(prepared.stubs.log) ? readFileSync(prepared.stubs.log, "utf8") : "missing stub log"}`);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PUBLIC_CA_PATH=");
    expect(result.stdout).toContain("PUBLIC_CA_SHA256_FINGERPRINT=AA:BB:CC:DD");
    expect(result.stdout).toContain("ISOLATED_ACCEPTANCE_READY");
    expect(`${result.stdout}${result.stderr}`).not.toContain("isolated-test-token");
    expect(`${result.stdout}${result.stderr}`).not.toContain("PRIVATE KEY");
    const log = readFileSync(prepared.stubs.log, "utf8");
    expect(log.indexOf("nft add table inet autopilot_cockpit_isolated"))
      .toBeLessThan(log.indexOf("systemd-run --unit=autopilot-cockpit-isolated-proxy"));
    expect(log).not.toContain("systemctl stop");
    expect(log).not.toContain("nft delete table");
    expect(statSync(join(prepared.runtime, "state")).mode & 0o777).toBe(0o700);
    expect(statSync(join(prepared.runtime, "projects")).mode & 0o777).toBe(0o700);
    expect(statSync(join(prepared.runtime, "control-plane.env")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(prepared.runtime, "control-plane.env"), "utf8"))
      .toContain("CONTROL_PLANE_SECURE_COOKIES=true");
    const isolatedCaddyfile = readFileSync(join(prepared.runtime, "Caddyfile"), "utf8");
    expect(isolatedCaddyfile).toContain("@api path /auth /auth/*");
    expect(isolatedCaddyfile).not.toMatch(/@api path .*\/health/);
    expect(readFileSync(join(prepared.runtime, "autopilot-caddy-root.crt"), "utf8"))
      .not.toContain("PRIVATE KEY");

    const cleanup = spawnSync("bash", [isolatedAcceptance, "--cleanup", prepared.runtime], {
      encoding: "utf8",
      env: prepared.env,
    });
    expect(cleanup.status).toBe(0);
    const cleanedLog = readFileSync(prepared.stubs.log, "utf8");
    expect(cleanedLog).toContain("systemctl stop autopilot-cockpit-isolated-proxy.service");
    expect(cleanedLog).toContain("systemctl stop autopilot-cockpit-isolated-control-plane.service");
    expect(cleanedLog).toContain("nft delete table inet autopilot_cockpit_isolated");
    expect(existsSync(prepared.runtime)).toBe(false);
    expect(spawnSync("bash", [isolatedAcceptance, "--cleanup", prepared.runtime], {
      encoding: "utf8",
      env: prepared.env,
    }).status).toBe(0);
  });

  it.each([
    ["Caddy validation", { STUB_CADDY_VALIDATE_FAIL: "1" }, []],
    ["Control Plane startup", { STUB_CONTROL_START_FAIL: "1" }, ["control", "nft"]],
    ["proxy startup", { STUB_PROXY_START_FAIL: "1" }, ["proxy", "control", "nft"]],
    ["private-key contaminated CA export", { STUB_CA_PAYLOAD_MODE: "private" }, ["proxy", "control", "nft"]],
    ["CA export with appended DER", { STUB_CA_PAYLOAD_MODE: "appended-der" }, ["proxy", "control", "nft"]],
    ["CA export with trailing arbitrary data", { STUB_CA_PAYLOAD_MODE: "arbitrary" }, ["proxy", "control", "nft"]],
    ["CA export with multiple PEM objects", { STUB_CA_PAYLOAD_MODE: "multiple" }, ["proxy", "control", "nft"]],
  ])("cleans every owned isolated mutation after %s fails", (_label, failureEnv, expectedCleanup) => {
    const prepared = prepareIsolatedRun();
    const cleanupNames = expectedCleanup as string[];

    const result = runIsolated(prepared, failureEnv);

    expect(result.status).not.toBe(0);
    const log = readFileSync(prepared.stubs.log, "utf8");
    expect(log.includes("systemctl stop autopilot-cockpit-isolated-proxy.service")).toBe(cleanupNames.includes("proxy"));
    expect(log.includes("systemctl stop autopilot-cockpit-isolated-control-plane.service")).toBe(cleanupNames.includes("control"));
    expect(log.includes("nft delete table inet autopilot_cockpit_isolated")).toBe(cleanupNames.includes("nft"));
    expect(log).not.toMatch(/nft delete table (?!inet autopilot_cockpit_isolated)/);
    expect(existsSync(prepared.runtime)).toBe(false);
    expect(`${result.stdout}${result.stderr}`).not.toContain("isolated-test-token");
  });

  it("cleans and terminates without readiness output when signalled", () => {
    const prepared = prepareIsolatedRun();

    const result = runIsolated(prepared, { STUB_SIGNAL_ON_CURL: "TERM" });

    expect(result.status).toBe(143);
    expect(result.stdout).not.toContain("ISOLATED_ACCEPTANCE_READY");
    expect(existsSync(prepared.runtime)).toBe(false);
    const log = readFileSync(prepared.stubs.log, "utf8");
    expect(log).toContain("systemctl stop autopilot-cockpit-isolated-proxy.service");
    expect(log).toContain("nft delete table inet autopilot_cockpit_isolated");
  });

  it("reports cleanup failure when an isolated listener remains", () => {
    const prepared = prepareIsolatedRun();
    expect(runIsolated(prepared).status).toBe(0);

    const cleanup = spawnSync("bash", [isolatedAcceptance, "--cleanup", prepared.runtime], {
      encoding: "utf8",
      env: { ...prepared.env, STUB_CLEANUP_OCCUPIED: "1" },
    });

    expect(cleanup.status).not.toBe(0);
    expect(existsSync(prepared.runtime)).toBe(true);
  });

  it("atomically refuses a runtime symlink race without changing the foreign target", () => {
    const prepared = prepareIsolatedRun();
    const foreign = join(makeTempDir(), "foreign-runtime");
    mkdirSync(foreign, { mode: 0o711 });
    const before = statSync(foreign);

    const result = runIsolated(prepared, {
      STUB_RACE_RUNTIME: prepared.runtime,
      STUB_RACE_TARGET: foreign,
    });

    expect(result.status).not.toBe(0);
    expect(statSync(foreign).mode & 0o777).toBe(before.mode & 0o777);
    expect(statSync(foreign).uid).toBe(before.uid);
    expect(statSync(foreign).gid).toBe(before.gid);
    const log = readFileSync(prepared.stubs.log, "utf8");
    expect(log).not.toContain("nft add table");
    expect(log).not.toContain("systemd-run");
  });

  it.each(["runtime-symlink", "bad-marker-mode"])(
    "refuses explicit cleanup with malicious ownership evidence: %s",
    (variant) => {
      const prepared = prepareIsolatedRun();
      const foreign = join(makeTempDir(), "foreign-runtime");
      mkdirSync(foreign, { mode: 0o755 });
      writeFileSync(join(foreign, ".autopilot-cockpit-isolated-owned"), "autopilot-cockpit-isolated-v1\n", { mode: 0o600 });
      if (variant === "runtime-symlink") {
        symlinkSync(foreign, prepared.runtime);
      } else {
        mkdirSync(prepared.runtime, { mode: 0o755 });
        writeFileSync(join(prepared.runtime, ".autopilot-cockpit-isolated-owned"), "autopilot-cockpit-isolated-v1\n", { mode: 0o644 });
      }

      const result = spawnSync("bash", [isolatedAcceptance, "--cleanup", prepared.runtime], {
        encoding: "utf8",
        env: prepared.env,
      });

      expect(result.status).not.toBe(0);
      expect(existsSync(prepared.stubs.log)).toBe(false);
      expect(existsSync(prepared.runtime)).toBe(true);
    },
  );

  it("refuses to mutate orphaned isolated resources when runtime evidence is missing", () => {
    const prepared = prepareIsolatedRun();

    const result = spawnSync("bash", [isolatedAcceptance, "--cleanup", prepared.runtime], {
      encoding: "utf8",
      env: { ...prepared.env, STUB_TABLE_EXISTS: "1" },
    });

    expect(result.status).not.toBe(0);
    const log = readFileSync(prepared.stubs.log, "utf8");
    expect(log).not.toContain("systemctl stop");
    expect(log).not.toContain("nft delete table");
  });

  it.each([
    ["occupied port 8443", { STUB_OCCUPIED_PORT: "8443" }],
    ["occupied port 8877", { STUB_OCCUPIED_PORT: "8877" }],
    ["pre-existing table", { STUB_TABLE_EXISTS: "1" }],
    ["pre-existing proxy transient unit", { STUB_PROXY_UNIT_EXISTS: "1" }],
    ["pre-existing Control Plane transient unit", { STUB_CONTROL_UNIT_EXISTS: "1" }],
  ])("refuses a pre-existing isolated resource before mutation: %s", (_label, extraEnv) => {
    const prepared = prepareIsolatedRun();

    const result = runIsolated(prepared, extraEnv);

    expect(result.status).not.toBe(0);
    const log = readFileSync(prepared.stubs.log, "utf8");
    expect(log).not.toContain("nft add table");
    expect(log).not.toContain("systemd-run");
    expect(log).not.toContain("systemctl stop");
    expect(log).not.toContain("nft delete table");
  });

  it.each([
    ["socket inspection error", { STUB_SS_FAIL: "1" }],
    ["nftables inspection error", { STUB_NFT_INSPECT_FAIL: "1" }],
    ["systemd inspection error", { STUB_SYSTEMCTL_INSPECT_FAIL: "1" }],
  ])("fails closed before mutation on %s", (_label, extraEnv) => {
    const prepared = prepareIsolatedRun();
    const result = runIsolated(prepared, extraEnv);
    expect(result.status).not.toBe(0);
    const log = readFileSync(prepared.stubs.log, "utf8");
    expect(log).not.toContain("nft add table");
    expect(log).not.toContain("systemd-run");
  });

  it.each([
    ["socket", { STUB_SS_FAIL: "1" }],
    ["nftables", { STUB_NFT_INSPECT_FAIL: "1" }],
    ["systemd", { STUB_SYSTEMCTL_INSPECT_FAIL: "1" }],
  ])("preserves cleanup evidence without mutation on %s inspection failure", (_label, extraEnv) => {
    const prepared = prepareIsolatedRun();
    expect(runIsolated(prepared).status).toBe(0);
    const before = readFileSync(prepared.stubs.log, "utf8");
    const cleanup = spawnSync("bash", [isolatedAcceptance, "--cleanup", prepared.runtime], {
      encoding: "utf8", env: { ...prepared.env, ...extraEnv },
    });
    expect(cleanup.status).not.toBe(0);
    expect(existsSync(prepared.runtime)).toBe(true);
    const added = readFileSync(prepared.stubs.log, "utf8").slice(before.length);
    expect(added).not.toContain("systemctl stop");
    expect(added).not.toContain("nft delete table");
  });

  it.each(["unit", "nft"])("preserves evidence and refuses foreign %s replacement during cleanup", (kind) => {
    const prepared = prepareIsolatedRun();
    expect(runIsolated(prepared).status).toBe(0);
    const before = readFileSync(prepared.stubs.log, "utf8");
    const cleanup = spawnSync("bash", [isolatedAcceptance, "--cleanup", prepared.runtime], {
      encoding: "utf8",
      env: { ...prepared.env, STUB_FOREIGN_REPLACEMENT: kind },
    });
    expect(cleanup.status).not.toBe(0);
    expect(existsSync(prepared.runtime)).toBe(true);
    const added = readFileSync(prepared.stubs.log, "utf8").slice(before.length);
    if (kind === "unit") expect(added).not.toContain("systemctl stop");
    if (kind === "nft") expect(added).not.toContain("nft delete table");
  });

  it.each(["unit", "nft", "unit-late", "nft-late"])("fails closed when %s identity is replaced after startup", (kind) => {
    const prepared = prepareIsolatedRun();

    const result = runIsolated(prepared, { STUB_POST_START_REPLACEMENT: kind });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("ISOLATED_ACCEPTANCE_READY");
    expect(existsSync(prepared.runtime)).toBe(true);
    const log = readFileSync(prepared.stubs.log, "utf8");
    expect(log).not.toContain("systemctl stop");
    expect(log).not.toContain("nft delete table");
    expect(readFileSync(join(prepared.runtime, ".autopilot-cockpit-isolated-owned"), "utf8"))
      .toContain("nonce=");
  });

  it.each(["unit", "nft"])("does not take over a foreign %s that wins the create race", (kind) => {
    const prepared = prepareIsolatedRun();
    const result = runIsolated(prepared, kind === "unit"
      ? { STUB_CONTROL_START_FAIL: "1", STUB_FOREIGN_REPLACEMENT: "unit" }
      : { STUB_NFT_CREATE_RACE: "1", STUB_FOREIGN_REPLACEMENT: "nft" });
    expect(result.status).not.toBe(0);
    expect(existsSync(prepared.runtime)).toBe(true);
    const log = readFileSync(prepared.stubs.log, "utf8");
    if (kind === "unit") expect(log).not.toContain("systemctl stop");
    if (kind === "nft") expect(log).not.toContain("nft delete table");
  });

  it.each(["503", "malformed", "missing", "not-ready", "error-code"])("does not announce READY for %s /ready state", (mode) => {
    const prepared = prepareIsolatedRun();
    const result = runIsolated(prepared, { STUB_READY_MODE: mode });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("ISOLATED_ACCEPTANCE_READY");
  });

  it.each(["503", "malformed", "wrong"])("does not announce READY for %s /health state", (mode) => {
    const prepared = prepareIsolatedRun();
    const result = runIsolated(prepared, { STUB_HEALTH_MODE: mode });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("ISOLATED_ACCEPTANCE_READY");
  });

  it("refuses cleanup of an unowned runtime without touching isolated resources", () => {
    const prepared = prepareIsolatedRun();
    mkdirSync(prepared.runtime);
    writeFileSync(join(prepared.runtime, "sentinel"), "owned elsewhere\n");

    const result = spawnSync("bash", [isolatedAcceptance, "--cleanup", prepared.runtime], {
      encoding: "utf8",
      env: prepared.env,
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(prepared.runtime, "sentinel"), "utf8")).toBe("owned elsewhere\n");
    expect(existsSync(prepared.stubs.log)).toBe(false);
  });

  it("refuses a staged release whose topology no longer matches the exact candidate", () => {
    const prepared = prepareIsolatedRun();
    const release = join(prepared.releaseRoot, "releases", prepared.sha);
    chmodSync(release, 0o755);
    writeFileSync(join(release, "injected.txt"), "not staged\n");
    chmodSync(join(release, "injected.txt"), 0o444);
    chmodSync(release, 0o555);

    const result = runIsolated(prepared);

    expect(result.status).not.toBe(0);
    expect(existsSync(prepared.runtime)).toBe(false);
    expect(existsSync(prepared.stubs.log)).toBe(false);
  });

  it("rejects changed candidate content with identical release topology before mutation", () => {
    const prepared = prepareIsolatedRun();
    const candidateIndex = join(prepared.checkout, "cockpit", "dist", "index.html");
    git(prepared.checkout, "update-index", "--assume-unchanged", "cockpit/dist/index.html");
    writeFileSync(candidateIndex, "candidate content changed after staging\n");
    expect(git(prepared.checkout, "status", "--porcelain")).toBe("");

    const result = runIsolated(prepared);

    expect(result.status).not.toBe(0);
    expect(existsSync(prepared.runtime)).toBe(false);
    expect(existsSync(prepared.stubs.log)).toBe(false);
  });

  it("defines an isolated trusted-origin browser test with artifact capture disabled", () => {
    const config = readFileSync(join(process.cwd(), "playwright.proxy.config.ts"), "utf8");
    const spec = readFileSync(join(process.cwd(), "tests", "browser-proxy", "cockpit-proxy.spec.ts"), "utf8");

    expect(config).toContain("ignoreHTTPSErrors: false");
    expect(config).toMatch(/trace:\s*["']off["']/);
    expect(config).toMatch(/video:\s*["']off["']/);
    expect(config).toMatch(/screenshot:\s*["']off["']/);
    expect(config).not.toContain("webServer");
    expect(spec).toContain('await page.goto("/")');
    expect(spec).toContain('getByLabel("Control Plane token")');
    expect(spec).toContain('getByRole("button", { name: "Přihlásit" })');
    expect(spec).toContain('getByRole("heading", { name: "Hybrid Cockpit" })');
    expect(spec).toContain('performance.getEntriesByType("resource")');
  });
});

function runHostAcceptance(extraEnv: NodeJS.ProcessEnv = {}) {
  const root = makeTempDir();
  const bin = join(root, "bin");
  const log = join(root, "host.log");
  const home = join(root, "home");
  mkdirSync(bin);
  mkdirSync(home);
  writeFileSync(join(home, ".curlrc"), "--insecure\n--proxy https://evil.example\n");
  writeExecutable(join(bin, "openssl"), `
printf 'openssl %s\\n' "$*" >> "$STUB_LOG"
if [[ "\${1:-}" == s_client ]]; then printf '%s\\n' 'test certificate'; fi
if [[ "\${1:-}" == x509 ]]; then cat >/dev/null; fi
`);
  writeExecutable(join(bin, "npx"), `
[[ "\${AUTOPILOT_PROXY_TEST_TOKEN:-}" == behavioral-secret ]]
[[ "\${1:-}" == --no-install ]]
if [[ "\${STUB_NPX_IGNORE_TERM:-0}" == 1 ]]; then trap '' TERM; while :; do :; done; fi
printf 'playwright trusted-origin\\n' >> "$STUB_LOG"
`);
  writeExecutable(join(bin, "curl"), `
printf 'curl %s\\n' "$*" >> "$STUB_LOG"
[[ "\${1:-}" == --disable && "\${2:-}" == --noproxy && "\${3:-}" == '*' ]] || exit 90
[[ "$*" == *'--connect-timeout 2'* && "$*" == *'--max-time 5'* ]] || exit 92
[[ -z "\${http_proxy:-}\${https_proxy:-}\${HTTP_PROXY:-}\${HTTPS_PROXY:-}\${ALL_PROXY:-}\${all_proxy:-}\${CURL_CA_BUNDLE:-}\${SSL_CERT_FILE:-}\${SSL_CERT_DIR:-}" ]] || exit 91
headers= body= method=GET cookie_jar=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump-header) headers="$2"; shift 2 ;;
    --output) body="$2"; shift 2 ;;
    --request) method="$2"; shift 2 ;;
    --cookie-jar) cookie_jar="$2"; shift 2 ;;
    --write-out|--header|--data-binary|--cookie|--noproxy) shift 2 ;;
    --disable|--silent|--show-error) shift ;;
    *) url="$1"; shift ;;
  esac
done
[[ -z "$cookie_jar" ]] || printf 'cookie-mode %s\\n' "$(stat -c %a "$cookie_jar")" >> "$STUB_LOG"
name="$(basename "$headers" .headers)"
full_csp="default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
case "$name" in
  root|spa|lookalike-*)
    [[ "\${STUB_INCOMPLETE_CSP:-0}" != 1 ]] || full_csp="default-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
    printf '%s\\n' 'HTTP/2 200' "Content-Security-Policy: $full_csp" 'X-Content-Type-Options: nosniff' 'Referrer-Policy: no-referrer' 'Strict-Transport-Security: max-age=300' 'Cache-Control: no-cache' > "$headers"
    printf '%s\\n' '<!doctype html><script src="/assets/app.js"></script>' > "$body"
    printf 200 ;;
  asset)
    printf '%s\\n' 'HTTP/2 200' 'Cache-Control: public, max-age=31536000, immutable' > "$headers"
    printf app > "$body"; printf 200 ;;
  unauthenticated-api)
    printf '%s\\n' 'HTTP/2 401' 'Cache-Control: no-store' > "$headers"
    printf unauthorized > "$body"; printf 401 ;;
  unsupported)
    if [[ "\${STUB_UNSUPPORTED_API_SHAPED:-0}" == 1 ]]; then
      printf '%s\\n' 'HTTP/2 405' 'Cache-Control: no-store' 'Content-Type: application/json' > "$headers"
    else
      printf '%s\\n' 'HTTP/2 405' 'Cache-Control: no-cache' 'Content-Type: text/plain; charset=utf-8' > "$headers"
    fi
    printf method > "$body"; printf 405 ;;
  login)
    case "\${STUB_COOKIE_VARIANT:-valid}" in
      valid) cookie='autopilot_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; HttpOnly; SameSite=Lax; Path=/; Secure' ;;
      empty) cookie='autopilot_session=; HttpOnly; SameSite=Lax; Secure' ;;
      secure-value) cookie='autopilot_session=session-value; HttpOnly; SameSite=Lax; Secure=0' ;;
      httponly-value) cookie='autopilot_session=session-value; HttpOnly=no; SameSite=Lax; Secure' ;;
      lax-prefix) cookie='autopilot_session=session-value; HttpOnly; SameSite=Laxevil; Secure' ;;
      duplicate-secure) cookie='autopilot_session=session-value; HttpOnly; SameSite=Lax; Secure; Secure' ;;
      comma-joined) cookie='autopilot_session=session-value; HttpOnly; SameSite=Lax; Secure, autopilot_session=shadow; HttpOnly; SameSite=Lax; Secure' ;;
      invalid-length) cookie='autopilot_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; HttpOnly; SameSite=Lax; Secure' ;;
      invalid-char) cookie='autopilot_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA!; HttpOnly; SameSite=Lax; Secure' ;;
    esac
    printf '%s\\n' 'HTTP/2 200' "Set-Cookie: $cookie" > "$headers"
    [[ "\${STUB_MULTI_SESSION_COOKIE:-0}" != 1 ]] || printf '%s\\n' 'Set-Cookie: autopilot_session=shadow; Path=/' >> "$headers"
    printf authenticated > "$body"; printf 200 ;;
  session|status|api-*)
    printf '%s\\n' 'HTTP/2 200' 'Cache-Control: no-store' > "$headers"
    printf authenticated > "$body"; printf 200 ;;
  evil-origin|evil-referer)
    printf '%s\\n' 'HTTP/2 403' > "$headers"; printf csrf > "$body"; printf 403 ;;
  logout)
    printf '%s\\n' 'HTTP/2 200' > "$headers"; printf logout > "$body"; printf 200 ;;
  logged-out)
    printf '%s\\n' 'HTTP/2 401' > "$headers"; printf logged-out > "$body"; printf 401 ;;
esac
`);

  const outerTimeout = extraEnv.TEST_OUTER_TIMEOUT_SECONDS;
  const command = outerTimeout ? "/usr/bin/timeout" : "bash";
  const args = outerTimeout ? ["--signal=KILL", `${outerTimeout}s`, "bash", hostAcceptance] : [hostAcceptance];
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: home,
      STUB_LOG: log,
      http_proxy: "http://evil.example",
      HTTPS_PROXY: "http://evil.example",
      ALL_PROXY: "socks5://evil.example",
      CURL_CA_BUNDLE: join(root, "evil-ca.pem"),
      SSL_CERT_FILE: join(root, "evil-cert.pem"),
      SSL_CERT_DIR: join(root, "evil-certs"),
      AUTOPILOT_PROXY_BASE_URL: "https://autopilot.local:8443",
      AUTOPILOT_PROXY_TOKEN_COMMAND: extraEnv.TEST_TOKEN_COMMAND ?? "printf %s behavioral-secret",
    },
  });
  return { result, log };
}

describe("Cockpit trusted host acceptance", () => {
  it("keeps token, cookies, TLS verification, and cleanup boundaries explicit", () => {
    const source = readFileSync(hostAcceptance, "utf8");

    expect(source).toContain("AUTOPILOT_PROXY_TOKEN_COMMAND");
    expect(source).toContain("AUTOPILOT_PROXY_BASE_URL");
    expect(source).toMatch(/chmod 600 .*cookie/);
    expect(source).toMatch(/unset token/);
    expect(source).toContain("openssl s_client");
    expect(source).toContain("-verify_return_error");
    expect(source).toContain("-checkhost autopilot.local");
    expect(source).not.toMatch(/(?:^|\s)(?:-k|--insecure)(?:\s|$)/m);
    expect(source).not.toMatch(/set\s+-[^\n]*x/);
    expect(source).toContain("HOST_PROXY_ACCEPTANCE_OK");
    expect(source).toContain("--connect-timeout 2");
    expect(source).toContain("--max-time 5");
    expect(source).toContain("npx --no-install playwright");
    const isolatedSource = readFileSync(isolatedAcceptance, "utf8");
    const timeoutWrappers = `${source}\n${isolatedSource}`.split("\n")
      .filter((line) => /\btimeout\b/.test(line) && !line.includes("--connect-timeout"));
    expect(timeoutWrappers).toHaveLength(7);
    expect(timeoutWrappers.every((line) => /timeout --signal=TERM --kill-after=/.test(line))).toBe(true);
  });

  it("accepts trusted responses without exposing the token or weakening TLS", () => {
    const { result, log } = runHostAcceptance();

    if (result.status !== 0) throw new Error(`${result.stderr}\n${readFileSync(log, "utf8")}`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("HOST_PROXY_ACCEPTANCE_OK");
    expect(`${result.stdout}${result.stderr}`).not.toContain("behavioral-secret");
    const commands = readFileSync(log, "utf8");
    expect(commands).toContain("openssl s_client");
    expect(commands).toContain("-verify_return_error");
    expect(commands).toContain("openssl x509 -noout -checkhost autopilot.local");
    expect(commands).toContain("cookie-mode 600");
    expect(commands).toContain("playwright trusted-origin");
    expect(commands).toContain("evil-referer.headers");
    expect(commands).not.toContain("behavioral-secret");
    expect(commands).not.toMatch(/(?:^|\s)(?:-k|--insecure)(?:\s|$)/m);
  });

  it.each([
    ["multiple autopilot session cookies", { STUB_MULTI_SESSION_COOKIE: "1" }],
    ["an empty session value", { STUB_COOKIE_VARIANT: "empty" }],
    ["Secure=0 instead of a bare Secure token", { STUB_COOKIE_VARIANT: "secure-value" }],
    ["HttpOnly=no instead of a bare HttpOnly token", { STUB_COOKIE_VARIANT: "httponly-value" }],
    ["a SameSite=Lax prefix match", { STUB_COOKIE_VARIANT: "lax-prefix" }],
    ["a duplicate Secure attribute", { STUB_COOKIE_VARIANT: "duplicate-secure" }],
    ["a comma-joined second session cookie", { STUB_COOKIE_VARIANT: "comma-joined" }],
    ["a non-43-character session token", { STUB_COOKIE_VARIANT: "invalid-length" }],
    ["a non-base64url session token", { STUB_COOKIE_VARIANT: "invalid-char" }],
    ["API-shaped unsupported lookalike POST", { STUB_UNSUPPORTED_API_SHAPED: "1" }],
    ["incomplete Content-Security-Policy", { STUB_INCOMPLETE_CSP: "1" }],
  ])("rejects %s", (_label, extraEnv) => {
    expect(runHostAcceptance(extraEnv).result.status).not.toBe(0);
  });

  it.each([
    ["an extra blank token line", "printf 'behavioral-secret\\n\\n'"],
    ["a NUL byte in token stdout", "printf 'behavioral\\0secret'"],
  ])("rejects %s", (_label, command) => {
    const { result, log } = runHostAcceptance({ TEST_TOKEN_COMMAND: command });
    expect(result.status).not.toBe(0);
    expect(readFileSync(log, "utf8")).not.toContain("login.headers");
  });
  it("hard-kills a token command that ignores TERM", () => {
    const started = Date.now();
    const { result, log } = runHostAcceptance({
      AUTOPILOT_PROXY_TEST_MODE: "1",
      AUTOPILOT_PROXY_TEST_TOKEN_TIMEOUT: "1s",
      AUTOPILOT_PROXY_TEST_TOKEN_KILL_AFTER: "1s",
      TEST_OUTER_TIMEOUT_SECONDS: "4",
      TEST_TOKEN_COMMAND: "trap '' TERM; while :; do :; done",
    });

    expect(result.status).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(3500);
    expect(readFileSync(log, "utf8")).not.toContain("login.headers");
  });

  it("hard-kills Playwright when its runner ignores TERM", () => {
    const started = Date.now();
    const { result } = runHostAcceptance({
      AUTOPILOT_PROXY_TEST_MODE: "1",
      AUTOPILOT_PROXY_TEST_PLAYWRIGHT_TIMEOUT: "1s",
      AUTOPILOT_PROXY_TEST_PLAYWRIGHT_KILL_AFTER: "1s",
      TEST_OUTER_TIMEOUT_SECONDS: "4",
      STUB_NPX_IGNORE_TERM: "1",
    });

    expect(result.status).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(3500);
    expect(result.stdout).not.toContain("HOST_PROXY_ACCEPTANCE_OK");
  });

});

type CutoverFixture = ReturnType<typeof prepareCutover>;

function stubExecutable(directory: string, name: string, source: string): void {
  const path = join(directory, name);
  writeFileSync(path, `#!/usr/bin/env bash\nset -Eeuo pipefail\n${source}\n`);
  chmodSync(path, 0o755);
}

function prepareCutover(options: { finalNewline?: boolean; secureLine?: string; runtimeMask?: boolean } = {}): {
  root: string;
  checkout: string;
  releaseRoot: string;
  sha: string;
  envPath: string;
  currentPath: string;
  evidencePath: string;
  caddyConfigPath: string;
  persistentMaskPath: string;
  runtimeMaskPath: string;
  packageCaddyUnitPath: string;
  previousTarget: string;
  previousEnvironment: Buffer;
  stubLog: string;
  stubDir: string;
  env: NodeJS.ProcessEnv;
} {
  const { checkout } = makeCheckout();
  mkdirSync(join(checkout, "ops", "cockpit-proxy"), { recursive: true });
  for (const name of ["Caddyfile", "autopilot-cockpit.nft", "autopilot-cockpit-firewall.service", "autopilot-cockpit-firewall.sh", "caddy-autopilot.conf", "autopilot-cockpit-cutover-recovery.service", "autopilot-cockpit-cutover-recovery.timer", "autopilot-cockpit-recovery-verify.sh", "autopilot-cockpit-recovery-smoke.mjs"]) {
    writeFileSync(join(checkout, "ops", "cockpit-proxy", name), readFileSync(join(process.cwd(), "ops", "cockpit-proxy", name)));
  }
  git(checkout, "add", ".");
  git(checkout, "commit", "-qm", "add reviewed proxy config");
  const sha = git(checkout, "rev-parse", "HEAD");
  const releaseRoot = makeReleaseRoot();
  const fakeNode24 = join(makeTempDir(), "node");
  writeFileSync(fakeNode24, `#!/usr/bin/env bash\nif [[ "\${1:-}" == --version ]]; then printf 'v24.0.0\\n'; else exec ${JSON.stringify(process.execPath)} "$@"; fi\n`);
  chmodSync(fakeNode24, 0o755);
  const staged = runStage(checkout, releaseRoot, fakeNode24);
  if (staged.status !== 0) throw new Error(`stage fixture failed: ${staged.stdout}\n${staged.stderr}`);

  const root = join(makeTempDir(), "fake-root");
  mkdirSync(join(root, "run"), { recursive: true });
  const envPath = join(root, "home", "radek", ".config", "autopilot", "control-plane.env");
  const currentPath = join(releaseRoot, "current");
  mkdirSync(dirname(envPath), { recursive: true });
  const environmentText = `CONTROL_PLANE_TOKEN=secret-do-not-print\n${options.secureLine ?? "CONTROL_PLANE_SECURE_COOKIES=false"}\nAUTOPILOT_STATE_DIR=/state\nAUTOPILOT_PROJECTS_DIR=/projects${options.finalNewline === false ? "" : "\n"}`;
  const previousEnvironment = Buffer.from(environmentText);
  writeFileSync(envPath, previousEnvironment, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  const previousTarget = `releases/${"1".repeat(40)}`;
  mkdirSync(join(releaseRoot, previousTarget), { recursive: true });
  symlinkSync(previousTarget, currentPath);
  const evidencePath = join(root, "var", "lib", "autopilot-cockpit", "isolated-acceptance", `${sha}.ok`);
  mkdirSync(dirname(evidencePath), { recursive: true });
  chmodSync(join(root, "var", "lib", "autopilot-cockpit"), 0o755);
  writeFileSync(evidencePath, `sha=${sha}\nhost_acceptance=ok\ncleanup=ok\n`, { mode: 0o600 });
  chmodSync(evidencePath, 0o600);
  const stubDir = join(makeTempDir(), "bin");
  mkdirSync(stubDir);
  const stubLog = join(makeTempDir(), "events.log");
  writeFileSync(stubLog, "");
  const caddyConfigPath = join(root, "etc", "caddy", "Caddyfile");
  mkdirSync(dirname(caddyConfigPath), { recursive: true });
  chmodSync(dirname(caddyConfigPath), 0o755);
  const persistentMaskPath = join(root, "etc", "systemd", "system", "caddy.service");
  const runtimeMaskPath = join(root, "run", "systemd", "system", "caddy.service");
  const packageCaddyUnitPath = join(root, "usr", "lib", "systemd", "system", "caddy.service");
  mkdirSync(dirname(packageCaddyUnitPath), { recursive: true });
  writeFileSync(packageCaddyUnitPath, "[Service]\nExecStart=/usr/bin/caddy run\n", { mode: 0o644 });
  const recoveryProgramPath = join(root, "usr", "local", "libexec", "autopilot-cockpit-live-cutover");
  mkdirSync(dirname(recoveryProgramPath), { recursive: true });
  writeFileSync(recoveryProgramPath, readFileSync(liveCutover), { mode: 0o755 });
  mkdirSync(join(root, "etc", "systemd", "system"), { recursive: true });
  for (const name of ["autopilot-cockpit-cutover-recovery.service", "autopilot-cockpit-cutover-recovery.timer"]) {
    writeFileSync(join(root, "etc", "systemd", "system", name), readFileSync(join(process.cwd(), "ops", "cockpit-proxy", name)), { mode: 0o644 });
  }
  mkdirSync(join(root, "etc", "systemd", "system", "timers.target.wants"), { recursive: true });
  symlinkSync("../autopilot-cockpit-cutover-recovery.timer", join(root, "etc", "systemd", "system", "timers.target.wants", "autopilot-cockpit-cutover-recovery.timer"));
  const maskPath = options.runtimeMask ? runtimeMaskPath : persistentMaskPath;
  mkdirSync(join(root, "etc", "systemd", "system"), { recursive: true });
  mkdirSync(dirname(maskPath), { recursive: true });
  chmodSync(join(root, "etc", "systemd", "system"), 0o755);
  symlinkSync("/dev/null", maskPath);
  const log = 'printf "%s\\n" "' + '${0##*/}' + ':$*" >> "$STUB_LOG"';
  stubExecutable(stubDir, "setpriv", `${log}\nexport AUTOPILOT_PRIVDROP_ACTIVE=1\nwhile (($#)); do [[ "$1" == -- ]] && { shift; break; }; shift; done\nexec "$@"`);
  stubExecutable(stubDir, "ss", `${log}\n[[ -n "\${STUB_SS_ERROR_PORT:-}" && "$*" == *":$STUB_SS_ERROR_PORT"* ]] && exit 2\nif [[ "$*" == *":8787"* ]]; then printf 'LISTEN 0 511 127.0.0.1:8787 0.0.0.0:*\\n'; exit 0; fi\ncase "\${STUB_OCCUPIED_PORT:-}" in 80|443|8443|8877) [[ "$*" == *":$STUB_OCCUPIED_PORT"* ]] && printf 'LISTEN occupied\\n'; exit 0 ;; esac\nif grep -q '^systemctl:start caddy.service$' "$STUB_LOG" && { [[ "\${STUB_CADDY_SURVIVES_STOP:-0}" == 1 ]] || ! grep -q '^systemctl:stop caddy.service$' "$STUB_LOG"; }; then case "$*" in *':80'*) printf 'LISTEN 0 511 192.168.122.99:80 0.0.0.0:*\\n' ;; *':443'*) printf 'LISTEN 0 511 192.168.122.99:443 0.0.0.0:*\\n' ;; esac; fi`);
  stubExecutable(stubDir, "dpkg", `${log}\n[[ "$1" == -s && "$2" == caddy ]] && exit 0\nif [[ "$1" == -V && "$2" == caddy ]]; then [[ "\${STUB_DPKG_VERIFY_ERROR:-0}" == 1 ]] && exit 2; [[ "\${STUB_DPKG_VERIFY_OUTPUT:-0}" == 1 ]] && printf '??5?????? c /etc/caddy/Caddyfile\\n'; exit 0; fi\nexit 1`);
  stubExecutable(stubDir, "caddy", `${log}\n[[ "$1" == validate ]]`);
  stubExecutable(stubDir, "systemd-run", `${log}\nexit 0`);
  stubExecutable(stubDir, "nft", `${log}\nstate="$STUB_NFT_STATE"\nif [[ "$*" == --check* ]]; then [[ "\${STUB_NFT_CHECK_ERROR:-0}" == 1 ]] && exit 1; exit 0; fi\nif [[ "$*" == '-j list tables' ]]; then [[ "\${STUB_NFT_INSPECTION_ERROR:-0}" == 1 ]] && exit 2; if [[ "\${STUB_NFT_EXISTING:-0}" == 1 || -f "$state" ]]; then printf '%s' '{"nftables":[{"table":{"family":"inet","name":"autopilot_cockpit"}}]}'; else printf '%s' '{"nftables":[]}'; fi; exit 0; fi\nif [[ "$*" == '-j list table inet autopilot_cockpit' ]]; then nonce="$(cat "$state" 2>/dev/null || true)"; comment="autopilot-cockpit:$nonce"; [[ "$nonce" == foreign ]] && comment=foreign; printf '{"nftables":[{"table":{"family":"inet","name":"autopilot_cockpit","comment":"%s"}},{"chain":{"family":"inet","table":"autopilot_cockpit","name":"input","type":"filter","hook":"input","prio":-10,"policy":"accept","comment":"%s"}},{"rule":{"family":"inet","table":"autopilot_cockpit","chain":"input","expr":[{"match":{"op":"==","left":{"payload":{"protocol":"tcp","field":"dport"}},"right":{"set":[80,443]}}},{"match":{"op":"!=","left":{"payload":{"protocol":"ip","field":"saddr"}},"right":"192.168.122.1"}},{"drop":null}],"comment":"%s"}}]}' "$comment" "$comment" "$comment"; exit 0; fi\nexit 0`);
  stubExecutable(stubDir, "systemctl", `${log}\nif [[ -n "\${STUB_SYSTEMCTL_FAIL_ON:-}" && "$*" == "$STUB_SYSTEMCTL_FAIL_ON" && "$*" != 'start autopilot-cockpit-firewall.service' ]]; then exit 1; fi\nif [[ "$*" == 'start autopilot-cockpit-firewall.service' ]]; then [[ "\${STUB_FIREWALL_FAIL_BEFORE_NFT:-0}" == 1 ]] && exit 1; cat "$STUB_FIREWALL_IDENTITY" > "$STUB_NFT_STATE"; fi\nif [[ "$*" == 'restart autopilot-control-plane.service' ]]; then case "\${STUB_REPLACE_ON_CONTROL_RESTART:-}" in current) rm -f "$STUB_CURRENT_PATH"; ln -s 'releases/2222222222222222222222222222222222222222' "$STUB_CURRENT_PATH"; exit 1;; environment) printf 'FOREIGN=1\\n' > "$STUB_ENV_PATH"; exit 1;; esac; fi\nif [[ "$*" == 'stop caddy.service' && "\${STUB_FOREIGN_NFT_DURING_ROLLBACK:-0}" == 1 ]]; then printf 'foreign\\n' > "$STUB_NFT_STATE"; fi\nif [[ "$*" == 'stop autopilot-cockpit-firewall.service' && -f "$STUB_NFT_STATE" ]]; then rm -f "$STUB_NFT_STATE"; fi\nif [[ -n "\${STUB_SYSTEMCTL_FAIL_ON:-}" && "$*" == "$STUB_SYSTEMCTL_FAIL_ON" ]]; then exit 1; fi\ncase "$*" in\n'is-enabled caddy.service') if [[ "\${STUB_RUNTIME_MASK:-0}" == 1 ]]; then printf 'masked-runtime\\n'; else printf 'masked\\n'; fi ;;\n'is-active caddy.service') [[ "\${STUB_CADDY_INSPECTION_ERROR:-0}" == 1 ]] && exit 1; if grep -q '^systemctl:start caddy.service$' "$STUB_LOG" && ! grep -q '^systemctl:stop caddy.service$' "$STUB_LOG"; then if [[ "\${STUB_FOREIGN_CADDY_BEFORE_ROLLBACK:-0}" == 1 ]]; then printf 'foreign\\n' > "$STUB_CADDY_CONFIG"; exit 1; fi; case "\${STUB_REPLACE_CADDY_IDENTITY:-}" in dropin) printf 'foreign\\n' > "$STUB_CADDY_DROPIN";; unit) printf 'foreign\\n' > "$STUB_CADDY_PACKAGE_UNIT";; esac; printf 'active\\n'; else printf 'inactive\\n'; exit 3; fi ;;\n'is-active autopilot-control-plane.service') printf 'active\\n' ;;\n'is-active autopilot-control-plane-health.timer') printf 'active\\n' ;;\n'is-active autopilot-state-maintenance.timer') printf 'active\\n' ;;\n'is-active autopilot-cockpit-firewall.service') if grep -q '^systemctl:stop autopilot-cockpit-firewall.service$' "$STUB_LOG" && [[ ! -f "$STUB_NFT_STATE" ]]; then printf 'inactive\\n'; exit 3; else printf 'active\\n'; fi ;;\n*) exit 0 ;;\nesac`);
  stubExecutable(stubDir, "curl", `${log}\nout=''; url=''; while (($#)); do case "$1" in --output) out="$2"; shift 2;; http://*) url="$1"; shift;; *) shift;; esac; done\nif [[ "$url" == */ready ]]; then printf '%s' '{"ready":true,"components":{"configuration":{"status":"ready","error_code":null},"managed_state":{"status":"ready","error_code":null},"project_registry":{"status":"ready","error_code":null},"supervisor":{"status":"ready","error_code":null},"token_gateway":{"status":"ready","error_code":null}}}' > "$out"; else printf '%s' '{"ok":true}' > "$out"; fi\nprintf 200`);
  stubExecutable(stubDir, "npm", `${log}\n[[ "\${STUB_NPM_REQUIRE_BOUNDARY:-0}" != 1 || "\${AUTOPILOT_PRIVDROP_ACTIVE:-0}" == 1 ]] || exit 96\n[[ -z "\${MALICIOUS_ROOT_MARKER:-}" ]] || exit 97\nprintf 'npm-boundary:uid=%s:user=%s:path=%s\\n' "$(id -u)" "\${USER:-}" "\${PATH:-}" >> "$STUB_LOG"\ncase "$*" in\n*ops:backup*) archive="$AUTOPILOT_CUTOVER_TEST_ROOT/backup.apbackup.json"; printf '{}\\n' > "$archive"; printf '{"path":"%s","validation":{"valid":true}}\\n' "$archive" ;;\n*ops:recovery-drill*) printf '{"ok":true,"validation":{"ready":true,"reconciled":true,"errors":[]}}\\n' ;;\n*ops:boundary-check*) printf '{"ok":true}\\n' ;;\n*smoke:cockpit-run*) printf '{"mode":"dry-run","provider_invoked":false,"run_status":"completed"}\\n' ;;\n*) exit 1 ;;\nesac`);

  const systemctlBase = join(stubDir, "systemctl-base");
  renameSync(join(stubDir, "systemctl"), systemctlBase);
  stubExecutable(stubDir, "systemctl", `${log}\nif [[ "$*" == 'is-active autopilot-cockpit-cutover-recovery.timer' ]]; then printf 'active\\n'; exit 0; fi\nexec ${JSON.stringify(systemctlBase)} "$@"`);

  return {
    root, checkout, releaseRoot, sha, envPath, currentPath, evidencePath, caddyConfigPath,
    persistentMaskPath, runtimeMaskPath, packageCaddyUnitPath, previousTarget, previousEnvironment, stubLog, stubDir,
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      STUB_LOG: stubLog,
      AUTOPILOT_CUTOVER_TEST_MODE: "1",
      AUTOPILOT_CUTOVER_TEST_ROOT: root,
      AUTOPILOT_CUTOVER_TEST_BIN: stubDir,
      AUTOPILOT_CUTOVER_TEST_AUTO_ACK: "1",
      AUTOPILOT_CUTOVER_TEST_ACK_TIMEOUT: "1",
      AUTOPILOT_NODE_BIN: fakeNode24,
      STUB_CADDY_CONFIG: caddyConfigPath,
      STUB_CADDY_DROPIN: join(root, "etc", "systemd", "system", "caddy.service.d", "autopilot.conf"),
      STUB_CADDY_PACKAGE_UNIT: packageCaddyUnitPath,
      STUB_NFT_STATE: join(root, "nft-state"),
      STUB_FIREWALL_IDENTITY: join(root, "var", "lib", "autopilot-cockpit", "firewall.identity"),
      STUB_CURRENT_PATH: currentPath,
      STUB_ENV_PATH: envPath,
      STUB_RUNTIME_MASK: options.runtimeMask ? "1" : "0",
    },
  };
}

function runCutover(fixture: CutoverFixture, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], {
    encoding: "utf8",
    env: { ...fixture.env, ...extraEnv },
    timeout: 10_000,
  });
}

describe("Cockpit transactional live cutover", () => {
  it("starts the owned firewall before Caddy and commits only after an acknowledgement", () => {
    const fixture = prepareCutover();
    const result = runCutover(fixture);
    if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}\n${readFileSync(fixture.stubLog, "utf8")}`);
    expect(result.stdout).toContain("CUTOVER_WAITING_FOR_HOST_ACCEPTANCE");
    expect(result.stdout).toContain("CUTOVER_OK");
    expect(result.stdout).not.toContain("secret-do-not-print");
    expect(readlinkSync(fixture.currentPath)).toBe(`releases/${fixture.sha}`);
    expect(readFileSync(fixture.envPath, "utf8").match(/^CONTROL_PLANE_SECURE_COOKIES=true$/gm)).toHaveLength(1);
    const events = readFileSync(fixture.stubLog, "utf8");
    expect(events.indexOf("systemctl:start autopilot-cockpit-firewall.service"))
      .toBeLessThan(events.indexOf("systemctl:start caddy.service"));
    const ledger = readFileSync(join(fixture.root, "run", "autopilot-cockpit-cutover", "transaction.ledger"), "utf8");
    for (const field of [
      "firewall_unit_installed=1", "nft_config_installed=1", "firewall_helper_installed=1",
      "firewall_identity_installed=1", "firewall_reload_attempted=1", "firewall_attempted=1", "current_attempted=1",
      "environment_attempted=1", "caddy_config_installed=1", "caddy_dropin_installed=1",
      "caddy_reload_attempted=1", "caddy_unmasked=1", "caddy_enabled=1", "caddy_attempted=1",
    ]) expect(ledger).toContain(field);
  });

  it.each(["firewall", "current", "environment", "control-plane", "caddy-files", "caddy"])(
    "rolls back exact prior bytes and link after failure following %s mutation",
    (phase) => {
      const fixture = prepareCutover();
      const result = runCutover(fixture, { AUTOPILOT_CUTOVER_TEST_FAIL_AFTER: phase });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("ROLLBACK_OK");
      expect(readFileSync(fixture.envPath)).toEqual(fixture.previousEnvironment);
      expect(readlinkSync(fixture.currentPath)).toBe(fixture.previousTarget);
      const events = readFileSync(fixture.stubLog, "utf8");
      expect(events).toContain("systemctl:restart autopilot-control-plane.service");
      expect(events).toContain("npm:--silent run ops:boundary-check");
      expect(events).toContain("npm:--silent run smoke:cockpit-run -- --dry-run");
      expect(events).not.toMatch(/nft:delete table (?!inet autopilot_cockpit)/);
    },
  );

  it.each([
    "firewall-unit-install",
    "nft-config-install",
    "firewall-helper-install",
    "firewall-identity-install",
    "firewall-reload",
    "caddy-config-install",
    "caddy-dropin-install",
    "caddy-reload",
  ])("restores every file/install/reload boundary after %s", (phase) => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, { AUTOPILOT_CUTOVER_TEST_FAIL_AFTER: phase });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("ROLLBACK_OK");
    for (const path of [
      join(fixture.root, "etc", "systemd", "system", "autopilot-cockpit-firewall.service"),
      join(fixture.root, "etc", "nftables.d", "autopilot-cockpit.nft"),
      join(fixture.root, "usr", "local", "libexec", "autopilot-cockpit-firewall"),
      join(fixture.root, "var", "lib", "autopilot-cockpit", "firewall.identity"),
      join(fixture.root, "etc", "systemd", "system", "caddy.service.d", "autopilot.conf"),
    ]) expect(existsSync(path)).toBe(false);
  });

  it("times out awaiting host acceptance and rolls back", () => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, { AUTOPILOT_CUTOVER_TEST_AUTO_ACK: "0" });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("ROLLBACK_OK");
    expect(readFileSync(fixture.envPath)).toEqual(fixture.previousEnvironment);
    expect(readlinkSync(fixture.currentPath)).toBe(fixture.previousTarget);
  });

  it("restores the exact package Caddyfile bytes after rollback", () => {
    const fixture = prepareCutover();
    const caddyfile = join(fixture.root, "etc", "caddy", "Caddyfile");
    mkdirSync(dirname(caddyfile), { recursive: true });
    const packagedBytes = Buffer.from("# untouched package default\n:80 { respond ok }\n");
    writeFileSync(caddyfile, packagedBytes, { mode: 0o644 });
    const result = runCutover(fixture, { AUTOPILOT_CUTOVER_TEST_FAIL_AFTER: "caddy" });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("ROLLBACK_OK");
    expect(readFileSync(caddyfile)).toEqual(packagedBytes);
  });

  it("accepts a valid random ID through the separate acknowledgement invocation", async () => {
    const fixture = prepareCutover();
    const child = spawn("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_CUTOVER_TEST_AUTO_ACK: "0", AUTOPILOT_CUTOVER_TEST_ACK_TIMEOUT: "5" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const ledger = join(fixture.root, "run", "autopilot-cockpit-cutover", "transaction.ledger");
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline && (!existsSync(ledger) || !readFileSync(ledger, "utf8").includes("state=waiting"))) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(existsSync(ledger)).toBe(true);
    expect(statSync(ledger).mode & 0o777).toBe(0o600);
    const ackId = readFileSync(ledger, "utf8").match(/^ack_id=([a-f0-9]{64})$/m)?.[1];
    expect(ackId).toMatch(/^[a-f0-9]{64}$/);
    const accepted = spawnSync("bash", [liveCutover, "--accept", ackId!], { encoding: "utf8", env: fixture.env });
    expect(accepted.status).toBe(0);
    const status = await new Promise<number | null>((resolve) => child.once("close", resolve));
    if (status !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("CUTOVER_OK");
  }, 10_000);

  it.each([
    "start autopilot-cockpit-firewall.service",
    "unmask caddy.service",
    "enable caddy.service",
    "start caddy.service",
  ])("rolls back when systemctl fails during %s", (command) => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, { STUB_SYSTEMCTL_FAIL_ON: command });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("ROLLBACK_OK");
    expect(readFileSync(fixture.envPath)).toEqual(fixture.previousEnvironment);
    expect(readlinkSync(fixture.currentPath)).toBe(fixture.previousTarget);
    const events = readFileSync(fixture.stubLog, "utf8");
    if (command !== "start autopilot-cockpit-firewall.service") {
      expect(events).toContain("systemctl:mask caddy.service");
    }
  });

  it.each([
    ["Caddy stop fails", { STUB_SYSTEMCTL_FAIL_ON: "stop caddy.service" }],
    ["Caddy listener survives stop", { STUB_CADDY_SURVIVES_STOP: "1" }],
    ["Caddy config is replaced before rollback", { STUB_FOREIGN_CADDY_BEFORE_ROLLBACK: "1" }],
  ])("retains the firewall and reports rollback failure when %s", (_label, extraEnv) => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, {
      ...extraEnv,
      ...("STUB_FOREIGN_CADDY_BEFORE_ROLLBACK" in extraEnv ? {} : { AUTOPILOT_CUTOVER_TEST_FAIL_AFTER: "caddy" }),
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("ROLLBACK_FAILED");
    expect(readFileSync(fixture.stubLog, "utf8")).not.toContain("systemctl:stop autopilot-cockpit-firewall.service");
  });

  it("refuses a pre-existing production nft table before mutation", () => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, { STUB_NFT_EXISTING: "1" });
    expect(result.status).not.toBe(0);
    expect(readFileSync(fixture.stubLog, "utf8")).not.toContain("systemctl:start autopilot-cockpit-firewall.service");
  });

  it("retains a foreign replacement nft table during rollback", () => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, {
      AUTOPILOT_CUTOVER_TEST_FAIL_AFTER: "caddy",
      STUB_FOREIGN_NFT_DURING_ROLLBACK: "1",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("ROLLBACK_FAILED");
    expect(readFileSync(fixture.stubLog, "utf8")).not.toContain("systemctl:stop autopilot-cockpit-firewall.service");
    expect(readFileSync(fixture.env.STUB_NFT_STATE!, "utf8")).toBe("foreign\n");
  });

  it("retains the owned firewall artifacts when its stop fails", () => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, {
      AUTOPILOT_CUTOVER_TEST_FAIL_AFTER: "firewall",
      STUB_SYSTEMCTL_FAIL_ON: "stop autopilot-cockpit-firewall.service",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("ROLLBACK_FAILED");
    expect(existsSync(fixture.env.STUB_NFT_STATE!)).toBe(true);
    expect(existsSync(join(fixture.root, "etc", "systemd", "system", "autopilot-cockpit-firewall.service"))).toBe(true);
  });

  it.each([
    ["Caddy inspection error", { STUB_CADDY_INSPECTION_ERROR: "1", AUTOPILOT_CUTOVER_TEST_FAIL_AFTER: "caddy" }],
    ["dpkg verify error", { STUB_DPKG_VERIFY_ERROR: "1" }],
    ["dpkg verify output", { STUB_DPKG_VERIFY_OUTPUT: "1" }],
    ["ss inspection error", { STUB_SS_ERROR_PORT: "8443" }],
    ["nonempty listener", { STUB_OCCUPIED_PORT: "8443" }],
    ["nft inspection error", { STUB_NFT_INSPECTION_ERROR: "1" }],
  ])("fails closed on %s", (_label, extraEnv) => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, extraEnv);
    expect(result.status).not.toBe(0);
    expect(readFileSync(fixture.stubLog, "utf8")).not.toContain("systemctl:start autopilot-cockpit-firewall.service");
  });

  it("refuses invalid offline nft syntax before mutation", () => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, { STUB_NFT_CHECK_ERROR: "1" });
    expect(result.status).not.toBe(0);
    expect(readFileSync(fixture.stubLog, "utf8")).toContain("nft:--check --file");
    expect(readFileSync(fixture.stubLog, "utf8")).not.toContain("systemctl:start autopilot-cockpit-firewall.service");
  });

  it("restores owned partial files when firewall start fails before creating a table", () => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, { STUB_FIREWALL_FAIL_BEFORE_NFT: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("ROLLBACK_OK");
    expect(existsSync(fixture.env.STUB_NFT_STATE!)).toBe(false);
    expect(existsSync(join(fixture.root, "etc", "systemd", "system", "autopilot-cockpit-firewall.service"))).toBe(false);
  });

  it.each(["dropin", "unit"])("retains the firewall when transaction Caddy %s identity is replaced", (kind) => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, { STUB_REPLACE_CADDY_IDENTITY: kind });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("ROLLBACK_FAILED");
    const events = readFileSync(fixture.stubLog, "utf8");
    expect(events).not.toContain("systemctl:stop caddy.service");
    expect(events).not.toContain("systemctl:stop autopilot-cockpit-firewall.service");
  });

  it.each([
    " CONTROL_PLANE_SECURE_COOKIES=false",
    "CONTROL_PLANE_SECURE_COOKIES=\"false\"",
    "'CONTROL_PLANE_SECURE_COOKIES=false'",
    "CONTROL_PLANE_SECURE_COOKIES=fa\\\nlse",
  ])("rejects systemd EnvironmentFile ambiguity: %s", (secureLine) => {
    const fixture = prepareCutover({ secureLine });
    const result = runCutover(fixture);
    expect(result.status).not.toBe(0);
    expect(readFileSync(fixture.stubLog, "utf8")).not.toContain("systemctl:start autopilot-cockpit-firewall.service");
    expect(existsSync(join(fixture.root, "etc", "systemd", "system", "autopilot-cockpit-firewall.service"))).toBe(false);
  });

  it("rejects invalid UTF-8 in the protected environment", () => {
    const fixture = prepareCutover();
    writeFileSync(fixture.envPath, Buffer.from([0xff, 0xfe, 0x0a]), { mode: 0o600 });
    const result = runCutover(fixture);
    expect(result.status).not.toBe(0);
    expect(readFileSync(fixture.stubLog, "utf8")).not.toContain("systemctl:start autopilot-cockpit-firewall.service");
  });

  it("cleans every registered transaction temporary after command-interior failure", () => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, { AUTOPILOT_CUTOVER_TEST_FAIL_AFTER: "caddy-config-install" });
    expect(result.status).not.toBe(0);
    const leftovers: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/^\.(?:firewall|current|control-plane|caddy|restore)/.test(entry.name)) leftovers.push(path);
      }
    };
    walk(fixture.root);
    expect(leftovers).toEqual([]);
  });

  it("recovers an uncompleted transaction idempotently after process loss", async () => {
    const fixture = prepareCutover();
    const child = spawn("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_CUTOVER_TEST_PAUSE_AFTER: "environment" },
    });
    const ledger = join(fixture.root, "var", "lib", "autopilot-cockpit", "transactions", "active", "transaction.ledger");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (!existsSync(ledger) || !readFileSync(ledger, "utf8").includes("environment_changed=1"))) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(existsSync(ledger)).toBe(true);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));
    expect(readFileSync(fixture.envPath, "utf8")).toContain("CONTROL_PLANE_SECURE_COOKIES=true");
    const recovered = spawnSync("bash", [liveCutover, "--recover"], { encoding: "utf8", env: fixture.env });
    expect(recovered.status).toBe(0);
    expect(recovered.stdout).toContain("ROLLBACK_OK");
    expect(readFileSync(fixture.envPath)).toEqual(fixture.previousEnvironment);
    const second = spawnSync("bash", [liveCutover, "--recover"], { encoding: "utf8", env: fixture.env });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("RECOVERY_NOT_NEEDED");
  }, 15_000);

  it("reconciles current_attempted as a no-op when publication never happened and prior current was absent", async () => {
    const fixture = prepareCutover(); rmSync(fixture.currentPath);
    const child = spawn("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_CUTOVER_TEST_KILL_BEFORE: "current-mv" },
    });
    const status = await new Promise<number | null>((resolve) => child.once("close", resolve));
    expect(status).not.toBe(0);
    expect(existsSync(fixture.currentPath)).toBe(false);
    const recovered = spawnSync("bash", [liveCutover, "--recover"], { encoding: "utf8", env: fixture.env });
    expect(recovered.status, `${recovered.stdout}\n${recovered.stderr}`).toBe(0); expect(recovered.stdout).toContain("ROLLBACK_OK");
    expect(existsSync(fixture.currentPath)).toBe(false);
  }, 15_000);

  it.each([
    ["nft", (f: ReturnType<typeof prepareCutover>) => join(f.root, "etc", "nftables.d")],
    ["caddy-dropin", (f: ReturnType<typeof prepareCutover>) => join(f.root, "etc", "systemd", "system", "caddy.service.d")],
  ])("removes an owned empty %s directory after a crash immediately after publication", async (phase, directory) => {
    const fixture = prepareCutover();
    const child = spawn("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_CUTOVER_TEST_KILL_AFTER_MKDIR: phase },
    });
    const status = await new Promise<number | null>((resolve) => child.once("close", resolve));
    expect(status).not.toBe(0); expect(existsSync(directory(fixture))).toBe(true);
    const recovered = spawnSync("bash", [liveCutover, "--recover"], { encoding: "utf8", env: fixture.env });
    expect(recovered.status, `${recovered.stdout}\n${recovered.stderr}`).toBe(0); expect(recovered.stdout).toContain("ROLLBACK_OK");
    expect(existsSync(directory(fixture))).toBe(false);
  }, 15_000);

  it("treats a crash immediately before owned directory creation as a no-op", async () => {
    const fixture = prepareCutover(); const directory = join(fixture.root, "etc", "nftables.d");
    const child = spawn("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], { env: { ...fixture.env, AUTOPILOT_CUTOVER_TEST_KILL_BEFORE_MKDIR: "nft" } });
    const status = await new Promise<number | null>((resolve) => child.once("close", resolve));
    expect(status).not.toBe(0); expect(existsSync(directory)).toBe(false);
    const recovered = spawnSync("bash", [liveCutover, "--recover"], { encoding: "utf8", env: fixture.env });
    expect(recovered.status).toBe(0); expect(recovered.stdout).toContain("ROLLBACK_OK"); expect(existsSync(directory)).toBe(false);
  }, 15_000);

  it.each(["current", "environment"])("preserves a foreign %s replacement and fails rollback", (kind) => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, { STUB_REPLACE_ON_CONTROL_RESTART: kind });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("ROLLBACK_FAILED");
    if (kind === "current") expect(readlinkSync(fixture.currentPath)).toBe(`releases/${"2".repeat(40)}`);
    else expect(readFileSync(fixture.envPath, "utf8")).toBe("FOREIGN=1\n");
  });

  it.each(["current", "environment"])("preserves a foreign %s replacement across SIGTERM rollback", async (kind) => {
    const fixture = prepareCutover();
    const child = spawn("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_CUTOVER_TEST_PAUSE_AFTER: kind },
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    const ledger = join(fixture.root, "run", "autopilot-cockpit-cutover", "transaction.ledger");
    const field = kind === "current" ? "current_switched=1" : "environment_changed=1";
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (!existsSync(ledger) || !readFileSync(ledger, "utf8").includes(field))) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(existsSync(ledger) && readFileSync(ledger, "utf8").includes(field)).toBe(true);
    if (kind === "current") {
      rmSync(fixture.currentPath);
      symlinkSync(`releases/${"3".repeat(40)}`, fixture.currentPath);
    } else writeFileSync(fixture.envPath, "SIGNAL_FOREIGN=1\n");
    child.kill("SIGTERM");
    const status = await new Promise<number | null>((resolve) => child.once("close", resolve));
    expect(status).not.toBe(0);
    expect(stdout).toContain("ROLLBACK_FAILED");
    if (kind === "current") expect(readlinkSync(fixture.currentPath)).toBe(`releases/${"3".repeat(40)}`);
    else expect(readFileSync(fixture.envPath, "utf8")).toBe("SIGNAL_FOREIGN=1\n");
  }, 12_000);

  it("preserves a concurrent EnvironmentFile replacement before the CAS publication", async () => {
    const fixture = prepareCutover();
    const child = spawn("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_CUTOVER_TEST_PAUSE_AFTER: "before-environment-cas" },
    });
    const ledger = join(fixture.root, "var", "lib", "autopilot-cockpit", "transactions", "active", "transaction.ledger");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (!existsSync(ledger) || !readFileSync(ledger, "utf8").includes("/.control-plane.env-"))) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(readFileSync(ledger, "utf8")).toContain("environment_attempted=0");
    const foreign = "CONCURRENT_FOREIGN=1\n";
    const replacement = `${fixture.envPath}.foreign`;
    writeFileSync(replacement, foreign, { mode: 0o600 });
    renameSync(replacement, fixture.envPath);
    const status = await new Promise<number | null>((resolve) => child.once("close", resolve));
    expect(status).not.toBe(0);
    expect(readFileSync(fixture.envPath, "utf8")).toBe(foreign);
  }, 12_000);

  it.each([
    ["old version", (body: string) => body.replace("version=autopilot-cockpit-cutover-v4", "version=autopilot-cockpit-cutover-v3")],
    ["unknown key", (body: string) => `${body}unknown_key=x\n`],
    ["duplicate key", (body: string) => `${body}state=waiting\n`],
    ["control character", (body: string) => body.replace("checkout=", "checkout=bad\t")],
  ])("rejects a %s in the recovery ledger before systemd mutation", async (_name, mutate) => {
    const fixture = prepareCutover();
    const owner = spawn("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_CUTOVER_TEST_AUTO_ACK: "0", AUTOPILOT_CUTOVER_TEST_ACK_TIMEOUT: "5" },
    });
    const ledger = join(fixture.root, "var", "lib", "autopilot-cockpit", "transactions", "active", "transaction.ledger");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (!existsSync(ledger) || !readFileSync(ledger, "utf8").includes("state=waiting"))) await new Promise((resolve) => setTimeout(resolve, 20));
    owner.kill("SIGKILL");
    await new Promise((resolve) => owner.once("close", resolve));
    writeFileSync(ledger, mutate(readFileSync(ledger, "utf8")), { mode: 0o600 });
    const before = readFileSync(fixture.stubLog, "utf8");
    const recovered = spawnSync("bash", [liveCutover, "--recover"], { encoding: "utf8", env: fixture.env });
    expect(recovered.status).not.toBe(0);
    expect(readFileSync(fixture.stubLog, "utf8").slice(before.length)).not.toContain("systemctl:");
  }, 15_000);

  it("preserves a no-final-newline environment while changing exactly false to true", () => {
    const fixture = prepareCutover({ finalNewline: false });
    const result = runCutover(fixture);
    expect(result.status).toBe(0);
    const changed = readFileSync(fixture.envPath);
    expect(changed.at(-1)).not.toBe(0x0a);
    expect(changed.toString("utf8")).toContain("CONTROL_PLANE_SECURE_COOKIES=true");
  });

  it.each([
    "CONTROL_PLANE_SECURE_COOKIES=true",
    "CONTROL_PLANE_SECURE_COOKIES=false\nCONTROL_PLANE_SECURE_COOKIES=false",
    "NO_SECURE_COOKIE_ASSIGNMENT=1",
  ])("refuses a non-single-false secure cookie assignment before mutation: %s", (secureLine) => {
    const fixture = prepareCutover({ secureLine });
    const result = runCutover(fixture);
    expect(result.status).not.toBe(0);
    expect(readFileSync(fixture.stubLog, "utf8")).not.toContain("systemctl:start autopilot-cockpit-firewall.service");
  });

  it("restores Caddyfile metadata and the original runtime mask location", () => {
    const fixture = prepareCutover({ runtimeMask: true });
    mkdirSync(dirname(fixture.caddyConfigPath), { recursive: true });
    writeFileSync(fixture.caddyConfigPath, "package default\n", { mode: 0o644 });
    const oldTime = new Date(1_700_000_000_000);
    utimesSync(fixture.caddyConfigPath, oldTime, oldTime);
    const result = runCutover(fixture, { AUTOPILOT_CUTOVER_TEST_FAIL_AFTER: "caddy" });
    expect(result.status).not.toBe(0);
    expect(statSync(fixture.caddyConfigPath).mode & 0o777).toBe(0o644);
    expect(Math.trunc(statSync(fixture.caddyConfigPath).mtimeMs / 1000)).toBe(Math.trunc(oldTime.getTime() / 1000));
    const events = readFileSync(fixture.stubLog, "utf8");
    expect(events).toContain("systemctl:mask --runtime caddy.service");
    expect(events).not.toContain("systemctl:mask caddy.service");
  });

  it.each([
    ["dirty checkout", {}],
    ["invalid manifest", {}],
    ["occupied 8443", { STUB_OCCUPIED_PORT: "8443" }],
    ["occupied 8877", { STUB_OCCUPIED_PORT: "8877" }],
    ["missing isolated evidence", {}],
    ["unowned Caddy", {}],
    ["modified Caddy package mode", {}],
  ])("refuses %s before the first mutation", (label, extraEnv) => {
    const fixture = prepareCutover();
    if (label === "dirty checkout") writeFileSync(join(fixture.checkout, "dirty.txt"), "dirty\n");
    if (label === "invalid manifest") {
      const manifest = join(fixture.releaseRoot, "manifests", `${fixture.sha}.sha256`);
      chmodSync(manifest, 0o644);
      writeFileSync(manifest, `${"0".repeat(64)}  ./index.html\n`);
      chmodSync(manifest, 0o444);
    }
    if (label === "missing isolated evidence") rmSync(fixture.evidencePath);
    if (label === "unowned Caddy") {
      const foreign = join(fixture.root, "etc", "systemd", "system", "caddy.service.d", "autopilot.conf");
      mkdirSync(dirname(foreign), { recursive: true });
      writeFileSync(foreign, "foreign\n");
    }
    if (label === "modified Caddy package mode") writeFileSync(fixture.caddyConfigPath, "package\n", { mode: 0o666 });
    const result = runCutover(fixture, extraEnv);
    expect(result.status).not.toBe(0);
    expect(readFileSync(fixture.stubLog, "utf8")).not.toContain("systemctl:start autopilot-cockpit-firewall.service");
    expect(readFileSync(fixture.envPath)).toEqual(fixture.previousEnvironment);
    expect(readlinkSync(fixture.currentPath)).toBe(fixture.previousTarget);
  });

  it("runs every project npm command through the sanitized radek privilege boundary", () => {
    const fixture = prepareCutover();
    const result = runCutover(fixture, {
      STUB_NPM_REQUIRE_BOUNDARY: "1",
      MALICIOUS_ROOT_MARKER: "must-not-cross-boundary",
    });
    expect(result.status).toBe(0);
    const events = readFileSync(fixture.stubLog, "utf8");
    expect(events.match(/^setpriv:/gm)).toHaveLength(15);
    expect(events).toContain(`--reuid ${process.getuid!()} --regid ${process.getgid!()} --clear-groups --`);
    expect(events).toContain(`npm-boundary:uid=${process.getuid!()}:user=radek:`);
    expect(events).not.toContain("must-not-cross-boundary");
  });

  it("recovers from the immutable transaction snapshot after the checkout disappears", async () => {
    const fixture = prepareCutover();
    const child = spawn("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_CUTOVER_TEST_PAUSE_AFTER: "environment" },
    });
    const ledger = join(fixture.root, "var", "lib", "autopilot-cockpit", "transactions", "active", "transaction.ledger");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (!existsSync(ledger) || !readFileSync(ledger, "utf8").includes("environment_changed=1"))) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(existsSync(ledger)).toBe(true);
    const snapshot = join(dirname(ledger), "snapshot");
    expect(statSync(snapshot).mode & 0o777).toBe(0o500);
    expect(statSync(join(snapshot, "Caddyfile")).mode & 0o777).toBe(0o400);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));
    renameSync(fixture.checkout, `${fixture.checkout}.gone`);
    writeFileSync(fixture.stubLog, "");
    const recovered = spawnSync("bash", [liveCutover, "--recover"], { encoding: "utf8", env: fixture.env });
    expect(recovered.status).toBe(0);
    expect(recovered.stdout).toContain("ROLLBACK_OK");
    expect(readFileSync(fixture.envPath)).toEqual(fixture.previousEnvironment);
    expect(readFileSync(fixture.stubLog, "utf8")).not.toContain("npm:");
    expect(readFileSync(fixture.stubLog, "utf8")).toContain("systemd-run:");
  }, 15_000);

  it("reports rollback failure when checkout-free recovery acceptance fails", async () => {
    const fixture = prepareCutover();
    const child = spawn("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_CUTOVER_TEST_PAUSE_AFTER: "environment" },
    });
    const ledger = join(fixture.root, "var", "lib", "autopilot-cockpit", "transactions", "active", "transaction.ledger");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (!existsSync(ledger) || !readFileSync(ledger, "utf8").includes("environment_changed=1"))) await new Promise((resolve) => setTimeout(resolve, 20));
    child.kill("SIGKILL"); await new Promise((resolve) => child.once("close", resolve));
    writeFileSync(fixture.stubLog, "");
    const recovered = spawnSync("bash", [liveCutover, "--recover"], { encoding: "utf8", env: { ...fixture.env, STUB_RECOVERY_VERIFIER_FAIL: "1" } });
    expect(recovered.status).not.toBe(0);
    expect(recovered.stdout).toContain("ROLLBACK_FAILED");
    expect(readFileSync(fixture.stubLog, "utf8")).not.toContain("npm:");
  }, 15_000);

  it("records PID starttime and refuses recovery takeover while the exact owner is alive", async () => {
    const fixture = prepareCutover();
    const child = spawn("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_CUTOVER_TEST_AUTO_ACK: "0", AUTOPILOT_CUTOVER_TEST_ACK_TIMEOUT: "5" },
    });
    const ledger = join(fixture.root, "var", "lib", "autopilot-cockpit", "transactions", "active", "transaction.ledger");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (!existsSync(ledger) || !readFileSync(ledger, "utf8").includes("state=waiting"))) await new Promise((resolve) => setTimeout(resolve, 20));
    const body = readFileSync(ledger, "utf8");
    expect(body).toMatch(/^owner_starttime=[0-9]+$/m);
    expect(Number(body.match(/^deadline_epoch=([0-9]+)$/m)?.[1])).toBeGreaterThan(Math.floor(Date.now() / 1000));
    const recovery = spawnSync("bash", [liveCutover, "--recover"], { encoding: "utf8", env: fixture.env });
    expect(recovery.status).toBe(0);
    expect(recovery.stdout).toContain("RECOVERY_OWNER_ACTIVE");
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));
    expect(spawnSync("bash", [liveCutover, "--recover"], { encoding: "utf8", env: fixture.env }).status).toBe(0);
  }, 15_000);

  it("serializes dead-owner ACK and concurrent recovery without committing", async () => {
    const fixture = prepareCutover();
    const owner = spawn("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_CUTOVER_TEST_AUTO_ACK: "0", AUTOPILOT_CUTOVER_TEST_ACK_TIMEOUT: "5" },
    });
    const ledger = join(fixture.root, "var", "lib", "autopilot-cockpit", "transactions", "active", "transaction.ledger");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (!existsSync(ledger) || !readFileSync(ledger, "utf8").includes("state=waiting"))) await new Promise((resolve) => setTimeout(resolve, 20));
    const ackId = readFileSync(ledger, "utf8").match(/^ack_id=([a-f0-9]{64})$/m)?.[1];
    expect(ackId).toMatch(/^[a-f0-9]{64}$/);
    owner.kill("SIGKILL");
    await new Promise((resolve) => owner.once("close", resolve));

    const run = (args: string[]) => new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const child = spawn("bash", [liveCutover, ...args], { env: fixture.env });
      let stdout = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.once("close", (status) => resolve({ status, stdout }));
    });
    const [recoveryA, recoveryB, ack] = await Promise.all([run(["--recover"]), run(["--recover"]), run(["--accept", ackId!])]);
    expect([recoveryA.stdout, recoveryB.stdout].filter((value) => value.includes("ROLLBACK_OK"))).toHaveLength(1);
    expect([recoveryA.stdout, recoveryB.stdout].filter((value) => value.includes("RECOVERY_NOT_NEEDED"))).toHaveLength(1);
    expect(ack.status).not.toBe(0);
    expect(readFileSync(ledger, "utf8")).toContain("state=rolled-back");
    expect(`${recoveryA.stdout}${recoveryB.stdout}${ack.stdout}`).not.toContain("CUTOVER_OK");
  }, 20_000);

  it.each([
    ["firewall-unit-install", "firewall_unit_installed=1", "nft_config_installed=1"],
    ["nft-config-install", "nft_config_installed=1", "firewall_helper_installed=1"],
    ["firewall-helper-install", "firewall_helper_installed=1", "firewall_identity_installed=1"],
    ["firewall-identity-install", "firewall_identity_installed=1", "firewall_attempted=1"],
    ["current", "current_switched=1", "environment_changed=1"],
    ["environment", "environment_changed=1", "control_plane_restarted=1"],
    ["caddy-config-install", "caddy_config_installed=1", "caddy_dropin_installed=1"],
    ["caddy-dropin-install", "caddy_dropin_installed=1", "caddy_attempted=1"],
    ["caddy", "caddy_started=1", "state=waiting"],
  ])("recovers a SIGKILL immediately after %s publication", async (phase, published, later) => {
    const fixture = prepareCutover();
    const child = spawn("bash", [liveCutover, fixture.checkout, fixture.releaseRoot, fixture.sha], {
      env: { ...fixture.env, AUTOPILOT_CUTOVER_TEST_PAUSE_AFTER: phase, AUTOPILOT_CUTOVER_TEST_AUTO_ACK: "0" },
    });
    const ledger = join(fixture.root, "var", "lib", "autopilot-cockpit", "transactions", "active", "transaction.ledger");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (!existsSync(ledger) || !readFileSync(ledger, "utf8").includes(published))) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(readFileSync(ledger, "utf8")).toContain(published);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(readFileSync(ledger, "utf8")).not.toContain(later);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));
    renameSync(fixture.checkout, `${fixture.checkout}.gone`);
    const recovered = spawnSync("bash", [liveCutover, "--recover"], { encoding: "utf8", env: fixture.env });
    expect(recovered.status).toBe(0);
    expect(recovered.stdout).toContain("ROLLBACK_OK");
    if (phase === "caddy") {
      const events = readFileSync(fixture.stubLog, "utf8");
      expect(events).toContain("systemctl:stop caddy.service");
      expect(events).toContain("systemctl:stop autopilot-cockpit-firewall.service");
    }
  }, 15_000);

  it("rejects a backslash-newline continuation anywhere before the secure-cookie assignment", () => {
    const fixture = prepareCutover();
    writeFileSync(fixture.envPath, "UNRELATED=continued\\\nCONTROL_PLANE_SECURE_COOKIES=false\nAUTOPILOT_STATE_DIR=/state\nAUTOPILOT_PROJECTS_DIR=/projects\n", { mode: 0o600 });
    const result = runCutover(fixture);
    expect(result.status).not.toBe(0);
    expect(readFileSync(fixture.stubLog, "utf8")).not.toContain("systemctl:start autopilot-cockpit-firewall.service");
  });

  it.each([
    "autopilot-control-plane.service",
    "autopilot-control-plane-health.timer",
    "autopilot-state-maintenance.timer",
    "autopilot-cockpit-cutover-recovery.timer",
  ])("requires exact active stdout for %s", (unit) => {
    const fixture = prepareCutover();
    const real = join(fixture.stubDir, "systemctl-real");
    renameSync(join(fixture.stubDir, "systemctl"), real);
    stubExecutable(fixture.stubDir, "systemctl", `if [[ "$*" == ${JSON.stringify(`is-active ${unit}`)} ]]; then printf 'activating\\n'; exit 0; fi\nexec ${JSON.stringify(real)} "$@"`);
    const result = runCutover(fixture);
    expect(result.status).not.toBe(0);
    expect(readFileSync(fixture.stubLog, "utf8")).not.toContain("systemctl:start autopilot-cockpit-firewall.service");
    expect(existsSync(join(fixture.root, "etc", "systemd", "system", "autopilot-cockpit-firewall.service"))).toBe(false);
  });

  it("archives a rolled-back active transaction so a subsequent cutover can start", () => {
    const fixture = prepareCutover();
    const first = runCutover(fixture, { AUTOPILOT_CUTOVER_TEST_FAIL_AFTER: "firewall" });
    expect(first.stdout).toContain("ROLLBACK_OK");
    const second = runCutover(fixture);
    expect(second.status).toBe(0);
    const history = join(fixture.root, "var", "lib", "autopilot-cockpit", "transactions", "history");
    expect(readdirSync(history)).toHaveLength(1);
    expect(statSync(join(history, readdirSync(history)[0]!)).mode & 0o777).toBe(0o500);
  }, 15_000);
});
