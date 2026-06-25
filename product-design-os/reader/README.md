# Design Reader And Visual QA

Status: wired structured snapshot analyzer plus vendored reader/VEM sources

> **Beta wiring status (D4b, updated 2026-06-25):** in `autopilot-beta` only
> `pdos:visual-qa` is wired. `@playwright/test` is now a devDependency for the
> browser-gated visual-QA slice, but the `pdos:reader:capture` /
> `:element-map` / `:document` commands and the `capture-design-reader.ts` /
> `capture-element-map.ts` scripts are **vendored from canonical and NOT fully
> wired here**. There are no `pdos:reader:*` npm scripts, the files are not in
> `tsconfig`, and the VEM schema is not part of deterministic validation. Treat
> the reader commands below as **design intent, not a working beta path** until
> D4b legalization.

```powershell
npm.cmd run pdos:visual-qa -- --file product-design-os/reader/visual-qa-sample.json --format markdown
```

Not wired in beta: `pdos:reader:capture`, `pdos:reader:element-map`, and
`pdos:reader:document`.

The Visual QA analyzer accepts structured viewport evidence and produces a
report for:

- checked desktop/mobile viewports
- text overlap
- horizontal overflow
- low contrast flags
- heading and CTA presence
- primary content hidden in canvas/media
- reduced-motion fallback
- repeated card/template-risk signals
- suggested actions for Design Critic review

When legalized, the vendored Design Reader capture source is intended to use
local Playwright to:

- open a URL or local HTML file
- capture desktop and mobile screenshots
- extract DOM text, headings, actions, card counts, overflow, contrast, motion,
  reduced-motion support, canvas-content risk, and template-risk signals
- write a snapshot JSON and Visual QA Markdown report under `output/playwright/`

It does not yet run OCR, compare screenshots, or mutate project files.

The Visual Element Map source is present as vendored canonical work, but it is
not a live beta layer yet. Its intended command emits `element-map.json` with
per-element passports and supports an offline `xy -> passport` resolver for
human-pointed preview defects. Source binding is best-effort and falls back to
`sourceRef: "unknown"` when no local `data-*` source hints exist.

The document-reader adapter is also vendored but not exposed through a beta npm
script. Once wired, it can call the separate `pdf-supervisor` repository as a
local external worker, verify runtime readiness, invoke `document_supervisor.cli`,
and expect reviewable Markdown/JSON artifacts under `output/document-reader/`.
See `pdf-supervisor-adapter.md`.

Future modules should be added incrementally:

- `capture-element-map.ts` (vendored VEM MVP source; not wired in beta)
- `run-ocr.ts`
- `analyze-layout.ts`
- `detect-template-risk.ts`
- `compare-reference.ts`
- `generate-visual-report.ts`

Each future module must stay local/deterministic by default, preserve source
evidence, avoid copying raw private project logs into Autopilot, and include
tests plus work-log impact.
