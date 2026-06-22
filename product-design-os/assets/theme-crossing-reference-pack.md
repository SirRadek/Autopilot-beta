# Theme Crossing Reference Pack

Status: candidate reference pack
Updated: 2026-06-05

Use this pack when a marketing or creative-service website needs more original
visual direction while still preserving SEO-readable content, conversion clarity,
accessibility, performance, and mobile safety.

## Advisory Gemini Brainstorm

Gemini CLI 0.44.1 was used as a redacted advisory reviewer. No private
repository data, secrets, local paths, customer data, or unpublished assets were
sent. Gemini output is not a source of truth.

Useful directions after review:

- `Prism Minimalist`: calculated minimalism + dopamine color + 3D. Keep as a
  lightweight SVG/CSS prism first; 3D only after performance budget.
- `Analog Automation`: modern retro + written/editorial craft + distinct proof.
  Strong fit for proof-led service pages.
- `Pixel Playground`: pixel vibe + freedom + novelty. Good for demo worlds if
  SEO text remains outside canvas.
- `Digital Atrium`: chill/calm + lightness + futurism. Use cautiously because
  glass/blur can hurt contrast and mobile performance.
- `Avant-Garde Canvas`: art + animation + lightness. Use only with static HTML
  mirror and reduced-motion fallback.

Rejected or constrained:

- Hidden semantic text as an SEO workaround. Use real visible HTML content.
- Canvas/WebGL as the only carrier of content.
- Heavy physics or 3D before a budget, fallback, and mobile plan exist.

## Free/No-Cost Source Pool

Source candidates must still be checked per concrete file before adoption.
The canonical reusable source records live in
`product-design-os/library/source-catalog.json`. This section keeps only the
theme-crossing design intent.

- Open Doodles: CC0 illustration source for hand-written/playful artistic
  accents. Good for written/editorial and calm human cues.
  Source: https://www.opendoodles.com/about
- Open Peeps: CC0 avatar/people library from the same open illustration family.
  Source: https://www.openpeeps.com/
- Quaternius Ultimate Animated Animal Pack: CC0 animated animal models in FBX,
  OBJ, Blend, and glTF. Good for mascot experiments.
  Source: https://quaternius.com/packs/ultimateanimatedanimals.html
- Kenney assets: CC0 2D, 3D, UI, pixel, and texture packs. Good for pixel,
  retro, UI-kit, and demo-world prototypes.
  Source: https://kenney.nl/assets
- Poly Haven: CC0 HDRIs, textures, and 3D models. Good for lighting, material,
  and background studies.
  Source: https://polyhaven.com/license
- ambientCG: CC0 PBR materials, HDRIs, models, and textures. Good for 3D
  surface tests.
  Source: https://ambientcg.com/
- Haikei / Flowity-style SVG generators: useful for custom SVG backgrounds, but
  generated outputs must be saved locally with source notes before use.
  Sources: https://haikei.app/ and https://flowity.app/
- Lume Studio Next: MIT Next.js motion/agency template reference. Use as
  motion/layout inspiration, not as an Astro runtime dependency by default.
  Source: https://github.com/haramishra/lume-studio-next
- AstroWind: MIT Astro/Tailwind reference for SEO-friendly site structure,
  sitemap, Open Graph, image optimization, and content architecture.
  Source: https://github.com/arthelokyo/astrowind

Avoid:

- Free assets with unclear redistribution rights.
- Personal-use-only packs.
- Free preview files from paid template systems unless the license explicitly
  allows commercial reuse.
- Lottie/Rive/community files without a per-file license record.

## Direction Seeds

### Light Retro Proof

Axes: lightness + modern retro + written/editorial craft.

Use for: professional but playful service proof, case studies, handoff packets,
before/after evidence.

Assets:

- `backgrounds/theme-written-retro-proof.svg`
- Open Doodles annotations or custom line drawings.

SEO compromise:

- Keep H1, service proof, case outcomes, and CTA in DOM text.
- Use texture as a background only.

### Calm Prism Focus

Axes: calm + calculated minimalism + dopamine accent.

Use for: high-trust homepage, focused lead path, light/dark premium mode.

Assets:

- `backgrounds/theme-calm-prism-grid.svg`
- Poly Haven or ambientCG only if a later 3D material test is approved.

SEO compromise:

- Keep the first viewport offer readable before any motion.
- Use static SVG first; 3D prism is optional.

### Dopamine Demo Worlds

Axes: colorful dopamine + pixel vibe + product demos.

Use for: demo gallery, service worlds, playful route previews.

Assets:

- `backgrounds/theme-dopamine-pixel-field.svg`
- Kenney pixel/UI packs after per-pack license capture.

SEO compromise:

- Demo world labels and descriptions must be readable links.
- Pixel visual cannot replace service copy.

### Cat Concierge Motion

Axes: playful mascot + calm trust + proof-led guidance.

Use for: RadeQ cat guide, cursor/scroll cue, friendly non-technical onboarding.

Assets:

- Existing RadeQ cat model, or Quaternius CC0 animal model after exact source
  record.
- Static image/SVG fallback for no-WebGL and reduced-motion.

SEO compromise:

- Mascot never carries primary content.
- CTA and demo links remain normal HTML.

## Required Handoff Fields

Every adopted source must record:

- source URL,
- license,
- exact asset URL or local path,
- allowed use,
- modifications,
- performance budget,
- mobile fallback,
- reduced-motion behavior,
- SEO content kept outside media/canvas,
- visual QA evidence.
