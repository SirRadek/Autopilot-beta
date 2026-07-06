// Shared handling of mesh-node `related_files` hints, used by BOTH bind-points so
// their semantics cannot diverge (BLIND2): bind-point ① (related-files-status, the
// ratchet) and bind-point ② (changed-files-capabilities, the blocker gate).

// Templated/glob hints (e.g. docs/projects/<slug>/architecture.md) are intentional
// patterns, not real paths — never treat them as MISSING and never match them.
export const PLACEHOLDER_RE = /[<>*]/;

/**
 * Hand-authored path hints may carry shell/path noise (e.g. `./`, `\`, repeated
 * slashes, trailing slash/dot). Canonicalize that noise once for every bind-point
 * so the ratchet and blocker gate cannot disagree. Case is deliberately preserved:
 * git path matching is case-sensitive, and lowercasing would change semantics.
 */
export function normalizeRelatedFileHint(hint: string): string {
  return hint
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/[/.]+$/, "");
}
