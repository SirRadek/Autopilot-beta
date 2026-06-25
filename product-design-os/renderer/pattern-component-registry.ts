import {
  renderSharpPositioningHero,
  sharpPositioningHeroCss,
  type SharpPositioningHeroInput
} from "./components/sharp-positioning-hero";
import { renderDotStageHero, dotStageHeroCss } from "./components/dot-stage-hero";

export interface PatternComponentRegistryEntry {
  readonly render: (input: SharpPositioningHeroInput) => string;
  readonly css: string;
}

export const patternComponentRegistry = {
  "sharp-positioning-hero": {
    render: renderSharpPositioningHero,
    css: sharpPositioningHeroCss
  },
  // Heterogeneous renderer input; dot-stage-hero narrows its own input internally.
  // Cast at this dispatch boundary keeps the runtime function identity intact.
  "dot-stage-hero": {
    render: renderDotStageHero as unknown as (input: SharpPositioningHeroInput) => string,
    css: dotStageHeroCss
  }
} satisfies Record<string, PatternComponentRegistryEntry>;

export type RegisteredPatternId = keyof typeof patternComponentRegistry;

export function getPatternComponent(patternId: string): PatternComponentRegistryEntry {
  const component = patternComponentRegistry[patternId as RegisteredPatternId];
  if (component === undefined) {
    throw new Error(`No renderer registered for pattern ${patternId}.`);
  }
  return component;
}
