import { describe, expect, it } from "vitest";

import { makeHandoffId } from "../../src/data/delivery-system/checkCompletionMatrix";
import {
  correctionLoopMaxIterations,
  selectWorkerOutputNextAction,
  type CorrectionLoopEntry
} from "../../src/data/delivery-system/modelOutputEvaluation";

describe("model output evaluation correction loop policy", () => {
  it("resolves correction-loop max iterations from routing mode step budgets", () => {
    expect(correctionLoopMaxIterations()).toBe(3);
    expect(correctionLoopMaxIterations("idea")).toBe(2);
    expect(correctionLoopMaxIterations("review")).toBe(2);
    expect(correctionLoopMaxIterations("spec")).toBe(3);
    expect(correctionLoopMaxIterations("build")).toBe(3);
  });

  it("binds retry and escalation to the loop maxIterations", () => {
    expect(selectWorkerOutputNextAction(loop({ iterationCount: 1, maxIterations: 2 }), "needs_scoring")).toBe(
      "retry_with_correction"
    );
    expect(selectWorkerOutputNextAction(loop({ iterationCount: 2, maxIterations: 2 }), "needs_scoring")).toBe(
      "escalate_model_route"
    );
  });
});

function loop(overrides: Pick<CorrectionLoopEntry, "iterationCount" | "maxIterations">): CorrectionLoopEntry {
  return {
    taskId: "task-correction-loop",
    handoffId: makeHandoffId("hp-20260706-correction-loop"),
    provider: "local",
    iterationCount: overrides.iterationCount,
    maxIterations: overrides.maxIterations,
    lastScore: 42,
    failureLabels: ["instruction_following"],
    correctionApplied: "tighten expected output contract",
    state: "needs_scoring"
  };
}
