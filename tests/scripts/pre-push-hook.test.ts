import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const hook = resolve("scripts/git-hooks/pre-push");
const zeroSha = "0000000000000000000000000000000000000000";

let root: string;
let npmLog: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pre-push-hook-"));
  npmLog = join(root, "npm.log");
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "npm"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$NPM_LOG"
if [ "$*" = "run beta:vendor-check" ]; then
  exit "\${VENDOR_CHECK_EXIT:-0}"
fi
exit 0
`,
  );
  chmodSync(join(bin, "npm"), 0o755);

  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  writeFileSync(join(root, "fixture.txt"), "base\n");
  git(["add", "fixture.txt"]);
  git(["commit", "-q", "-m", "base"]);
  writeFileSync(join(root, "fixture.txt"), "change\n");
  git(["commit", "-q", "-am", "change"]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("pre-push hook", () => {
  it("blocks the push when vendor provenance verification fails", () => {
    const head = git(["rev-parse", "HEAD"]);
    const result = spawnSync("sh", [hook], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
        NPM_LOG: npmLog,
        VENDOR_CHECK_EXIT: "37",
        AUTOPILOT_HOOK_BASE_REF: "HEAD^",
      },
      input: `refs/heads/test ${head} refs/heads/test ${zeroSha}\n`,
    });

    expect(result.status).toBe(37);
    expect(result.stderr).toContain("checking vendor provenance failed; Git operation blocked");
    expect(readFileSync(npmLog, "utf8").trim().split("\n")).toEqual([
      expect.stringContaining("run mesh:changed -- --root . --since"),
      expect.stringContaining("run baseline:waiver-check -- --range"),
      "run beta:vendor-check",
    ]);
  });
});
