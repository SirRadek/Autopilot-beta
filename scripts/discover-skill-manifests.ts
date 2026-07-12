import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { discoverSkillManifest, type SkillManifest } from "../src/data/delivery-system/skillRegistry";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key?.startsWith("--") && value !== undefined) args.set(key.slice(2), value);
}

const root = args.get("root");
const locator = args.get("locator");
const commit = args.get("commit");
const output = args.get("output");

if (!root || !locator || !commit) {
  throw new Error("usage: tsx scripts/discover-skill-manifests.ts --root ROOT --locator LOCATOR --commit SHA [--output FILE]");
}

if (!existsSync(root)) throw new Error(`skill_discovery_root_missing: ${root}`);

const manifests: SkillManifest[] = [];
for (const path of findSkillDocuments(root)) {
  const relativeSkillPath = relative(root, path).replace(/[/\\]SKILL\.md$/, "");
  manifests.push(discoverSkillManifest(root, { sourceLocator: locator, sourceCommitSha: commit, relativeSkillPath }));
}
manifests.sort((left, right) => left.id.localeCompare(right.id));

const serialized = `${JSON.stringify(manifests, null, 2)}\n`;
if (output) writeFileSync(output, serialized, "utf8");
else process.stdout.write(serialized);

function findSkillDocuments(directory: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...findSkillDocuments(path));
    else if (entry.isFile() && entry.name === "SKILL.md") results.push(path);
  }
  return results;
}
