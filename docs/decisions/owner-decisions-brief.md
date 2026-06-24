# Owner-decisions brief — autopilot-beta (standalone product line)

**Date:** 2026-06-24. **Author:** Opus (architecture/governance). **Scope:** ONLY `autopilot-beta` (owner
fixed the topology: beta is the standalone product; merge-back to canonical is dropped). Grounded in the
4-source backlog brainstorm + verified repo facts. Each decision = a real fork the owner must resolve;
implementation (when chosen) goes through the `codex_cli` worker, Opus architect→review→land.

Reading guide per decision: **Q** (the question) · **Fork** (why it's not obvious) · **Options** (with
tradeoffs) · **Rec** (Opus recommendation) · **Depends/Effort**.

---

## D1 — Renderer: build vs adopt, and the "free-design" tension (THE central one)
**Q:** How does `composition.spec.json` become real HTML/CSS/JS, and does adopting a UI library betray the
"design output stays free/creative" rule?
**Fork:** A bespoke compiler is pure to the doctrine but huge; adopting Astro+shadcn is ~0 compiler code but
risks importing the library's *look* into a product whose whole pitch is non-templated design.
**Options:**
- **(A) Bespoke spec→DOM compiler.** Full control, doctrine-pure; but reinvents layout/a11y/perf, high
  effort/risk, slow to first artifact.
- **(B) Adopt Astro + Tailwind + shadcn/Radix components (styles + behavior).** ~0 compiler code, static
  zero-JS default (matches "deterministic + perf-first"); BUT the shadcn/Radix *visual* vocabulary leaks
  into output → templated look. Contradicts [[feedback_process_rules_not_design_rules]].
- **(C) Hybrid — adopt the INFRA/BEHAVIOR, author the LOOK.** Astro as the static shell + asset/perf
  pipeline (mechanical infra, not design); tokens→CSS-vars; the actual pattern components are
  **project-authored** from the F3 contracts + tokens; Radix/React-Aria used ONLY for hard a11y BEHAVIOR
  (focus-trap, listbox semantics), never their styles.
**Rec:** **(C).** It threads the tension exactly: you reuse the open ecosystem for the parts that are
commodity (static rendering, asset optimization, a11y behavior, perf), and keep the *visual* layer
project-authored so the design stays free. "Adopt for substrate, author the look."
**Depends:** D7 (token fill) + D2 (contracts) first. Effort: high; via codex worker.

## D2 — Contract authoring policy (the brainstorm's one real disagreement)
**Q:** Where do the ~34 missing component contracts come from — hand-authored, auto-ingested from
shadcn/Radix TS props, or library-assisted-then-reviewed?
**Fork:** agy/Claude-synthesis say "auto-parse TS props, hand-authoring is a fallacy"; the Claude critique
(correct) says that imports a component vocabulary, a pattern (design semantics) ≠ a component (impl props)
so the mapping is lossy/per-pattern, and context7 fetches *token values/docs*, it does NOT generate a
contract layer.
**Options:**
- **(A) Hand-author all 34** (current seed style). Fully owned; slow; doesn't scale.
- **(B) Bulk auto-ingest from a UI library.** Fast; imports look + lossy semantic→prop mapping; the hard
  part doesn't automate → the saving is mostly illusory.
- **(C) Library-ASSISTED, per renderer-slice, reviewed.** Use library prop docs (via context7) as INPUT;
  a codex-authored contract encodes the PATTERN's design intent (slots/invariants), reviewed against the
  pattern; authored ONLY for patterns the current renderer slice instantiates.
**Rec:** **(C), lazily.** Never bulk-ingest 37 upfront (substrate for a non-existent consumer). Contracts
are part of the product IP (they encode design intent), so they stay project-authored — library knowledge
is an input, not the output.
**Depends:** D1 (renderer slice defines which contracts are needed). Effort: medium, incremental.

## D3 — "On-brand" metric (what the eval measures)
**Q:** How is the one subjective axis the held-out eval needs defined?
**Fork:** Objective proxies (overlap/contrast/variance) are gameable and don't capture "brand"; pure
owner-judgment doesn't scale; an LLM-judge scales but model ≠ source-of-truth (CLAUDE.md).
**Options:**
- **(A) Objective proxy metrics only.** Cheap, but measures the wrong thing.
- **(B) Owner/Opus written rubric, logged, advisory.** Honest; subjective; the only axis no open ruleset
  supplies.
- **(C) Vendor LLM-judge (codex/agy) scoring the rubric, advisory.** Scales (B); must stay advisory.
**Rec:** **(B) + (C) advisory.** A written brand rubric (owner-defined dimensions) scored by Opus + a vendor
judge, LOGGED. Objective axes (buildability, axe-core a11y, Lighthouse perf) GATE; on-brand only INFORMS.
**Critical reframing:** the eval **informs an owner ON-decision; it does NOT objectively license** any
creative axis. "default-OFF pending eval" really means "pending an owner call that the eval evidences."
**Depends:** D1 (need real IS artifacts to judge). Effort: medium / highest leverage.

## D4 — QA gating + the orphaned reader (codex's #1, two linked calls)
**Q4a:** Do buildability / a11y / perf / visual-QA stay report-only, or BLOCK release where they should?
**Q4b:** The Playwright reader (`capture-design-reader.ts`/`capture-element-map.ts`) is **verified orphaned**
(imports `@playwright/test` not in deps; no `pdos:reader:*` scripts; not in tsconfig) yet docs present it as
working = **false-green**. Legalize, or quarantine?
**Rec (4a):** Once a real renderer produces real artifacts, the **objective** axes (axe-core, Lighthouse
budget, structural buildability) become **BLOCKING** in `verify`/release; **on-brand stays advisory**. Until
the renderer exists there's nothing real to gate → stay report-only.
**Rec (4b):** Two steps. **NOW (cheap, no renderer):** kill the false-green — mark the reader docs "planned,
not wired" so `verify`-green stops implying a working reader. **THEN:** LEGALIZE it (Playwright is exactly
the adopt-for-substrate pick for real visual-QA) — add `@playwright/test`, the `pdos:reader:*` scripts, the
tsconfig include, wire into the real visual-QA. This converts the mock `analyzeProductDesignVisualQa` into a
real DOM probe.
**Depends:** 4b-now is independent (do immediately); 4a + 4b-legalize depend on D1. Effort: low (now) / med.

## D5 — Make governance enforceable (evidence schema + TTL) — codex
**Q:** Rules mandate Context7/license/clean-room, but "verified" is satisfiable by free text. Add an
evidence schema + source-freshness TTL, gated in `verify`?
**Fork:** Text-trust is cheap but means the governance is aspiration, not a gate — for a system whose pitch
is "model output advisory until verified," that's a hole.
**Rec:** **Yes — add it.** A small `evidence.schema.json` (`{ library, version, query, source, date,
covered_claim, fallback }`) + a `source_freshness_ttl`, validated in `verify`; SPDX license normalization
(esp. `CC0-1.0`) + per-asset adoption evidence (URL/path/license). This is the difference between
governance-as-doc and governance-as-gate, and it's cheap.
**Depends:** none — do early. Effort: low / high trust-value.

## D6 — Validator: keep the homemade subset, or adopt Ajv — codex (REVISED after reading the code)
**Q:** Adopt **Ajv v8 + ajv-formats** to replace the homemade `validateJsonSchema`?
**Verified correction (Opus read `src/lib/delivery-system/validation.ts`):** the validator is NOT
"implements 0 of everything" — it's a deliberate, fairly capable **subset**: `type`, `enum`, `const`,
`allOf`, `if/then/else`, `not`, `required`, `additionalProperties`, `properties`, `items`, `minItems`,
`uniqueItems`, `minLength`, `pattern`, `format:date|date-time`, `minimum`, `maximum`. What it **silently
ignores** (no error, no enforcement) is specifically **`$ref` / `oneOf` / `anyOf`** (+ `maxLength`,
`maxItems`, `multipleOf`, `patternProperties`, object-valued `enum`). The **only** schema using `$ref`/
`oneOf` is `reader/element-map.schema.json` (6×) — which belongs to the reader **parked NOT WIRED in D4b**.
**Fork:** Ajv removes the `$ref`/`oneOf` blind spot and the "no $ref" authoring tax; but it's a dep + a
migration that must map Ajv's error `{instancePath,message,params}` back to the repo's `{path,message}`
shape AND keep the repo's exact message TEXT (`"is required"`, `"must be one of: …"`) so no invalid-case
test drifts. Real, test-sensitive.
**Rec:** **DEFER — do NOT adopt now.** The migration's only current beneficiary (element-map enforcement)
is parked; adopting Ajv today is enforcement-substrate for a non-existent live consumer (the trap the
brainstorm critique named). **Adopt Ajv when we legalize the reader (D4b-legalize) OR a live schema in the
deterministic `validate` path genuinely needs `$ref`/`oneOf`** — then the migration earns its
test-drift risk. Until then the subset is fine for the subset-authored schemas. (If/when adopted: codex
worker, behind a hard gate — `validate` 0/0 + identical issue `{path,message}` text on the existing
invalid-case tests.)
**Depends:** D4b-legalize or a new live schema need. Effort: medium + test-sensitive.

## D7 — Token floor: enable overrides + override semantics
**Q:** The floor is filled with NEUTRAL values. Enable `token_overrides` now, and with what format?
**Rec:** Re-fill the floor from an **open set** (open-props / Radix Colors / Tailwind defaults via context7)
in the **W3C Design Tokens format**, axe-AA verified; adopt **Style Dictionary** resolution for
`mapTokens(base, overrides)` (don't invent override semantics); enable `token_overrides` once the floor is
real. **Owner approves the actual brand values** (the model never invents brand).
**Depends:** independent; a fast early substrate win. Effort: low (½ day).

## D8 — Prune the dark OFF scaffolding
**Q:** Keep or quarantine the redundant F5 hard gate (`PDOS_ENFORCE_ALLOWED_PATTERNS`, now superseded by the
soft intent-prior) and the 5 OFF creative axes?
**Rec:** **Quarantine the F5 hard-gate enforcement path** (keep the `--shadow-allowed-patterns` diagnostic;
mark enforcement deprecated/frozen) — it carries fixture-rebaseline + confusion cost for zero current value.
Keep the OTHER OFF axes as **documented-not-built** (they're docs, not code — no carry cost) until the eval
(D3) licenses an owner decision. Low effort; reduces "is this on?" confusion.
**Depends:** none. Effort: low.

---

## Recommended sequence (beta-only) — REVISED
1. **D4b-now (DONE, `7e3fc69`) + D5 (in progress)** — kill false-green, make evidence enforceable. Cheap, no
   renderer needed, makes the green HONEST (the highest-trust, lowest-cost wins; codex's forensic findings).
   **D6 (Ajv) is DEFERRED** out of step 1 — its only consumer (element-map) is parked (see D6 revised).
2. **D7** — token fill from an open set → real substrate.
3. **D1 (Option C) minimal renderer slice** + **D2 (Option C) lazy contracts** for that slice → first real
   IS artifacts. (codex worker, Opus architect.) → unblocks D4b-legalize + (then) D6.
4. **D3 + D4a** — held-out eval on those artifacts; promote objective QA to blocking.
5. **D8** — prune dark axes; harden the harness in parallel (agy heartbeat fix, kill silent fallbacks).

## What needs YOUR call vs what I can just do
- **Genuinely owner/architecture (need your decision):** D1 (renderer strategy + the free-design tension),
  D2 (contract policy), D3 (on-brand definition), D4a (does QA block release), D7 (brand token values).
- **I can execute on your "yes" (mechanical/low-risk, in-beta):** D4b-now (kill false-green), D5 (evidence
  schema), D6 (Ajv migration), D8 (quarantine F5 gate), D7 token-fill mechanics.

Tell me which to start. My pick: **#1 (D4b-now + D5 + D6)** — it costs little, needs no big decision, and
turns the "verify green" into an honest green before we build anything on top of it.
