# Zednik V5 — DEEP critique with real artifact access (2026-06-27)

Owner correction: critique providers must have **real access to the rendered HTML + source
files** (see them skrz na skrz), not a text description. Earlier round had agy explicitly
blinded (`Do NOT search files`) — worthless. This round: every participant reads the real
self-contained `output/render/landing-page.html` + sources + screenshots.

Participants (all file-grounded):
- **agy** (Gemini, brand/visual) — read landing-page.html + brand doc + opened v5fix-*.png
  screenshots; wrote a full audit. exit 0.
- **Workflow: 5 Opus lenses** (structure-css, a11y-contrast, content-brand, responsive-fit,
  conversion-ux) — each read its assigned real files → **28 findings → adversarial
  verify (skeptic re-reads the HTML per finding) → 26 confirmed** (2 rejected, several
  down-graded).
- **codex** (technical) — empty_output both attempts (lane flaky); its CSS/technical lens
  was independently covered by the structure-css + a11y-contrast Opus lenses on the same files.
- **Opus** — multimodal synthesis with the screenshots.

## What real file access caught that screenshots + green gates did NOT

**CRITICAL — the page cannot convert a lead (cux-1).** All three CTAs point at in-page
anchors that DO NOT EXIST (`#kontakt` :835, `#proof` :855, `#request` :867 — no matching
`id` anywhere), and there is NO phone number, `tel:`, `mailto:`, or form on the whole page.
A homeowner who clicks any CTA reaches nothing. For a local mason the single highest-
converting action (a tappable phone) is entirely absent. (agy independently: the CTAs and
contact path are broken.)

**HIGH — the proof "real work" image is missing / off-brand (CB2 + CB1).** The proof
section references `./assets/zednik-brick-proof.jpg`, which is NOT in the render assets dir
(only the sandstone wall is) → it renders as a broken/empty frame in the trust-critical
slot while the hero photo shows. And even when present it is a RED-BRICK stock wall —
off-brand vs the "Pískovec & Šalvěj" sandstone hero (the brand doc explicitly differentiates
away from competitor brick-red). agy: "showing a broken image is a major trust-killer."

**HIGH — my own scrim fix reintroduced a contrast risk (SC-1 / A11Y-2).** Making the photo
visible (scrim → low alpha) means the dark sage H1 (#2C5E43) + eyebrow now sit over an
UNCONTROLLED lit photo with only a text-shadow, no backing plate → contrast drops below AA
over mid/dark photo regions (H1 large-text 3:1 floor not guaranteed; eyebrow 4.5:1 fails on
dark regions). The old near-black scrim guaranteed contrast; lightening it removed the
guarantee. Fix: strengthen a darkening band under the copy column, or flip hero text light.

**HIGH — trust badge contrast (A11Y-1):** badge text #F9F5EE on its translucent fill
composites to ~3.6:1 over the page bg, < 4.5:1. Make the badge fill opaque/darker.

**HIGH — proof + CTA headings are giant wrapping walls (RF-1/RF-2/RF-6).** `--pdos-type-heading`
hits its 5rem/80px max on any desktop ≥1333px, but the H2 columns are capped at 14ch/16ch →
the ~110-char Czech sentences wrap to 7-10 lines of huge serif, reading as a tech splash,
contradicting the craftsman brand. line-height 0.94/0.95 is too tight for stacked Czech
diacritics across that many lines, and the sections (unlike the hero) get no mobile font
step-down. agy independently: "9-12 lines… visually overwhelming."

**HIGH — conversion structure:** proof CTA is the weakest (ghost) button at peak intent
(cux-2); proof block has zero hard-credibility marker — the build-count is stranded in the
hero (cux-3); final CTA restates the proof verbatim instead of escalating (cux-4).

**MEDIUM/LOW:** stone::after over-darkens the photo's bottom edge in the image variant
(SC-2); the WCAG gate is structurally blind to every color-mix and text-over-photo pair, so
A11Y-1/2 passed it (A11Y-3 — worth fixing to stop regressions); stale visual_qa_probe
headline/CTAs (CB3); CTA verb inconsistency kalkulace/nacenění + mismatched anchors (CB4);
H1 line-height 1.02 causes ~4px serif glyph overlap on the 3-line headline (SC-4, measured);
sage used as H1 body color rather than accent (CB6); page reads as 3 disconnected blocks +
awkward 3-column outcome-cta grid separating testimonial from CTA (cux-5 + agy Move 3); dead
stone-surface CSS in image variant (SC-3); 4K sparseness (RF-4); over-promise "bez
navyšování rozpočtu" (CB5); marginal muted_text pairs (A11Y-4); 70rem copy-wrapper dead cap
(RF-5); abstract-SVG proof fallback (cux-6).

Full verified findings with file:line evidence: `output/critique2/` (workflow output) +
agy artifact. This appendix is the durable record.

## Resolution log
- **Wave 1** (landed `ba5eb84`, live): solid sage CTA (cux-2 hero), opaque badge (A11Y-1),
  stronger hero copy backing (SC-1/A11Y-2), real warm stone proof photo (CB1/CB2), split +
  resized proof/CTA headings (RF-1/RF-2/RF-6/SC-4), unified `#kontakt` hrefs (CB4), softened
  over-promise (CB5), refreshed stale probe (CB3), proof CTA solid (cux-2).
- **Wave 2** (landed `c1e181f`, live): the `#kontakt` contact section — tappable `tel:` +
  accessible `mailto:` form (cux-1, the CRITICAL). Phone/email are PLACEHOLDERS (owner swaps).
- **Wave 3** (this pass): **A11Y-4** muted_text override `#6E6962`→`#5F5A53` (4.57→5.87:1 on
  panel); **A11Y-3** WCAG gate hardened — `resolveColor` now resolves `color-mix()` (incl.
  transparent-over-backdrop) and the gate HARD-checks the badge + muted-on-panel composited
  pairs and WARNs on text-over-photo. Verified the resolver against this doc's own hand-
  computed numbers: pre-fix badge fill = rgb(131,128,125), pre-fix badge contrast = 3.60:1
  (the value the old gate was blind to). 11 new unit tests; verify EXIT 0 (164 tests).
- **Deferred** (LOW/NIT, not blocking): cux-5/agy Move 3 (outcome-cta 3-column splits the
  testimonial from the CTA → cohesion redesign), RF-4 (4K sparseness), SC-3 (dead stone-surface
  CSS in image variant), RF-5 (70rem copy-wrapper cap), CB6 (sage as H1 body color), cux-6
  (abstract-SVG proof fallback). Next polish pass.

## Meta
The deterministic gates AND a browser fit-probe were all green on this page, and my own
screenshot read missed the dead CTAs and the missing proof image entirely. Only giving the
providers the actual files surfaced them. This is exactly the owner's point.
