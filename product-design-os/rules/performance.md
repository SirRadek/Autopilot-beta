# Performance Rules

Performance is a product constraint.

## Motion And Media Budget

- Animate transform and opacity by default.
- Avoid layout-thrashing animation.
- Lazy-load non-critical media.
- Keep primary content available as HTML text.
- Respect `prefers-reduced-motion`.
- Use 3D only when it explains product, process, data, or system state.
- Treat 3D/WebGL as a premium add-on, not a default hero treatment.

## Stop Conditions

- Heavy animation blocks the critical user action.
- Canvas replaces primary SEO or accessibility content.
- A paid media or model tool is required without explicit owner approval.
- Mobile performance cannot be verified.
