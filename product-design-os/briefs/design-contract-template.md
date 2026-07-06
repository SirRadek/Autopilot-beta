# Design Contract

Per-project design contract — the file-backed context that replaces pasting
design decisions into prompts. Lives in the supervised project repo; the
control plane holds this template. The advisory Design Director (agy/Gemini)
proposes diffs to this file; the supervisor lands them after gates. Do not
hardcode token values in prompts — reference this contract.

## Machine layer (YAML header)

Copy into the top of the project's `DESIGN-CONTRACT.md` as YAML front matter:

```yaml
project: <slug>
page_profile: seo_led | balanced | brand_led | experimental_showcase
tokens_source: <path to the project token files (color/typography/spacing)>
type_pairing:
  display: <font id from the source catalog>
  body: <font id from the source catalog>
motion_level: 0-10
updated: YYYY-MM-DD
```

Token values live in the token files, not here. Fonts must reference
license-gated entries in `product-design-os/library/source-catalog.json`.

## Direction

One paragraph: what the design should feel like and why that serves the
target user and the critical user action.

## Do's

- Seed from `taste/global-liked.json` and the project's taste preferences.

## Don'ts

- Seed from `taste/global-disliked.json` and `rules/anti-ai-slop.md`.

## Trend hypotheses in play

Reference dated entries from `library/design-trend-hypotheses.md` only. Each
entry listed here must carry its review-by date. Expired hypotheses must be
re-reviewed before further use.

## Change protocol

1. Design Director proposes a diff (tokens reference, Do's & Don'ts, pairing).
2. Supervisor verifies against gates (`pdos:validate`, fit-safety,
   visual-qa where relevant) and the page profile floor.
3. Only landed contract text governs implementer tasks; proposals are
   advisory until merged.
