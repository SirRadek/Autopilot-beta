#!/usr/bin/env node
// Design token lint: forbids raw hex colours in cockpit CSS outside the token
// definition file. Colours must be referenced via var(--token). Keeps the
// design tokens the single source of truth and prevents palette drift.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cssRoot = join(repoRoot, "cockpit", "src");
const TOKENS_FILE = join(repoRoot, "cockpit", "src", "app", "tokens.css");
const HEX = /#[0-9a-fA-F]{3,8}\b/;

function collectCss(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...collectCss(full));
    } else if (entry.endsWith(".css") && full !== TOKENS_FILE) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];
for (const file of collectCss(cssRoot)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    const match = HEX.exec(line);
    if (match) violations.push({ file: relative(repoRoot, file), line: index + 1, value: match[0] });
  });
}

for (const v of violations) {
  console.error(`✗ ${v.file}:${v.line} — raw hex "${v.value}" (use var(--token) from tokens.css)`);
}
console.log(`Design token lint ${violations.length === 0 ? "passed" : "FAILED"}.`);
console.log(`Violations: ${violations.length}`);
if (violations.length > 0) process.exitCode = 1;
