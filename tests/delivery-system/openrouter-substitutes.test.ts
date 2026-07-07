import { describe, expect, it } from "vitest";

import {
  SUBSTITUTE_LADDERS,
  isEndpointUsable
} from "../../src/data/delivery-system/openrouterSubstitutes";

describe("OpenRouter substitute catalog", () => {
  it("classifies endpoint usability with the public health predicate", () => {
    expect(isEndpointUsable({ status: 1, uptime_last_5m: 100, uptime_last_30m: 99 })).toBe(true);
    expect(isEndpointUsable({ status: -5, uptime_last_5m: 100, uptime_last_30m: 99 })).toBe(false);
    expect(isEndpointUsable({ status: 1, uptime_last_5m: 100, uptime_last_30m: 94.9 })).toBe(false);
    expect(isEndpointUsable({ status: 1, uptime_last_5m: null, uptime_last_30m: 99 })).toBe(false);
    expect(isEndpointUsable({ status: 0, uptime_last_5m: 95, uptime_last_30m: 95 })).toBe(true);
  });

  it("keeps ladder entries catalog-only and above the quality floor", () => {
    const allCandidates = Object.values(SUBSTITUTE_LADDERS).flat();

    expect(allCandidates.every((candidate) => candidate.quality !== "below_floor")).toBe(true);
    expect(SUBSTITUTE_LADDERS.code_draft.slice(0, 3).some((candidate) => candidate.provider_slug !== "Poolside")).toBe(
      true
    );
    expect(SUBSTITUTE_LADDERS.planning[0]?.provider_slug).not.toBe("Nvidia");
    expect(allCandidates.every((candidate) => candidate.evidence.trim().length > 0)).toBe(true);
  });
});
