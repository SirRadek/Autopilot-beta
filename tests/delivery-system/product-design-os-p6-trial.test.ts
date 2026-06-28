import { readFileSync } from "node:fs";
import path from "node:path";

import { parse, type HTMLElement } from "node-html-parser";
import { describe, expect, it } from "vitest";

import { RenderCompositionSpecError, renderCompositionPage } from "../../product-design-os/renderer/render-composition";
import { isSafeHref } from "../../product-design-os/renderer/safe-url";
import { assertRootColorContrastWcagAA } from "../../product-design-os/renderer/wcag-contrast";
import { validateJsonSchema } from "../../src/lib/delivery-system/validation";

const pdosRoot = path.join(process.cwd(), "product-design-os");
const trialSpecFile = path.join(pdosRoot, "specs", "examples", "local-bricklayer.composition.json");
const compositionSchemaFile = path.join(pdosRoot, "specs", "composition.schema.json");
const assetManifestFile = path.join(pdosRoot, "assets", "asset-manifest.json");
const proofHref = "./assets/sections/local-bricklayer-stone-proof.jpg";
const proofAlt = "Ručně kladené kamenné zdivo — rekonstrukce staré chalupy";
const proofSourceUrl = "https://www.flickr.com/photos/58187590@N02/25240639751";

describe("Product Design OS P6 local-bricklayer first trial", () => {
  it("validates the trial composition spec and inline content provenance", () => {
    const spec = readJsonRecord(trialSpecFile);
    const schema = readJson(compositionSchemaFile);
    const assetManifest = readJsonRecord(assetManifestFile);
    const assets = recordArray(assetManifest, "assets");
    const brickAsset = assets.find((asset) => asset.id === "local-bricklayer-brick-proof");
    const inlineContent = inlineProofAssetContent(spec);

    expect(validateJsonSchema(spec, schema)).toEqual([]);
    expect(brickAsset).toBeUndefined();
    expect(recordArrayValue(spec, "asset_ids")).not.toContain("local-bricklayer-brick-proof");
    expect(inlineContent).toEqual(
      expect.objectContaining({
        href: proofHref,
        alt: proofAlt,
        license: "CC0-1.0",
        source_url: proofSourceUrl
      })
    );
  });

  it("renders the local-bricklayer page with clean contracts, AA contrast, real stone image, Lora, and CTA priority", () => {
    const result = renderCompositionPage(readJson(trialSpecFile), pdosRoot);
    const root = parse(result.html);
    const proof = requiredElement(root, '[data-pattern-id="proof-led-section"]');
    const proofImage = requiredElement(proof, "img");
    const proofImageSrc = requiredAttribute(proofImage, "src");
    const ctas = root.querySelectorAll("a.cta").map((cta) => ({
      text: cta.text.trim(),
      className: requiredAttribute(cta, "class")
    }));
    const contrast = assertRootColorContrastWcagAA(result.html);

    expect(result.sections.map((section) => section.pattern_id)).toEqual([
      "tactile-shadow-hero",
      "proof-led-section",
      "outcome-cta"
    ]);
    expect(result.sections.every((section) => section.contractErrors.length === 0)).toBe(true);
    expect(contrast.map((pair) => pair.pair)).toEqual([
      "background/text",
      "background/muted_text",
      "surface/text",
      "surface/muted_text",
      "accent/accent_text",
      "accent_secondary/accent_text"
    ]);
    expect(isSafeHref(proofImageSrc)).toBe(true);
    expect(proofImageSrc).toBe(proofHref);
    expect(requiredAttribute(proofImage, "alt")).toBe(proofAlt);
    expect(result.html).toContain("https://fonts.googleapis.com/css2?family=Lora:wght@400;700&amp;display=swap");
    expect(ctas).toEqual([
      {
        text: "Získat kalkulaci zdarma",
        className: "cta"
      },
      {
        text: "Prohlédnout naše realizace",
        className: "cta"
      },
      {
        text: "Nezávazně poptat nacenění",
        className: "cta"
      }
    ]);
  });
});

function requiredElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (element === null) {
    throw new Error(`Missing element for selector ${selector}.`);
  }
  return element;
}

function requiredAttribute(element: HTMLElement, name: string): string {
  const value = element.getAttribute(name);
  if (value === undefined) {
    throw new Error(`Missing attribute ${name}.`);
  }
  return value;
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

function recordArray(value: Record<string, unknown>, key: string): readonly Record<string, unknown>[] {
  const rawValue = value[key];
  if (!Array.isArray(rawValue)) {
    throw new Error(`${key} must be an array.`);
  }
  return rawValue.filter(isRecord);
}

function recordArrayValue(value: Record<string, unknown>, key: string): readonly unknown[] {
  const rawValue = value[key];
  return Array.isArray(rawValue) ? rawValue : [];
}

function inlineProofAssetContent(spec: Record<string, unknown>): Record<string, unknown> | undefined {
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const proofNode = nodes.find((node): node is Record<string, unknown> => isRecord(node) && node.target_id === "proof-led-section");
  const slotFills = proofNode !== undefined && Array.isArray(proofNode.slot_fills) ? proofNode.slot_fills : [];
  const proofSlot = slotFills.find((fill): fill is Record<string, unknown> => isRecord(fill) && fill.slot === "proof_asset");
  const fills = proofSlot !== undefined && Array.isArray(proofSlot.fills) ? proofSlot.fills : [];
  const fillWithContent = fills.find((fill): fill is Record<string, unknown> => isRecord(fill) && isRecord(fill.content));
  return fillWithContent !== undefined && isRecord(fillWithContent.content) ? fillWithContent.content : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
