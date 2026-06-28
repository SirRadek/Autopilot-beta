# Graphic Agent Operating Model

Date introduced: 2026-05-29
Status: active control-plane policy
Owner: Autopilot Control Plane

This document defines how Autopilot routes and supervises visual production work. The Graphic Production Agent is a governed execution role, not a separate product runtime, design studio, or autonomous cloud workflow. Cloud tools are allowed when they are free/no-cost and their account, usage-rights, and data-disclosure boundaries are clear; paid tools remain blocked unless the owner later grants an explicit exception.

## Purpose

The Graphic Production Agent decides how graphics should be created for a project:

- static brand systems, icons, diagrams, and vector graphics
- website motion backgrounds and lightweight animated surfaces
- simple physics visuals
- moving models and WebGL scenes when they materially explain the product or system
- video storyboards and frame-based explainers

The agent must choose the smallest useful toolchain and produce reviewable artifacts before implementation.

## Core Rule

DOM content first, motion second.

Primary text, SEO content, calls to action, forms, navigation, pricing, legal text, and accessibility-critical information must remain in HTML. Canvas, WebGL, video, and generated media can support the story, but they must not become the only source of meaning.

## Default Toolchain

Local and free tools are the default lane:

| Need | Default tool | Reason |
| --- | --- | --- |
| Static graphics, icons, UI frames | HTML, CSS, SVG | versionable, fast, accessible, easy to inspect |
| Motion backgrounds | CSS, SVG, Canvas 2D | low-cost animation without WebGL by default |
| Lightweight particles and mesh fields | Canvas 2D | predictable performance and simple fallbacks |
| Depth, camera, moving models | Three.js | WebGL only when depth/model motion is useful |
| Real physics | Rapier | only for gravity, collisions, constraints, or rigid bodies |
| Model creation or cleanup | Blender | local GLB/source asset workflow when installed |
| Visual evidence | Playwright screenshots | repeatable verification and regression evidence |

Optional free cloud tools are allowed after no-cost confirmation:

| Tool | Default status | Decision needed |
| --- | --- | --- |
| Figma | optional free cloud design surface | use when editable collaborative design files are needed and the free/no-cost path is confirmed |
| Canva | optional free cloud template surface | use when templated output is useful and the free/no-cost path is confirmed |
| HyperFrames | optional free/no-cost video lane | use for HTML-to-video/storyboard output when video is requested and no paid plan is required |
| Kling AI | paid cloud risk | blocked by default; use only after a later explicit owner cost, account, and rights exception |

## Required Inputs

The Graphic Production Agent must not start production until it has:

- visual goal
- target surface
- audience
- brand constraints
- content that must remain DOM-accessible
- source ids or reference ids when external inspiration/assets are involved
- license/provenance status for every adopted external asset
- motion intensity
- asset budget
- performance budget

Missing visual direction is a stop condition.

## Output Contract

Every completed visual-production slice returns:

- visual brief
- selected tool route
- asset manifest
- source/library adoption record
- implementation notes
- fallback plan
- verification evidence

For motion or model work, the fallback plan must include reduced-motion and mobile behavior.

## MCP Routing

The local read-only MCP server exposes `select_graphic_route`.

This tool returns the Graphic Production Agent, matched route rules, preferred tools, fallback tools, required checks, and stop conditions. It does not generate assets, call external providers, mutate files, deploy, or approve work.

## Routing Matrix

| Request signal | Output | Preferred route | Fallback route |
| --- | --- | --- | --- |
| brand, logo, icon, vector, illustration | brand system or static vector | HTML/CSS/SVG | Figma or Canva with owner decision |
| motion, animated background, particles | motion background | CSS/SVG or Canvas 2D | Three.js if depth or camera matters |
| physics, gravity, collision, spring | physics motion | Canvas 2D plus Rapier | CSS/SVG if easing is enough |
| 3D, WebGL, GLB, model, camera | WebGL scene or model asset | Three.js plus Blender | Canvas 2D fallback |
| video, cinematic, Kling, HyperFrames, reel | video storyboard | HyperFrames plus Playwright capture | CSS/SVG or Canvas storyboard |

## Quality Gates

Required checks:

- SEO content outside canvas
- reduced-motion support
- mobile fallback
- performance budget
- contrast check
- responsive check
- visual regression capture
- free tier or no-cost confirmation
- owner cost decision for paid-tool exceptions

Stop conditions:

- primary content hidden in canvas
- missing reduced-motion fallback
- missing mobile fallback
- performance budget missing
- cloud tool without free-tier confirmation
- paid tool without owner exception
- unlicensed or unknown asset source
- reference copied without clean-room brief
- visual direction missing

## Handoff

The Graphic Production Agent hands off to:

- Frontend/Web Agent for implementation
- SEO Performance Agent when visual content could affect indexability, speed, or Core Web Vitals
- UX Reviewer for clarity, hierarchy, accessibility, and motion fatigue
- QA for responsive, reduced-motion, and visual regression evidence
- Governance Officer only after independent evidence exists

The agent cannot approve its own visual output.

## Decision Ledger Entry

```yaml
decision_id: 2026-05-29-graphic-agent-operating-model
type: architecture
context: Autopilot needs a governed way to decide how graphics, motion backgrounds, physics visuals, models, and video storyboards are produced.
decision: Add a Graphic Production Agent policy with local/free defaults, explicit tool routing, fallback requirements, free-cloud allowance, and paid-tool blocks by default.
reasoning: Visual production needs repeatable routing and quality gates without turning Autopilot into a product runtime or paid external workflow by default.
alternatives:
  - ad hoc graphics per request
  - make Three.js the default for all visual work
  - make Kling or another paid cloud generator the default
  - create a separate design studio runtime now
impact: Autopilot can route visual production through typed governance while preserving control-plane boundaries and free/local defaults.
approved_by: owner request to configure the graphical agent inside Autopilot
related_tasks:
  - src/data/delivery-system/graphicAgent.ts
  - tests/delivery-system/graphic-agent-policy.test.ts
```
