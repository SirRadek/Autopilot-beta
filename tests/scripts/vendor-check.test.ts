import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VENDOR_ROOTS, collectVendoredFiles, generate, gitScrubbedEnv, verify } from "../../scripts/vendor-check.mjs";

// The vendor-check airlock had ZERO tests (audit 2026-07-05 §4-B / F2 probe c): a regression that
// neutered drift/untracked detection — or dropped a VENDOR_ROOT — passed `verify` green because the
// gate only fails on *actual* drift, which the regression is precisely what disables. These tests
// drive the real verify() against a throwaway git tree so those neuterings now fail a test.

const ALL_ROOTS = ["product-design-os", "src"] as const;

let root: string;
let manifestPath: string;

function git(args: string[]): void {
  // Scrubbed env: with a caller-leaked GIT_DIR this helper's `git init`/`git add` would hit the
  // HOST repo instead of the temp fixture (that exact leak corrupted the host .git/config once).
  execFileSync("git", args, { cwd: root, stdio: "pipe", env: gitScrubbedEnv() });
}

function opts(vendorRoots: readonly string[] = ALL_ROOTS) {
  return { root, manifestPath, vendorRoots };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vendor-check-"));
  manifestPath = join(root, "vendor-manifest.json");
  git(["init", "-q"]);
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "product-design-os"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "product-design-os", "b.ts"), "export const b = 2;\n");
  git(["add", "-A"]);
  generate(opts());
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("vendor-check airlock", () => {
  it("passes on a clean, freshly generated tree", () => {
    expect(() => verify(opts())).not.toThrow();
  });

  it("throws on DRIFT: a pristine vendored file changed vs its baseline hash", () => {
    writeFileSync(join(root, "src", "a.ts"), "export const a = 999;\n");
    expect(() => verify(opts())).toThrow(/provenance problem/);
  });

  it("throws on MISSING: a manifested file removed from disk", () => {
    rmSync(join(root, "src", "a.ts"));
    expect(() => verify(opts())).toThrow(/provenance problem/);
  });

  it("throws on UNTRACKED under src: a new vendored file not in the manifest", () => {
    writeFileSync(join(root, "src", "evil-new-file.ts"), "export const evil = true;\n");
    expect(() => verify(opts())).toThrow(/provenance problem/);
  });

  it("throws on a missing manifest", () => {
    rmSync(manifestPath);
    expect(() => verify(opts())).toThrow(/vendor-manifest\.json missing/);
  });

  // Regression guard for the exact hole F2 planted: dropping a VENDOR_ROOT makes files under it
  // invisible to the airlock. With `src` removed from the roots, the untracked src file is NOT
  // caught — so this asserts the *consequence*, pinning why `src` must stay in VENDOR_ROOTS.
  it("demonstrates that dropping the src root neuters detection under it", () => {
    writeFileSync(join(root, "src", "evil-new-file.ts"), "export const evil = true;\n");
    expect(() => verify(opts())).toThrow(/provenance problem/); // caught with full roots
    expect(() => verify(opts(["product-design-os"]))).not.toThrow(); // invisible without src
  });

  it("pins the airlocked roots so removing one is a test failure", () => {
    expect([...VENDOR_ROOTS].sort()).toEqual(["product-design-os", "src"]);
  });

  // Belt-and-braces for the pre-push GIT_DIR leak: even when a caller leaks a (bogus) GIT_DIR into
  // process.env, the gate's child `git` calls must resolve the fixture repo from cwd — not the
  // caller's repo — so results stay correct and the HOST repo can never be touched.
  it("ignores a leaked GIT_DIR: collectVendoredFiles still resolves the temp repo", () => {
    const prior = process.env.GIT_DIR;
    process.env.GIT_DIR = join(root, "nonexistent-bogus-gitdir");
    try {
      expect(collectVendoredFiles(root, ALL_ROOTS)).toEqual(["product-design-os/b.ts", "src/a.ts"]);
      expect(() => verify(opts())).not.toThrow();
    } finally {
      if (prior === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = prior;
    }
  });
});
