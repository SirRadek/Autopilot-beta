# Design Reader And Visual QA

Status: phase-2 local capture plus structured snapshot analyzer

This folder tracks the Product & Design OS Design Reader direction. The current
implemented layers are deterministic and local:

```powershell
npm.cmd run pdos:visual-qa -- --file product-design-os/reader/visual-qa-sample.json --format markdown
npm.cmd run pdos:reader:capture -- --html-file product-design-os/reader/capture-sample.html --output-dir output/playwright/product-design-os
npm.cmd run pdos:reader:element-map -- --html-file product-design-os/reader/capture-sample.html --output-dir output/playwright/product-design-os
npm.cmd run pdos:reader:document -- --check-only --supervisor-root C:\path\pdf-supervisor
```

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

The Design Reader capture command uses local Playwright to:

- open a URL or local HTML file
- capture desktop and mobile screenshots
- extract DOM text, headings, actions, card counts, overflow, contrast, motion,
  reduced-motion support, canvas-content risk, and template-risk signals
- write a snapshot JSON and Visual QA Markdown report under `output/playwright/`

It does not yet run OCR, compare screenshots, or mutate project files.

The Visual Element Map capture command emits `element-map.json` with per-element
passports and supports an offline `xy -> passport` resolver for human-pointed
preview defects. Source binding is best-effort and falls back to
`sourceRef: "unknown"` when no local `data-*` source hints exist.

The document-reader adapter can call the separate `pdf-supervisor` repository as
a local external worker. It verifies runtime readiness, invokes
`document_supervisor.cli`, and expects reviewable Markdown/JSON artifacts under
`output/document-reader/`. See `pdf-supervisor-adapter.md`.

Future modules should be added incrementally:

- `capture-element-map.ts` (implemented VEM MVP)
- `run-ocr.ts`
- `analyze-layout.ts`
- `detect-template-risk.ts`
- `compare-reference.ts`
- `generate-visual-report.ts`

Each future module must stay local/deterministic by default, preserve source
evidence, avoid copying raw private project logs into Autopilot, and include
tests plus work-log impact.
