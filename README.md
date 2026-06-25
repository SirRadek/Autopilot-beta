# autopilot-beta

Clean-install beta of the `autopilot` product-design-os **floor**. A separate
product line: **no shared git history** with canonical `autopilot`. The
relationship to canonical is held by [`vendor-manifest.json`](vendor-manifest.json)
(provenance + hash), not by git ancestry.

- **Pinned base:** `autopilot@599785fb710cc01100ae1d5028af433e8fcfabbd`
- **Plan:** external canonical context at
  `autopilot/output/autopilot-beta-development-plan.md` in the sibling
  canonical checkout, not a live path inside this beta repository.

## Vendored vs new

- **Vendored byte-identically** (`product-design-os/`, `src/`): registry +
  schemas + the scripts/harness later phases modify. Recorded in
  `vendor-manifest.json`. `beta:vendor-check` is the hash gate.
- **New (beta-only):** `scripts/vendor-check.mjs`, and the layers introduced by
  later phases (composition.schema, recipe.schema, component contract, requires
  taxonomy).

## Why byte-identical

An additive/report-only change to a vendored file diffs cleanly against the
pinned canonical baseline, so merge-back is a patch (`git format-patch`), not a
manual reimplementation. The hash gate enforces that invariant.

## Boundary

Canonical `autopilot` lives in a **separate folder** and is never in this
working tree → beta cannot mutate the base by construction (plan §2.4). No raw
logs / secrets committed.

## Commands

```
npm install
npm run beta:vendor-check     # provenance + drift gate
npm run typecheck
npm run pdos:validate         # F0 report-only integrity inventory
npm run verify                # deterministic gate: vendor-check + typecheck + test + PDOS checks
npm run pdos:evidence-freshness -- --now YYYY-MM-DD --fail-on-stale
                              # real-project CI freshness gate; intentionally separate from verify
```
