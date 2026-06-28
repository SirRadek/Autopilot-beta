// CLI for the bind-point ① related_files status checker + ratchet gate.
//
//   # one-shot report (exit nonzero on ANY missing/stale):
//   tsx related-files-status-cli.ts --root <repo> [--nodes-subdir <dir>] [--prior snap.json] [--snapshot-out snap.json]
//
//   # per-project mesh lives at <project>/.autopilot/decision-mesh/nodes:
//   tsx related-files-status-cli.ts --root <project> --nodes-subdir .autopilot/decision-mesh/nodes
//
//   # freeze the current known-missing set as a ratchet floor:
//   tsx related-files-status-cli.ts --root <repo> --write-baseline floor.json
//
//   # ratchet gate (exit nonzero ONLY on NEW rot vs the floor — known rot is allowed):
//   tsx related-files-status-cli.ts --root <repo> --baseline floor.json
//
// Read-only; `--root` may point at any repo with a mesh dir without mutating it.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  computeRelatedFilesStatus,
  currentMissingKeys,
  diffAgainstBaseline,
  type ComputeOptions,
  type RelatedFileEntry,
} from "./related-files-status";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const root = arg("--root") ?? process.cwd();
const nodesSubdir = arg("--nodes-subdir");
const priorPath = arg("--prior");
const snapshotOut = arg("--snapshot-out");
const writeBaseline = arg("--write-baseline");
const baselinePath = arg("--baseline");

const prior =
  priorPath !== undefined && existsSync(priorPath)
    ? (JSON.parse(readFileSync(priorPath, "utf8")) as Record<string, string>)
    : undefined;

const opts: ComputeOptions = {};
if (nodesSubdir !== undefined) opts.nodesSubdir = nodesSubdir;
if (prior !== undefined) opts.prior = prior;

// --write-baseline: freeze the current known-missing set as the ratchet floor and exit.
if (writeBaseline !== undefined) {
  const report = computeRelatedFilesStatus(root, nodesSubdir !== undefined ? { nodesSubdir } : {});
  const missing = currentMissingKeys(report);
  writeFileSync(writeBaseline, JSON.stringify({ generatedFrom: root, missing }, null, 2) + "\n");
  console.log(`[related-files] baseline written: ${writeBaseline}`);
  console.log(`  ${missing.length} known-missing hints frozen as the ratchet floor`);
  process.exit(0);
}

const report = computeRelatedFilesStatus(root, opts);
const s = report.summary;

console.log(`[related-files] root=${root}${nodesSubdir !== undefined ? ` nodes=${nodesSubdir}` : ""}`);
console.log(
  `  total=${s.total} VERIFIED=${s.verified} STALE=${s.stale} MISSING=${s.missing} PLACEHOLDER=${s.placeholder}`,
);

// --baseline: ratchet mode — fail only on NEW rot vs the committed floor.
if (baselinePath !== undefined && existsSync(baselinePath)) {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as { missing?: string[] };
  const diff = diffAgainstBaseline(report, baseline.missing ?? []);
  for (const k of diff.resolved) console.log(`  RESOLVED ${k}`);
  for (const k of diff.newMissing) console.log(`  NEW-ROT  ${k}`);
  console.log(`  ratchet: ${diff.newMissing.length} new dead pointer(s) (fail if >0); ${diff.resolved.length} resolved`);
  process.exit(diff.newMissing.length > 0 ? 1 : 0);
}

// default strict mode: report bad hints and fail on any of them.
const bad = report.entries.filter((e: RelatedFileEntry) => e.status === "MISSING" || e.status === "STALE");
for (const e of bad.slice(0, 50)) {
  console.log(`  ${e.status.padEnd(11)} ${e.node} -> ${e.relatedFile}`);
}

if (snapshotOut !== undefined) {
  writeFileSync(snapshotOut, JSON.stringify(report.snapshot, null, 2) + "\n");
  console.log(`  snapshot written: ${snapshotOut}`);
}

process.exit(bad.length > 0 ? 1 : 0);
