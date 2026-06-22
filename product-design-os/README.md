# Product & Design OS

Status: phase-1 governance foundation

This folder is the Product & Design Operating System layer for Autopilot. It is
not an app runtime, workflow engine, connector client, or duplicate source of
truth. It extends the existing Decision Mesh and governance process with
reusable product, UX, design, asset, and QA templates.

Use this layer when work touches marketing websites, portfolios, landing pages,
ecommerce, dashboards, admin tools, client portals, data tools, AI agent UIs,
automation UIs, public-sector pages, internal systems, visual redesign, motion,
graphic assets, UX flow, conversion, or usability.

Core rule:

```text
Do not generate a website or UI from vibes.
Classify the project, lock scope, run opposition, select patterns/assets,
define QA, and only then implement.
```

Phase 1 includes templates, schemas, recipes, taste memory, deterministic
foundation validation, a local intake/change-request router, console-only
Markdown reports, and deterministic scoring for recipes, patterns, and assets.
It also includes a local design library under `library/` for reusable
commercial-safe source candidates, inspiration-only references, clean-room
reference analysis, and generated project indexing.
Future automation scripts must be added incrementally with tests and mesh
impact records.

Run the deterministic foundation check with:

```powershell
npm.cmd run pdos:validate
```

Route a project intake or change request locally with:

```powershell
npm.cmd run pdos:route -- --text "marketing website for leads with motion"
npm.cmd run pdos:route -- --change "add 3d avatar to checkout"
npm.cmd run pdos:report -- --text "marketing website for leads with motion"
npm.cmd run pdos:score -- --text "marketing website for leads with motion" --format markdown
npm.cmd run pdos:visual-qa -- --file visual-snapshot.json --format markdown
npm.cmd run pdos:reader:capture -- --html-file product-design-os/reader/capture-sample.html --output-dir output/playwright/product-design-os
npm.cmd run pdos:reader:document -- --check-only --supervisor-root C:\path\pdf-supervisor
npm.cmd run pdos:library:projects
```

## Process Gates

1. Project Type Lock
2. Needs Lock
3. Scope Contract
4. Product Opposition
5. Direction Lock
6. Implementation Lock
7. QA Lock

Before planning or implementation, route the task through the existing Decision
Mesh MCP tools: `select_capabilities`, `get_relevant_subgraph`,
`build_agent_packet`, and for supervised projects `build_project_mesh_packet`.
The local read-only MCP server also exposes `route_product_design_os` for the
same intake/change-request routing and `score_product_design_os` for local
recipe/pattern/asset scoring without writing files.
The local Design Reader can capture screenshots and DOM/CSS evidence with
Playwright, then feed structured viewport evidence into Visual QA. OCR and
reference comparison remain later phases. The document-reader adapter can also
invoke the separate `pdf-supervisor` Python worker for PDF/document conversion
without copying that project into Autopilot.
For design/technology claims, prefer Context7 when connected; otherwise record
the official-docs fallback.
For creative visual directions, use `rules/theme-crossing.md` to combine mood
axes intentionally, then validate the SEO, accessibility, performance, mobile,
and conversion compromise before implementation.
Use `rules/design-seo-tradeoff.md` to declare whether a project is `seo_led`,
`balanced`, `brand_led`, or `experimental_showcase`. The SEO floor is mandatory
for public pages, but perfect SEO is not mandatory for every design-led site.
For external sources and references, use `rules/source-and-license-gates.md` and
`rules/clean-room-reference-workflow.md`. Inspiration can be broad; adoption into
a commercial project requires a complete source record, exact asset path or URL,
license evidence, fallbacks, and QA.

## Integration Boundary

- Existing root `mesh/` remains Autopilot's operational mesh.
- Project-specific meshes remain under `docs/projects/<project-slug>/decision-mesh/`.
- `product-design-os/` provides templates and registries that those meshes and
  project records may reference.
- `product-design-os/library/` stores reusable source reviews, reference records,
  clean-room templates, and the generated local project index.
- Claims from Gemini, Reddit, GitHub, Context7, or other external sources remain
  advisory until verified through local files, tests, official docs, or owner
  decisions.
