import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildReviewMemoryPacket,
  extractReviewMemoryDocument,
  type ReviewMemoryDecision,
  type ReviewMode,
  type ReviewTestEvidence,
} from "../src/data/delivery-system/reviewMemory";

export interface ReviewMemoryPacketCliIo {
  readonly writeOut: (value: string) => void;
  readonly writeError: (value: string) => void;
}

interface ParsedArguments {
  readonly root: string;
  readonly base: string;
  readonly head: string;
  readonly mode: ReviewMode;
  readonly affected: readonly string[];
  readonly noMemoryReason: string | null;
  readonly checks: readonly string[];
}

const DEFAULT_IO: ReviewMemoryPacketCliIo = {
  writeOut: (value) => process.stdout.write(value),
  writeError: (value) => process.stderr.write(value),
};

function fail(code: string): never {
  throw new Error(code);
}

function takeValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    fail(`missing_argument_value:${flag}`);
  }
  return value;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  let root: string | null = null;
  let base: string | null = null;
  let head: string | null = null;
  let mode: ReviewMode | null = null;
  let noMemoryReason: string | null = null;
  const affected: string[] = [];
  const checks: string[] = [];

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (flag === undefined || !flag.startsWith("--")) {
      fail("invalid_review_memory_argument");
    }
    const value = takeValue(args, index, flag);
    switch (flag) {
      case "--root":
        if (root !== null) fail("duplicate_review_root");
        root = value;
        break;
      case "--base":
        if (base !== null) fail("duplicate_review_base");
        base = value;
        break;
      case "--head":
        if (head !== null) fail("duplicate_review_head");
        head = value;
        break;
      case "--mode":
        if (mode !== null || (value !== "delta" && value !== "release")) {
          fail("invalid_review_mode");
        }
        mode = value;
        break;
      case "--affected":
        affected.push(value);
        break;
      case "--no-memory-reason":
        if (noMemoryReason !== null) fail("duplicate_no_memory_reason");
        noMemoryReason = value;
        break;
      case "--check":
        checks.push(value);
        break;
      default:
        fail(`unknown_review_memory_argument:${flag}`);
    }
  }

  if (root === null || base === null || head === null || mode === null) {
    fail("required_review_memory_argument_missing");
  }
  if (affected.length > 0 && noMemoryReason !== null) {
    fail("review_memory_decision_conflict");
  }
  if (mode === "delta" && affected.length === 0 && noMemoryReason === null) {
    fail("review_memory_decision_required");
  }
  if (mode === "release" && (affected.length > 0 || noMemoryReason !== null)) {
    fail("release_review_cannot_narrow_memory");
  }

  return { root, base, head, mode, affected, noMemoryReason, checks };
}

function resolveProjectRoot(value: string): string {
  let root: string;
  try {
    root = realpathSync(value);
  } catch {
    fail("review_root_invalid");
  }
  if (!statSync(root).isDirectory() || !existsSync(join(root, ".git"))) {
    fail("review_root_not_git_repository");
  }
  const gitEntry = lstatSync(join(root, ".git"));
  if (!gitEntry.isDirectory() && !gitEntry.isFile()) {
    fail("review_root_not_git_repository");
  }
  return root;
}

function git(root: string, args: readonly string[], errorCode: string): string {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    shell: false,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error !== undefined) fail(errorCode);
  return result.stdout;
}

function resolveCommit(root: string, ref: string): string {
  const output = git(
    root,
    ["rev-parse", "--verify", `${ref}^{commit}`],
    "git_ref_invalid",
  ).trim();
  if (!/^[a-f0-9]{40}$/.test(output)) fail("git_ref_invalid");
  return output;
}

function changedFiles(root: string, base: string, head: string): string[] {
  return git(
    root,
    ["diff", "--name-only", "--diff-filter=ACMR", `${base}..${head}`, "--"],
    "git_diff_failed",
  )
    .split(/\r?\n/)
    .filter(Boolean);
}

function discoverMemoryDocuments(root: string) {
  const memoryDirectory = join(root, "docs", "superpowers", "review-memory");
  if (!existsSync(memoryDirectory)) fail("review_memory_directory_missing");
  const directoryEntry = lstatSync(memoryDirectory);
  if (directoryEntry.isSymbolicLink() || !directoryEntry.isDirectory()) {
    fail("review_memory_directory_not_regular");
  }

  const names = readdirSync(memoryDirectory)
    .filter((name) => name.endsWith(".md"))
    .sort();
  if (names.length === 0) fail("review_memory_documents_required");

  return names.map((name) => {
    const path = join(memoryDirectory, name);
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1) {
      fail("review_memory_file_not_regular");
    }
    return extractReviewMemoryDocument(
      relative(root, path).replaceAll("\\", "/"),
      readFileSync(path, "utf8"),
    );
  });
}

function parseCheck(value: string): ReviewTestEvidence {
  const parts = value.split(":");
  if (parts.length !== 3) fail("invalid_review_check");
  const [checkId, status, sourcePath] = parts;
  if (status !== "passed" && status !== "failed" && status !== "not_run") {
    fail("invalid_review_check_status");
  }
  return {
    check_id: checkId as string,
    status,
    source_path: sourcePath ? sourcePath : null,
  };
}

function memoryDecision(args: ParsedArguments): ReviewMemoryDecision {
  if (args.mode === "release") return { kind: "release_all" };
  if (args.affected.length > 0) {
    return { kind: "selected", invariant_ids: args.affected };
  }
  return { kind: "none", reason: args.noMemoryReason as string };
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "unknown_review_memory_error";
}

export function runReviewMemoryPacketCli(
  argv: readonly string[],
  io: ReviewMemoryPacketCliIo = DEFAULT_IO,
): number {
  try {
    const args = parseArguments(argv);
    const root = resolveProjectRoot(args.root);
    const baseSha = resolveCommit(root, args.base);
    const headSha = resolveCommit(root, args.head);
    const packet = buildReviewMemoryPacket({
      mode: args.mode,
      base_sha: baseSha,
      head_sha: headSha,
      changed_files: changedFiles(root, baseSha, headSha),
      documents: discoverMemoryDocuments(root),
      memory_decision: memoryDecision(args),
      test_evidence: args.checks.map(parseCheck),
    });
    io.writeOut(`${JSON.stringify(packet, null, 2)}\n`);
    return 0;
  } catch (error) {
    io.writeError(`review_memory_packet_error:${errorCode(error)}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  resolve(invokedPath) === resolve(fileURLToPath(import.meta.url))
) {
  process.exitCode = runReviewMemoryPacketCli(process.argv.slice(2));
}
