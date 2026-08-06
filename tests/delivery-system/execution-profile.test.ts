import { describe, expect, it } from "vitest";
import { classifyWorkUnitForProfile, resolveVerificationMode, assertNoSilentRouteChange, DEV_DEFAULT_COST_TIERS, RUN_REASONING_EFFORTS, SUPPORTED_REASONING_EFFORTS } from "../../src/data/delivery-system/executionProfile";

describe("executionProfile", () => {
  it("uses diff-scoped verification only for ordinary DEV work", () => {
    expect(resolveVerificationMode("dev", "ordinary")).toBe("diff_scoped");
    expect(resolveVerificationMode("dev", "high")).toBe("full_fail_closed");
    expect(resolveVerificationMode("prod", "ordinary")).toBe("full_fail_closed");
    expect(resolveVerificationMode("prod", "high")).toBe("full_fail_closed");
  });

  it("classifies PROD and high-risk boundaries as high risk", () => {
    expect(classifyWorkUnitForProfile("dev", false)).toEqual({ class: "bounded_implementation", risk: "ordinary" });
    expect(classifyWorkUnitForProfile("dev", true)).toEqual({ class: "high_risk", risk: "high" });
    expect(classifyWorkUnitForProfile("prod", false)).toEqual({ class: "high_risk", risk: "high" });
  });

  it("defaults DEV to free/cheap lanes and refuses a silent route change", () => {
    expect(DEV_DEFAULT_COST_TIERS).toContain("free");
    expect(() => assertNoSilentRouteChange({ provider: "codex_cli", model: "gpt-5", reasoning: "high" }, { provider: "codex_cli", model: "gpt-5", reasoning: "high" })).not.toThrow();
    expect(() => assertNoSilentRouteChange({ provider: "codex_cli", model: "gpt-5", reasoning: "high" }, { provider: "codex_cli", model: "gpt-5", reasoning: "xhigh" })).toThrow("silent_route_change_forbidden");
  });

  it("exposes the verified max and delegation-capable ultra levels only on Codex", () => {
    expect(RUN_REASONING_EFFORTS).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(SUPPORTED_REASONING_EFFORTS.codex_cli).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(SUPPORTED_REASONING_EFFORTS.claude_cli).not.toContain("ultra");
    expect(SUPPORTED_REASONING_EFFORTS.agy_cli).not.toContain("ultra");
  });
});
