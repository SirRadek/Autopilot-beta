import { readFileSync, writeFileSync } from "node:fs";

import {
  curateSkillManifests,
  type SkillCurationRule,
  type SkillManifest
} from "../src/data/delivery-system/skillRegistry";

interface Allowlist {
  readonly sources: Readonly<Record<string, {
    readonly commitSha: string;
    readonly skills: readonly { readonly id: string; readonly trust: "reviewed" | "approved" }[];
  }>>;
}

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key?.startsWith("--") && value !== undefined) args.set(key.slice(2), value);
}

const candidatesPath = required("candidates");
const allowlistPath = required("allowlist");
const outputPath = required("output");
const candidates = JSON.parse(readFileSync(candidatesPath, "utf8")) as SkillManifest[];
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8")) as Allowlist;
const rules: SkillCurationRule[] = Object.values(allowlist.sources).flatMap((source) =>
  source.skills.map((skill) => ({ id: skill.id, sourceCommitSha: source.commitSha, trust: skill.trust }))
);
const curated = curateSkillManifests(candidates, rules);
writeFileSync(outputPath, `${JSON.stringify(curated, null, 2)}\n`, "utf8");
process.stdout.write(`curated=${curated.length}\n`);

function required(name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`usage: tsx scripts/curate-skill-manifests.ts --candidates FILE --allowlist FILE --output FILE`);
  return value;
}
