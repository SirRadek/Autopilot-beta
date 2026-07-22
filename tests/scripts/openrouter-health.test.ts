import { describe, expect, it } from "vitest";

import {
  endpointVerdict,
  evaluateModelHealth,
  isOpenRouterHealthEntrypoint
} from "../../scripts/openrouter-health";

describe("openrouter health reader", () => {
  it("recognizes the direct CLI entry point on POSIX and Windows paths only", () => {
    expect(isOpenRouterHealthEntrypoint("/app/scripts/openrouter-health.ts", "/app/scripts/openrouter-health.ts")).toBe(true);
    expect(isOpenRouterHealthEntrypoint("C:\\app\\scripts\\openrouter-health.ts", "C:\\app\\scripts\\openrouter-health.ts")).toBe(true);
    expect(isOpenRouterHealthEntrypoint("/tmp/recovery-smoke.mjs", "/tmp/recovery-smoke.mjs")).toBe(false);
    expect(isOpenRouterHealthEntrypoint("/app/scripts/openrouter-health.ts", "/other/openrouter-health.ts")).toBe(false);
  });

  it("treats the measured Venice outage shape as unusable", () => {
    const health = evaluateModelHealth({
      endpoints: [
        {
          name: "Venice",
          provider_name: "Venice",
          status: -2,
          uptime_last_5m: null,
          uptime_last_30m: null,
          uptime_last_1d: 0,
          latency_last_30m: null,
          throughput_last_30m: null
        }
      ]
    });

    expect(health.usable).toBe(false);
    expect(health.endpoints).toHaveLength(1);
    expect(health.endpoints[0]).toMatchObject({
      provider: "Venice",
      usable: false,
      status: -2,
      up5m: null,
      up30m: null,
      up1d: 0
    });
    expect(endpointVerdict(health.endpoints[0]!)).toBe("DOWN");
  });

  it("treats a healthy nemotron-shaped endpoint as usable", () => {
    const health = evaluateModelHealth({
      endpoints: [
        {
          name: "Nvidia",
          provider_name: "Nvidia",
          status: 1,
          uptime_last_5m: 100,
          uptime_last_30m: 99.2,
          uptime_last_1d: 99.1,
          latency_last_30m: 1234,
          throughput_last_30m: 18
        }
      ]
    });

    expect(health.usable).toBe(true);
    expect(health.endpoints[0]?.usable).toBe(true);
    expect(endpointVerdict(health.endpoints[0]!)).toBe("USABLE");
  });

  it("returns the unknown contract for unparseable payload shapes", () => {
    expect(evaluateModelHealth("not-json")).toEqual({
      endpoints: [],
      usable: false
    });
  });

  // Measured live 2026-07-06: the REAL API wraps the model in a top-level `data` object. The first
  // reader version parsed only the bare shape, so every live probe came back UNKNOWN — this pins
  // the real contract (third mock-mirrors-assumption catch today).
  it("parses the real data-wrapped endpoints payload (measured shape)", () => {
    const health = evaluateModelHealth({
      data: {
        id: "qwen/qwen3-coder:free",
        name: "Qwen: Qwen3 Coder 480B A35B (free)",
        endpoints: [
          {
            name: "Venice | qwen/qwen3-coder-480b-a35b-07-25:free",
            provider_name: "Venice",
            status: 0,
            uptime_last_5m: null,
            uptime_last_30m: null,
            uptime_last_1d: 0
          }
        ]
      }
    });

    expect(health.endpoints).toHaveLength(1);
    expect(health.endpoints[0]?.provider).toBe("Venice");
    expect(health.usable).toBe(false);
  });

  it("labels grey endpoint signatures without treating them as usable", () => {
    const health = evaluateModelHealth({
      endpoints: [
        {
          provider_name: "GreyProvider",
          status: 1,
          uptime_last_5m: null,
          uptime_last_30m: null,
          uptime_last_1d: 99
        }
      ]
    });

    expect(health.usable).toBe(false);
    expect(endpointVerdict(health.endpoints[0]!)).toBe("GREY");
  });
});
