# Design SEO Tradeoff

SEO is a project-specific tradeoff, not a universal maximum.

Autopilot must protect a minimum SEO and accessibility floor, but it must not
force every website into the same content-heavy, perfectly optimized structure.
Some sites sell through search. Some sell through brand memory, referral,
portfolio impact, social sharing, direct sales, or a single campaign moment.

## Tradeoff Profiles

### `seo_led`

Use for local services, ecommerce categories, content hubs, public information,
and recovery work.

Priority:

- crawlability,
- keyword/content depth,
- URL structure,
- internal links,
- schema where useful,
- Core Web Vitals,
- conversion clarity.

Design can be original, but not at the cost of discoverability or task clarity.

### `balanced`

Use for most professional marketing websites.

Priority:

- first-screen clarity,
- memorable visual identity,
- static service content,
- proof and CTA,
- good enough metadata and indexability,
- performance that does not hurt mobile trust.

This is the default for premium service sites.

### `brand_led`

Use for portfolios, creative studios, campaign pages, launches, and sites where
the main value is remembered visual identity.

Priority:

- originality,
- first impression,
- emotion,
- motion quality,
- shareability,
- proof of craft.

SEO does not need to be perfect. It does need a visible, indexable floor so the
site is understandable, linkable, accessible, and not invisible to crawlers.

### `experimental_showcase`

Use for demos, art pieces, motion studies, and highly interactive previews.

Priority:

- experiment quality,
- technical craft,
- controlled fallback,
- clear entry/exit path,
- performance budget evidence.

Search traffic is not the primary goal. The page still needs a title, basic
description, accessible links, and a static explanation of what the visitor is
seeing.

## Minimum SEO Floor

Unless the owner explicitly approves a private/noindex campaign, every public
page keeps:

- one clear purpose,
- title and description,
- canonical or explicit canonical decision,
- robots/indexability decision,
- visible H1 or equivalent primary heading,
- normal HTML links for primary navigation and CTA,
- essential offer/proof text outside canvas, video, image, and WebGL,
- mobile-readable layout,
- accessible names for controls,
- reduced-motion behavior when motion is present,
- no text overlap or horizontal overflow,
- a performance budget appropriate to the profile.

## What Can Be Traded Away

On `brand_led` and `experimental_showcase` work, these may be relaxed when the
reason is recorded:

- exhaustive keyword coverage,
- long-form SEO sections,
- dense internal linking,
- schema beyond basics,
- perfect Lighthouse score,
- conservative layout conventions,
- very low motion level.

## What Cannot Be Traded Away Silently

Do not trade away these without an explicit owner decision:

- indexability of a page meant to be public,
- readable primary message,
- accessible navigation,
- CTA availability,
- mobile usability,
- reduced-motion fallback,
- license/provenance checks,
- rollback path.

## Direction Lock Requirement

Every design direction must state:

- `tradeoff_profile`,
- what SEO/technical rules are kept,
- what SEO/technical rules are intentionally relaxed,
- why that tradeoff fits the target user and business goal,
- how visual originality is verified,
- what fallback keeps the page usable.
