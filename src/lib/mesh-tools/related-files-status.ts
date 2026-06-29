// Bind-point ① MVP — stateless related_files status checker.
//
// The brainstorm (3 rounds, codex+agy+Opus) settled that a governance mesh whose
// node `related_files` are unverified string hints rots silently: a 2026-06 probe
// measured 29/111 hints already missing/placeholder in the canonical mesh. This is
// the load-bearing fix: resolve every node's `related_files` against the real repo
// ON DEMAND and classify it. Keyed to git blob hashes so "stale" needs no stored DB
// — a hint whose blob hash no longer matches a prior snapshot is STALE by definition.
//
// No SQLite, no ast-grep, no LLM: the falsify-the-need probe proved bind-point ① is
// demonstrable with `git hash-object` semantics + existence checks alone. The heavy
// discovery substrate is deferred until measured pain proves it necessary.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type RelatedFileStatus = "VERIFIED" | "STALE" | "MISSING" | "PLACEHOLDER" | "UNSNAPSHOTTED";

export interface RelatedFileEntry {
  /** node yaml file name the hint came from */
  node: string;
  /** the declared related_files path */
  relatedFile: string;
  status: RelatedFileStatus;
  /** current git blob hash, present only when the file exists on disk */
  blobHash?: string;
}

export interface RelatedFilesSummary {
  total: number;
  verified: number;
  stale: number;
  missing: number;
  placeholder: number;
  /** existing file hints absent from a SUPPLIED prior snapshot — drift-blind coverage gaps (fail-closed) */
  unsnapshotted: number;
}

export interface RelatedFilesReport {
  root: string;
  entries: RelatedFileEntry[];
  summary: RelatedFilesSummary;
  /** {relatedFile: blobHash} for every hint that exists — persist + pass back as `prior` to detect drift */
  snapshot: Record<string, string>;
}

export interface ComputeOptions {
  /** nodes dir relative to root (default "mesh/nodes") */
  nodesSubdir?: string;
  /** prior snapshot {relatedFile: blobHash}; a present-but-different hash => STALE */
  prior?: Record<string, string>;
}

// Templated/glob hints (e.g. docs/projects/<slug>/architecture.md) are intentional
// patterns, not real paths — never treat them as MISSING.
const PLACEHOLDER_RE = /[<>*]/;

/** git blob object hash of a buffer: sha1("blob " + len + NUL + content). Matches `git hash-object`. */
export function gitBlobHash(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}`);
  const nul = Buffer.from([0]);
  return createHash("sha1").update(Buffer.concat([header, nul, content])).digest("hex");
}

/** Extract the `related_files:` list out of one mesh node YAML (no YAML dep — bounded list block). */
export function parseRelatedFiles(yamlText: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of yamlText.split(/\r?\n/)) {
    if (/^related_files:\s*$/.test(raw)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    const item = raw.match(/^\s+-\s+(.+?)\s*$/);
    if (item && item[1] !== undefined) {
      out.push(item[1]);
      continue;
    }
    if (/^\S/.test(raw)) inBlock = false; // a new top-level key ends the block
  }
  return out;
}

function listNodeFiles(nodesDir: string): string[] {
  if (!existsSync(nodesDir)) return [];
  return readdirSync(nodesDir)
    .filter((f) => f.endsWith(".yaml"))
    .filter((f) => statSync(join(nodesDir, f)).isFile())
    .sort();
}

export function computeRelatedFilesStatus(root: string, opts: ComputeOptions = {}): RelatedFilesReport {
  const nodesDir = join(root, opts.nodesSubdir ?? "mesh/nodes");
  const prior = opts.prior ?? {};
  // Whether a prior snapshot was SUPPLIED (vs the default empty object). When supplied, a current
  // file hint with no entry in it is a coverage gap (UNSNAPSHOTTED), not a free pass — otherwise the
  // drift gate would silently go blind on every newly-added hint until someone remembered to regen.
  const hasPrior = opts.prior !== undefined;
  const entries: RelatedFileEntry[] = [];
  const snapshot: Record<string, string> = {};

  for (const node of listNodeFiles(nodesDir)) {
    const yamlText = readFileSync(join(nodesDir, node), "utf8");
    for (const relatedFile of parseRelatedFiles(yamlText)) {
      if (PLACEHOLDER_RE.test(relatedFile)) {
        entries.push({ node, relatedFile, status: "PLACEHOLDER" });
        continue;
      }
      const abs = join(root, relatedFile);
      if (!existsSync(abs)) {
        entries.push({ node, relatedFile, status: "MISSING" });
        continue;
      }
      if (statSync(abs).isDirectory()) {
        // a directory hint (e.g. src/api) exists but has no blob — coarse VERIFIED, no drift tracking
        entries.push({ node, relatedFile, status: "VERIFIED" });
        continue;
      }
      const blobHash = gitBlobHash(readFileSync(abs));
      snapshot[relatedFile] = blobHash;
      const priorHash = prior[relatedFile];
      let status: RelatedFileStatus;
      if (priorHash === undefined) {
        // No baseline hash for this file. With no prior supplied at all we cannot judge drift, so it
        // is VERIFIED; but when a prior WAS supplied, an existing file hint missing from it means the
        // snapshot has fallen out of coverage — surface it as a fail-closed signal, never a silent pass.
        status = hasPrior ? "UNSNAPSHOTTED" : "VERIFIED";
      } else {
        status = priorHash !== blobHash ? "STALE" : "VERIFIED";
      }
      entries.push({ node, relatedFile, status, blobHash });
    }
  }

  const summary: RelatedFilesSummary = {
    total: entries.length,
    verified: entries.filter((e) => e.status === "VERIFIED").length,
    stale: entries.filter((e) => e.status === "STALE").length,
    missing: entries.filter((e) => e.status === "MISSING").length,
    placeholder: entries.filter((e) => e.status === "PLACEHOLDER").length,
    unsnapshotted: entries.filter((e) => e.status === "UNSNAPSHOTTED").length,
  };
  return { root, entries, summary, snapshot };
}

/** stable key for an entry (a path can appear under multiple nodes) */
export function entryKey(e: RelatedFileEntry): string {
  return `${e.node}::${e.relatedFile}`;
}

/** the set of currently-MISSING entry keys — the ratchet floor a baseline freezes */
export function currentMissingKeys(report: RelatedFilesReport): string[] {
  return report.entries
    .filter((e) => e.status === "MISSING")
    .map(entryKey)
    .sort();
}

export interface BaselineDiff {
  /** MISSING now but not in the baseline floor — a regression (a new dead pointer) */
  newMissing: string[];
  /** in the baseline floor but no longer MISSING — known rot that got fixed */
  resolved: string[];
}

/**
 * Ratchet gate: compare current rot against a committed baseline floor of known-missing
 * keys. New rot fails; pre-existing known rot does not (it can only be paid down, never
 * grown). This lets the gate ship before the 21 canonical dead pointers are fixed.
 */
export function diffAgainstBaseline(report: RelatedFilesReport, baselineMissing: readonly string[]): BaselineDiff {
  const floor = new Set(baselineMissing);
  const currentMissing = new Set(currentMissingKeys(report));
  const newMissing = [...currentMissing].filter((k) => !floor.has(k)).sort();
  const resolved = [...floor].filter((k) => !currentMissing.has(k)).sort();
  return { newMissing, resolved };
}
