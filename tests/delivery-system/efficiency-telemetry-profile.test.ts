import { describe, expect, it } from "vitest";

import { buildEfficiencyTelemetryEvent } from "../../src/data/delivery-system/efficiencyTelemetry";

describe("efficiency telemetry profile", () => {
  it("records the profile and keeps recommendations null and shadow-only", () => {
    const event = buildEfficiencyTelemetryEvent({
      recordedAt: "2026-07-21T10:00:00.000Z",
      workUnit: {
        work_unit_id: "wu1",
        class: "bounded_implementation",
        risk: "ordinary",
      },
      handoffId: "h1",
      actualModel: "gpt-5",
      actualReasoningEffort: "medium",
      status: "completed",
      profile: "dev",
    });

    expect(event.profile).toBe("dev");
    expect(event.recommended_model).toBeNull();
    expect(event.recommended_reasoning_effort).toBeNull();
    expect(event.routing_mode).toBe("shadow_only");
  });
});
