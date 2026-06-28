import {
  renderSharpPositioningHero,
  sharpPositioningHeroCss,
} from "./components/sharp-positioning-hero";
import { outcomeCtaCss, renderOutcomeCta } from "./components/outcome-cta";
import { proofLedSectionCss, renderProofLedSection } from "./components/proof-led-section";
import { dotStageHeroCss, renderDotStageHero } from "./components/dot-stage-hero";
import { pointCloudBackgroundCss, renderPointCloudBackground } from "./components/point-cloud-background";
import { renderTactileShadowHero, tactileShadowHeroCss } from "./components/tactile-shadow-hero";
import type { PatternRenderInput } from "./types";
export interface PatternComponentRegistryEntry {
  readonly render: (input: PatternRenderInput) => string;
  readonly css: string;
  readonly rendererKind: "section";
}

export const patternComponentRegistry = {
  "sharp-positioning-hero": {
    render: renderSharpPositioningHero,

    css: sharpPositioningHeroCss,
    rendererKind: "section"
  },
  "proof-led-section": {
    render: renderProofLedSection,
    css: proofLedSectionCss,
    rendererKind: "section"
  },
  "outcome-cta": {
    render: renderOutcomeCta,
    css: outcomeCtaCss,
    rendererKind: "section"
  },
  "dot-stage-hero": {
    render: renderDotStageHero,
    css: dotStageHeroCss,
    rendererKind: "section"
  },
  "point-cloud-background": {
    render: renderPointCloudBackground,
    css: pointCloudBackgroundCss,
    rendererKind: "section"
  },
  "tactile-shadow-hero": {
    render: renderTactileShadowHero,
    css: tactileShadowHeroCss,
    rendererKind: "section"
  }
} satisfies Record<string, PatternComponentRegistryEntry>;

export type RegisteredPatternId = keyof typeof patternComponentRegistry;

export function hasPatternComponent(patternId: string): patternId is RegisteredPatternId {
  return Object.prototype.hasOwnProperty.call(patternComponentRegistry, patternId);
}

export function hasSectionPatternComponent(patternId: string): patternId is RegisteredPatternId {
  return hasPatternComponent(patternId) && patternComponentRegistry[patternId].rendererKind === "section";
}

export function getPatternComponent(patternId: string): PatternComponentRegistryEntry {
  if (!hasPatternComponent(patternId)) {
    throw new Error(`No renderer registered for pattern ${patternId}.`);
  }
  return patternComponentRegistry[patternId];
}
