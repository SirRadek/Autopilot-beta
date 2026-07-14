import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const stageRelease = join(process.cwd(), "ops", "cockpit-proxy", "stage-release.sh");
const isolatedAcceptance = join(process.cwd(), "ops", "cockpit-proxy", "isolated-acceptance.sh");
const hostAcceptance = join(process.cwd(), "ops", "cockpit-proxy", "host-acceptance.sh");
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
  [[ "\${STUB_FOREIGN_REPLACEMENT:-}" != nft ]] || nonce="$(printf '%064d' 8)"
  comment="autopilot-isolated:$nonce"
  printf '{"nftables":[{"table":{"family":"inet","name":"autopilot_cockpit_isolated","comment":"%s"}},{"chain":{"family":"inet","table":"autopilot_cockpit_isolated","name":"input","comment":"%s"}},{"rule":{"family":"inet","table":"autopilot_cockpit_isolated","chain":"input","comment":"%s"}}]}' "$comment" "$comment" "$comment"
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
    if [[ "\${STUB_FOREIGN_REPLACEMENT:-}" == unit ]]; then printf 'Autopilot isolated %064d\\n' 8
    else sed -n 's/.*--property=Description=Autopilot isolated \\([a-f0-9]\\{64\\}\\).*/Autopilot isolated \\1/p' "$STUB_LOG" | tail -1; fi
    exit 0
  fi
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
if [[ -n "$output" && "$output" == */ready.json ]]; then
  case "\${STUB_READY_MODE:-ready}" in
    ready) printf '%s' '{"configuration":{"status":"ready"},"managed_state":{"status":"ready"},"project_registry":{"status":"ready"},"supervisor":{"status":"ready"},"token_gateway":{"status":"ready"}}' > "$output"; printf 200 ;;
    503) printf '{}' > "$output"; printf 503 ;;
    malformed) printf '{' > "$output"; printf 200 ;;
    missing) printf '%s' '{"configuration":{"status":"ready"}}' > "$output"; printf 200 ;;
    not-ready) printf '%s' '{"configuration":{"status":"ready"},"managed_state":{"status":"ready"},"project_registry":{"status":"ready"},"supervisor":{"status":"degraded"},"token_gateway":{"status":"ready"}}' > "$output"; printf 200 ;;
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

  it.each(["503", "malformed", "missing", "not-ready"])("does not announce READY for %s /ready state", (mode) => {
    const prepared = prepareIsolatedRun();
    const result = runIsolated(prepared, { STUB_READY_MODE: mode });
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

  const result = spawnSync("bash", [hostAcceptance], {
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
      AUTOPILOT_PROXY_TOKEN_COMMAND: "printf %s behavioral-secret",
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
    expect(source).toMatch(/timeout 5s openssl s_client/);
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
});
