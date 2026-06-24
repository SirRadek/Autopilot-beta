import {
  renderSharpPositioningHero,
  sharpPositioningHeroCss,
} from "./components/sharp-positioning-hero";
import { outcomeCtaCss, renderOutcomeCta } from "./components/outcome-cta";
import { proofLedSectionCss, renderProofLedSection } from "./components/proof-led-section";
import type { PatternRenderInput } from "./types";

export interface PatternComponentRegistryEntry {
  readonly render: (input: PatternRenderInput) => string;
  readonly css: string;
}

export const patternComponentRegistry = {
  "sharp-positioning-hero": {
    render: renderSharpPositioningHero,
    css: sharpPositioningHeroCss
  },
  "proof-led-section": {
    render: renderProofLedSection,
    css: proofLedSectionCss
  },
  "outcome-cta": {
    render: renderOutcomeCta,
    css: outcomeCtaCss
  }
} satisfies Record<string, PatternComponentRegistryEntry>;

export type RegisteredPatternId = keyof typeof patternComponentRegistry;

export function hasPatternComponent(patternId: string): patternId is RegisteredPatternId {
  return Object.prototype.hasOwnProperty.call(patternComponentRegistry, patternId);
}

export function getPatternComponent(patternId: string): PatternComponentRegistryEntry {
  if (!hasPatternComponent(patternId)) {
    throw new Error(`No renderer registered for pattern ${patternId}.`);
  }
  return patternComponentRegistry[patternId];
}
