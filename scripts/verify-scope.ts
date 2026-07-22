import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

import {
  resolveVerificationMode,
  type RunProfile,
} from "../src/data/delivery-system/executionProfile";
import type { WorkUnitRisk } from "../src/data/delivery-system/efficiencyPolicy";

export interface VerificationPlanInput {
  readonly profile: RunProfile;
  readonly risk: WorkUnitRisk;
  readonly changedFiles: readonly string[];
}

export interface PlannedCommand {
  readonly file: "npm";
  readonly args: readonly string[];
}

export interface VerificationPlan {
  readonly mode: "diff_scoped" | "full_fail_closed";
  readonly commands: readonly PlannedCommand[];
}

export type CommandExecutor = (
  file: string,
  args: readonly string[],
  options: { readonly stdio: "inherit" },
) => unknown;

export function resolveVerificationPlan(input: VerificationPlanInput): VerificationPlan {
  const mode = resolveVerificationMode(input.profile, input.risk);
  if (mode === "full_fail_closed") {
    return fullVerificationPlan();
  }

  const files = [...new Set(input.changedFiles)].sort();
  if (files.length === 0) throw new Error("verification_change_set_required");
  if (files.some(hasUnsupportedPathCharacter)) {
    throw new Error("verification_change_path_unsupported");
  }
  if (files.some((path) => !isMappedPath(path))) return fullVerificationPlan();

  const commands: PlannedCommand[] = [
    { file: "npm", args: ["run", "runtime:check"] },
    { file: "npm", args: ["run", "typecheck"] },
    {
      file: "npm",
      args: [
        "run",
        "mesh:changed",
        "--",
        "--files",
        files.join(" "),
        "--fail-on-blocker",
        "--fail-on-ungoverned",
      ],
    },
  ];

  if (
    files.some(
      (path) =>
        path.startsWith("src/data/delivery-system/") ||
        path.startsWith("tests/delivery-system/"),
    )
  ) {
    commands.push({ file: "npm", args: ["test", "--", "tests/delivery-system"] });
  }
  if (files.some((path) => path.startsWith("scripts/") || path.startsWith("tests/scripts/"))) {
    commands.push({ file: "npm", args: ["test", "--", "tests/scripts"] });
  }
  if (files.some((path) => path.startsWith("cockpit/"))) {
    commands.push({ file: "npm", args: ["run", "cockpit:test"] });
  }
  if (files.some((path) => path.startsWith("docs/") || path === "README.md")) {
    commands.push({ file: "npm", args: ["run", "docs:links"] });
  }
  return { mode, commands };
}

export function parseGitPorcelain(output: Buffer): readonly string[] {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(output);
  } catch {
    throw new Error("verification_git_porcelain_malformed");
  }
  if (decoded.length === 0) return [];
  if (!decoded.endsWith("\0")) throw new Error("verification_git_porcelain_malformed");

  const records = decoded.slice(0, -1).split("\0");
  const files: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record.length < 4 || record[2] !== " ") {
      throw new Error("verification_git_porcelain_malformed");
    }
    const status = record.slice(0, 2);
    if (!/^[ MTADRCU?!]{2}$/u.test(status) || status === "  ") {
      throw new Error("verification_git_porcelain_malformed");
    }
    const path = record.slice(3);
    if (path.length === 0) throw new Error("verification_git_porcelain_malformed");
    files.push(path);

    if (status.includes("R") || status.includes("C")) {
      index += 1;
      const originalPath = records[index];
      if (originalPath === undefined || originalPath.length === 0) {
        throw new Error("verification_git_porcelain_malformed");
      }
      files.push(originalPath);
    }
  }
  return [...new Set(files)].sort();
}

export function collectWorkingTreeFiles(cwd: string = process.cwd()): readonly string[] {
  const output = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] },
  );
  return parseGitPorcelain(output);
}

export function executeVerificationPlan(
  plan: VerificationPlan,
  execute: CommandExecutor = executeFile,
): void {
  for (const command of plan.commands) {
    execute(command.file, command.args, { stdio: "inherit" });
  }
}

interface CliOptions {
  readonly profile: RunProfile;
  readonly risk: WorkUnitRisk;
  readonly files: readonly string[];
  readonly workingTree: boolean;
  readonly run: boolean;
}

export function runVerifyScopeCli(argv: readonly string[]): VerificationPlan {
  const options = parseCliOptions(argv);
  if (options.workingTree && options.files.length > 0) {
    throw new Error("verification_change_selector_conflict");
  }
  const changedFiles = options.workingTree ? collectWorkingTreeFiles() : options.files;
  const plan = resolveVerificationPlan({
    profile: options.profile,
    risk: options.risk,
    changedFiles,
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (options.run) executeVerificationPlan(plan);
  return plan;
}

function hasUnsupportedPathCharacter(path: string): boolean {
  return path.length === 0 || /[\s\u0000-\u001f\u007f]/u.test(path);
}

function isMappedPath(path: string): boolean {
  return (
    path.startsWith("src/data/delivery-system/") ||
    path.startsWith("tests/delivery-system/") ||
    path.startsWith("scripts/") ||
    path.startsWith("tests/scripts/") ||
    path.startsWith("cockpit/") ||
    path.startsWith("docs/") ||
    path === "README.md"
  );
}

function fullVerificationPlan(): VerificationPlan {
  return {
    mode: "full_fail_closed",
    commands: [
      { file: "npm", args: ["run", "verify"] },
      { file: "npm", args: ["run", "cockpit:test"] },
      { file: "npm", args: ["run", "browser:qa"] },
    ],
  };
}

function executeFile(
  file: string,
  args: readonly string[],
  options: { readonly stdio: "inherit" },
): unknown {
  return execFileSync(file, [...args], options);
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let profile: RunProfile | undefined;
  let risk: WorkUnitRisk | undefined;
  let workingTree = false;
  let run = false;
  const files: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--working-tree") {
      workingTree = true;
    } else if (argument === "--run") {
      run = true;
    } else if (argument === "--profile") {
      const value = argv[++index];
      if (value !== "dev" && value !== "prod") throw new Error("verification_profile_invalid");
      profile = value;
    } else if (argument === "--risk") {
      const value = argv[++index];
      if (value !== "ordinary" && value !== "high") throw new Error("verification_risk_invalid");
      risk = value;
    } else if (argument === "--file") {
      const value = argv[++index];
      if (value === undefined) throw new Error("verification_file_missing");
      files.push(value);
    } else {
      throw new Error("verification_argument_invalid");
    }
  }

  if (profile === undefined) throw new Error("verification_profile_required");
  if (risk === undefined) throw new Error("verification_risk_required");
  return { profile, risk, files, workingTree, run };
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (currentFile === invokedFile) {
  try {
    runVerifyScopeCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "verification_failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
