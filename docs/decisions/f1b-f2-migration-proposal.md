# F1b/F2 — Data-migration proposal (OWNER SIGN-OFF GATE)

**Status:** ✅ SIGNED OFF 2026-06-23 (owner: A4=alias, B3=distinct, F2 rebaseline=yes per-domain,
run F1b now). **F1b EXECUTED** (see record at bottom). **F2 remains PENDING** per-domain approval.
Original proposal text kept for audit trail.
**Base:** beta HEAD `4a86165` (post-F1a). **Author of analysis:** real `codex_cli` worker
(tech-opponent), **reviewed + synthesized by Opus** against the repo (model ≠ source-of-truth).
Creative-opponent lane (`agy`) = MISSING (WORKER-CLI-001) → 2-source (Opus + real Codex).

## Opus review verdict

Codex's proposal is **accepted as the migration plan**. Every load-bearing claim was verified
against the repo:
- `score-product-design-os.ts` emits **rejected** pattern/asset candidates in the JSON report
  (`rejected.patterns = scoredPatterns.slice(limit)`), so **any manifest addition changes score
  output** — confirmed. → F2 is a deliberate behavior change, not "nulová změna".
- `mascot-progressive-guide.good_for` = "cursor and scroll guidance"; `.examples` = "cat concierge",
  "section-aware mascot guide" → A4 alias grounded.
- `proof-led-section` = broad case-evidence vs `studio-proof-ledger` enumerated/auditable → B3
  distinct defensible.
- `taste/pattern-scores.json` contains guided-offer-map, cat-concierge-guide, studio-proof-ledger,
  demo-world-hub (F2 must not forget these).
- Verified all current data files contain **none** of the F1a typed fields yet (clean start).

## The classification rule (id vs tag) — by REGISTRY MEMBERSHIP, not regex

For each legacy string in `dependencies`/`works_with`/`avoid_with` (and recipe `allowed_patterns`):
1. registry = `pattern-manifest` ids ∪ `asset-manifest` ids.
2. in registry → copy to `*_ids` (pattern-ids and asset-ids share one `*_ids` field — F1a added no
   separate pattern-vs-asset namespace; splitting them would be a *new* schema decision).
3. approved F2 ghost → **hold in legacy field until F2** assigns a canonical target, then copy the
   canonical id to `*_ids` (never to `*_tags`).
4. else → `*_tags`. Regex-valid strings like `checkout`, `fake-metrics` are **tags** unless they are
   actual registry ids. Dedupe canonical ids after alias/collapse.

### Asset field policy (manifest reality)
| field | target | ghosts present | rationale (repo scan) |
|---|---|---|---|
| `dependencies` | `dependency_tags` (only) | none | 0 id-refs; 1 tech tag `three.js-or-static-fallback` |
| `works_with` | `works_with_ids` (pattern+asset ids together); `works_with_tags` for true tags | 5: cat-concierge-guide, demo-world-hub, guided-offer-map, section-aware-mascot, studio-proof-ledger → **hold until F2** | 84 pattern-id + 2 asset-id + 8 ghost occurrences |
| `avoid_with` | `avoid_with_tags` (all) | none | 103 occurrences, all anti-pattern concepts, 0 registry ids |

## F1b — what is baseline-SAFE to migrate now (after sign-off)

1. **Asset typed fields**: populate `works_with_ids` / `works_with_tags` / `avoid_with_tags` /
   `dependency_tags` for current registry-hit ids and tags. **Hold** the 5 embedded ghosts in legacy
   `works_with` until F2.
2. **5 clean recipes** (100% valid pattern ids — client-portal-trust, dashboard-data-heavy,
   ecommerce-conversion, internal-ops-clean, public-sector-accessible): copy `allowed_patterns` →
   `allowed_pattern_ids`. Keep legacy `allowed_patterns` authoritative.
3. **Do NOT** copy creative-motion / marketing-premium yet: `validateGhostPatterns` concatenates
   `allowed_patterns ⧺ allowed_pattern_ids` **without dedup**, so copying their ghosts would
   **double-count** (13 → more). Their typed lists are produced in F2 after canonical targets exist.
4. **Do NOT** infer `required_sections` (no legacy source with section semantics; `minimum_seo_floor`
   is an SEO-floor, not sections — owner question below).

**Baseline impact of F1b:** score diff = **0** (scoring never reads the new fields, and recipe
scored-output carries no pattern lists), validate outcome unchanged (clean-recipe `allowed_pattern_ids`
are all valid → no new ghost warnings; `PDOS_ASSET_REF_TAG_MIX` stays 3 because legacy untyped fields
remain). Score fixtures in `tests/fixtures/score-baseline/` still pass.
**Provenance:** the mutated files (`asset-manifest.json`, the 5 recipe JSONs) are **vendored** → each
gets `patched_by: "F1b"` in `vendor-manifest.json` (content_hash stays canonical baseline = merge-back
anchor). Same hand-mark discipline as F0/F1a; never `--generate` over an edited file.

## F2 — deliberate behavior-change window (owner approval per dávka)

F2 adds manifest entries for the ghosts. This **cannot** be byte-baseline-stable:
- new pattern/asset entries appear in the scorer's **rejected** lists → score JSON changes;
- adopted ghosts become real ids → `PDOS_GHOST_PATTERN` count drops below 13 (the intended F0→0 path).
→ F2 requires an **owner-approved rebaseline** (regenerate score fixtures + update the F0/F1a warning-
count assertions) in a conscious gate — exactly like the plan's F2 ("owner approval per dávka") and
the F5 honesty rule ("NEdělat pod hlavičkou nulová změna").

### F2 ghost → entry map (12 distinct; F0.5 taxonomy honored)
| ghost | decision | type | target id |
|---|---|---|---|
| animated-hero | adopt-new | pattern (motion) | animated-hero |
| theme-crossed-motion | collapse-modifier (D1) | modifier | theme-crossed-direction |
| theme-crossed-positioning | collapse-modifier (D1) | modifier | theme-crossed-direction |
| cat-concierge-guide | new-asset + use existing pattern (D2) | asset | cat-concierge (+ pattern mascot-progressive-guide) |
| section-aware-mascot | **alias (A4 — owner call)** | pattern | mascot-progressive-guide |
| demo-world-hub | adopt-new (ONE shared entry) | pattern (ux) | demo-world-hub |
| mask-reveal | adopt-new (effect/modifier note) | pattern (motion) | mask-reveal |
| motion-background | new-asset (A7) | asset (background) | motion-background |
| guided-offer-map | adopt-new | pattern (ux/conversion) | guided-offer-map |
| studio-proof-ledger | **adopt-new distinct (B3 — owner call)** | pattern (conversion) | studio-proof-ledger |
| case-study-strip | adopt-new | pattern (layout) | case-study-strip |
| outcome-cta | adopt-new | pattern (conversion) | outcome-cta |

After F2, canonical recipe typed lists (with A4=alias, B3=distinct):
- **creative-motion** `allowed_pattern_ids`: animated-hero, theme-crossed-direction,
  mascot-progressive-guide, cursor-responsive-detail, scroll-linked-proof, demo-world-hub,
  mask-reveal. (`motion-background` is an asset → has no recipe pattern-id slot; recipes have no
  `allowed_asset_ids` field today — owner question.)
- **marketing-premium** `allowed_pattern_ids`: sharp-positioning-hero, theme-crossed-direction,
  guided-offer-map, studio-proof-ledger, demo-world-hub, proof-led-section, case-study-strip,
  outcome-cta, service-demo-link.

## Ordering & owner-approval points
F1b first (only known-canonical data; baseline-safe) → validate/test/score check → **F2 by domain**:
(1) shared/core (theme-crossed modifiers, mascot/cat split, demo-world-hub) → (2) creative-motion
(animated-hero, mask-reveal, motion-background, cat-concierge) → (3) marketing-premium (guided-offer-map,
studio-proof-ledger, case-study-strip, outcome-cta) → (4) cleanup asset `works_with` ghosts +
taste/pattern-scores. Approve before: F1b write · A4/B3 final · any new manifest entry/asset ·
any baseline change · F1c legacy-field removal.

## Decisions needed from owner (sign-off)
1. **A4** — alias `section-aware-mascot` → `mascot-progressive-guide` (Codex+Opus recommend), or keep distinct?
2. **B3** — adopt `studio-proof-ledger` as a distinct conversion pattern (recommend), or alias to `proof-led-section`?
3. **F2 baseline** — allow F2 to rebaseline score fixtures + warning-count tests (required for manifest
   additions), batched per domain? (No honest alternative keeps byte-identical baselines.)
4. **D1 modifiers** — where to record motion/positioning treatments under the no-`direction_ids`
   schema: pattern `notes`/`examples`, or a future owner-approved structured modifier field?
5. **Recipe asset refs** — recipes have no `allowed_asset_ids`; how to represent `motion-background`
   and the asset half of `cat-concierge`? (add field later, or leave assets out of recipe typed lists?)
6. **Proceed with F1b now** (baseline-safe slice) on sign-off, holding F2 for per-domain approval?

## Risks (verified)
- F2 manifest additions change score fixtures (rejected candidates) and warning counts — by design.
- `works_with_ids` is cross-registry/untyped → future pattern/asset id collisions ambiguous.
- No `allowed_asset_ids` on recipes → `motion-background` / cat-concierge asset cannot live in recipe typed fields today.
- Alias/collapse can dedupe distinct legacy signals (cat-concierge-guide + section-aware-mascot both → mascot-progressive-guide).
- New assets (cat-concierge, motion-background) need real source/license/provenance before creation.
- `taste/pattern-scores.json` references 4 ghosts; not dereferenced today but F2 should migrate consciously.

## buildSubagentTree (real Codex)
```
parent_session_hash: autopilot-beta-f1b-20260623
└─ cli-codex-hp-20260623-beta-f1b-proposal-20260623T072926
   agent_type: codex_cli-external   exit: 0   duration: 445 s
   handoff_id: hp-20260623-beta-f1b-proposal   role: author/tech-opponent (advisory)
```
agy_cli MISSING (WORKER-CLI-001). Opus verified all citations against the repo before recording.

---

# F1b EXECUTED — record (2026-06-23, commit pending)

**Implementation worker:** real `codex_cli` via `runCliWorker` (buildSubagentTree below). Opus
cross-checked Codex's asset classification against an independent registry-membership scan
(**38/38 assets, 0 mismatches**) and verified each recipe adds only `allowed_pattern_ids` = exact
copy of `allowed_patterns` (rest byte-unchanged) before applying.

**Applied (additive, +81/-0):**
- `asset-manifest.json` (38 assets): `works_with_ids` (37 assets; registry pattern+asset ids),
  `avoid_with_tags` (38), `dependency_tags` (1 = quaternius `three.js-or-static-fallback`).
  The 5 F2 ghosts stay ONLY in legacy `works_with` (held on 6 assets) — not in `*_ids`/`*_tags`.
- 5 clean recipes: `allowed_pattern_ids` = copy of `allowed_patterns`. `creative-motion` /
  `marketing-premium` untouched (ghost-bearing → F2).
- `vendor-manifest.json`: 6 data files marked `patched_by:"F1b"` by hand (canonical `content_hash`
  preserved as merge-back anchor; never `--generate` over an edited file).

**Gates (all green):** typecheck ✅ · vendor-check ✅ (111 pristine + 9 patched) · vitest 7/7 ✅ ·
**baseline score 7/7 byte-identical** to pre-F1a capture · validate passed, 0 errors, 22 warnings
`{ASSET_REF_TAG_MIX:3, EMPTY_TOKENS:6, GHOST_PATTERN:13}` unchanged.

```
buildSubagentTree:
parent_session_hash: autopilot-beta-f1b-20260623
└─ cli-codex-hp-20260623-beta-f1b-exec-20260623T074858
   agent_type: codex_cli-external   exit: 0   duration: 273 s
   handoff_id: hp-20260623-beta-f1b-exec   role: data migration (emit); Opus review vs registry + land
```
Note: two prior attempts failed fast (≈18s, empty) due to an Opus-side output-schema bug — OpenAI
structured-output strict mode requires every property listed in `required` + `additionalProperties:
false`. Fixed (all asset fields required, `[]` for empties), then exit 0. agy_cli MISSING.

**Next:** F2 per-domain (owner-approved rebaseline), then F1c (remove legacy fields; baseline-unchanged
gate already satisfied → `PDOS_ASSET_REF_TAG_MIX` then drops).

---

# Open questions RESOLVED (2026-06-23, owner: "podle doporučení", grounded via context7)

- **D1 modifier storage → optional `modifiers` enum array on `pattern.schema.json`.** Add
  `"modifiers": { "type":"array","items":{ "type":"string","enum":["motion","positioning"] },"default":[] }`
  (optional → existing patterns stay valid under additionalProperties:false; enum → constrained set).
  `theme-crossed-direction` gets `modifiers: ["motion","positioning"]`. Structured > burying in notes;
  honors D1 (no new type/`direction_ids`). Confirmed idiomatic via context7 (JSON Schema: optional
  property + items.enum is the non-breaking way to add a constrained field).
- **Recipe `allowed_asset_ids` → NOT added.** Recipes stay pattern-scoped; assets are scored from
  `asset-manifest` by fit, not pinned per recipe. Recipe→asset pinning is a separate capability
  outside F1/F2. `motion-background` registers as an asset (batch 2) linked to patterns via its own
  `works_with_ids`; it drops out of `creative-motion` typed pattern list (it was never a pattern).

---

# F2 BATCH 1 (shared/core) EXECUTED — record (2026-06-23)

**Implementation worker:** real `codex_cli` via `runCliWorker` (hp-20260623-beta-f2-batch1, exit 0,
244 s). Opus reviewed every edit against `pattern.schema`/`asset.schema` + verified anchors verbatim
before applying.

**Applied (3 vendored files → `patched_by` += "F2"):**
- `pattern.schema.json`: optional `modifiers` enum array (`["motion","positioning"]`) — D1 storage.
- `pattern-manifest.json`: `theme-crossed-direction.modifiers = ["motion","positioning"]` (records D1
  collapse); NEW pattern `demo-world-hub` (ux_pattern) — resolves its 2 ghost occurrences.
- `asset-manifest.json`: NEW asset `cat-concierge` (avatar, internal provenance, `works_with_ids`
  =[mascot-progressive-guide]) — D2 mascot asset half.

**Owner-approved rebaseline (deliberate, documented):**
- `PDOS_GHOST_PATTERN` 13 → **11** (demo-world-hub ×2 resolved); total warnings 22 → **20**. Tests
  `product-design-os-validation` + `product-design-os-f1a` ghost assertions updated 13→11.
- Score fixtures regenerated. **Diff is pure insertion**: across all 7 inputs the only change is
  `demo-world-hub` (pattern) + `cat-concierge` (asset) appearing as `selected:false` rejected
  candidates — **zero change to any existing item's score or selection** (verified by raw diff).

**Gates:** typecheck ✅ · vendor-check ✅ (109 pristine + 11 patched) · vitest 7/7 ✅ · validate 0
errors / 20 warnings.

```
buildSubagentTree:
└─ cli-codex-hp-20260623-beta-f2-batch1-20260623T083103  agent_type: codex_cli-external  exit: 0  244 s
```
**Remaining F2:** batch 2 (creative-motion: animated-hero, mask-reveal, motion-background, cat-concierge
recipe rewrite), batch 3 (marketing-premium: guided-offer-map, studio-proof-ledger, case-study-strip,
outcome-cta), batch 4 (cleanup: rewrite ghost recipes to canonical ids → remaining ghosts→0,
taste/pattern-scores). Each its own owner-approved rebaseline. Then F1c.
