import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const skipDirectoryNames = new Set([
  "node_modules",
  ".git",
  ".claude",
  "dist",
  "build",
  "coverage",
  ".vitest",
  ".next",
  "tmp",
]);
const sourceFileExtensions = new Set([".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs"]);
const laneImportAllowedPrefixes = [
  "src/governed-core/",
  "src/data/delivery-system/",
  "tests/",
];
const vendorSpawnAllowedPrefixes = laneImportAllowedPrefixes;
const lanePrefix = "src/data/delivery-system/";
const forbiddenImportPattern =
  /\bfrom\s+["'][^"']*(?:cliWorker|cliWorkerCapture)["']|\bimport\s*\(\s*["'][^"']*(?:cliWorker|cliWorkerCapture)["']\s*\)/;
const forbiddenVendorSpawnPattern =
  /\b(?:spawn|spawnSync|exec|execFile|execFileSync)\s*\(\s*["'`](?:codex|agy|gemini|qwen)["'`]/;
const forbiddenNodePtyImportPattern =
  /\bfrom\s+["'`]node-pty["'`]|\bimport\(\s*["'`]node-pty["'`]/;
const forbiddenFullEnvPatterns = [
  /env\s*:\s*process\.env\b/,
  /env\s*:\s*\{\s*\.\.\.\s*process\.env/,
];

describe("governed dispatch boundary", () => {
  it("keeps the vendor spawn lane reachable only from governed-core or the lane itself", () => {
    const violations = sourceFiles(repoRoot).flatMap((file) => {
      const rel = normalizePath(relative(repoRoot, file));
      if (laneImportAllowedPrefixes.some((prefix) => rel.startsWith(prefix))) {
        return [];
      }

      return readFileSync(file, "utf8")
        .split(/\r?\n/)
        .flatMap((line, index) =>
          forbiddenImportPattern.test(line) ? [`${rel}:${index + 1}`] : []
        );
    });

    expect(violations).toEqual([]);
  });

  it("keeps vendor CLI process creation inside governed-core, tests, or the lane", () => {
    const violations = sourceFiles(repoRoot).flatMap((file) => {
      const rel = normalizePath(relative(repoRoot, file));
      if (vendorSpawnAllowedPrefixes.some((prefix) => rel.startsWith(prefix))) {
        return [];
      }

      return readFileSync(file, "utf8")
        .split(/\r?\n/)
        .flatMap((line, index) =>
          forbiddenVendorSpawnPattern.test(line) || forbiddenNodePtyImportPattern.test(line)
            ? [`${rel}:${index + 1}`]
            : []
        );
    });

    expect(violations).toEqual([]);
  });

  it("keeps the vendor lane from passing the full host env to spawned processes", () => {
    const violations = sourceFiles(repoRoot).flatMap((file) => {
      const rel = normalizePath(relative(repoRoot, file));
      if (!rel.startsWith(lanePrefix)) {
        return [];
      }

      return readFileSync(file, "utf8")
        .split(/\r?\n/)
        .flatMap((line, index) =>
          forbiddenFullEnvPatterns.some((pattern) => pattern.test(line)) ? [`${rel}:${index + 1}`] : []
        );
    });

    expect(violations).toEqual([]);
  });
});

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (skipDirectoryNames.has(entry.name)) {
        return [];
      }
      const path = join(dir, entry.name);
      return sourceFiles(path);
    }

    if (!entry.isFile()) {
      return [];
    }

    const dot = entry.name.lastIndexOf(".");
    if (dot === -1 || !sourceFileExtensions.has(entry.name.slice(dot))) {
      return [];
    }

    return [join(dir, entry.name)];
  });
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}
