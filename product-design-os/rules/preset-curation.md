# Preset Curation

How motion/effect presets enter and leave `library/preset-manifest.json`.

## Preset curation rule

- Success in a real supervised project → add a preset entry with
  `status: "candidate"`; promote to `"proven"` only after a second successful
  use in a different project or page.
- Failure (owner rejection, performance regression, accessibility or
  reduced-motion breakage) → set `status: "anti_pattern"`, add a matching item
  to `taste/global-disliked.json`, and record a line in
  `taste/feedback-log.json` explaining what failed and why.
- Presets are pointers to project proof: `demo_route` and `screenshots`
  reference the supervised project route/repo where the preset actually ran.
  Never host demo code or runtime demos in this repository.
- Every preset must reference an existing pattern via `pattern_id`
  (enforced by `pdos:validate`); duplicate preset ids are rejected.
