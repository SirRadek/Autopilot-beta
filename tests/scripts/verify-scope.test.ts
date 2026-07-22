import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  collectWorkingTreeFiles,
  executeVerificationPlan,
  parseGitPorcelain,
  resolveVerificationPlan,
} from "../../scripts/verify-scope";

describe("verify-scope", () => {
  it("plans diff-scoped commands for ordinary dev work", () => {
    const plan = resolveVerificationPlan({
      profile: "dev",
      risk: "ordinary",
      changedFiles: ["src/data/delivery-system/runStore.ts"],
    });

    expect(plan.mode).toBe("diff_scoped");
    expect(plan.commands).toContainEqual({
      file: "npm",
      args: [
        "run",
        "mesh:changed",
        "--",
        "--files",
        "src/data/delivery-system/runStore.ts",
        "--fail-on-blocker",
        "--fail-on-ungoverned",
      ],
    });
    expect(plan.commands.flatMap((command) => command.args)).not.toContain("browser:qa");
  });

  it("plans full fail-closed verification for prod or high-risk work", () => {
    const plan = resolveVerificationPlan({ profile: "prod", risk: "ordinary", changedFiles: [] });

    expect(plan.mode).toBe("full_fail_closed");
    expect(plan.commands).toEqual([
      { file: "npm", args: ["run", "verify"] },
      { file: "npm", args: ["run", "cockpit:test"] },
      { file: "npm", args: ["run", "browser:qa"] },
    ]);
    expect(resolveVerificationPlan({ profile: "dev", risk: "high", changedFiles: [] }).mode).toBe(
      "full_fail_closed",
    );
  });

  it("fails closed for an empty ordinary dev change set", () => {
    expect(() =>
      resolveVerificationPlan({ profile: "dev", risk: "ordinary", changedFiles: [] }),
    ).toThrow("verification_change_set_required");
  });

  it("falls back to full fail-closed verification for any unmapped path", () => {
    const plan = resolveVerificationPlan({
      profile: "dev",
      risk: "ordinary",
      changedFiles: ["scripts/verify-scope.ts", "unmapped/file.txt"],
    });

    expect(plan).toEqual({
      mode: "full_fail_closed",
      commands: [
        { file: "npm", args: ["run", "verify"] },
        { file: "npm", args: ["run", "cockpit:test"] },
        { file: "npm", args: ["run", "browser:qa"] },
      ],
    });
  });

  it.each(["docs/has space.md", "scripts/has\tcontrol.ts", "cockpit/has\ncontrol.ts", "src/a\0b.ts"])(
    "refuses unsupported path %j",
    (path) => {
      expect(() =>
        resolveVerificationPlan({ profile: "dev", risk: "ordinary", changedFiles: [path] }),
      ).toThrow("verification_change_path_unsupported");
    },
  );

  it("collects tracked, staged, renamed, and untracked paths from Git porcelain", () => {
    const root = mkdtempSync(join(tmpdir(), "autopilot-verify-scope-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: root });
      execFileSync("git", ["config", "user.email", "verify-scope@example.invalid"], { cwd: root });
      execFileSync("git", ["config", "user.name", "Verify Scope"], { cwd: root });
      writeFileSync(join(root, "tracked.ts"), "export {};\n");
      writeFileSync(join(root, "old-name.ts"), "export {};\n");
      execFileSync("git", ["add", "tracked.ts"], { cwd: root });
      execFileSync("git", ["add", "old-name.ts"], { cwd: root });
      execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
      writeFileSync(join(root, "tracked.ts"), "export const tracked = true;\n");
      writeFileSync(join(root, "staged.ts"), "export const staged = true;\n");
      execFileSync("git", ["add", "staged.ts"], { cwd: root });
      execFileSync("git", ["mv", "old-name.ts", "new-name.ts"], { cwd: root });
      writeFileSync(join(root, "untracked.ts"), "export const value = 1;\n");

      expect(collectWorkingTreeFiles(root)).toEqual([
        "new-name.ts",
        "old-name.ts",
        "staged.ts",
        "tracked.ts",
        "untracked.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("collects both rename paths and rejects malformed rename records", () => {
    expect(parseGitPorcelain(Buffer.from("R  new.ts\0old.ts\0"))).toEqual(["new.ts", "old.ts"]);
    expect(() => parseGitPorcelain(Buffer.from("R  new.ts\0"))).toThrow(
      "verification_git_porcelain_malformed",
    );
  });

  it("rejects an unknown porcelain status", () => {
    expect(() => parseGitPorcelain(Buffer.from("ZZ file.ts\0"))).toThrow(
      "verification_git_porcelain_malformed",
    );
  });

  it("accepts a tracked type-change porcelain status", () => {
    expect(parseGitPorcelain(Buffer.from(" T tracked.ts\0"))).toEqual(["tracked.ts"]);
  });

  it("stops after the first failed structured command", () => {
    const execute = vi.fn(() => {
      throw new Error("command failed");
    });

    expect(() =>
      executeVerificationPlan(
        {
          mode: "full_fail_closed",
          commands: [
            { file: "npm", args: ["run", "verify"] },
            { file: "npm", args: ["run", "cockpit:test"] },
          ],
        },
        execute,
      ),
    ).toThrow("command failed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("npm", ["run", "verify"], { stdio: "inherit" });
  });
});
