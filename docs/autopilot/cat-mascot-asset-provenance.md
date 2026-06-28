# Cat Mascot Asset Provenance

Date: 2026-05-10
Workspace: `C:\Users\sirok\Documents\Autopilot`
Phase: local static-site implementation

## Selected Asset

- Runtime file: `public/models/cat/quaternius-cat.glb`
- Candidate source: https://poly.pizza/m/qKICY6xla2
- Listed author: Quaternius
- Listed license: Public Domain (CC0)
- Local optimized size: 229,676 bytes
- Runtime compression: none
- Required glTF extensions: none

## Why This Asset

- Full-body cat rig with separate joints for head, body, tail, legs, and root.
- Animation clips include `Idle`, `Headbutt`, `Walk`, `Run`, `Jump_Start`, and `Jump_Loop`.
- Small enough for a static website without Draco, Meshopt, KTX2, or extra runtime decoders.
- Can be tinted to a ginger/brown palette inspired by the user's approved cat reference.

## Candidate Checks

- `quaternius-cat-2023.glb`: 238,672 bytes before lossless cleanup.
- `quaternius-cat-2023-pruned-dedup.glb`: 229,676 bytes after `gltf-transform prune` and `dedup`.
- `gltf-transform inspect` result: glTF 2.0, generator `FBX2glTF v0.9.7`, no required extensions, 2,448 triangles, 2,276 uploaded vertices, one 512x512 embedded atlas texture.
- Parsed rig after cleanup: `Body`, `Head`, `Tail`, `FrontLeg.L`, `FrontLeg.R`, `BackLeg.L`, `BackLeg.R`, `Root`.

## Source Verification

- Poly Pizza page for the selected model lists `Quaternius`, `FBX/GLTF format`, and `Public Domain (CC0)`.
- Quaternius Cube World Kit page lists CC0, glTF, animated/textured assets, and commercial use language.
- Quaternius FAQ says the assets are free for commercial, educational, and personal use, do not require attribution, and may be modified.

## Gemini Advisory

Command used:

```powershell
gemini -m auto --skip-trust --approval-mode plan
```

Accepted:

- Prefer the full-body Quaternius candidate over the smaller face/blob candidate because it has head, tail, legs, and `Headbutt`/`Idle` animation support.
- Verify reduced motion, WebGL failure, clipping, mobile behavior, and visual output.

Rejected for this MVP:

- Do not add `react-three-fiber`, `@react-three/drei`, or `gltfjsx`.
- Do not add Draco compression for a sub-250 KB model.
- Do not add new runtime decoders unless a future asset actually requires them.

## Verification

- Unit tests: `npm run test`
- Typecheck: `npm run typecheck`
- Static build: `npm run build`
- Browser e2e: `npm run test:e2e`
- Canvas screenshot pixel gate:
  - `docs/autopilot/cat-mascot-2026-05-10/desktop-final-canvas.png`
  - `docs/autopilot/cat-mascot-2026-05-10/mobile-final-canvas.png`

## Current Limitations

- The model is stylized low-poly, not a realistic fur simulation.
- Eye bones are not separate in the chosen rig; current pointer tracking uses body/head/tail motion.
- The mascot is currently scoped to the hero core panel, not a cross-page roaming companion.
- The private original cat photo remains a local reference only and is ignored by Git; the public derivative is `public/reference/cat-reference.jpeg`.
