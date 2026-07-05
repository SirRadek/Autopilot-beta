#!/usr/bin/env node
// check-baseline-waivers — report-first self-approval gate for baseline "excuse" entries.
//
// A baseline excuse is an entry that suppresses a gate finding:
//   - vendor-manifest.json  : a `beta_authored` file, or a `patched_by` mark on a vendored file
//   - fit-safety-baseline   : a `warn-only` component (id + css hash)
//   - related-files-baseline: a grandfathered MISSING related_files pointer
// The whole-system audit (2026-07-05 §4-B, verification lane V2) found the mechanical root of
// "green but not correct": an author can add BOTH the code and the baseline entry that excuses it
// in ONE commit, with no second signal. This surfaces such growth and asks for a reviewed waiver.
//
// Waiver format (commit message trailer):  Baseline-Waiver: <file-or-all> — <reason>
// Coverage is per baseline file (coarse, report-first): naming the file (basename or repo path)
// or `all` waives its growth in that commit range. This mirrors the `Mesh-Ack:` consent trailer
// the consolidation plan chose — an auditable consent journal, reviewed by the owner in history,
// NOT an unforgeable gate.
//
// Modes:
//   node scripts/check-baseline-waivers.mjs                 -> HEAD vs working tree (local nudge)
//   node scripts/check-baseline-waivers.mjs --range A..B    -> across a pushed/CI commit range
//   ... --strict                                            -> exit 1 on unwaived growth (blocking)
// Report-first default: exits 0 (warn only). Report-first mode never blocks on an internal
// error; `--strict` surfaces a crash as a failure (fail-closed) so a broken gate is visible.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const BASELINE_FILES = [
  { path: "vendor-manifest.json", extract: extractVendorManifestExcuses },
  { path: "product-design-os/qa/fit-safety/fit-safety-baseline.json", extract: extractFitSafetyExcuses },
  { path: "mesh/related-files-baseline.json", extract: extractRelatedFilesExcuses },
];

function extractVendorManifestExcuses(json) {
  const set = new Set();
  for (const entry of json?.beta_authored ?? []) set.add(`beta_authored:${entry}`);
  for (const file of json?.files ?? []) if (file?.patched_by) set.add(`patched_by:${file.source_path}`);
  return set;
}

function extractFitSafetyExcuses(json) {
  const set = new Set();
  // Keyed on id+hash so a re-baselined (hash-changed) component reads as new growth, not a no-op.
  for (const component of json?.components ?? []) set.add(`component:${component.id}:${component.css_sha256}`);
  return set;
}

function extractRelatedFilesExcuses(json) {
  return new Set((json?.missing ?? []).map((pointer) => `missing:${pointer}`));
}

// Parse `Baseline-Waiver: <target>` trailers from commit messages. Target is the first token
// after the colon (a baseline filename, its basename, or `all`); the reason follows a dash.
export function extractWaivedTargets(commitMessages) {
  const set = new Set();
  const re = /^\s*Baseline-Waiver:\s*(\S+)/gim;
  for (const message of commitMessages) {
    let match;
    while ((match = re.exec(message)) !== null) set.add(match[1].replace(/[.,;]+$/, ""));
  }
  return set;
}

/**
 * Pure core. `entries` = [{ path, before: Set<string>, after: Set<string> }]. Returns one finding
 * per baseline file that GREW (added excuse entries) without a covering waiver in commitMessages.
 */
export function findUnwaivedBaselineGrowth(entries, commitMessages) {
  const waived = extractWaivedTargets(commitMessages);
  const findings = [];
  for (const { path, before, after } of entries) {
    const added = [...after].filter((key) => !before.has(key));
    if (added.length === 0) continue;
    const covered = waived.has("all") || waived.has(path) || waived.has(basename(path));
    if (!covered) findings.push({ path, added });
  }
  return findings;
}

function readJsonAt(ref, path) {
  try {
    const text =
      ref === null
        ? existsSync(join(ROOT, path))
          ? readFileSync(join(ROOT, path), "utf8")
          : null
        : execFileSync("git", ["show", `${ref}:${path}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return text ? JSON.parse(text) : {};
  } catch {
    return {}; // absent/unparseable at that ref → treated as no excuses
  }
}

function gitLogMessages(range) {
  try {
    const out = execFileSync("git", ["log", "--format=%B%x00", range], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\0").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function run(argv) {
  const strict = argv.includes("--strict");
  const rangeIdx = argv.indexOf("--range");
  const range = rangeIdx !== -1 ? argv[rangeIdx + 1] : null;

  let baseRef;
  let headRef;
  let commitMessages;
  if (range && range.includes("..")) {
    const [a, b] = range.split("..");
    baseRef = a || null;
    headRef = b || "HEAD";
    commitMessages = gitLogMessages(range);
  } else {
    baseRef = "HEAD"; // compare committed HEAD vs the working tree; no message exists yet
    headRef = null;
    commitMessages = [];
  }

  const entries = BASELINE_FILES.map(({ path, extract }) => ({
    path,
    before: extract(readJsonAt(baseRef, path)),
    after: extract(readJsonAt(headRef, path)),
  }));
  const findings = findUnwaivedBaselineGrowth(entries, commitMessages);

  if (findings.length === 0) {
    console.log("[baseline-waiver] OK: no unwaived baseline-excuse growth.");
    return 0;
  }
  console.warn(`[baseline-waiver] ${strict ? "FAIL" : "WARN"}: baseline-excuse entries added without a Baseline-Waiver: trailer:`);
  for (const finding of findings) {
    const sample = finding.added.slice(0, 5).join(", ");
    console.warn(`  ${finding.path}  (+${finding.added.length}): ${sample}${finding.added.length > 5 ? ", …" : ""}`);
  }
  console.warn("  If intentional, add to the commit message:  Baseline-Waiver: <file> — <reason reviewed by owner>");
  return strict ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const strict = process.argv.includes("--strict");
  try {
    process.exit(run(process.argv.slice(2)));
  } catch (error) {
    // Report-first mode never blocks on an internal error; `--strict` surfaces a crash as a failure
    // (fail-closed) so a broken gate is visible.
    console.warn(`[baseline-waiver] WARN: check could not complete: ${error?.message ?? error}`);
    process.exit(strict ? 1 : 0);
  }
}
