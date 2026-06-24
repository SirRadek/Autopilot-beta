import {
  renderSharpPositioningHero,
  sharpPositioningHeroCss,
  type SharpPositioningHeroInput
} from "./components/sharp-positioning-hero";

export interface PatternComponentRegistryEntry {
  readonly render: (input: SharpPositioningHeroInput) => string;
  readonly css: string;
}

export const patternComponentRegistry = {
  "sharp-positioning-hero": {
    render: renderSharpPositioningHero,
    css: sharpPositioningHeroCss
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
