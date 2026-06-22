#!/usr/bin/env node
// beta:vendor-check — provenance + drift gate for vendored contracts.
//
// Beta is a clean-install separate repo with NO shared git history with the
// canonical `autopilot`. The relationship to canonical is held by this
// manifest, not by git ancestry. Every vendored file records:
//   { source_path, canonical_sha, content_hash }
// content_hash = sha256 of the exact bytes copied from autopilot@<canonical_sha>.
//
// Modes:
//   node scripts/vendor-check.mjs            -> verify (re-hash vendored files vs manifest; exit 1 on drift)
//   node scripts/vendor-check.mjs --generate -> (re)write vendor-manifest.json from current vendored tree
//
// Why byte-identical matters: an additive/report-only change to a vendored file
// diffs cleanly against the pinned canonical baseline, so merge-back is a patch
// (git format-patch), not a manual reimplementation (plan §2.3).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const MANIFEST_PATH = join(ROOT, "vendor-manifest.json");

// Pinned canonical base. The HEAD of canonical autopilot at bootstrap time.
const CANONICAL_SHA = "599785fb710cc01100ae1d5028af433e8fcfabbd";

// Roots that are vendored byte-identically from canonical. Everything under
// these is provenance-tracked. Beta-only files (package.json, tsconfig,
// scripts/, vendor-manifest.json, node_modules, .git) are NOT vendored.
const VENDOR_ROOTS = ["product-design-os", "src"];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function walk(dir, acc) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, acc);
    } else if (st.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

function collectVendoredFiles() {
  const files = [];
  for (const root of VENDOR_ROOTS) {
    const abs = join(ROOT, root);
    if (existsSync(abs)) walk(abs, files);
  }
  // POSIX-style relative paths so the manifest is OS-stable.
  return files
    .map((f) => relative(ROOT, f).split(sep).join("/"))
    .sort();
}

function generate() {
  const files = collectVendoredFiles().map((source_path) => ({
    source_path,
    canonical_sha: CANONICAL_SHA,
    content_hash: sha256(readFileSync(join(ROOT, source_path))),
  }));
  const manifest = {
    schema: "autopilot-beta/vendor-manifest@1",
    canonical_repo: "autopilot",
    canonical_sha: CANONICAL_SHA,
    note:
      "Byte-identical vendor of pinned contracts from autopilot@canonical_sha. " +
      "No shared git history; provenance + drift are held here. See plan §2.2-2.4.",
    file_count: files.length,
    files,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`[vendor-manifest] wrote ${files.length} entries (base ${CANONICAL_SHA.slice(0, 12)}).`);
}

function verify() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error("[vendor-check] FAIL: vendor-manifest.json missing. Run: npm run beta:vendor-manifest");
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const expected = new Map(manifest.files.map((e) => [e.source_path, e.content_hash]));
  const actual = collectVendoredFiles();

  const drift = []; // hash mismatch
  const missing = []; // in manifest, not on disk
  const untracked = []; // on disk under vendor roots, not in manifest

  for (const [source_path, content_hash] of expected) {
    const abs = join(ROOT, source_path);
    if (!existsSync(abs)) {
      missing.push(source_path);
      continue;
    }
    const got = sha256(readFileSync(abs));
    if (got !== content_hash) drift.push(source_path);
  }
  for (const f of actual) {
    if (!expected.has(f)) untracked.push(f);
  }

  const problems = drift.length + missing.length + untracked.length;
  if (problems === 0) {
    console.log(
      `[vendor-check] OK: ${expected.size} vendored files match manifest (base ${manifest.canonical_sha.slice(0, 12)}).`,
    );
    return;
  }
  console.error(`[vendor-check] FAIL: ${problems} provenance problem(s) vs autopilot@${manifest.canonical_sha.slice(0, 12)}:`);
  for (const f of drift) console.error(`  DRIFT     ${f}  (content changed vs pinned baseline)`);
  for (const f of missing) console.error(`  MISSING   ${f}  (in manifest, absent on disk)`);
  for (const f of untracked) console.error(`  UNTRACKED ${f}  (under vendor root, not in manifest — re-run --generate if intentional)`);
  process.exit(1);
}

if (process.argv.includes("--generate")) generate();
else verify();
