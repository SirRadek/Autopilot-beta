import { chmodSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hooksPath = "scripts/git-hooks";
const absoluteHooksPath = resolve(root, hooksPath).replaceAll("\\", "/");
const hooks = ["pre-commit", "commit-msg", "pre-push"];

function git(args) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

if (git(["rev-parse", "--git-dir"]).status !== 0) {
  console.log("[autopilot:hooks] no Git repository found; skipping hook install");
  process.exit(0);
}

for (const hook of hooks) {
  const path = join(root, hooksPath, hook);
  if (!existsSync(path)) {
    console.error(`[autopilot:hooks] missing hook file: ${path}`);
    process.exit(1);
  }

  try {
    chmodSync(path, 0o755);
  } catch {
    // Best effort. Windows Git Bash can still execute hook files through sh.
  }
}

const current = git(["config", "--local", "--get", "core.hooksPath"]);
const currentPath = current.status === 0 ? current.stdout.trim().replaceAll("\\", "/") : "";

if (currentPath === hooksPath) {
  console.log(`[autopilot:hooks] already configured core.hooksPath=${hooksPath}`);
  process.exit(0);
}

if (currentPath === absoluteHooksPath) {
  const configured = git(["config", "--local", "core.hooksPath", hooksPath]);
  if (configured.status !== 0) {
    console.error("[autopilot:hooks] failed to repair absolute core.hooksPath");
    console.error(configured.stderr.trim());
    process.exit(configured.status ?? 1);
  }

  console.log(
    `[autopilot:hooks] repaired absolute core.hooksPath=${currentPath} to relative ${hooksPath} for worktree-correct hooks`
  );
  process.exit(0);
}

if (currentPath) {
  console.warn(
    `[autopilot:hooks] WARNING: existing foreign core.hooksPath=${currentPath}; leaving it unchanged. ` +
      `Autopilot git gates are NOT active until you run "git config core.hooksPath ${hooksPath}" after merging local hooks.`
  );
  process.exit(0);
}

const configured = git(["config", "--local", "core.hooksPath", hooksPath]);
if (configured.status !== 0) {
  console.error("[autopilot:hooks] failed to configure core.hooksPath");
  console.error(configured.stderr.trim());
  process.exit(configured.status ?? 1);
}

console.log(`[autopilot:hooks] configured core.hooksPath=${hooksPath}`);
