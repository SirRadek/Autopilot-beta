# Design Trend Hypotheses

Dated, expiring hypotheses about current visual direction. Trends are not
policy: each entry is advisory input for the Design Director lane, carries a
source and a review-by date, and must be re-reviewed after that date before
further use. Never bake a trend into mesh nodes, recipes, or rules.

Recorded 2026-07-04 from owner-supplied research (secondary synthesis; claims
not independently verified — treat as UNVERIFIED hypotheses). Review by
2026-12-31.

## anti-trend (imperfect, layered, analog)

- What: deliberate imperfection against algorithmic cleanliness — layered
  collage, scanned textures, intentional asymmetry, "human hand" cues.
- Apply for: `brand_led` / `experimental_showcase` profiles wanting warmth and
  distinctiveness; portfolios, culture, campaign pages.
- Do not apply for: `seo_led` conversion pages, dense data UIs, public-sector.
- Floor still holds: legibility, contrast, mobile usability, reduced motion.

## smooth-it-over (softened geometry)

- What: rounded corners, softened edges, friendlier forms replacing strict
  corporate sharpness; evolution of an identity, not a rebrand.
- Apply for: e-commerce, community services, B2B wanting a human face —
  works across `balanced` and `brand_led`.
- Cue for implementers: organic shadows, larger radii, softer contrast ramps.

## kinetic-3d-typography

- What: type that moves or extrudes as a first-class interface element; haptic
  feel; scroll/cursor-reactive headlines.
- Apply for: hero sections in `brand_led` / `experimental_showcase` only, with
  the motion brief contract and DOM-text rule (real text stays DOM).
- Hard limits: `three_d_experience_addon` stop conditions, performance budget,
  reduced-motion fallback.

## signature-typography (custom/modified fonts)

- What: brands modifying letterforms, ligatures, or commissioning custom type
  for an unmistakable signature.
- Apply for: mature brands with budget; otherwise approximate via licensed
  display faces from the source catalog.
- Gate: any font enters projects only through the license-gated source
  catalog; boutique foundry faces (e.g. Canicule, GS Lomba, Snowee, Kronik
  Antik — UNVERIFIED, no catalog entries yet) need per-font license evidence
  before first use.

## Typography pairing rule of thumb

Pair a high-contrast or characterful display face (serif or experimental) for
headings with a neutral, highly legible neo-grotesque or geometric sans for
body text. Both must come from the source catalog; check the pairing against
`min_font_below_legible_floor` and line-length checks in visual QA.
