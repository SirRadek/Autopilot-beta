# Clean-Room Reference Workflow

References can be studied broadly, but implementation must be original.

This workflow separates evidence from production work so Autopilot can learn
from strong websites, screenshots, OCR, DOM/CSS inspection, and HTML captures
without copying protected expression into our projects.

## Allowed Reference Capture

Allowed for analysis:

- public URL,
- screenshots,
- viewport notes,
- visible text extracted through OCR or DOM inspection,
- heading and CTA hierarchy,
- approximate color, spacing, typography, and motion observations,
- interaction notes,
- performance and SEO observations,
- publicly visible HTML/CSS inspected for understanding.

Raw captures are evidence, not implementation input. Store them under
`output/reference-captures/` or a project-specific evidence folder unless the
owner explicitly approves a sanitized committed reference.

## Blocked Reuse

Do not copy into a project:

- HTML structure as production code,
- CSS rules or animation keyframes,
- JS interaction code,
- illustrations, photos, video, 3D models, icons, fonts, logos, or brand assets,
- exact copywriting,
- distinctive section composition copied closely enough to be recognizable.

Do not make a cloned site with different colors. Extract principles, not files.

## Clean-Room Steps

1. Capture evidence: URL, date, screenshots, OCR/DOM text, layout notes, and
   performance/SEO observations.
2. Extract abstractions: purpose, audience, layout rhythm, visual anchor, motion
   role, proof strategy, CTA logic, and failure risks.
3. Quarantine raw evidence: keep raw HTML/CSS/screenshots out of implementation
   prompts except as source pointers.
4. Write an original brief: describe the desired effect in our own words,
   without source code or copied assets.
5. Build with our stack: HTML/CSS/SVG/Canvas/Three.js/Blender or other approved
   local/free routes.
6. Verify distance: compare screenshots and code shape so the result is clearly
   original.
7. Record adoption: source ids, inspiration notes, assets actually used,
   licenses, QA evidence, and rollback.

## Reverse Engineering Boundary

Reverse engineering is allowed for learning, interoperability, accessibility,
SEO, performance, and design analysis. It is not approval to reuse protected
expression.

If the target site's terms block scraping, automated copying, or redistribution,
do not store raw copies. Use screenshots and high-level notes instead.

## Handoff Rule

Never pass raw reference output directly to an implementation agent. Normalize it
into:

- verified facts,
- assumptions,
- inspiration patterns,
- protected elements to avoid,
- original design brief,
- allowed sources/assets,
- forbidden reuse,
- required checks,
- evidence pointers.
