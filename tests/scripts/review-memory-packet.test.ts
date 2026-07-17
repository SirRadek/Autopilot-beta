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
    expect(packet.test_evidence).toEqual([
      expect.objectContaining({ attestation: "self_reported" }),
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
      "docs_only",
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      affected_invariant_ids: [],
      memory_files: [],
      no_memory_reason: "docs_only",
    });
  });

  it("binds memory content to the declared head instead of the worktree", () => {
    const repo = createRepository();
    writeFileSync(
      join(repo.root, "docs/superpowers/review-memory/managed.md"),
      "# Leaked worktree memory\n\n### LEAK-01 — Must not appear\n",
    );

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
    expect(result.stdout).not.toContain("LEAK-01");
    expect(result.stdout).toContain("MM-01");
  });

  it("does not follow a symlinked worktree ancestor", () => {
    const repo = createRepository();
    const outside = mkdtempSync(join(tmpdir(), "review-memory-outside-"));
    tempRoots.push(outside);
    writeFileSync(join(outside, "leak.md"), "### LEAK-01 — Outside\n");
    rmSync(join(repo.root, "docs"), { recursive: true });
    symlinkSync(outside, join(repo.root, "docs"), "dir");

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
    expect(result.stdout).not.toContain("LEAK-01");
  });

  it("requires passed evidence and verifies its source at head", () => {
    const repo = createRepository();
    const withoutEvidence = runCli([
      "--root",
      repo.root,
      "--base",
      repo.baseSha,
      "--head",
      repo.headSha,
      "--mode",
      "release",
    ]);
    expect(withoutEvidence.status).toBe(1);
    expect(withoutEvidence.stderr).toContain(
      "review_memory_packet_error:review_passed_evidence_required",
    );

    writeFileSync(join(repo.root, "tests/worktree-only.test.ts"), "// not committed\n");
    const missingSource = runCli([
      "--root",
      repo.root,
      "--base",
      repo.baseSha,
      "--head",
      repo.headSha,
      "--mode",
      "release",
      "--check",
      "full-suite:passed:tests/worktree-only.test.ts",
    ]);
    expect(missingSource.status).toBe(1);
    expect(missingSource.stderr).toContain(
      "review_memory_packet_error:review_check_source_missing",
    );
  });

  it("preserves unusual Git paths using NUL-delimited parsing", () => {
    const repo = createRepository();
    const unusual = ["src/tab\tname.ts", 'src/quote"name.ts', "src/back\\slash.ts"];
    for (const path of unusual) writeFileSync(join(repo.root, path), "// unusual\n");
    git(repo.root, ["add", "."]);
    git(repo.root, ["commit", "-q", "-m", "unusual paths"]);
    const headSha = git(repo.root, ["rev-parse", "HEAD"]).trim();

    const result = runCli([
      "--root",
      repo.root,
      "--base",
      repo.headSha,
      "--head",
      headSha,
      "--mode",
      "delta",
      "--affected",
      "MM-01",
      "--check",
      "focused-state:passed:tests/state.test.ts",
    ]);

    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout) as { changed_files: string[] }).changed_files).toEqual(
      unusual.sort(),
    );
  });

  it("fails closed on a newline in a Git path without splitting it", () => {
    const repo = createRepository();
    writeFileSync(join(repo.root, "src/line\nbreak.ts"), "// unusual\n");
    git(repo.root, ["add", "."]);
    git(repo.root, ["commit", "-q", "-m", "newline path"]);
    const headSha = git(repo.root, ["rev-parse", "HEAD"]).trim();

    const result = runCli([
      "--root",
      repo.root,
      "--base",
      repo.headSha,
      "--head",
      headSha,
      "--mode",
      "delta",
      "--affected",
      "MM-01",
      "--check",
      "focused-state:passed:tests/state.test.ts",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "review_memory_packet_error:invalid_review_path",
    );
  });

  it("keeps deleted paths inside the fixed-diff boundary", () => {
    const repo = createRepository();
    unlinkSync(join(repo.root, "src/state.ts"));
    git(repo.root, ["add", "-A"]);
    git(repo.root, ["commit", "-q", "-m", "delete state"]);
    const headSha = git(repo.root, ["rev-parse", "HEAD"]).trim();

    const result = runCli([
      "--root",
      repo.root,
      "--base",
      repo.headSha,
      "--head",
      headSha,
      "--mode",
      "delta",
      "--affected",
      "MM-01",
      "--check",
      "focused-state:passed:tests/state.test.ts",
    ]);

    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout) as { changed_files: string[] }).changed_files).toEqual([
      "src/state.ts",
    ]);
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
    git(repo.root, ["add", "-A"]);
    git(repo.root, ["commit", "-q", "-m", "symlink memory"]);
    const symlinkHead = git(repo.root, ["rev-parse", "HEAD"]).trim();

    const result = runCli([
      "--root",
      repo.root,
      "--base",
      repo.baseSha,
      "--head",
      symlinkHead,
      "--mode",
      "release",
      "--check",
      "full-suite:passed:tests/state.test.ts",
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
