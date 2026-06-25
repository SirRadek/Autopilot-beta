import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkRenderedContract } from "../../product-design-os/renderer/check-render-contract";
import {
  OutcomeCtaContractError,
  renderOutcomeCta
} from "../../product-design-os/renderer/components/outcome-cta";
import {
  ProofLedSectionContractError,
  renderProofLedSection
} from "../../product-design-os/renderer/components/proof-led-section";
import { patternComponentRegistry } from "../../product-design-os/renderer/pattern-component-registry";
import { renderComposition } from "../../product-design-os/renderer/render-composition";
import type { ComponentContract, PatternSlotMap, ResolvedAsset, ResolvedPatternReference } from "../../product-design-os/renderer/types";

const pdosRoot = path.join(process.cwd(), "product-design-os");

describe("Product Design OS P2 pattern renderers", () => {
  it("renders proof-led-section from demo props with zero contract errors", () => {
    const contract = readPatternContract("proof-led-section");
    const html = renderProofLedSection({
      props: proofProps(),
      slots: proofLedSlots(),
      contract
    });
    const report = checkRenderedContract(html, contract);

    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(html).toContain('data-pattern-id="proof-led-section"');
    expect(html).toContain('data-contract-prop="proof_item"');
  });

  it("renders outcome-cta from demo props with zero contract errors", () => {
    const contract = readPatternContract("outcome-cta");
    const html = renderOutcomeCta({
      props: outcomeProps(),
      slots: outcomeSlots(),
      contract
    });
    const report = checkRenderedContract(html, contract);

    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(html).toContain('data-pattern-id="outcome-cta"');
    expect(html).toContain('data-contract-slot="proof_context"');
  });

  it("throws typed errors for missing or short required props", () => {
    const proofContract = readPatternContract("proof-led-section");
    const outcomeContract = readPatternContract("outcome-cta");

    expect(() =>
      renderProofLedSection({
        props: {
          ...proofProps(),
          proof_item: "short"
        },
        slots: proofLedSlots(),
        contract: proofContract
      })
    ).toThrow(ProofLedSectionContractError);

    expect(() =>
      renderOutcomeCta({
        props: {
          ...outcomeProps(),
          outcome_statement: "short"
        },
        slots: outcomeSlots(),
        contract: outcomeContract
      })
    ).toThrow(OutcomeCtaContractError);
  });

  it("escapes hostile props instead of emitting executable markup", () => {
    const proofContract = readPatternContract("proof-led-section");
    const outcomeContract = readPatternContract("outcome-cta");
    const hostile = "Launch </h1><script>alert(1)</script>";

    const proofHtml = renderProofLedSection({
      props: {
        ...proofProps(),
        proof_item: hostile
      },
      slots: proofLedSlots(),
      contract: proofContract
    });
    const outcomeHtml = renderOutcomeCta({
      props: {
        ...outcomeProps(),
        outcome_statement: hostile
      },
      slots: outcomeSlots(),
      contract: outcomeContract
    });

    expect(proofHtml).toContain("Launch &lt;/h1&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(outcomeHtml).toContain("Launch &lt;/h1&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(proofHtml).not.toContain("<script>alert(1)</script>");
    expect(outcomeHtml).not.toContain("<script>alert(1)</script>");
  });

  it("rejects unsafe CTA hrefs", () => {
    const proofContract = readPatternContract("proof-led-section");
    const outcomeContract = readPatternContract("outcome-cta");

    expect(() =>
      renderProofLedSection({
        props: {
          ...proofProps(),
          cta_href: "javascript:alert(1)"
        },
        slots: proofLedSlots(),
        contract: proofContract
      })
    ).toThrow(/unsafe_href/);

    expect(() =>
      renderOutcomeCta({
        props: {
          ...outcomeProps(),
          cta_href: "javascript:alert(1)"
        },
        slots: outcomeSlots(),
        contract: outcomeContract
      })
    ).toThrow(/unsafe_href/);
  });

  it("resolves proof-led-section and outcome-cta from the component registry", () => {
    expect(patternComponentRegistry["proof-led-section"].render).toBe(renderProofLedSection);
    expect(patternComponentRegistry["outcome-cta"].render).toBe(renderOutcomeCta);
    expect(Object.keys(patternComponentRegistry).sort()).toEqual([
      "dot-stage-hero",
      "outcome-cta",
      "proof-led-section",
      "sharp-positioning-hero",
      "structural-gravity-grid"
    ]);
  });

  it("render-composition renders a proof-led-section node", () => {
    const contract = readPatternContract("proof-led-section");
    const result = renderComposition(proofCompositionSpec(), pdosRoot);
    const report = checkRenderedContract(result.html, contract);

    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(result.html).toContain('data-pattern-id="proof-led-section"');
    expect(result.html).not.toContain('data-pattern-id="sharp-positioning-hero"');
    expect(result.qaTargets[0]?.patternId).toBe("proof-led-section");
  });

  it("render-composition renders an outcome-cta node", () => {
    const contract = readPatternContract("outcome-cta");
    const result = renderComposition(outcomeCompositionSpec(), pdosRoot);
    const report = checkRenderedContract(result.html, contract);

    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(result.html).toContain('data-pattern-id="outcome-cta"');
    expect(result.html).not.toContain('data-pattern-id="sharp-positioning-hero"');
    expect(result.qaTargets[0]?.patternId).toBe("outcome-cta");
  });
});

function proofProps(): Record<string, string> {
  return {
    proof_item: "A real case strip explains the before and after.",
    outcome_statement: "Visitors see the result before the closing request.",
    source_reference: "Case study",
    cta_label: "View the case"
  };
}

function outcomeProps(): Record<string, string> {
  return {
    outcome_statement: "Turn the offer into a request-ready launch page.",
    cta_label: "Request a plan"
  };
}

function proofLedSlots(): PatternSlotMap {
  return {
    proof_asset: [proofAsset()]
  };
}

function outcomeSlots(): PatternSlotMap {
  return {
    proof_context: [proofContext()]
  };
}

function proofAsset(): ResolvedAsset {
  return {
    id: "proof-strip-case-study",
    targetKind: "asset",
    assetType: "section",
    source: "product-design-os"
  };
}

function proofContext(): ResolvedPatternReference {
  return {
    id: "proof-led-section",
    targetKind: "pattern",
    nodeId: "proof-section",
    props: proofProps()
  };
}

function proofCompositionSpec(): unknown {
  return {
    spec_kind: "composition_spec",
    id: "p2-proof-section",
    nodes: [
      {
        node_id: "proof-section",
        target_kind: "pattern",
        target_id: "proof-led-section",
        props: propsArray(proofProps()),
        slot_fills: [
          {
            slot: "proof_asset",
            fills: [{ target_kind: "asset", target_id: "proof-strip-case-study" }]
          }
        ]
      }
    ],
    token_overrides: {
      enabled: false,
      values: []
    }
  };
}

function outcomeCompositionSpec(): unknown {
  return {
    spec_kind: "composition_spec",
    id: "p2-outcome-cta",
    nodes: [
      {
        node_id: "outcome-cta-node",
        target_kind: "pattern",
        target_id: "outcome-cta",
        props: propsArray(outcomeProps()),
        slot_fills: [
          {
            slot: "proof_context",
            fills: [{ target_kind: "pattern", target_id: "proof-led-section" }]
          }
        ]
      },
      {
        node_id: "proof-section",
        target_kind: "pattern",
        target_id: "proof-led-section",
        props: propsArray(proofProps()),
        slot_fills: [
          {
            slot: "proof_asset",
            fills: [{ target_kind: "asset", target_id: "proof-strip-case-study" }]
          }
        ]
      }
    ],
    token_overrides: {
      enabled: false,
      values: []
    }
  };
}

function propsArray(props: Record<string, string>): readonly unknown[] {
  return Object.entries(props).map(([name, stringValue]) => ({
    name,
    string_value: stringValue
  }));
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
