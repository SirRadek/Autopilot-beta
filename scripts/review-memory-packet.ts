import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildReviewMemoryPacket,
  extractReviewMemoryDocument,
  normalizeReviewRepositoryPath,
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
  return gitBuffer(root, args, errorCode).toString("utf8");
}

function gitBuffer(
  root: string,
  args: readonly string[],
  errorCode: string,
): Buffer {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "buffer",
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
  return splitNul(
    gitBuffer(
      root,
      [
        "diff",
        "--name-only",
        "-z",
        `${base}..${head}`,
        "--",
      ],
      "git_diff_failed",
    ),
  );
}

interface GitTreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly objectId: string;
  readonly path: string;
}

function splitNul(output: Buffer): string[] {
  const decoded = output.toString("utf8");
  if (decoded.includes("\uFFFD")) fail("git_path_encoding_invalid");
  return decoded.split("\0").filter(Boolean);
}

function parseTreeEntries(output: Buffer): GitTreeEntry[] {
  return splitNul(output).map((record) => {
    const match = /^([0-9]{6}) ([a-z]+) ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(
      record,
    );
    if (match === null) fail("git_tree_invalid");
    return {
      mode: match[1] as string,
      type: match[2] as string,
      objectId: match[3] as string,
      path: match[4] as string,
    };
  });
}

function treeEntries(
  root: string,
  head: string,
  path: string,
  recursive = false,
): GitTreeEntry[] {
  return parseTreeEntries(
    gitBuffer(
      root,
      ["ls-tree", "-z", ...(recursive ? ["-r"] : []), head, "--", path],
      "git_tree_failed",
    ),
  );
}

function isRegularBlob(entry: GitTreeEntry): boolean {
  return (
    entry.type === "blob" &&
    (entry.mode === "100644" || entry.mode === "100755")
  );
}

function discoverMemoryDocuments(root: string, head: string) {
  const directoryPath = "docs/superpowers/review-memory";
  const directory = treeEntries(root, head, directoryPath).find(
    (entry) => entry.path === directoryPath,
  );
  if (directory === undefined) fail("review_memory_directory_missing");
  if (directory.type !== "tree" || directory.mode !== "040000") {
    fail("review_memory_directory_not_regular");
  }

  const prefix = `${directoryPath}/`;
  const entries = treeEntries(root, head, directoryPath, true)
    .filter(
      (entry) =>
        entry.path.startsWith(prefix) &&
        !entry.path.slice(prefix.length).includes("/") &&
        entry.path.endsWith(".md"),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  if (entries.length === 0) fail("review_memory_documents_required");

  return entries.map((entry) => {
    if (!isRegularBlob(entry)) fail("review_memory_file_not_regular");
    return extractReviewMemoryDocument(
      entry.path,
      git(
        root,
        ["cat-file", "blob", entry.objectId],
        "review_memory_blob_read_failed",
      ),
    );
  });
}

function verifyEvidenceSources(
  root: string,
  head: string,
  evidence: readonly ReviewTestEvidence[],
): void {
  for (const item of evidence) {
    if (item.source_path === null) continue;
    const exact = treeEntries(root, head, item.source_path).find(
      (entry) => entry.path === item.source_path,
    );
    if (exact === undefined || !isRegularBlob(exact)) {
      fail("review_check_source_missing");
    }
  }
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
    source_path: sourcePath
      ? normalizeReviewRepositoryPath(sourcePath)
      : null,
    attestation: "self_reported",
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
    const evidence = args.checks.map(parseCheck);
    verifyEvidenceSources(root, headSha, evidence);
    const packet = buildReviewMemoryPacket({
      mode: args.mode,
      base_sha: baseSha,
      head_sha: headSha,
      changed_files: changedFiles(root, baseSha, headSha),
      documents: discoverMemoryDocuments(root, headSha),
      memory_decision: memoryDecision(args),
      test_evidence: evidence,
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
