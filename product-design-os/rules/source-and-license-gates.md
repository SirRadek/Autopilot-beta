# Source And License Gates

External design sources are not production assets until their source, license,
cost, usage rights, and adoption constraints are recorded.

## Source Classes

Use these classes consistently:

- `approved_source`: source-level terms are compatible with commercial work, but
  each adopted file still needs an exact source record.
- `candidate_source`: promising source, but per-pack, per-file, or current terms
  must be checked before adoption.
- `inspiration_only`: may be studied for patterns, mood, layout rhythm, motion
  intent, or UX strategy, but cannot be copied into project code or assets.
- `blocked`: personal-use-only, non-commercial, no-derivatives, unclear,
  subscription-locked, paid-only, leaked, or provenance-risk source.

## Commercial-Safe Defaults

Prefer:

- CC0 for illustrations, textures, HDRIs, game assets, simple 3D assets, and
  public-domain style packs.
- MIT, ISC, BSD, or Apache-2.0 for code, icons, UI helpers, and examples.
- SIL OFL for fonts, with font license files preserved when bundled.

Allowed only with extra care:

- CC BY assets, when attribution can be displayed and recorded.
- custom free licenses, only after reading the exact terms and recording the
  allowed use.
- generated media, only when the tool's commercial rights, source inputs, and
  account cost are clear.

Blocked by default:

- NC, non-commercial, personal-use-only, editorial-only, no-derivatives, unclear
  redistribution, trial-only, paid-credit, or unknown-license sources.
- leaked prompts, ripped templates, copied brand assets, copied logos, copied
  product screenshots, and copied proprietary animation/code.
- community files from marketplaces without per-file license evidence.

## Required Adoption Record

Before a source-derived asset is used in a project, record:

- source URL,
- exact asset URL or download page,
- local path if downloaded,
- license name and URL,
- last reviewed date,
- commercial-use status,
- attribution requirement,
- modifications made,
- performance budget and file size target,
- mobile fallback,
- reduced-motion fallback for motion/model assets,
- SEO content kept outside media/canvas,
- visual QA evidence path,
- rollback path.

## Project Rule

Every project may have its own asset choices, but the shared library keeps the
source review. Project entries should point back to the shared source id instead
of re-explaining the same license every time.

If the library is missing a source entry, stop and create one before adoption.
