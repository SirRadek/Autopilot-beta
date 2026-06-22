# Strict Product & Design Process

Autopilot must not implement a product or design request immediately when the
project type, goal, audience, workflow, risk, and definition of done are not
known.

## Required Gates

Before these gates, use the existing Decision Mesh MCP path:

1. `select_capabilities`
2. `get_relevant_subgraph`
3. `build_agent_packet`
4. `build_project_mesh_packet` for supervised projects

Use `select_design_review_route` and `search_architecture_library` when the work
contains visual critique, technology choice, GitHub project research, Gemini
brainstorming, or current best-practice claims.

1. Project Type Lock
2. Needs Lock
3. Scope Contract
4. Product Opposition
5. Direction Lock
6. Implementation Lock
7. QA Lock

## Gate Outputs

Project Type Lock must identify project type, primary goal, target users,
critical user action, logic priority, design priority, motion level, and risk
level.

Needs Lock must produce a Needs Report with explicit requirements, hidden needs,
critical workflows, roles, data, risks, conflicts, open questions, recommended
direction, and what not to do yet.

Scope Contract must update `product-design-os/scope/PROJECT_SCOPE.md` or the
project-specific equivalent.

Product Opposition must identify goal drift, feature creep, unnecessary effects,
UX risks, performance risks, accessibility risks, and conversion risks.

Direction Lock must approve UX direction, logic model, design direction, asset
strategy, creativity level, motion level, design/SEO tradeoff profile,
performance budget, and test plan.
If the work uses external inspiration or assets, Direction Lock must also name
the source ids, reference ids, clean-room boundary, and license/provenance state.

Implementation Lock must name exact work, non-work, target files, tests, and
verification method.

QA Lock must include logic, responsive, accessibility, performance, visual,
scope, change-request, and report checks.

## Stop Conditions

- Missing project mesh for implementation work.
- Missing scope for non-trivial product/design work.
- Missing source/library entry for adopted external asset or template.
- Reference HTML/CSS/assets copied into implementation without clean-room brief.
- Technology or best-practice claim without Context7 or official-docs fallback.
- External cloud model would become source of truth.
- Paid tool, paid credit, or unknown cost is required.
- New runtime, connector mutation, or parallel source of truth is proposed
  without architecture decision.
