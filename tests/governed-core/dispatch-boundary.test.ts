import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const srcRoot = join(repoRoot, "src");
const allowedPrefixes = [
  "src/governed-core/",
  "src/data/delivery-system/"
];
const forbiddenImportPattern =
  /\bfrom\s+["'][^"']*(?:cliWorker|cliWorkerCapture)["']|\bimport\s*\(\s*["'][^"']*(?:cliWorker|cliWorkerCapture)["']\s*\)/;

describe("governed dispatch boundary", () => {
  it("keeps the vendor spawn lane reachable only from governed-core or the lane itself", () => {
    const violations = sourceFiles(srcRoot).flatMap((file) => {
      const rel = normalizePath(relative(repoRoot, file));
      if (allowedPrefixes.some((prefix) => rel.startsWith(prefix))) {
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
});

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }

    return path.endsWith(".ts") ? [path] : [];
  });
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}
