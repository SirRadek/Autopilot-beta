// CLI for the bind-point ① related_files status checker.
//   tsx src/lib/mesh-tools/related-files-status-cli.ts --root <repo> [--prior snap.json] [--snapshot-out snap.json]
// Exits nonzero if any hint is MISSING or STALE — usable as a CI gate. Read-only;
// `--root` may point at any repo with a mesh/nodes dir (e.g. the canonical autopilot
// mesh) without mutating it.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { computeRelatedFilesStatus, type RelatedFileEntry } from "./related-files-status";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const root = arg("--root") ?? process.cwd();
const priorPath = arg("--prior");
const snapshotOut = arg("--snapshot-out");

const prior =
  priorPath !== undefined && existsSync(priorPath)
    ? (JSON.parse(readFileSync(priorPath, "utf8")) as Record<string, string>)
    : undefined;

const report = computeRelatedFilesStatus(root, prior !== undefined ? { prior } : {});
const s = report.summary;

console.log(`[related-files] root=${root}`);
console.log(
  `  total=${s.total} VERIFIED=${s.verified} STALE=${s.stale} MISSING=${s.missing} PLACEHOLDER=${s.placeholder}`,
);

const bad = report.entries.filter((e: RelatedFileEntry) => e.status === "MISSING" || e.status === "STALE");
for (const e of bad.slice(0, 50)) {
  console.log(`  ${e.status.padEnd(11)} ${e.node} -> ${e.relatedFile}`);
}

if (snapshotOut !== undefined) {
  writeFileSync(snapshotOut, JSON.stringify(report.snapshot, null, 2) + "\n");
  console.log(`  snapshot written: ${snapshotOut}`);
}

process.exit(bad.length > 0 ? 1 : 0);
