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
  options: { distRootSymlink?: boolean; distSymlink?: boolean } = {},
): { checkout: string; sha: string } {
  const checkout = join(makeTempDir(), "checkout");
  const dist = options.distRootSymlink ? join(makeTempDir(), "external-dist") : join(checkout, "cockpit", "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), options.distRootSymlink ? "external\n" : "cockpit\n");
  writeFileSync(join(dist, "assets", "app.js"), "app\n");
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
