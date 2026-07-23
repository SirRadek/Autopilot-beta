import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const installer = resolve("ops/provider-cli/install-provider-cli.sh");

type Entry = { provider: string; version: string; file: string; content: string };

const ENTRIES: Entry[] = [
  { provider: "codex", version: "0.144.5", file: "codex", content: "codex-binary-fixture" },
  {
    provider: "codex",
    version: "0.144.5",
    file: "codex-code-mode-host",
    content: "codex-code-mode-host-fixture"
  },
  { provider: "claude", version: "2.1.216", file: "claude", content: "claude-binary-fixture" },
  { provider: "agy", version: "1.1.5", file: "agy", content: "agy-binary-fixture" }
];

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function writeManifest(path: string, entries: Entry[]): void {
  const rows = entries
    .map(
      (e) =>
        `| ${e.provider} | ${e.version} | ${e.file} | ${sha256(e.content)} | ${Buffer.byteLength(e.content)} |`
    )
    .join("\n");
  writeFileSync(
    path,
    `# Test Manifest\n\n| provider | version | file | sha256 | size (bytes) |\n|---|---|---|---|---|\n${rows}\n`
  );
}

function stageFiles(dir: string, entries: Entry[]): void {
  mkdirSync(dir, { recursive: true });
  for (const e of entries) writeFileSync(join(dir, e.file), e.content);
}

const roots: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function run(env: NodeJS.ProcessEnv) {
  return spawnSync("bash", [installer], { encoding: "utf8", env: { ...process.env, ...env } });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("install-provider-cli.sh", () => {
  it("refuses to run without the explicit test-mode flag, touching nothing", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES);

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
      // AUTOPILOT_PROVIDER_CLI_TEST_MODE intentionally unset
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(installRoot, "codex"))).toBe(false);
    expect(existsSync(join(installRoot, "bin"))).toBe(false);
  });

  it("fails closed when a file is missing from staging", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES.slice(0, 3));

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(installRoot, "agy"))).toBe(false);
  });

  it("fails closed when a staged file's hash does not match the manifest", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES);
    writeFileSync(join(staging, "claude"), "tampered-content");

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(installRoot, "claude"))).toBe(false);
  });

  it("rejects a symlink staged in place of a regular file", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES.filter((e) => e.file !== "agy"));
    const decoy = join(staging, "decoy-agy-target");
    writeFileSync(decoy, ENTRIES.find((e) => e.file === "agy")!.content);
    symlinkSync(decoy, join(staging, "agy"));

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(installRoot, "agy"))).toBe(false);
  });

  it("rejects an extra file staged alongside the manifest's 4", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES);
    writeFileSync(join(staging, "unexpected-extra-file"), "extra");

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(installRoot, "codex"))).toBe(false);
  });

  it("installs all three providers, publishes symlinks atomically, on a valid staging set", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES);

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).toBe(0);

    const codexDir = join(installRoot, "codex", "0.144.5");
    const claudeDir = join(installRoot, "claude", "2.1.216");
    const agyDir = join(installRoot, "agy", "1.1.5");
    expect(readFileSync(join(codexDir, "codex"), "utf8")).toBe("codex-binary-fixture");
    expect(readFileSync(join(codexDir, "codex-code-mode-host"), "utf8")).toBe(
      "codex-code-mode-host-fixture"
    );
    expect(readFileSync(join(claudeDir, "claude"), "utf8")).toBe("claude-binary-fixture");
    expect(readFileSync(join(agyDir, "agy"), "utf8")).toBe("agy-binary-fixture");

    for (const [name, dir] of [
      ["codex", codexDir],
      ["claude", claudeDir],
      ["agy", agyDir]
    ] as const) {
      const link = join(installRoot, "bin", name);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe(join(dir, name));
    }
  });

  it("preserves the prior symlink target on a version bump instead of deleting or overwriting in place", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES);

    const first = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });
    expect(first.status).toBe(0);
    const oldTarget = readlinkSync(join(installRoot, "bin", "claude"));

    const bumped = ENTRIES.map((e) =>
      e.provider === "claude"
        ? { ...e, version: "2.2.0", content: "claude-binary-fixture-v2" }
        : e
    );
    const manifest2 = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest2, bumped);
    const staging2 = tempDir("provider-cli-staging-");
    stageFiles(staging2, bumped);

    const second = run({
      PROVIDER_CLI_MANIFEST: manifest2,
      PROVIDER_CLI_STAGING: staging2,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });
    expect(second.status).toBe(0);

    expect(readlinkSync(join(installRoot, "bin", "claude"))).toBe(
      join(installRoot, "claude", "2.2.0", "claude")
    );
    // The prior version directory and its file are untouched (no delete/in-place overwrite).
    expect(existsSync(join(installRoot, "claude", "2.1.216", "claude"))).toBe(true);
    expect(readFileSync(join(installRoot, "claude", "2.1.216", "claude"), "utf8")).toBe(
      "claude-binary-fixture"
    );
    expect(oldTarget).toBe(join(installRoot, "claude", "2.1.216", "claude"));
  });

  it("fails closed when the target version directory already exists with a different identity", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES);

    mkdirSync(join(installRoot, "agy", "1.1.5"), { recursive: true });
    writeFileSync(join(installRoot, "agy", "1.1.5", "agy"), "pre-existing-mismatched-content");

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(installRoot, "agy", "1.1.5", "agy"), "utf8")).toBe(
      "pre-existing-mismatched-content"
    );
    expect(existsSync(join(installRoot, "bin", "agy"))).toBe(false);
  });

  it("rejects a manifest version containing path traversal", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    const hostile = ENTRIES.map((e) =>
      e.provider === "agy" ? { ...e, version: "../../etc" } : e
    );
    writeManifest(manifest, hostile);
    stageFiles(staging, ENTRIES);

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(installRoot, "bin"))).toBe(false);
    expect(existsSync(resolve(installRoot, "..", "etc"))).toBe(false);
  });

  it("rejects a manifest filename containing a path separator", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    const hostile = ENTRIES.map((e) =>
      e.provider === "agy" ? { ...e, file: "../agy" } : e
    );
    writeManifest(manifest, hostile);
    mkdirSync(staging, { recursive: true });
    for (const e of ENTRIES) {
      if (e.provider !== "agy") writeFileSync(join(staging, e.file), e.content);
    }

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(installRoot, "bin"))).toBe(false);
  });

  it("rejects a manifest with a duplicate row for the same provider/file instead of the expected exact 4-artifact mapping", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    // Drop agy and duplicate the claude row instead: still 4 rows, but the exact
    // expected provider/file mapping is wrong.
    const hostile = ENTRIES.filter((e) => e.provider !== "agy").concat({
      provider: "claude",
      version: "2.1.216",
      file: "claude",
      content: "claude-binary-fixture"
    });
    writeManifest(manifest, hostile);
    stageFiles(staging, hostile);

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(installRoot, "bin"))).toBe(false);
  });

  it("fails closed and installs nothing when bin/ already has a hostile pre-existing non-symlink destination", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES);

    mkdirSync(join(installRoot, "bin"), { recursive: true });
    writeFileSync(join(installRoot, "bin", "claude"), "hostile-preexisting-regular-file");

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(installRoot, "bin", "claude"), "utf8")).toBe(
      "hostile-preexisting-regular-file"
    );
    expect(existsSync(join(installRoot, "codex"))).toBe(false);
    expect(existsSync(join(installRoot, "bin", "codex"))).toBe(false);
    expect(existsSync(join(installRoot, "bin", "agy"))).toBe(false);
  });

  it("fails closed when the target provider root already exists as a symlink instead of a directory", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES);

    const decoyDir = tempDir("provider-cli-decoy-");
    mkdirSync(installRoot, { recursive: true });
    symlinkSync(decoyDir, join(installRoot, "agy"));

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(installRoot, "bin"))).toBe(false);
    expect(existsSync(join(installRoot, "bin", "agy"))).toBe(false);
    expect(existsSync(join(installRoot, "bin", "codex"))).toBe(false);
  });

  it("leaves ALL stable symlinks unchanged when a later provider's target fails during a version bump", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES);

    const first = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });
    expect(first.status).toBe(0);

    const codexLink = readlinkSync(join(installRoot, "bin", "codex"));
    const claudeLink = readlinkSync(join(installRoot, "bin", "claude"));
    const agyLink = readlinkSync(join(installRoot, "bin", "agy"));

    // Bump codex and claude legitimately, but make the agy target directory
    // pre-exist with mismatched content so its install fails partway through.
    const bumped = ENTRIES.map((e) => {
      if (e.provider === "codex") return { ...e, version: "0.145.0", content: e.content + "-v2" };
      if (e.provider === "claude")
        return { ...e, version: "2.2.0", content: "claude-binary-fixture-v2" };
      return { ...e, version: "1.2.0" };
    });
    const manifest2 = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest2, bumped);
    const staging2 = tempDir("provider-cli-staging-");
    stageFiles(staging2, bumped);

    mkdirSync(join(installRoot, "agy", "1.2.0"), { recursive: true });
    writeFileSync(join(installRoot, "agy", "1.2.0", "agy"), "hostile-preexisting");

    const second = run({
      PROVIDER_CLI_MANIFEST: manifest2,
      PROVIDER_CLI_STAGING: staging2,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(second.status).not.toBe(0);
    expect(readlinkSync(join(installRoot, "bin", "codex"))).toBe(codexLink);
    expect(readlinkSync(join(installRoot, "bin", "claude"))).toBe(claudeLink);
    expect(readlinkSync(join(installRoot, "bin", "agy"))).toBe(agyLink);
    // The legitimately-staged codex/claude version dirs must not have been
    // installed either, since publication never happens for a failed run.
    expect(existsSync(join(installRoot, "codex", "0.145.0"))).toBe(false);
    expect(existsSync(join(installRoot, "claude", "2.2.0"))).toBe(false);
  });

  it("restores all prior stable-link states when publication fails partway through", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES);

    const first = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });
    expect(first.status).toBe(0);

    const codexLink = readlinkSync(join(installRoot, "bin", "codex"));
    const claudeLink = readlinkSync(join(installRoot, "bin", "claude"));
    const agyLink = readlinkSync(join(installRoot, "bin", "agy"));

    const bumped = ENTRIES.map((e) =>
      e.provider === "agy" ? { ...e, version: "1.2.0", content: "agy-binary-fixture-v2" } : e
    );
    const manifest2 = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest2, bumped);
    const staging2 = tempDir("provider-cli-staging-");
    stageFiles(staging2, bumped);

    // Sabotage publication for agy specifically: replace its bin symlink with a
    // non-empty directory so the final rename/publish step cannot succeed.
    rmSync(join(installRoot, "bin", "agy"), { force: true });
    mkdirSync(join(installRoot, "bin", "agy"));
    writeFileSync(join(installRoot, "bin", "agy", "blocker"), "x");

    const second = run({
      PROVIDER_CLI_MANIFEST: manifest2,
      PROVIDER_CLI_STAGING: staging2,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(second.status).not.toBe(0);
    expect(readlinkSync(join(installRoot, "bin", "codex"))).toBe(codexLink);
    expect(readlinkSync(join(installRoot, "bin", "claude"))).toBe(claudeLink);
  });

  it("rejects 4 unique rows with valid providers but the wrong artifact mapping", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    // Same provider/version cardinality (codex x2, claude x1, agy x1) and every row is
    // unique, but codex's second artifact is "codex-extra" instead of the required
    // "codex-code-mode-host" — the exact per-provider file mapping is wrong.
    const hostile = ENTRIES.map((e) =>
      e.provider === "codex" && e.file === "codex-code-mode-host"
        ? { ...e, file: "codex-extra" }
        : e
    );
    writeManifest(manifest, hostile);
    stageFiles(staging, hostile);

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(installRoot, "bin"))).toBe(false);
    expect(existsSync(join(installRoot, "codex"))).toBe(false);
  });

  it("rejects two codex rows carrying different versions", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    const hostile = ENTRIES.map((e) =>
      e.provider === "codex" && e.file === "codex-code-mode-host"
        ? { ...e, version: "0.144.6" }
        : e
    );
    writeManifest(manifest, hostile);
    stageFiles(staging, hostile);

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(installRoot, "bin"))).toBe(false);
    expect(existsSync(join(installRoot, "codex"))).toBe(false);
  });

  it("preserves the exact prior state of all three stable links when publication actually fails mid-way (test-only injected failure)", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES);

    const first = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });
    expect(first.status).toBe(0);

    const codexLink = readlinkSync(join(installRoot, "bin", "codex"));
    const claudeLink = readlinkSync(join(installRoot, "bin", "claude"));
    const agyLink = readlinkSync(join(installRoot, "bin", "agy"));

    const bumped = ENTRIES.map((e) => {
      if (e.provider === "codex") return { ...e, version: "0.145.0", content: e.content + "-v2" };
      if (e.provider === "claude")
        return { ...e, version: "2.2.0", content: "claude-binary-fixture-v2" };
      return { ...e, version: "1.2.0", content: "agy-binary-fixture-v2" };
    });
    const manifest2 = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest2, bumped);
    const staging2 = tempDir("provider-cli-staging-");
    stageFiles(staging2, bumped);

    // Nothing hostile is pre-staged in the install root: this is a genuine mid-publication
    // failure, injected only because TEST_MODE is on, targeting the claude link specifically.
    const second = run({
      PROVIDER_CLI_MANIFEST: manifest2,
      PROVIDER_CLI_STAGING: staging2,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot,
      AUTOPILOT_PROVIDER_CLI_TEST_FAIL_LINK: "claude"
    });

    expect(second.status).not.toBe(0);
    expect(readlinkSync(join(installRoot, "bin", "codex"))).toBe(codexLink);
    expect(readlinkSync(join(installRoot, "bin", "claude"))).toBe(claudeLink);
    expect(readlinkSync(join(installRoot, "bin", "agy"))).toBe(agyLink);
    // The newly-published version directories (phase 1) must be rolled back too,
    // not just the stable links (phase 2) — otherwise orphaned versions accumulate
    // on every failed bump.
    expect(existsSync(join(installRoot, "codex", "0.145.0"))).toBe(false);
    expect(existsSync(join(installRoot, "claude", "2.2.0"))).toBe(false);
    expect(existsSync(join(installRoot, "agy", "1.2.0"))).toBe(false);
  });

  it("never injects a publication failure when TEST_MODE is off, even if the flag is set", () => {
    // AUTOPILOT_PROVIDER_CLI_TEST_FAIL_LINK must have zero effect outside test mode: it
    // should not be readable as a production behavior toggle.
    const result = spawnSync("bash", [installer], {
      encoding: "utf8",
      env: {
        ...process.env,
        AUTOPILOT_PROVIDER_CLI_TEST_FAIL_LINK: "claude"
        // AUTOPILOT_PROVIDER_CLI_TEST_MODE intentionally unset -> should fail on the
        // root-privilege preflight check, not reach any link-publication logic.
      }
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must run as root");
  });

  it("fails closed, before any mkdir mutation, when the test install root itself is a symlink", () => {
    const staging = tempDir("provider-cli-staging-");
    const realRoot = tempDir("provider-cli-root-real-");
    const rootsParent = tempDir("provider-cli-root-parent-");
    const installRoot = join(rootsParent, "root-link");
    symlinkSync(realRoot, installRoot);
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES);

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(realRoot, "bin"))).toBe(false);
    expect(existsSync(join(realRoot, "codex"))).toBe(false);
  });

  it("fails closed, before any mkdir mutation, when the install root's bin/ already exists as a symlink", () => {
    const staging = tempDir("provider-cli-staging-");
    const installRoot = tempDir("provider-cli-root-");
    const decoyBinTarget = tempDir("provider-cli-decoy-bin-");
    mkdirSync(installRoot, { recursive: true });
    symlinkSync(decoyBinTarget, join(installRoot, "bin"));
    const manifest = join(tempDir("provider-cli-manifest-"), "CHECKSUMS.md");
    writeManifest(manifest, ENTRIES);
    stageFiles(staging, ENTRIES);

    const result = run({
      PROVIDER_CLI_MANIFEST: manifest,
      PROVIDER_CLI_STAGING: staging,
      AUTOPILOT_PROVIDER_CLI_TEST_MODE: "1",
      AUTOPILOT_PROVIDER_CLI_TEST_ROOT: installRoot
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(installRoot, "codex"))).toBe(false);
    expect(existsSync(join(decoyBinTarget, "codex"))).toBe(false);
  });
});
