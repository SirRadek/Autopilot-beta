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

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync, writeFileSync, existsSync } from "node:fs";
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
const BETA_AUTHORED_SEED = ["product-design-os/recipes/recipe.schema.json"];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// A caller-inherited GIT_DIR/GIT_WORK_TREE would make every child `git` here resolve the CALLER's
// repository instead of `root` — the pre-push hook leaked exactly that and a temp-repo `git init`
// in the tests corrupted the host .git/config (core.bare). The hook now unsets these (lib.sh), but
// this gate must be safe under ANY caller: scrub them before shelling out to git.
function gitScrubbedEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;
  return env;
}

function collectVendoredFiles(root = ROOT, vendorRoots = VENDOR_ROOTS) {
  const files = [];
  for (const vendorRoot of vendorRoots) {
    const abs = join(root, vendorRoot);
    if (!existsSync(abs)) continue;
    // git ls-files honors .gitignore: tracked (--cached) + untracked-but-not-ignored
    // (--others --exclude-standard). Gitignored crash litter (e.g. *.stackdump) is excluded
    // so it can't turn the gate red, while a genuinely untracked vendored file still reaches
    // the UNTRACKED provenance check below. -z keeps paths with odd chars intact.
    const out = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", vendorRoot],
      { cwd: root, encoding: "utf8", env: gitScrubbedEnv() }
    );
    for (const rel of out.split("\0")) {
      if (!rel) continue;
      const full = join(root, rel);
      if (existsSync(full) && statSync(full).isFile()) files.push(full);
    }
  }
  // POSIX-style relative paths so the manifest is OS-stable.
  return files
    .map((f) => relative(root, f).split(sep).join("/"))
    .sort();
}

function generate({ root = ROOT, manifestPath = MANIFEST_PATH, vendorRoots = VENDOR_ROOTS } = {}) {
  // Preserve baseline hash + patched_by for files a phase already patched:
  // re-generating must NOT re-baseline a patched file to its modified content
  // (that would destroy the merge-back anchor). Pristine/new files are hashed live.
  const priorManifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : { files: [], beta_authored: [] };
  const priorFiles = Array.isArray(priorManifest.files) ? priorManifest.files : [];
  const priorBetaAuthored = Array.isArray(priorManifest.beta_authored) ? priorManifest.beta_authored : [];
  const prior = new Map(priorFiles.map((e) => [e.source_path, e]));
  const betaAuthored = [...new Set([...priorBetaAuthored, ...BETA_AUTHORED_SEED])].sort();
  const betaAuthoredSet = new Set(betaAuthored);
  const files = collectVendoredFiles(root, vendorRoots)
    .filter((source_path) => !betaAuthoredSet.has(source_path))
    .map((source_path) => {
      const was = prior.get(source_path);
      if (was?.patched_by) {
        return { source_path, canonical_sha: CANONICAL_SHA, content_hash: was.content_hash, patched_by: was.patched_by };
      }
      return {
        source_path,
        canonical_sha: CANONICAL_SHA,
        content_hash: sha256(readFileSync(join(root, source_path))),
      };
    });
  const manifest = {
    schema: "autopilot-beta/vendor-manifest@1",
    canonical_repo: "autopilot",
    canonical_sha: CANONICAL_SHA,
    note:
      "Byte-identical vendor of pinned contracts from autopilot@canonical_sha. " +
      "No shared git history; provenance + drift are held here. See plan §2.2-2.4.",
    file_count: files.length,
    beta_authored: betaAuthored,
    files,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`[vendor-manifest] wrote ${files.length} entries (base ${CANONICAL_SHA.slice(0, 12)}).`);
}

// Throws on any provenance problem (missing manifest, drift, missing, or untracked vendored
// file) after printing the human-readable detail; returns silently on a clean tree. The CLI
// runner turns a throw into exit 1, so the gate behavior is unchanged — the throw is what makes
// the airlock unit-testable (a regression that neuters a check now fails a test, not just prod).
function verify({ root = ROOT, manifestPath = MANIFEST_PATH, vendorRoots = VENDOR_ROOTS } = {}) {
  if (!existsSync(manifestPath)) {
    console.error("[vendor-check] FAIL: vendor-manifest.json missing. Run: npm run beta:vendor-manifest");
    throw new Error("vendor-manifest.json missing");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // content_hash is the PINNED canonical baseline and never changes — it is the
  // merge-back anchor. `patched_by` marks a vendored file that a beta phase has
  // intentionally modified: its content is *expected* to differ from baseline,
  // and `current vs baseline` is precisely the patch that can merge back.
  const expected = new Map(manifest.files.map((e) => [e.source_path, e]));
  const betaAuthored = new Set([...(Array.isArray(manifest.beta_authored) ? manifest.beta_authored : []), ...BETA_AUTHORED_SEED]);
  const actual = collectVendoredFiles(root, vendorRoots);

  const drift = []; // pristine file changed (accidental drift — a real problem)
  const missing = []; // in manifest, not on disk
  const untracked = []; // on disk under vendor roots, not in manifest
  const patched = []; // intentionally patched by a phase, differs as expected (OK)
  const patchReverted = []; // marked patched but matches baseline — patch absent

  for (const [source_path, entry] of expected) {
    const abs = join(root, source_path);
    if (!existsSync(abs)) {
      missing.push(source_path);
      continue;
    }
    const matches = sha256(readFileSync(abs)) === entry.content_hash;
    if (entry.patched_by) {
      if (matches) patchReverted.push(`${source_path} (${entry.patched_by})`);
      else patched.push(`${source_path} (${entry.patched_by})`);
    } else if (!matches) {
      drift.push(source_path);
    }
  }
  for (const f of actual) {
    if (expected.has(f)) continue;
    if (betaAuthored.has(f)) {
      console.log(`[vendor-check] AUTHORED  ${f}  (beta-authored, no canonical provenance)`);
      continue;
    }
    untracked.push(f);
  }

  // Informational lines (do not fail the gate): intentional phase patches.
  for (const f of patched) console.log(`[vendor-check] PATCHED   ${f}  (intentional phase diff vs baseline — merge-back unit)`);
  for (const f of patchReverted) console.warn(`[vendor-check] NOTE      ${f}  (marked patched but matches baseline — expected patch absent?)`);

  const problems = drift.length + missing.length + untracked.length;
  if (problems === 0) {
    const pristine = expected.size - patched.length - patchReverted.length;
    console.log(
      `[vendor-check] OK: ${pristine} pristine + ${patched.length} patched vendored files (base ${manifest.canonical_sha.slice(0, 12)}).`,
    );
    return;
  }
  console.error(`[vendor-check] FAIL: ${problems} provenance problem(s) vs autopilot@${manifest.canonical_sha.slice(0, 12)}:`);
  for (const f of drift) console.error(`  DRIFT     ${f}  (pristine vendored file changed vs baseline — not marked patched_by)`);
  for (const f of missing) console.error(`  MISSING   ${f}  (in manifest, absent on disk)`);
  for (const f of untracked) console.error(`  UNTRACKED ${f}  (under vendor root, not in manifest — re-run --generate if intentional)`);
  throw new Error(`${problems} provenance problem(s)`);
}

export { collectVendoredFiles, generate, verify, gitScrubbedEnv, CANONICAL_SHA, VENDOR_ROOTS };

// CLI entry: run only when invoked directly (not when imported by a test). A throw from
// verify()/generate() becomes exit 1, preserving the gate's original fail behavior.
const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    if (process.argv.includes("--generate")) generate();
    else verify();
  } catch {
    process.exit(1);
  }
}
