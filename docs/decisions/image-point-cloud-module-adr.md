# Image Point Cloud Module ADR

**Status:** Accepted for beta implementation, 2026-06-25.

## Decision

Add `src/lib/image-point-cloud/` as the reusable control-plane module for converting PNG images into compact point-cloud payloads. The public API is:

- `imageToPointCloud(options)` reads a PNG from `imagePath` or `imageBuffer` and returns base64-packed point data.
- `decodePointCloud(encoded)` turns the packed payload back into typed arrays for runtime renderers.
- `writePointCloudDebugOverlay(options)` writes a QA PNG overlay that marks selected points on the source image.

The module uses `pngjs`, a pure JavaScript PNG decoder/encoder. It does not depend on Chromium or Playwright.

## Rationale

The default conversion is faithful-first: scan the image by `sampleStep`, apply only alpha and brightness background masking, then emit one point per sampled pixel with the original RGB color. Depth is derived from luma with `z = (luma - 0.5) * depthAmp`.

This follows the successful `kocka_body_3d.html` approach. Prior ROI, quota and importance weighting experiments distorted the source image and missed visual features. For that reason, `regions`, `shapes` and `targetCount` are optional and default off. Their JSDoc warns that they change the faithful pixel-to-point relationship.

## Interface

`EncodedPointCloud` contains:

- `positions`: base64 `Float32Array` payload encoded as little-endian x/y/z triples.
- `colors`: base64 `Uint8Array` payload encoded as RGB triples.
- `sizes`: optional base64 `Uint8Array` point sizes.
- `stats`: point count, dimensions, sample step, mask ratio, bounding box and a compact color histogram summary.

Coordinates are normalized around the image center, with Y flipped upward. RGB stays per-pixel and unweighted in the default path.

## Governance Guarantees

- Determinism: sampling order is stable. Optional thinning uses a seeded hash, not ambient randomness.
- Stats: every output carries enough counts and bounds to spot accidental masking, thinning or dimension changes.
- Debug overlay: QA can inspect which source pixels became points without invoking a browser renderer.
- Scope: the module lives in `src/lib` because it is reusable library code, not a product-design-os registry artifact or renderer-specific script.

## Future Consumption

A future radeq generator can import `decodePointCloud` and render the returned typed arrays directly in Three.js, WebGL or a canvas pipeline. Generated assets can use the CLI to emit a checked-in TypeScript module:

```bash
tsx src/lib/image-point-cloud/cli.ts input.png --step 2 --out output-point-cloud.ts --debug output-overlay.png
```

The generator should keep faithful sampling as the default and enable `targetCount`, `regions` or `shapes` only when an explicit runtime budget requires it.
