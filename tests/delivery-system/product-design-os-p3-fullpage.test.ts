import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkRenderedContract } from "../../product-design-os/renderer/check-render-contract";
import { renderCompositionPage, RenderCompositionSpecError } from "../../product-design-os/renderer/render-composition";
import { assertRootColorContrastWcagAA } from "../../product-design-os/renderer/wcag-contrast";
import type { ComponentContract, TokenPrimitive } from "../../product-design-os/renderer/types";

const pdosRoot = path.join(process.cwd(), "product-design-os");
const baseCompositionFile = path.join(pdosRoot, "specs", "examples", "buildable-marketing.composition.json");

describe("Product Design OS P3 full-page rendering", () => {
  it("renders hero, proof, and CTA sections in spec order with explicit skipped pattern reasons", () => {
    const result = renderCompositionPage(readJson(baseCompositionFile), pdosRoot);

    expect(result.sections.map((section) => section.pattern_id)).toEqual([
      "sharp-positioning-hero",
      "proof-led-section",
      "outcome-cta"
    ]);
    expect(result.sections.every((section) => section.contractErrors.length === 0)).toBe(true);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        node_id: "theme-background",
        reason: expect.stringContaining("slot-only")
      }),
      expect.objectContaining({
        node_id: "editorial-hero",
        reason: expect.stringContaining("slot-only")
      }),
      expect.objectContaining({
        node_id: "crossed-theme",
        reason: expect.stringContaining("no registered section renderer")
      }),
      expect.objectContaining({
        node_id: "proof-strip",
        reason: expect.stringContaining("slot-only")
      })
    ]);
    expect(result.html).toContain('<main class="pdos-page"');
    expect(result.html).not.toContain('data-pattern-id="theme-crossed-direction"');
    expect(renderedPatternOrder(result.html)).toEqual([
      "sharp-positioning-hero",
      "proof-led-section",
      "outcome-cta"
    ]);
  });

  it("throws for an unknown pattern node instead of silently falling back", () => {
    expect(() =>
      renderCompositionPage(
        {
          spec_kind: "composition_spec",
          id: "unknown-pattern-page",
          nodes: [
            {
              node_id: "unknown-node",
              target_kind: "pattern",
              target_id: "unknown-marketing-section",
              props: [],
              slot_fills: []
            }
          ],
          token_overrides: {
            enabled: false,
            values: []
          }
        },
        pdosRoot
      )
    ).toThrow(RenderCompositionSpecError);
  });

  it("emits one root token block and a shared page container and type scale", () => {
    const result = renderCompositionPage(readJson(baseCompositionFile), pdosRoot);

    expect(countOccurrences(result.html, ":root{")).toBe(1);
    expect(countOccurrences(result.html, "--pdos-page-container-max: 1180px;")).toBe(1);
    expect(result.html).toContain("width: min(100%, var(--pdos-page-container-max));");
    expect(result.html).toContain("font-size: var(--pdos-type-display);");
    expect(result.html).toContain("font-size: var(--pdos-type-heading);");
    expect(result.html).not.toContain("width: min(100%, 1180px)");
  });

  it("owns the continuous canvas on the page wrapper with transparent section roots", () => {
    const result = renderCompositionPage(readJson(baseCompositionFile), pdosRoot);
    const pageRule = cssRuleBlock(result.html, ".pdos-page");
    const pageSectionRule = cssRuleBlock(result.html, ".pdos-page > section");

    expect(result.html).toContain("padding: var(--pdos-page-section-padding-block) var(--pdos-page-gutter);");
    expect(pageRule).toContain("var(--style-surface-background)");
    expect(pageSectionRule).toContain("background: transparent;");
    expect(result.html).not.toContain("border-block-start: 1px solid");
    expect(result.html).not.toContain(".sharp-positioning-hero__theme");
    expect(result.html).not.toContain(".sharp-positioning-hero::before");
    expect(result.html).not.toContain(".proof-led-section::before");
    expect(result.html).not.toContain(".outcome-cta::before");

    for (const selector of [".sharp-positioning-hero", ".proof-led-section", ".outcome-cta"]) {
      const sectionRule = cssRuleBlock(result.html, selector);
      expect(sectionRule).toContain("background: transparent;");
      expect(sectionRule).not.toContain("background: var(--color-background);");
      expect(sectionRule).not.toContain("background: var(--style-surface-background);");
      expect(sectionRule).not.toMatch(/\bborder(?:-[a-z-]+)?:/);
      expect(sectionRule).not.toContain("box-shadow:");
    }
  });

  it("uses one token-driven accent rule instead of divergent section decoration motifs", () => {
    const result = renderCompositionPage(readJson(baseCompositionFile), pdosRoot);
    const sharedAccentRule = cssRuleBlock(
      result.html,
      [
        ".sharp-positioning-hero__copy::before",
        ".proof-led-section__content::before",
        ".outcome-cta__inner::before"
      ].join(",\n")
    );

    expect(sharedAccentRule).toContain("height: var(--style-decoration-border-width);");
    expect(sharedAccentRule).toContain("border-radius: var(--style-corner-radius);");
    expect(sharedAccentRule).toContain("background: var(--color-accent-secondary);");
    expect(sharedAccentRule).toContain("opacity: var(--style-decoration-opacity);");
    expect(sharedAccentRule).toContain("transform: rotate(var(--style-accent-angle-deg));");
    expect(result.html).not.toContain("skewX(");
    expect(result.html).not.toContain("rotate(var(--style-accent-angle-inverse-deg))");
    expect(cssRuleBlock(result.html, ".sharp-positioning-hero__asset-wrap")).not.toContain("transform:");
    expect(cssRuleBlock(result.html, ".sharp-positioning-hero__asset")).not.toContain("transform:");
    expect(cssRuleBlock(result.html, ".proof-led-section__asset-wrap")).not.toContain("transform:");
    expect(cssRuleBlock(result.html, ".proof-led-section__asset")).not.toContain("transform:");
  });

  it("applies sage token overrides page-wide while staying WCAG-AA", () => {
    const result = renderCompositionPage(compositionSpecWithOverrides(sageOverrides()), pdosRoot);
    const vars = extractRootCssVars(result.html);
    const contrast = assertRootColorContrastWcagAA(result.html);

    expect(result.sections.every((section) => section.contractErrors.length === 0)).toBe(true);
    expect(vars.get("color-background")).toBe("#F6FBF4");
    expect(vars.get("color-accent")).toBe("#166534");
    expect(result.html).toContain("background: var(--color-background);");
    expect(contrast.map((pair) => pair.pair)).toEqual([
      "background/text",
      "background/muted_text",
      "surface/text",
      "surface/muted_text",
      "accent/accent_text",
      "accent_secondary/accent_text"
    ]);
  });

  it("rejects outcome CTA proof adjacency when the proof marker is empty or the outcome is missing", () => {
    const contract = readPatternContract("outcome-cta");
    const emptyProofReport = checkRenderedContract(
      [
        '<section data-pattern-id="outcome-cta">',
        '<div data-contract-slot="proof_context" data-slot-target-kind="pattern" data-slot-target-id="proof-led-section"></div>',
        '<h2 data-contract-prop="outcome_statement">Turn the offer into a request-ready launch page.</h2>',
        '<a class="cta" data-contract-prop="cta_label" href="#request">Request a plan</a>',
        "</section>"
      ].join(""),
      contract
    );
    const missingOutcomeReport = checkRenderedContract(
      [
        '<section data-pattern-id="outcome-cta">',
        '<div data-contract-slot="proof_context" data-slot-target-kind="pattern" data-slot-target-id="proof-led-section">',
        '<p data-contract-prop="proof_item">A real case strip explains the before and after.</p>',
        "</div>",
        '<a class="cta" data-contract-prop="cta_label" href="#request">Request a plan</a>',
        "</section>"
      ].join(""),
      contract
    );
    const unstructuredProofReport = checkRenderedContract(
      [
        '<section data-pattern-id="outcome-cta">',
        '<div data-contract-slot="proof_context" data-slot-target-kind="pattern" data-slot-target-id="proof-led-section">',
        "Arbitrary proof text",
        "</div>",
        '<h2 data-contract-prop="outcome_statement">Turn the offer into a request-ready launch page.</h2>',
        '<a class="cta" data-contract-prop="cta_label" href="#request">Request a plan</a>',
        "</section>"
      ].join(""),
      contract
    );

    expect(emptyProofReport.errors.map((issue) => issue.code)).toContain("proof_adjacency");
    expect(missingOutcomeReport.errors.map((issue) => issue.code)).toContain("proof_adjacency");
    expect(unstructuredProofReport.errors.map((issue) => issue.code)).toContain("proof_adjacency");
  });

  it("throws for unsupported slot-fill target kinds and unknown slot names", () => {
    const unsupportedKindSpec = cloneBaseCompositionSpec();
    const unsupportedHeroNode = findNodeById(unsupportedKindSpec, "positioning-hero");
    unsupportedHeroNode.slot_fills = [
      {
        slot: "hero_asset",
        fills: [{ target_kind: "component", target_id: "editorial-motion-hero" }]
      },
      {
        slot: "theme_background",
        fills: [{ target_kind: "asset", target_id: "theme-calm-prism-grid" }]
      }
    ];

    expectRenderSpecError(
      () => renderCompositionPage(unsupportedKindSpec, pdosRoot),
      "unsupported_slot_fill_target_kind"
    );

    const unknownSlotSpec = cloneBaseCompositionSpec();
    const unknownSlotHeroNode = findNodeById(unknownSlotSpec, "positioning-hero");
    unknownSlotHeroNode.slot_fills = [
      {
        slot: "hero_asset",
        fills: [{ target_kind: "asset", target_id: "editorial-motion-hero" }]
      },
      {
        slot: "unknown_slot",
        fills: [{ target_kind: "asset", target_id: "theme-calm-prism-grid" }]
      }
    ];

    expectRenderSpecError(() => renderCompositionPage(unknownSlotSpec, pdosRoot), "unknown_slot_name");
  });

  it("throws on ambiguous duplicate target_id pattern slot references", () => {
    const spec = cloneBaseCompositionSpec();
    insertAlternateProofNode(spec);

    expectRenderSpecError(() => renderCompositionPage(spec, pdosRoot), "ambiguous_pattern_target_id");
  });

  it("resolves pattern slot references by node id when duplicate pattern target ids exist", () => {
    const spec = cloneBaseCompositionSpec();
    insertAlternateProofNode(spec, {
      proof_item: "Alternate node-id proof context explains the after state.",
      outcome_statement: "The alternate proof node is resolved by its composition node id.",
      source_reference: "Alternate case study",
      cta_label: "View the case"
    });
    findNodeById(spec, "outcome-cta-node").slot_fills = [
      {
        slot: "proof_context",
        fills: [{ target_kind: "pattern", target_id: "proof-section-alt" }]
      }
    ];

    const result = renderCompositionPage(spec, pdosRoot);

    expect(result.html).toContain('data-proof-context-id="proof-section-alt"');
    expect(result.html).toContain("Alternate node-id proof context explains the after state.");
    expect(result.sections.every((section) => section.contractErrors.length === 0)).toBe(true);
  });

  it("reports asset-only page specs as slot-only skipped diagnostics", () => {
    expectRenderSpecError(
      () =>
        renderCompositionPage(
          {
            spec_kind: "composition_spec",
            id: "asset-only-page",
            nodes: [
              {
                node_id: "only-asset",
                target_kind: "asset",
                target_id: "theme-calm-prism-grid",
                props: [],
                slot_fills: []
              }
            ],
            token_overrides: {
              enabled: false,
              values: []
            }
          },
          pdosRoot
        ),
      "pattern_node_missing",
      "only-asset (Asset theme-calm-prism-grid is slot-only"
    );
  });

  it("fails the page WCAG gate when muted text falls below AA on the page background", () => {
    expectRenderSpecError(
      () =>
        renderCompositionPage(
          compositionSpecWithOverrides([
            override("color", "muted_text", "#A8A8A8")
          ]),
          pdosRoot
        ),
      "token_color_contrast_below_aa",
      "background/muted_text"
    );
  });

  it("renders calm, bold, and sage whole-page brands with WCAG-AA contrast", () => {
    const brandCases = [
      { id: "calm", overrides: calmOverrides(), background: "#F8FAFC" },
      { id: "bold", overrides: boldOverrides(), background: "#0B0F19" },
      { id: "sage", overrides: sageOverrides(), background: "#F6FBF4" }
    ] as const;

    for (const brandCase of brandCases) {
      const result = renderCompositionPage(compositionSpecWithOverrides(brandCase.overrides), pdosRoot);
      const vars = extractRootCssVars(result.html);
      const contrast = assertRootColorContrastWcagAA(result.html);

      expect(result.sections.map((section) => section.pattern_id)).toEqual([
        "sharp-positioning-hero",
        "proof-led-section",
        "outcome-cta"
      ]);
      expect(result.sections.every((section) => section.contractErrors.length === 0)).toBe(true);
      expect(vars.get("color-background")).toBe(brandCase.background);
      expect(cssRuleBlock(result.html, ".pdos-page")).toContain("var(--style-surface-background)");
      expect(contrast.map((pair) => pair.pair)).toContain("background/muted_text");
    }
  });
});

function sageOverrides(): readonly TokenOverrideSpec[] {
  return [
    override("color", "background", "#F6FBF4"),
    override("color", "surface", "#FFFFFF"),
    override("color", "text", "#183126"),
    override("color", "muted_text", "#3D5A4C"),
    override("color", "border", "#B7D0BF"),
    override("color", "accent", "#166534"),
    override("color", "accent_secondary", "#115E59"),
    override("color", "accent_soft", "#DDEFE3"),
    override("color", "accent_text", "#FFFFFF"),
    override("color", "focus_ring", "#166534"),
    override("style", "decoration_intensity", "subtle"),
    override("style", "accent_angle_deg", "0deg"),
    override("style", "corner_style", "rounded"),
    override("style", "heading_case", "none"),
    override("style", "surface_treatment", "flat")
  ];
}

function calmOverrides(): readonly TokenOverrideSpec[] {
  return [
    override("color", "background", "#F8FAFC"),
    override("color", "surface", "#FFFFFF"),
    override("color", "text", "#0F172A"),
    override("color", "muted_text", "#475569"),
    override("color", "border", "#CBD5E1"),
    override("color", "accent", "#2563EB"),
    override("color", "accent_secondary", "#0F766E"),
    override("color", "accent_soft", "#DBEAFE"),
    override("color", "accent_text", "#FFFFFF"),
    override("color", "focus_ring", "#0F766E"),
    override("style", "decoration_intensity", "subtle"),
    override("style", "accent_angle_deg", "0deg"),
    override("style", "corner_style", "rounded"),
    override("style", "heading_case", "none"),
    override("style", "surface_treatment", "flat")
  ];
}

function boldOverrides(): readonly TokenOverrideSpec[] {
  return [
    override("color", "background", "#0B0F19"),
    override("color", "surface", "#111827"),
    override("color", "text", "#F9FAFB"),
    override("color", "muted_text", "#CBD5E1"),
    override("color", "border", "#374151"),
    override("color", "accent", "#FACC15"),
    override("color", "accent_secondary", "#38BDF8"),
    override("color", "accent_soft", "#312E81"),
    override("color", "accent_text", "#111827"),
    override("color", "focus_ring", "#FACC15"),
    override("style", "decoration_intensity", "bold"),
    override("style", "accent_angle_deg", "-12deg"),
    override("style", "corner_style", "sharp"),
    override("style", "heading_case", "upper"),
    override("style", "surface_treatment", "gradient")
  ];
}

function compositionSpecWithOverrides(overrides: readonly TokenOverrideSpec[]): unknown {
  return {
    ...cloneJsonRecord(readJsonRecord(baseCompositionFile)),
    token_overrides: {
      enabled: true,
      values: overrides
    }
  };
}

function cloneBaseCompositionSpec(): Record<string, unknown> {
  return cloneJsonRecord(readJsonRecord(baseCompositionFile));
}

function insertAlternateProofNode(spec: Record<string, unknown>, props: Record<string, string> = proofProps()): void {
  const nodes = compositionNodes(spec);
  const proofNode = cloneJsonRecord(findNodeById(spec, "proof-section"));
  proofNode.node_id = "proof-section-alt";
  proofNode.props = propsArray(props);

  const outcomeIndex = nodes.findIndex((node) => node.node_id === "outcome-cta-node");
  if (outcomeIndex === -1) {
    throw new Error("Missing outcome-cta-node fixture.");
  }

  nodes.splice(outcomeIndex, 0, proofNode);
  spec.nodes = nodes;
}

function proofProps(): Record<string, string> {
  return {
    proof_item: "A real case strip explains the before and after.",
    outcome_statement: "Visitors see the result before the closing request.",
    source_reference: "Case study",
    cta_label: "View the case"
  };
}

function propsArray(props: Record<string, string>): readonly Record<string, string>[] {
  return Object.entries(props).map(([name, stringValue]) => ({
    name,
    string_value: stringValue
  }));
}

function override(tokenFile: string, tokenKey: string, value: TokenPrimitive): TokenOverrideSpec {
  return {
    token_file: tokenFile,
    token_key: tokenKey,
    value
  };
}

interface TokenOverrideSpec {
  readonly token_file: string;
  readonly token_key: string;
  readonly value: TokenPrimitive;
}

function renderedPatternOrder(html: string): readonly string[] {
  return [...html.matchAll(/data-pattern-id="([^"]+)"/g)].map((match) => {
    const patternId = match[1];
    if (patternId === undefined) {
      throw new Error("Missing pattern id capture.");
    }
    return patternId;
  });
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function extractRootCssVars(value: string): ReadonlyMap<string, string> {
  const rootBlock = /:root\{([\s\S]*?)\n\}/.exec(value)?.[1];
  if (rootBlock === undefined) {
    throw new Error("Missing :root CSS block.");
  }

  const vars = new Map<string, string>();
  const declarationPattern = /--([a-z0-9-]+):\s*([^;]+);/gi;
  let match: RegExpExecArray | null;
  while ((match = declarationPattern.exec(rootBlock)) !== null) {
    const key = match[1];
    const cssValue = match[2];
    if (key !== undefined && cssValue !== undefined) {
      vars.set(key, cssValue.trim());
    }
  }

  return vars;
}

function cssRuleBlock(html: string, selector: string): string {
  const escapedSelector = escapeRegExp(selector);
  const match = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(html);
  const block = match?.[1];
  if (block === undefined) {
    throw new Error(`Missing CSS rule for ${selector}.`);
  }

  return block;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compositionNodes(spec: Record<string, unknown>): Record<string, unknown>[] {
  const rawNodes = spec.nodes;
  if (!Array.isArray(rawNodes)) {
    throw new Error("Composition fixture nodes must be an array.");
  }

  const nodes: Record<string, unknown>[] = [];
  for (const rawNode of rawNodes) {
    if (!isRecord(rawNode)) {
      throw new Error("Composition fixture nodes must contain objects.");
    }
    nodes.push(rawNode);
  }

  return nodes;
}

function findNodeById(spec: Record<string, unknown>, nodeId: string): Record<string, unknown> {
  const node = compositionNodes(spec).find((candidate) => candidate.node_id === nodeId);
  if (node === undefined) {
    throw new Error(`Missing node fixture ${nodeId}.`);
  }

  return node;
}

function expectRenderSpecError(run: () => void, code: string, messageIncludes?: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RenderCompositionSpecError);
    const specError = error as RenderCompositionSpecError;
    expect(specError.code).toBe(code);
    if (messageIncludes !== undefined) {
      expect(specError.message).toContain(messageIncludes);
    }
    return;
  }

  throw new Error(`Expected RenderCompositionSpecError ${code}.`);
}

function readPatternContract(patternId: string): ComponentContract {
  const manifest = readJson<{ readonly contracts: readonly ComponentContract[] }>(
    path.join(pdosRoot, "contracts", "component-contract-manifest.json")
  );
  const contract = manifest.contracts.find((candidate) => candidate.target_kind === "pattern" && candidate.target_id === patternId);

  if (contract === undefined) {
    throw new Error(`Missing ${patternId} contract fixture.`);
  }

  return contract;
}

function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  const value = readJson(filePath);
  if (!isRecord(value)) {
    throw new Error(`${filePath} must contain an object.`);
  }
  return value;
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
