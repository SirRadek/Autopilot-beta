import { describe, expect, it } from "vitest";

import {
  anthropicKnownTiers,
  geminiKnownTiers,
  openaiKnownTiers,
  type ProviderTierSpec
} from "../../src/data/delivery-system/subscriptionBudget";

// S1 (vendor-routing v2): tier catalogs carry a reconstructed-placeholder costWeight.
// Contract under test: catalogs are exported; every weight is in (0, 1]; and each pool's
// flagship (deepest) tier weighs exactly 1.0. All weights are placeholders and MUST ship
// verifiedLocally:false until re-verified.

const catalogsByPool: ReadonlyArray<{
  readonly pool: string;
  readonly tiers: readonly ProviderTierSpec[];
  readonly flagshipTierId: string;
}> = [
  { pool: "anthropic", tiers: anthropicKnownTiers, flagshipTierId: "opus" },
  { pool: "openai", tiers: openaiKnownTiers, flagshipTierId: "gpt_5_5" },
  { pool: "google", tiers: geminiKnownTiers, flagshipTierId: "gemini_pro" }
];

describe("tier catalogs (S1)", () => {
  it("exports a non-empty catalog for every subscription pool", () => {
    for (const { pool, tiers } of catalogsByPool) {
      expect(tiers.length, `${pool} catalog should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("keeps every catalog weight in the (0, 1] pool-draw range", () => {
    for (const { pool, tiers } of catalogsByPool) {
      for (const tier of tiers) {
        expect(tier.costWeight, `${pool}/${tier.tierId} costWeight > 0`).toBeGreaterThan(0);
        expect(tier.costWeight, `${pool}/${tier.tierId} costWeight <= 1`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("weighs each pool's flagship tier at exactly 1.0", () => {
    for (const { pool, tiers, flagshipTierId } of catalogsByPool) {
      const flagship = tiers.find((tier) => tier.tierId === flagshipTierId);
      expect(flagship, `${pool} flagship ${flagshipTierId} exists`).toBeDefined();
      expect(flagship?.costWeight, `${pool} flagship weight === 1.0`).toBe(1.0);
    }
  });

  it("ships every reconstructed-placeholder weight as verifiedLocally:false (except the one pre-verified gemini_auto CLI path)", () => {
    // Only gemini_auto is verifiedLocally:true (its CLI access path was confirmed), and its
    // costWeight is still a reconstructed placeholder — so the honesty rule is: no NEW tier
    // added by S1 (anthropic/openai) may claim verifiedLocally:true for its weight.
    for (const tier of [...anthropicKnownTiers, ...openaiKnownTiers]) {
      expect(tier.verifiedLocally, `${tier.tierId} weight is an unverified placeholder`).toBe(false);
    }
  });

  it("orders each pool so cheaper tiers weigh strictly less than the flagship", () => {
    for (const { pool, tiers, flagshipTierId } of catalogsByPool) {
      const cheaper = tiers.filter((tier) => tier.tierId !== flagshipTierId);
      for (const tier of cheaper) {
        expect(tier.costWeight, `${pool}/${tier.tierId} < flagship 1.0`).toBeLessThan(1.0);
      }
    }
  });
});
