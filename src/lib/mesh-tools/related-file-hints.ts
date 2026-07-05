// Shared handling of mesh-node `related_files` hints, used by BOTH bind-points so
// their semantics cannot diverge (BLIND2): bind-point ① (related-files-status, the
// ratchet) and bind-point ② (changed-files-capabilities, the blocker gate).

// Templated/glob hints (e.g. docs/projects/<slug>/architecture.md) are intentional
// patterns, not real paths — never treat them as MISSING and never match them.
export const PLACEHOLDER_RE = /[<>*]/;

/**
 * Hand-authored directory hints may carry a trailing slash (e.g. `prompt-library/`).
 * Path-prefix matching must treat them identically to `prompt-library` — without
 * this, `startsWith(hint + "/")` becomes `prompt-library//` and matches nothing,
 * silently skipping every blocker on that surface (BLIND1).
 */
export function normalizeRelatedFileHint(hint: string): string {
  return hint.replace(/\/+$/, "");
}
