import { describe, expect, it } from "vitest";

import {
  buildTelemetrySummary,
  parseSinceDuration,
  parseTelemetryJsonl,
  summarizeDispatchDecisions,
  summarizeVendorCalls,
  withinSince
} from "../../scripts/telemetry-summary";

const NOW = "2026-07-06T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const WITHIN_WINDOW = "2026-07-06T11:30:00.000Z";
const OUT_OF_WINDOW = "2026-06-20T00:00:00.000Z";

describe("telemetry summary reader", () => {
  it("counts malformed JSONL lines while returning valid records", () => {
    const parsed = parseTelemetryJsonl('{"a":1}\nnot-json\n\n{"b":2}\n');

    expect(parsed).toEqual({
      records: [{ a: 1 }, { b: 2 }],
      parse_errors: 1
    });
  });

  it("parses supported since durations and rejects invalid shapes", () => {
    expect(parseSinceDuration("7d")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseSinceDuration("24h")).toBe(24 * 60 * 60 * 1000);
    expect(parseSinceDuration("90m")).toBe(90 * 60 * 1000);
    expect(() => parseSinceDuration("x7")).toThrow(/invalid_since_duration/);
  });

  it("includes the exact window boundary and excludes invalid timestamps", () => {
    const sinceMs = parseSinceDuration("7d");
    const boundary = new Date(NOW_MS - sinceMs).toISOString();

    expect(withinSince(boundary, NOW_MS, sinceMs)).toBe(true);
    expect(withinSince("not-a-date", NOW_MS, sinceMs)).toBe(false);
  });

  it("summarizes vendor calls by vendor, routing mode, outcome, retry count, and provider tokens", () => {
    const summary = summarizeVendorCalls(
      [
        vendorCall({
          vendor: "codex_cli",
          provider: "openai_gpt",
          routing_mode: "build",
          outcome: "success",
          attempt_count: 1,
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15
        }),
        vendorCall({
          vendor: "codex_cli",
          provider: "openai_gpt",
          outcome: "timeout",
          attempt_count: 2,
          input_tokens: 20,
          output_tokens: 10,
          total_tokens: 30
        }),
        vendorCall({
          vendor: "agy_cli",
          provider: "gemini_cli",
          routing_mode: "idea",
          outcome: "success",
          attempt_count: 1,
          input_tokens: 7,
          output_tokens: 8,
          total_tokens: 15
        }),
        vendorCall({ recorded_at: OUT_OF_WINDOW }),
        vendorCall({ recorded_at: "invalid-date" })
      ],
      NOW_MS,
      parseSinceDuration("7d")
    );

    expect(summary.total).toBe(3);
    expect(summary.parse_errors).toBe(0);
    expect(summary.excluded_out_of_window_or_invalid).toBe(2);
    expect(summary.by_vendor).toEqual({ codex_cli: 2, agy_cli: 1 });
    expect(summary.by_routing_mode).toEqual({ build: 1, none: 1, idea: 1 });
    expect(summary.by_outcome).toEqual({ success: 2, timeout: 1 });
    expect(summary.retried_calls).toBe(1);
    expect(summary.tokens_by_provider).toEqual({
      openai_gpt: {
        input_tokens: 30,
        output_tokens: 15,
        total_tokens: 45
      },
      gemini_cli: {
        input_tokens: 7,
        output_tokens: 8,
        total_tokens: 15
      }
    });
  });

  it("summarizes dispatch decisions and reports cheap-lane dispatched share", () => {
    const summary = summarizeDispatchDecisions(
      [
        dispatchDecision({
          routing_mode: "idea",
          resolved_lane: "agy_fast",
          decision: "dispatched"
        }),
        dispatchDecision({
          routing_mode: "build",
          resolved_lane: "codex_cli",
          decision: "dispatched"
        }),
        dispatchDecision({
          routing_mode: null,
          resolved_lane: null,
          decision: "refused",
          refusal_reason: "lane_not_allowed_in_mode"
        })
      ],
      NOW_MS,
      parseSinceDuration("7d")
    );

    expect(summary.total).toBe(3);
    expect(summary.dispatched).toBe(2);
    expect(summary.refused).toBe(1);
    expect(summary.by_refusal_reason).toEqual({ lane_not_allowed_in_mode: 1 });
    expect(summary.by_routing_mode).toEqual({ idea: 1, build: 1, none: 1 });
    expect(summary.by_resolved_lane).toEqual({ agy_fast: 1, codex_cli: 1, unresolved: 1 });
    expect(summary.cheap_lane_dispatched_pct).toBe(50);

    expect(
      summarizeDispatchDecisions(
        [
          dispatchDecision({ resolved_lane: "codex_cli", decision: "dispatched" }),
          dispatchDecision({ resolved_lane: "claude_supervisor", decision: "dispatched" })
        ],
        NOW_MS,
        parseSinceDuration("7d")
      ).cheap_lane_dispatched_pct
    ).toBe(0);

    expect(
      summarizeDispatchDecisions(
        [dispatchDecision({ decision: "refused", refusal_reason: "lane_not_allowed_in_mode" })],
        NOW_MS,
        parseSinceDuration("7d")
      ).cheap_lane_dispatched_pct
    ).toBeNull();
  });

  it("builds an end-to-end summary and accepts empty telemetry inputs", () => {
    const summary = buildTelemetrySummary({
      vendorCallsText: `${JSON.stringify(vendorCall({ vendor: "codex_cli", provider: "openai_gpt" }))}\n`,
      dispatchDecisionsText: `${JSON.stringify(dispatchDecision({ decision: "dispatched", resolved_lane: "agy_fast" }))}\n`,
      now: NOW,
      since: "24h"
    });

    expect(summary.since).toBe("24h");
    expect(summary.vendor_calls.total).toBe(1);
    expect(summary.dispatch_decisions.total).toBe(1);

    const emptySummary = buildTelemetrySummary({
      vendorCallsText: "",
      dispatchDecisionsText: "",
      now: NOW,
      since: "7d"
    });

    expect(emptySummary.vendor_calls.total).toBe(0);
    expect(emptySummary.dispatch_decisions.total).toBe(0);
  });
});

function vendorCall(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recorded_at: WITHIN_WINDOW,
    vendor: "codex_cli",
    provider: "openai_gpt",
    outcome: "success",
    attempt_count: 1,
    input_tokens: 1,
    output_tokens: 2,
    total_tokens: 3,
    ...overrides
  };
}

function dispatchDecision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recorded_at: WITHIN_WINDOW,
    routing_mode: "build",
    resolved_lane: "agy_fast",
    decision: "dispatched",
    refusal_reason: null,
    ...overrides
  };
}
