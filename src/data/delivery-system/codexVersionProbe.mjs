import { execFileSync } from "node:child_process";

export function readCodexVersion(command = "codex") {
  return execFileSync(command, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
