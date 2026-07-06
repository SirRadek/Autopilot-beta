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
const regenSnapshot = arg("--regen-snapshot");

// Fail-CLOSED on a broken drift input. The prior audit found that a missing/empty `--prior` silently
// yielded STALE=0 EXIT=0 — i.e. the drift detector went inert with no warning, one deleted/mistyped
// snapshot away from being a no-op. If `--prior` is given it MUST resolve to a non-empty object, else
// we refuse to run rather than pass green. Refreshing is still human-gated via `npm run mesh:snapshot:regen`.
function loadPriorOrDie(p: string): Record<string, string> {
  if (!existsSync(p)) {
    console.error(
      `[related-files] --prior snapshot not found: ${p}\n` +
        "  refusing to run drift-blind (fail-closed); regenerate with `npm run mesh:snapshot:regen` and commit it.",
    );
    process.exit(2);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    console.error(`[related-files] --prior snapshot is not valid JSON: ${p} (fail-closed)`);
    process.exit(2);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error(`[related-files] --prior snapshot is not a JSON object: ${p} (fail-closed)`);
    process.exit(2);
  }
  const obj = parsed as Record<string, unknown>;
  if (Object.keys(obj).length === 0) {
    console.error(
      `[related-files] --prior snapshot is empty: ${p}\n` +
        "  an empty snapshot makes every hint drift-blind; regenerate with `npm run mesh:snapshot:regen` (fail-closed).",
    );
    process.exit(2);
  }
  return obj as Record<string, string>;
}

const prior = priorPath !== undefined ? loadPriorOrDie(priorPath) : undefined;

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

// --regen-snapshot: (re)write the prior-hash drift snapshot from the current tree and exit. This is
// the HUMAN-GATE for STALE: run it DELIBERATELY after reviewing that a drifted node's guidance still
// holds. NEVER wire it into a hook — an automatic regen would launder drift as "verified" with no one
// confirming the node still matches the edited file (the whole point of STALE detection).
if (regenSnapshot !== undefined) {
  const report = computeRelatedFilesStatus(root, nodesSubdir !== undefined ? { nodesSubdir } : {});
  writeFileSync(regenSnapshot, JSON.stringify(report.snapshot, null, 2) + "\n");
  console.log(`[related-files] snapshot regenerated: ${regenSnapshot}`);
  console.log(`  ${Object.keys(report.snapshot).length} file hints hashed as the new drift baseline`);
  process.exit(0);
}

const report = computeRelatedFilesStatus(root, opts);
const s = report.summary;

console.log(`[related-files] root=${root}${nodesSubdir !== undefined ? ` nodes=${nodesSubdir}` : ""}`);
console.log(
  `  total=${s.total} VERIFIED=${s.verified} STALE=${s.stale} MISSING=${s.missing} PLACEHOLDER=${s.placeholder} UNSNAPSHOTTED=${s.unsnapshotted}`,
);

// --baseline: ratchet mode — fail only on NEW rot vs the committed floor.
if (baselinePath !== undefined && existsSync(baselinePath)) {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as { missing?: string[] };
  const diff = diffAgainstBaseline(report, baseline.missing ?? []);
  const staleEntries = report.entries.filter((e: RelatedFileEntry) => e.status === "STALE");
  const unsnapshotted = report.entries.filter((e: RelatedFileEntry) => e.status === "UNSNAPSHOTTED");
  for (const k of diff.resolved) console.log(`  RESOLVED ${k}`);
  for (const k of diff.newMissing) console.log(`  NEW-ROT  ${k}`);
  for (const e of staleEntries) console.log(`  STALE    ${e.node} -> ${e.relatedFile} (content drifted from snapshot)`);
  for (const e of unsnapshotted)
    console.log(`  UNSNAPSHOTTED ${e.node} -> ${e.relatedFile} (file hint missing from the committed snapshot)`);
  console.log(
    `  ratchet: ${diff.newMissing.length} new dead pointer(s) + ${staleEntries.length} stale + ${unsnapshotted.length} unsnapshotted (fail if >0); ${diff.resolved.length} resolved`,
  );
  if (staleEntries.length > 0 || unsnapshotted.length > 0) {
    console.log(
      "  -> review whether each STALE/UNSNAPSHOTTED node's guidance still matches the file, then run `npm run mesh:snapshot:regen` and commit the refreshed snapshot.",
    );
  }
  process.exit(diff.newMissing.length > 0 || staleEntries.length > 0 || unsnapshotted.length > 0 ? 1 : 0);
}

// default strict mode: report bad hints and fail on any of them.
const bad = report.entries.filter(
  (e: RelatedFileEntry) => e.status === "MISSING" || e.status === "STALE" || e.status === "UNSNAPSHOTTED",
);
for (const e of bad.slice(0, 50)) {
  console.log(`  ${e.status.padEnd(11)} ${e.node} -> ${e.relatedFile}`);
}

if (snapshotOut !== undefined) {
  writeFileSync(snapshotOut, JSON.stringify(report.snapshot, null, 2) + "\n");
  console.log(`  snapshot written: ${snapshotOut}`);
}

process.exit(bad.length > 0 ? 1 : 0);
