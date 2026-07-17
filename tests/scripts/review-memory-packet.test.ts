import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runReviewMemoryPacketCli } from "../../scripts/review-memory-packet";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const tempRoots: string[] = [];

interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("review memory packet CLI", () => {
  it("emits a privacy-safe delta packet with selected memory", () => {
    const repo = createRepository();
    const result = runCli([
      "--root",
      repo.root,
      "--base",
      repo.baseSha,
      "--head",
      repo.headSha,
      "--mode",
      "delta",
      "--affected",
      "MM-01",
      "--check",
      "focused-state:passed:tests/state.test.ts",
    ]);

    expect(result.status).toBe(0);
    const packet = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(packet).toMatchObject({
      schema_version: "autopilot-review-memory-packet-v1",
      mode: "delta",
      base_sha: repo.baseSha,
      head_sha: repo.headSha,
      affected_invariant_ids: ["MM-01"],
      contains_raw_content: false,
    });
    expect(packet.memory_files).toEqual([
      expect.objectContaining({
        path: "docs/superpowers/review-memory/managed.md",
      }),
    ]);
    expect(result.stdout).not.toContain("PRIVATE-SOURCE-CONTENT");
    expect(result.stdout).not.toContain("base commit secret message");
  });

  it("selects every discovered memory for release review", () => {
    const repo = createRepository();
    const result = runCli([
      "--root",
      repo.root,
      "--base",
      repo.baseSha,
      "--head",
      repo.headSha,
      "--mode",
      "release",
      "--check",
      "full-suite:passed:",
    ]);

    expect(result.status).toBe(0);
    const packet = JSON.parse(result.stdout) as {
      memory_files: unknown[];
      review_requirements: string[];
    };
    expect(packet.memory_files).toHaveLength(2);
    expect(packet.review_requirements).toContain(
      "review_complete_branch_diff",
    );
  });

  it("accepts one bounded no-memory decision", () => {
    const repo = createRepository();
    const result = runCli([
      "--root",
      repo.root,
      "--base",
      repo.baseSha,
      "--head",
      repo.headSha,
      "--mode",
      "delta",
      "--no-memory-reason",
      "Only repository prose changed.",
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      affected_invariant_ids: [],
      memory_files: [],
      no_memory_reason: "Only repository prose changed.",
    });
  });

  it.each([
    ["unknown ref", ["--base", "missing-ref"], "git_ref_invalid"],
    ["unknown invariant", ["--affected", "MM-99"], "unknown_review_invariant"],
    [
      "conflicting decision",
      ["--affected", "MM-01", "--no-memory-reason", "No memory."],
      "review_memory_decision_conflict",
    ],
    [
      "traversal evidence",
      ["--check", "focused:passed:../secret.log"],
      "invalid_review_path",
    ],
  ])("fails closed on %s", (_label, replacement, errorCode) => {
    const repo = createRepository();
    const args = [
      "--root",
      repo.root,
      "--base",
      repo.baseSha,
      "--head",
      repo.headSha,
      "--mode",
      "delta",
      "--affected",
      "MM-01",
    ];
    applyReplacement(args, replacement);

    const result = runCli(args);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`review_memory_packet_error:${errorCode}`);
  });

  it("rejects symlinked memory documents", () => {
    const repo = createRepository();
    const uiPath = join(
      repo.root,
      "docs/superpowers/review-memory/ui-control-invariants.md",
    );
    unlinkSync(uiPath);
    symlinkSync("managed.md", uiPath);

    const result = runCli([
      "--root",
      repo.root,
      "--base",
      repo.baseSha,
      "--head",
      repo.headSha,
      "--mode",
      "release",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "review_memory_packet_error:review_memory_file_not_regular",
    );
  });

  it("registers the Node 24 package command", () => {
    const packageJson = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts["review:packet"]).toBe(
      "tsx scripts/review-memory-packet.ts",
    );
  });
});

function createRepository(): {
  readonly root: string;
  readonly baseSha: string;
  readonly headSha: string;
} {
  const root = mkdtempSync(join(tmpdir(), "review-memory-cli-"));
  tempRoots.push(root);
  const memoryDir = join(root, "docs/superpowers/review-memory");
  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(
    join(memoryDir, "managed.md"),
    "# Managed\n\n### MM-01 — WAL first\n\nRegression coverage: `state`.\n",
  );
  writeFileSync(
    join(memoryDir, "ui-control-invariants.md"),
    "# UI\n\n### UI-01 — Readback\n\nRegression coverage: `ui`.\n",
  );
  writeFileSync(join(root, "src/state.ts"), "export const value = 'base';\n");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Review Test"]);
  git(root, ["config", "user.email", "review@example.invalid"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base commit secret message"]);
  const baseSha = git(root, ["rev-parse", "HEAD"]).trim();

  writeFileSync(
    join(root, "src/state.ts"),
    "export const value = 'PRIVATE-SOURCE-CONTENT';\n",
  );
  writeFileSync(join(root, "tests/state.test.ts"), "// focused test\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "head commit private summary"]);
  const headSha = git(root, ["rev-parse", "HEAD"]).trim();
  return { root, baseSha, headSha };
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function runCli(args: readonly string[]): CliResult {
  let stdout = "";
  let stderr = "";
  const status = runReviewMemoryPacketCli(args, {
    writeOut: (value) => {
      stdout += value;
    },
    writeError: (value) => {
      stderr += value;
    },
  });
  return { status, stdout, stderr };
}

function applyReplacement(args: string[], replacement: readonly string[]): void {
  const key = replacement[0] as string;
  const existing = args.indexOf(key);
  if (existing >= 0) {
    args.splice(existing, 2, ...replacement);
  } else {
    args.push(...replacement);
  }
}
