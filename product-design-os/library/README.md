# Product Design Library

Status: phase-1 local source, reference, and project index

This folder is the reusable Product & Design OS library. It stores:

- commercially usable source candidates,
- inspiration-only references,
- clean-room reference analysis templates,
- generated project index records,
- links between projects, patterns, assets, and source evidence.

It is not a download cache and not a legal approval authority. It records the
evidence needed before a source can be used in commercial project work.

## Library Layers

- `source-catalog.json`: source pools and libraries that may provide assets,
  code, icons, fonts, textures, models, or templates.
- `reference-catalog.json`: websites and examples used for inspiration or
  competitive analysis.
- `project-index.json`: generated index of known Autopilot project records.
  In this beta checkout, canonical `docs/projects/` records may be absent; such
  entries must be marked external/canonical-only until normalized into beta.
- `templates/`: source, reference, and project entry templates.

## Rules

Use `rules/source-and-license-gates.md` before adopting any external asset.

Use `rules/clean-room-reference-workflow.md` before studying a live website,
copying HTML for analysis, OCRing screenshots, or turning a reference into an
implementation brief.

References can inspire mood, structure, motion logic, and UX decisions.
Production must use our own code, copy, assets, and implementation route unless
the exact source license explicitly allows reuse and the adoption record is
complete.

## Project Index

The project-index generator exists in source, but its npm alias is pending Opus
package.json wiring. Until `pdos:library:projects` is added, regenerate the
local project index with:

```powershell
npx.cmd tsx product-design-os/scripts/update-project-library.ts
```

The index is intentionally based on beta-local `docs/projects/*` records when
they exist, not remote connector state. Remote or canonical project data should
be normalized into beta-local project records before it becomes a live local
library entry.
