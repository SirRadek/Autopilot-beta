import { parse, type HTMLElement } from "node-html-parser";

import type { RenderContractIssue } from "./check-render-contract";
import type { EncodedPointCloud } from "../../src/lib/image-point-cloud";
import { decodeFloat32Base64, decodeUint8Base64, decodeUint16Base64 } from "../../src/lib/image-point-cloud";

/**
 * check-point-cloud-scene — the Phase-0 gate that makes a STORED image→point-cloud
 * scene visible to autopilot's checkers.
 *
 * A faithful point cloud is a real image re-encoded as thousands of base64 points
 * inside a <script>. That payload matches neither the frame-element nor the
 * `data:` regex in check-render-contract.ts, and the contract parser strips
 * <script> before DOM parsing — so a cloud is GATE-INVISIBLE by construction. A
 * cloud hero could therefore reconstruct a readable headline/logo/price in-canvas
 * with no DOM twin (bypassing canvas_text_dom_twin / no_primary_content_in_canvas)
 * and launder an unlicensed source image into "just coordinates."
 *
 * `validatePointCloudScene` runs on the serialized EncodedPointCloud + its scene
 * declaration + the rendered HTML, and fails CLOSED. It is intended to be wired
 * into F3 renderability / F6 buildability as a non-buildable issue family with the
 * SAME exit semantics as the existing render-contract checks. `detectUndeclared
 * CloudInHtml` is the HTML-side safety net (called from checkRenderedContract):
 * any embedded cloud payload without a validated marker is an error.
 *
 * Design note: the author-declared metadata (text attestation, provenance, motion,
 * decorative role) lives in a scene WRAPPER here, not in the src/lib sampler's
 * PointCloudStats. Provenance and text-intent are composition-authoring concerns,
 * not properties of the pixel→point transform, so the faithful sampler stays a
 * pure, reusable library and the gate owns policy.
 */

// ─── Budgets (shared with the renderer at Phase 1) ──────────────────────────────

export const POINT_CLOUD_SCENE_BUDGETS = {
  /** Hero-class point ceiling. ~20x the dot engine's 1200 desktop budget. */
  maxPoints: 24_000,
  /** Lowpoly-facet ceiling: facets are a sparse decimation, never a second full cloud. */
  maxFacets: 4_000,
  /** Capped k-NN edge ceiling (stored pair count) + per-point neighbour cap. */
  maxEdges: 18_000,
  maxEdgeNeighbors: 3,
  /** Inline payload ceiling (positions+colors+sizes base64 chars). */
  maxPayloadBytes: 384 * 1024,
  /** Source-image pixel ceiling (width*height). */
  maxSourcePixels: 4_000_000,
  /** depthAmp ceiling: luma∈[0,1] so z stays within ~[-2,2] normalized units. */
  maxDepthAmp: 4,
  /** depthAmp*parallax_gain and bbox z-range ceiling. */
  maxEffectiveDepth: 6,
  /** At/above this point count a cloud can form legible glyphs. */
  glyphPointFloor: 1500,
  /** few-colour, high-top-ratio histogram = lettering/logo signature. */
  glyphBucketMax: 8,
  glyphTopRatio: 0.6
} as const;

// ─── Source catalog (subset of library/source-catalog.json) ─────────────────────

export type SourceCatalogStatus =
  | "approved_source"
  | "candidate_source"
  | "inspiration_only"
  | "blocked";

export type SourceCommercialUse =
  | "allowed"
  | "allowed_with_attribution"
  | "inspiration_only"
  | "unknown"
  | "blocked";

export interface SourceCatalogEntry {
  readonly id: string;
  readonly status: SourceCatalogStatus;
  readonly commercial_use: SourceCommercialUse;
}

export interface PointCloudSourceCatalog {
  readonly sources: readonly SourceCatalogEntry[];
}

const FAN_OUT_SAFE_COMMERCIAL_USE: ReadonlySet<SourceCommercialUse> = new Set<SourceCommercialUse>([
  "allowed",
  "allowed_with_attribution"
]);

// ─── Scene declaration ──────────────────────────────────────────────────────────

/**
 * Cloud origin. `internal` = authored in-repo from an owned image (no external
 * source to launder → passes). `source-recorded` = derived from an external
 * image and must bind to an approved catalog source via a per-file record.
 * Mirrors the asset manifest's provenance_status.
 */
export type PointCloudSceneSource =
  | { readonly provenance: "internal" }
  | {
      readonly provenance: "source-recorded";
      readonly source_id: string;
      readonly asset_url: string;
      readonly content_hash: string;
    };

export interface PointCloudStaticFallback {
  readonly label: string;
}

export interface PointCloudSceneDeclaration {
  /** Must be "decorative": the cloud is never the sole representation of content. */
  readonly role: string;
  readonly aria_hidden: boolean;
  readonly animated: boolean;
  readonly parallax_gain?: number;
  /**
   * The human-readable strings the cloud intends to depict. MUST be declared
   * (use [] to attest the cloud carries no readable text). Each declared string
   * requires a visible [data-cloud-twin] DOM node with identical text.
   */
  readonly text_payload?: readonly string[];
  readonly static_fallback?: PointCloudStaticFallback;
  readonly source: PointCloudSceneSource;
}

export interface PointCloudScene {
  readonly encoded: EncodedPointCloud;
  readonly declaration: PointCloudSceneDeclaration;
}

export interface ValidatePointCloudSceneInput {
  readonly scene: PointCloudScene;
  /** The rendered HTML the cloud ships inside (for DOM-twin + reduced-motion proof). */
  readonly html: string;
  /** Required only for source-recorded clouds; internal clouds need no catalog. */
  readonly catalog?: PointCloudSourceCatalog;
}

export interface PointCloudSceneReport {
  readonly errors: readonly RenderContractIssue[];
  readonly warnings: readonly RenderContractIssue[];
}

// ─── The checker ────────────────────────────────────────────────────────────────

export function validatePointCloudScene(input: ValidatePointCloudSceneInput): PointCloudSceneReport {
  const errors: RenderContractIssue[] = [];
  const warnings: RenderContractIssue[] = [];
  const pushError = (code: string, message: string): void => {
    errors.push({ code, severity: "error", message });
  };
  const pushWarning = (code: string, message: string): void => {
    warnings.push({ code, severity: "warning", message });
  };

  const { encoded, declaration } = input.scene;

  checkDecorative(declaration, pushError);
  checkBudgets(encoded, pushError);
  checkDepth(encoded, declaration, pushError);
  checkProvenance(declaration.source, input.catalog, pushError);
  checkTextTwins(encoded, declaration, input.html, pushError, pushWarning);
  checkReducedMotion(declaration, input.html, pushError);
  checkEngineGuards(declaration, input.html, pushError);
  checkRelief(input.html, pushError);
  const geometry = checkGeometry(encoded, pushError);
  checkFacets(encoded, geometry, input.html, pushError);
  checkEdges(encoded, geometry, pushError);

  return { errors, warnings };
}

/**
 * Decode-not-trust: the budget/depth/anti-text checks above key on DECLARED metadata
 * (pointCount, stats.bbox, optionsSummary.depthAmp) and base64 string LENGTHS — all
 * attacker-controllable in a hand-authored .cloud.json. This decodes the REAL positions
 * buffer ONCE and measures it: the declared point count must match the buffer, no
 * coordinate may be non-finite, xy must stay inside the normalized hull, and the REAL
 * z-range must respect the depth budget (so a cloud cannot declare depthAmp=1 yet ship
 * z=100 floats the engine then drives parallax from). The measured bbox is handed to the
 * facet and edge checks so they bound against the truth, not the declaration.
 */
interface CloudGeometry {
  readonly positions: Float32Array;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function checkGeometry(encoded: EncodedPointCloud, pushError: PushError): CloudGeometry | null {
  let positions: Float32Array;
  try {
    positions = decodeFloat32Base64(encoded.positions);
  } catch {
    pushError("cloud_geometry_invalid", "positions payload is not decodable base64:f32le.");
    return null;
  }
  if (positions.length !== encoded.pointCount * 3) {
    pushError(
      "cloud_geometry_invalid",
      `declared pointCount ${encoded.pointCount} but positions decode to ${Math.floor(positions.length / 3)} points — declared count and buffer disagree.`
    );
    return null;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < encoded.pointCount; i += 1) {
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const z = positions[i * 3 + 2] as number;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      pushError("cloud_geometry_invalid", `positions contain a non-finite coordinate at point ${i} (NaN/Infinity).`);
      return null;
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (minX < -1 || maxX > 1 || minY < -1 || maxY > 1) {
    pushError(
      "cloud_geometry_invalid",
      `positions xy range [${minX.toFixed(2)},${maxX.toFixed(2)}]×[${minY.toFixed(2)},${maxY.toFixed(2)}] is outside the normalized [-1,1] hull.`
    );
  }
  if (maxZ - minZ > POINT_CLOUD_SCENE_BUDGETS.maxEffectiveDepth) {
    pushError(
      "cloud_geometry_invalid",
      `actual positions z-range ${(maxZ - minZ).toFixed(2)} is over the ${POINT_CLOUD_SCENE_BUDGETS.maxEffectiveDepth} depth budget (the real buffer is measured, not the declared stats).`
    );
  }
  return { positions, minX, maxX, minY, maxY, minZ, maxZ };
}

/**
 * The line presets (edge-wire / blueprint-ribs) stroke a capped k-NN edge list over
 * the cloud's OWN points. Two real risks the gate must close from the artifact:
 * (1) ANTI-SLOP — a wireframe over a SPARSE cloud can render legible lettering that
 * isGlyphLikely (which only sees points, not strokes) would miss; so edges are allowed
 * only on clouds at/above the glyph floor, where the cloud already cleared the glyph
 * heuristic. (2) PAYLOAD/INTEGRITY — the declared edgeCount must match the decoded
 * buffer and every index must reference a real point (no dangling endpoints, no
 * understated count smuggling a fatter buffer past the 384KB sum).
 */
function checkEdges(encoded: EncodedPointCloud, geometry: CloudGeometry | null, pushError: PushError): void {
  const hasCount = typeof encoded.edgeCount === "number";
  const hasEdges = typeof encoded.edges === "string";
  if (!hasCount && !hasEdges) {
    return; // no edge bake — valid
  }
  if (!hasCount || !hasEdges) {
    pushError("cloud_edges_invalid", "Edge list must declare edgeCount and edges together; a partial edge payload is rejected.");
    return;
  }
  const edgeCount = encoded.edgeCount as number;
  if (!Number.isInteger(edgeCount) || edgeCount < 1) {
    pushError("cloud_edges_invalid", `edgeCount must be a positive integer; got ${edgeCount}.`);
    return;
  }
  if (encoded.pointCount < POINT_CLOUD_SCENE_BUDGETS.glyphPointFloor) {
    pushError(
      "cloud_edges_invalid",
      `Edges require a cloud of at least ${POINT_CLOUD_SCENE_BUDGETS.glyphPointFloor} points (a sparse wireframe could otherwise form legible glyphs); cloud has ${encoded.pointCount}.`
    );
  }
  if (edgeCount > POINT_CLOUD_SCENE_BUDGETS.maxEdges) {
    pushError("cloud_edges_invalid", `edgeCount ${edgeCount} is over the ${POINT_CLOUD_SCENE_BUDGETS.maxEdges} edge ceiling.`);
  }
  if (encoded.encoding.edges !== "base64:u16le") {
    pushError("cloud_edges_invalid", `edges must be encoded base64:u16le; got ${String(encoded.encoding.edges)}.`);
    return;
  }
  let decoded: Uint16Array;
  try {
    decoded = decodeUint16Base64(encoded.edges as string, "edges");
  } catch {
    pushError("cloud_edges_invalid", "edges payload is not decodable base64:u16le.");
    return;
  }
  if (decoded.length !== edgeCount * 2) {
    pushError(
      "cloud_edges_invalid",
      `edges payload has ${decoded.length} indices, expected ${edgeCount * 2} (2 per declared edge) — declared count and payload disagree.`
    );
    return;
  }
  // Anti-slop length bound: a real k-NN bake connects spatially-near points, so every edge
  // is short relative to the point spacing. An edge that spans the cloud could selectively
  // web a sparse readable subset into legible lettering even on a dense (glyph-floor-clear)
  // cloud — so cap each edge's xy length at a generous multiple of the mean spacing.
  const span = geometry ? Math.hypot(geometry.maxX - geometry.minX, geometry.maxY - geometry.minY) || 1 : 0;
  const maxEdgeLen = (span / Math.sqrt(Math.max(1, encoded.pointCount))) * 12;
  for (let e = 0; e < edgeCount; e += 1) {
    const a = decoded[e * 2] as number;
    const b = decoded[e * 2 + 1] as number;
    if (a >= encoded.pointCount || b >= encoded.pointCount) {
      pushError("cloud_edges_invalid", `edge index ${Math.max(a, b)} references a point outside the ${encoded.pointCount}-point cloud (dangling endpoint).`);
      return;
    }
    if (a === b) {
      pushError("cloud_edges_invalid", `edge ${e} is a self-loop (index ${a} to itself); edges must connect two distinct points.`);
      return;
    }
    if (geometry) {
      const dx = (geometry.positions[a * 3] as number) - (geometry.positions[b * 3] as number);
      const dy = (geometry.positions[a * 3 + 1] as number) - (geometry.positions[b * 3 + 1] as number);
      if (Math.hypot(dx, dy) > maxEdgeLen) {
        pushError(
          "cloud_edges_invalid",
          `edge ${e} spans ${Math.hypot(dx, dy).toFixed(3)} units, over the ${maxEdgeLen.toFixed(3)} k-NN length bound — long edges can wire a sparse subset into legible text.`
        );
        return;
      }
    }
  }
}

/**
 * The lowpoly-facet preset renders a DIFFERENT (much smaller) point set than the
 * full cloud — so the full-cloud budget/glyph/depth checks do NOT see it. Rather than
 * re-run every check on the facets, this gate proves the facets are a BOUNDED STRICT
 * DECIMATION of the already-validated cloud: every facet centroid is the mean of a
 * subset of the cloud's own points, so its bbox ⊆ the full cloud's bbox and its
 * z-range ⊆ the full z-range (already gated by checkDepth) BY CONSTRUCTION. What the
 * gate must still pin down from the artifact: the facet set is fewer points than the
 * cloud, under the facet ceiling, declared whole, and its payload length matches the
 * declared count (so facetCount cannot be understated to smuggle a bigger buffer).
 */
function checkFacets(encoded: EncodedPointCloud, geometry: CloudGeometry | null, html: string, pushError: PushError): void {
  const hasCount = typeof encoded.facetCount === "number";
  const hasPositions = typeof encoded.facetPositions === "string";
  const hasColors = typeof encoded.facetColors === "string";
  if (!hasCount && !hasPositions && !hasColors) {
    // A preset that declares lowpoly density but ships no facets would SILENTLY render
    // the full cloud — flag the mismatch rather than let the intent evaporate.
    if (/data-density\s*=\s*["']lowpoly["']/i.test(html)) {
      pushError("cloud_facets_invalid", 'scene declares data-density="lowpoly" but the asset carries no facet bake; the engine would silently render the full cloud.');
    }
    return;
  }
  if (!hasCount || !hasPositions || !hasColors) {
    pushError(
      "cloud_facets_invalid",
      "Lowpoly facets must declare facetCount, facetPositions and facetColors together; a partial facet payload is rejected."
    );
    return;
  }
  const facetCount = encoded.facetCount as number;
  const facetPositions = encoded.facetPositions as string;
  const facetColors = encoded.facetColors as string;
  if (!Number.isInteger(facetCount) || facetCount < 1) {
    pushError("cloud_facets_invalid", `facetCount must be a positive integer; got ${facetCount}.`);
    return;
  }
  if (facetCount > POINT_CLOUD_SCENE_BUDGETS.maxFacets) {
    pushError(
      "cloud_facets_invalid",
      `facetCount ${facetCount} is over the ${POINT_CLOUD_SCENE_BUDGETS.maxFacets} lowpoly-facet ceiling.`
    );
  }
  if (facetCount >= encoded.pointCount) {
    pushError(
      "cloud_facets_invalid",
      `Lowpoly facets (${facetCount}) must be a strict decimation of the ${encoded.pointCount}-point cloud (fewer points), not an equal or larger set.`
    );
  }
  if (encoded.encoding.facetPositions !== "base64:f32le" || encoded.encoding.facetColors !== "base64:u8") {
    pushError(
      "cloud_facets_invalid",
      `facets must declare encoding.facetPositions="base64:f32le" and encoding.facetColors="base64:u8"; got ${String(encoded.encoding.facetPositions)}/${String(encoded.encoding.facetColors)}.`
    );
    return;
  }
  // Decode-not-trust: prove the facet floats are a re-sample of THIS cloud — decodable,
  // count-consistent, finite, and every centroid inside the measured cloud bbox. A length-
  // only check would pass a same-length payload encoding off-hull / out-of-depth geometry.
  let facetXyz: Float32Array;
  let facetRgb: Uint8Array;
  try {
    facetXyz = decodeFloat32Base64(facetPositions);
    facetRgb = decodeUint8Base64(facetColors, undefined, "facetColors");
  } catch {
    pushError("cloud_facets_invalid", "facet payload is not decodable (facetPositions f32le / facetColors u8).");
    return;
  }
  if (facetXyz.length !== facetCount * 3 || facetRgb.length !== facetCount * 3) {
    pushError(
      "cloud_facets_invalid",
      `facet payload decodes to ${facetXyz.length / 3} position / ${facetRgb.length / 3} colour facets, not the declared ${facetCount}.`
    );
    return;
  }
  if (geometry) {
    const eps = 1e-3;
    for (let i = 0; i < facetCount; i += 1) {
      const x = facetXyz[i * 3] as number;
      const y = facetXyz[i * 3 + 1] as number;
      const z = facetXyz[i * 3 + 2] as number;
      if (
        !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) ||
        x < geometry.minX - eps || x > geometry.maxX + eps ||
        y < geometry.minY - eps || y > geometry.maxY + eps ||
        z < geometry.minZ - eps || z > geometry.maxZ + eps
      ) {
        pushError(
          "cloud_facets_invalid",
          `facet ${i} at (${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}) lies outside the cloud bbox — facets must be a centroid decimation of the SAME image, not new geometry.`
        );
        return;
      }
    }
  }
}

/**
 * topo-relief is a bounded-enum RENDERING TREATMENT (iso-z contour shading over the
 * SAME faithful brand positions — never new geometry). The RELIEF lookup that maps
 * the enum to a band count lives in the engine <script> the contract parser strips,
 * so the enum guarantee would vanish on stripping. The data-relief ATTRIBUTE survives
 * (it is HTML, not script), so the gate reads it from the artifact and rejects any
 * out-of-enum value — the bounded-enum guarantee holds even with the script gone.
 */
function checkRelief(html: string, pushError: PushError): void {
  if (!/data-point-cloud\b/i.test(html)) {
    return;
  }
  const allowed = new Set(["none", "soft", "topo", "ridge"]);
  // Validate EVERY data-relief occurrence, not just the first — a decoy `data-relief="none"`
  // earlier in the HTML must not shadow an out-of-enum value on the real canvas.
  const matches = html.matchAll(/data-relief\s*=\s*["']([^"']*)["']/gi);
  for (const match of matches) {
    const value = match[1] ?? "";
    if (!allowed.has(value)) {
      pushError(
        "cloud_relief_invalid",
        `data-relief="${value}" is not a bounded relief enum (none|soft|topo|ridge); topo-relief band count must be a fixed enum, not a free value.`
      );
    }
  }
}

/**
 * Measure-not-trust guards for the rendered cloud engine. The DPR clamp and the
 * pause-on-hidden cancel live inside a <script> that the contract parser strips
 * before DOM parsing — so the ONLY static evidence is a scan of the raw HTML.
 * These run at generation (the renderer self-checks its own output) and only when
 * a [data-point-cloud] canvas is actually present, so scene-data-only callers are
 * unaffected. Like the reduced-motion guard, they prove the guard EXISTS, not its
 * runtime behaviour — behaviour is covered by the Playwright visual-qa probe
 * (see docs/decisions/webgl-pointcloud-gpu-mode-plan.md, Phase C).
 */
function checkEngineGuards(declaration: PointCloudSceneDeclaration, html: string, pushError: PushError): void {
  if (!/data-point-cloud\b/i.test(html)) {
    return;
  }

  if (!/Math\.min\([^)]*devicePixelRatio/i.test(html)) {
    pushError(
      "cloud_dpr_unclamped",
      "The point-cloud engine must clamp the device pixel ratio (a Math.min(…, devicePixelRatio …) guard) so a high-DPR screen does not melt the GPU; none found in the rendered HTML."
    );
  }

  if (declaration.animated && !/document\.hidden[\s\S]{0,80}cancelAnimationFrame/i.test(html)) {
    pushError(
      "cloud_pause_on_hidden_missing",
      "An animated point-cloud engine must cancel its animation frame when the tab hides (a document.hidden branch that reaches cancelAnimationFrame); none found in the rendered HTML."
    );
  }
}

function checkDecorative(declaration: PointCloudSceneDeclaration, pushError: PushError): void {
  if (declaration.role !== "decorative") {
    pushError(
      "cloud_not_decorative",
      `Point-cloud scene role must be "decorative" (never the sole representation of content); got "${declaration.role}".`
    );
  }
  if (!declaration.aria_hidden) {
    pushError("cloud_not_decorative", "Point-cloud canvas must be aria-hidden so it is not read as primary content.");
  }
}

function checkBudgets(encoded: EncodedPointCloud, pushError: PushError): void {
  if (encoded.pointCount > POINT_CLOUD_SCENE_BUDGETS.maxPoints) {
    pushError(
      "cloud_pointcount_over_budget",
      `Point cloud has ${encoded.pointCount} points, over the ${POINT_CLOUD_SCENE_BUDGETS.maxPoints} hero budget.`
    );
  }

  const payloadBytes =
    encoded.positions.length + encoded.colors.length + (encoded.sizes?.length ?? 0) +
    (encoded.facetPositions?.length ?? 0) + (encoded.facetColors?.length ?? 0) +
    (encoded.edges?.length ?? 0);
  if (payloadBytes > POINT_CLOUD_SCENE_BUDGETS.maxPayloadBytes) {
    pushError(
      "cloud_payload_over_budget",
      `Inline cloud payload is ${payloadBytes} base64 chars, over the ${POINT_CLOUD_SCENE_BUDGETS.maxPayloadBytes}-byte budget.`
    );
  }

  const sourcePixels = encoded.stats.dims.width * encoded.stats.dims.height;
  if (sourcePixels > POINT_CLOUD_SCENE_BUDGETS.maxSourcePixels) {
    pushError(
      "cloud_payload_over_budget",
      `Source image is ${sourcePixels}px (${encoded.stats.dims.width}x${encoded.stats.dims.height}), over the ${POINT_CLOUD_SCENE_BUDGETS.maxSourcePixels}px budget.`
    );
  }
}

function checkDepth(
  encoded: EncodedPointCloud,
  declaration: PointCloudSceneDeclaration,
  pushError: PushError
): void {
  const depthAmp = encoded.stats.optionsSummary.depthAmp;
  if (depthAmp > POINT_CLOUD_SCENE_BUDGETS.maxDepthAmp) {
    pushError(
      "cloud_depth_over_budget",
      `depthAmp ${depthAmp} is over the ${POINT_CLOUD_SCENE_BUDGETS.maxDepthAmp} budget (luma-driven z would exceed the xy normalization).`
    );
  }

  const gain = declaration.parallax_gain ?? 1;
  if (!Number.isFinite(gain) || gain < 0) {
    pushError("cloud_depth_over_budget", `parallax_gain must be a finite, non-negative number; got ${gain}.`);
  } else if (depthAmp * gain > POINT_CLOUD_SCENE_BUDGETS.maxEffectiveDepth) {
    pushError(
      "cloud_depth_over_budget",
      `Effective depth depthAmp×parallax_gain = ${depthAmp * gain} is over the ${POINT_CLOUD_SCENE_BUDGETS.maxEffectiveDepth} budget.`
    );
  }

  const zRange = encoded.stats.bbox.max.z - encoded.stats.bbox.min.z;
  if (zRange > POINT_CLOUD_SCENE_BUDGETS.maxEffectiveDepth) {
    pushError(
      "cloud_depth_over_budget",
      `Point-cloud z-range ${zRange} is over the ${POINT_CLOUD_SCENE_BUDGETS.maxEffectiveDepth} budget.`
    );
  }
}

function checkProvenance(
  source: PointCloudSceneSource,
  catalog: PointCloudSourceCatalog | undefined,
  pushError: PushError
): void {
  // Internal clouds are authored in-repo from owned imagery — no external source
  // to launder, so there is nothing to verify against a license catalog.
  if (source.provenance === "internal") {
    return;
  }

  if (
    source.source_id.trim().length === 0 ||
    source.asset_url.trim().length === 0 ||
    source.content_hash.trim().length === 0
  ) {
    pushError(
      "cloud_source_unlicensed",
      "Source-recorded point cloud needs a per-file adoption record: source_id, asset_url, and content_hash are all required."
    );
    return;
  }

  if (catalog === undefined) {
    pushError(
      "cloud_source_unlicensed",
      `Source-recorded cloud "${source.source_id}" cannot be verified without a source catalog.`
    );
    return;
  }

  const entry = catalog.sources.find((candidate) => candidate.id === source.source_id);
  if (entry === undefined) {
    pushError("cloud_source_unlicensed", `source_id "${source.source_id}" is not in the source catalog.`);
    return;
  }

  if (entry.status !== "approved_source") {
    pushError(
      "cloud_source_unlicensed",
      `Source "${source.source_id}" has status "${entry.status}", not "approved_source" — unsafe for unattended fan-out.`
    );
    return;
  }

  if (!FAN_OUT_SAFE_COMMERCIAL_USE.has(entry.commercial_use)) {
    pushError(
      "cloud_source_unlicensed",
      `Source "${source.source_id}" commercial_use is "${entry.commercial_use}", not "allowed"/"allowed_with_attribution".`
    );
  }
}

function checkTextTwins(
  encoded: EncodedPointCloud,
  declaration: PointCloudSceneDeclaration,
  html: string,
  pushError: PushError,
  pushWarning: PushWarning
): void {
  const payload = declaration.text_payload;

  // Omission is a hard error: every cloud must AFFIRMATIVELY declare its text
  // intent (use [] to attest "no readable text"). Silent omission is the exact
  // SEO/a11y bypass this gate exists to close.
  if (payload === undefined) {
    pushError(
      "canvas_text_dom_twin_cloud",
      "Point-cloud scene must declare text_payload[] (the readable strings it depicts; use [] to attest none). Declared strings each need a visible [data-cloud-twin] DOM node."
    );
    return;
  }

  if (payload.length === 0) {
    // Attested as carrying no text. The glyph heuristic is necessary-not-
    // sufficient, so a glyph-likely "[]" is surfaced as a WARNING for a deeper
    // render/OCR probe, not a hard block (which would reject every photo cloud).
    if (isGlyphLikely(encoded)) {
      pushWarning(
        "canvas_text_dom_twin_cloud",
        `Cloud attests no text (text_payload: []) but is glyph-likely (${describeGlyphSignal(encoded)}); verify via a render/OCR probe before fan-out.`
      );
    }
    return;
  }

  const visibleTwinTexts = collectVisibleTwinTexts(html);
  for (const declared of payload) {
    const normalized = normalizeText(declared);
    const twinTexts = visibleTwinTexts.get(normalized) ?? [];
    if (normalized.length === 0 || !twinTexts.includes(normalized)) {
      pushError(
        "canvas_text_dom_twin_cloud",
        `Declared cloud text "${declared}" must have a matching visible [data-cloud-twin="${declared}"] DOM node with identical text.`
      );
    }
  }
}

function checkReducedMotion(
  declaration: PointCloudSceneDeclaration,
  html: string,
  pushError: PushError
): void {
  if (!declaration.animated) {
    return;
  }

  if (!/prefers-reduced-motion/i.test(html)) {
    pushError(
      "cloud_reduced_motion_missing",
      "Animated point-cloud scene must guard its motion with a prefers-reduced-motion check (none found in the rendered HTML)."
    );
  }

  const fallbackLabel = declaration.static_fallback?.label.trim() ?? "";
  if (fallbackLabel.length === 0) {
    pushError(
      "cloud_reduced_motion_missing",
      "Animated point-cloud scene must declare a static_fallback (the resolved still it freezes to under reduced motion)."
    );
  }
}

/**
 * HTML-side safety net wired into checkRenderedContract. Any rendered output that
 * embeds an EncodedPointCloud payload MUST carry a validated [data-point-cloud]
 * canvas stamped with [data-cloud-contract]; otherwise the cloud bypassed
 * validatePointCloudScene and is rejected. Fires ONLY on a real cloud payload
 * signature, so non-cloud patterns are unaffected.
 */
export function detectUndeclaredCloudInHtml(html: string): RenderContractIssue | null {
  // Cheap structural pre-filter: skip the DOM parse entirely unless a cloud-shaped
  // payload is present somewhere in the document.
  if (!hasCloudPayloadSignature(html)) {
    return null;
  }

  // DOM-confirm. Presence of the markers ANYWHERE is not enough — an injected payload
  // plus a DECOY [data-point-cloud][data-cloud-contract] on an unrelated element would
  // otherwise launder past the gate. So we bind each payload to its OWN scene section
  // and require the validated canvas to live in that same section.
  const root = parse(html, {
    comment: false,
    lowerCaseTagName: true,
    blockTextElements: { script: true, style: true }
  });

  // Localize the payload to its host element(s). .text aggregates descendant text, so a
  // wrapping <section> matches the signature too; the real host is the innermost matching
  // element (the <script data-dot-cloud> or a bare <div>{…}</div>) — i.e. one with no
  // matching descendant of its own.
  const matching = root.querySelectorAll("*").filter((element) => hasCloudPayloadSignature(element.text));
  const hosts = matching.filter(
    (element) => !matching.some((other) => other !== element && isDescendantOf(other, element))
  );

  // The pre-filter saw a payload but the DOM could not localize it to a single element
  // (signature scattered across nodes). Fail closed: an unlocalizable payload is, by
  // definition, not bound to a validated canvas.
  const everyHostValidated = hosts.length > 0 && hosts.every((host) => isBoundToValidatedCanvas(host));
  if (everyHostValidated) {
    return null;
  }

  return {
    code: "undeclared_scene_blob",
    severity: "error",
    message:
      "An EncodedPointCloud payload is embedded without a validated [data-point-cloud][data-cloud-contract] canvas in its scene section. Route every point cloud through validatePointCloudScene."
  };
}

/**
 * Structural payload signature: a cloud-shaped blob always carries at least one decodable
 * geometry field plus a pointCount or a base64:* buffer tag. We match the STRUCTURE, not
 * the encoding tag value — the engine decodes via raw atob and ignores encoding.* tags, so
 * keying on the literal "base64:*" string alone let a mislabeled tag
 * (encoding.positions:"raw:f32") or a facet-only blob render while evading detection. Used
 * both as the whole-document pre-filter and per element (against el.text) during DOM-confirm.
 */
function hasCloudPayloadSignature(text: string): boolean {
  const hasGeometryField = /["'](?:positions|facetPositions|edges)["']\s*:/i.test(text);
  if (!hasGeometryField) {
    return false;
  }
  return /["']pointCount["']\s*:/i.test(text) || /base64:(?:f32le|u16le|u8)/i.test(text);
}

/**
 * A payload is "declared" when its enclosing scene section also contains a
 * [data-point-cloud][data-cloud-contract] canvas — the canvas that validatePointCloudScene
 * gated. A payload with no enclosing scene section is a free blob ⇒ undeclared.
 */
function isBoundToValidatedCanvas(host: HTMLElement): boolean {
  const scene = enclosingScene(host);
  if (scene === null) {
    return false;
  }
  return scene
    .querySelectorAll("canvas")
    .some((canvas) => canvas.hasAttribute("data-point-cloud") && canvas.hasAttribute("data-cloud-contract"));
}

/**
 * The payload's scene section: its nearest ancestor (or self) that is a <section> or carries
 * class "point-cloud-bg". The real renderer emits <section class="point-cloud-bg">; a bare
 * <section> also counts so the validated-canvas fixtures (which wrap the canvas + payload in
 * a plain <section>) stay valid. Returns null when no scene section encloses the payload.
 */
function enclosingScene(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null | undefined = element;
  while (current != null) {
    if ((current.tagName ?? "").toLowerCase() === "section" || current.classList.contains("point-cloud-bg")) {
      return current;
    }
    const parent = current.parentNode as HTMLElement | null | undefined;
    if (parent == null || parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function isDescendantOf(node: HTMLElement, ancestor: HTMLElement): boolean {
  let current = node.parentNode as HTMLElement | null | undefined;
  while (current != null) {
    if (current === ancestor) {
      return true;
    }
    const parent = current.parentNode as HTMLElement | null | undefined;
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return false;
}

// ─── Internals ──────────────────────────────────────────────────────────────────

type PushError = (code: string, message: string) => void;
type PushWarning = (code: string, message: string) => void;

function isGlyphLikely(encoded: EncodedPointCloud): boolean {
  if (encoded.pointCount >= POINT_CLOUD_SCENE_BUDGETS.glyphPointFloor) {
    return true;
  }
  const histogram = encoded.stats.colorHistogram;
  const topRatio = histogram.top[0]?.ratio ?? 0;
  return (
    histogram.bucketCount <= POINT_CLOUD_SCENE_BUDGETS.glyphBucketMax &&
    topRatio >= POINT_CLOUD_SCENE_BUDGETS.glyphTopRatio
  );
}

function describeGlyphSignal(encoded: EncodedPointCloud): string {
  const histogram = encoded.stats.colorHistogram;
  const topRatio = histogram.top[0]?.ratio ?? 0;
  return `pointCount=${encoded.pointCount}, histogram bucketCount=${histogram.bucketCount}, topRatio=${topRatio.toFixed(2)}`;
}

function collectVisibleTwinTexts(html: string): Map<string, string[]> {
  const root = parse(html, {
    comment: false,
    lowerCaseTagName: true,
    blockTextElements: { script: true, style: true }
  });
  const twinTextsByWord = new Map<string, string[]>();
  for (const twin of root.querySelectorAll("[data-cloud-twin]").filter(isVisibleElement)) {
    const key = normalizeText(twin.getAttribute("data-cloud-twin") ?? "");
    const texts = twinTextsByWord.get(key) ?? [];
    texts.push(normalizeText(twin.text));
    twinTextsByWord.set(key, texts);
  }
  return twinTextsByWord;
}

function isVisibleElement(element: HTMLElement): boolean {
  let current: HTMLElement | null | undefined = element;
  while (current != null) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden")?.toLowerCase() === "true") {
      return false;
    }
    const style = current.getAttribute("style")?.toLowerCase() ?? "";
    if (/(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style)) {
      return false;
    }
    const parent = current.parentNode as HTMLElement | null | undefined;
    if (parent == null || parent === current) {
      break;
    }
    current = parent;
  }
  return true;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
