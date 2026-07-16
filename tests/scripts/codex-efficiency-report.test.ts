import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertAggregateOnly,
  buildEfficiencyReport,
  compareEfficiencyWindows,
  type EfficiencyReportV1,
} from "../../src/data/delivery-system/efficiencyReport";
import type { RolloutEfficiencyEstimate } from "../../src/data/delivery-system/codexRolloutEfficiency";
import { runCodexEfficiencyCli } from "../../scripts/codex-efficiency-report";

describe("Codex efficiency reporting", () => {
  it("requires matched sample sizes and a 30 percent median reduction", () => {
    const result = compareEfficiencyWindows(
      reportFixture(),
      reportFixture({ median: 700, ordinary: 20, highRisk: 5 }),
    );

    expect(result).toMatchObject({
      status: "accepted",
      median_reduction_pct: 30,
      ordinary_samples: 20,
      high_risk_samples: 5,
    });
  });

  it("returns insufficient evidence instead of success", () => {
    expect(
      compareEfficiencyWindows(
        reportFixture(),
        reportFixture({ median: 600, ordinary: 19, highRisk: 5 }),
      ).status,
    ).toBe("insufficient_evidence");
  });

  it("rejects a Critical or High escape even when tokens improve", () => {
    expect(
      compareEfficiencyWindows(
        reportFixture(),
        reportFixture({
          median: 600,
          ordinary: 20,
          highRisk: 5,
          escapedHigh: 1,
        }),
      ).status,
    ).toBe("quality_regression");
  });

  it("rejects first-pass, retry exhaustion, and incomplete-work regressions", () => {
    const result = compareEfficiencyWindows(
      reportFixture(),
      reportFixture({
        median: 600,
        ordinary: 20,
        highRisk: 5,
        firstPass: 87,
        retryExhausted: 2,
        incomplete: 1,
      }),
    );

    expect(result.status).toBe("quality_regression");
    expect(result.reasons).toEqual([
      "first_pass_acceptance_regressed",
      "retry_exhaustion_increased",
      "incomplete_work_increased",
    ]);
  });

  it("builds an aggregate-only report from an explicit source map", () => {
    const estimate = estimateFixture();
    const report = buildEfficiencyReport({
      estimates: [estimate],
      workUnits: [
        {
          source: estimate.source,
          descriptor: {
            work_unit_id: "wu-1",
            class: "bounded_implementation",
            risk: "ordinary",
          },
          status: "completed",
          first_pass_accepted: true,
          escaped_severity: null,
          retry_exhausted: false,
        },
      ],
      since: "2026-07-10T00:00:00.000Z",
      until: "2026-07-11T00:00:00.000Z",
      generatedAt: "2026-07-11T00:00:01.000Z",
    });

    expect(report).toMatchObject({
      contains_raw_content: false,
      coverage: "estimated",
      samples: { ordinary: 1, high_risk: 0, completed: 1 },
      tokens: {
        median_per_completed: 58,
        cached_input: 35,
        uncached_input: 15,
        output: 8,
      },
      orchestration: { tool_calls: 2, poll_calls: 1 },
    });
    expect(() => assertAggregateOnly(report)).not.toThrow();
    expect(JSON.stringify(report)).not.toContain("private");
  });

  it("refuses forbidden aggregate keys recursively", () => {
    expect(() =>
      assertAggregateOnly({ safe: { raw_tool_payload: "private" } }),
    ).toThrow(/forbidden_aggregate_key/);
  });

  it("runs the report CLI against aggregate fixtures", () => {
    const output = execFileSync(
      join(process.cwd(), "node_modules", ".bin", "tsx"),
      [
        "scripts/codex-efficiency-report.ts",
        "report",
        "--sessions",
        "tests/fixtures/codex-efficiency",
        "--work-units",
        "tests/fixtures/codex-efficiency/work-units.json",
        "--since",
        "7d",
        "--json",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const report = JSON.parse(output) as EfficiencyReportV1;

    expect(report.contains_raw_content).toBe(false);
    expect(report.samples.completed).toBe(5);
    expect(() => assertAggregateOnly(report)).not.toThrow();
    expect(output).not.toContain("private prompt");
  });

  it.each([
    ["without a map argument", []],
    ["when the explicit map file is unavailable", ["--work-units", "missing-work-units.json"]],
  ])("returns insufficient evidence %s", (_label, mapArgs) => {
    const report = runCodexEfficiencyCli(
      [
        "report",
        "--sessions",
        "tests/fixtures/codex-efficiency",
        ...mapArgs,
        "--since",
        "7d",
        "--json",
      ],
      new Date("2026-07-16T00:00:00.000Z"),
    ) as EfficiencyReportV1;

    expect(report).toMatchObject({
      coverage: "insufficient_evidence",
      samples: { ordinary: 0, high_risk: 0, completed: 0 },
    });
  });

  it("compares an immutable baseline record and preserves insufficient evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-efficiency-compare-"));
    try {
      const baselinePath = join(root, "baseline.json");
      const candidatePath = join(root, "candidate.json");
      writeFileSync(
        baselinePath,
        JSON.stringify({
          ...reportFixture({ ordinary: 0, highRisk: 0 }),
          schema_version: "autopilot-codex-efficiency-baseline-v1",
          method: "replay-aware-positive-counter-delta",
          limitations: [
            "explicit historical source-to-work-unit map unavailable",
            "forked rollout counters are not provider billing records",
            "provider-authoritative telemetry unavailable",
          ],
          routing: {
            mode: "shadow_only",
            recommended_model: null,
            recommended_reasoning_effort: null,
          },
          acceptance: {
            status: "insufficient_evidence",
            median_reduction_pct: null,
            reasons: [
              "historical_work_unit_map_unavailable",
              "minimum_sample_not_met",
            ],
          },
        }),
      );
      writeFileSync(
        candidatePath,
        JSON.stringify(reportFixture({ ordinary: 0, highRisk: 0 })),
      );

      expect(
        runCodexEfficiencyCli([
          "compare",
          "--baseline",
          baselinePath,
          "--candidate",
          candidatePath,
          "--json",
        ]),
      ).toMatchObject({
        status: "insufficient_evidence",
        ordinary_samples: 0,
        high_risk_samples: 0,
        reasons: ["minimum_sample_not_met"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["unknown fields", { operator_note: "private data" }],
    ["unapproved limitation values", { limitations: ["private data"] }],
  ])("rejects baseline records with %s", (_label, extra) => {
    const root = mkdtempSync(join(tmpdir(), "codex-efficiency-invalid-"));
    try {
      const baselinePath = join(root, "baseline.json");
      const candidatePath = join(root, "candidate.json");
      writeFileSync(
        baselinePath,
        JSON.stringify({
          ...reportFixture({ ordinary: 0, highRisk: 0 }),
          schema_version: "autopilot-codex-efficiency-baseline-v1",
          method: "replay-aware-positive-counter-delta",
          limitations: [
            "explicit historical source-to-work-unit map unavailable",
            "forked rollout counters are not provider billing records",
            "provider-authoritative telemetry unavailable",
          ],
          routing: {
            mode: "shadow_only",
            recommended_model: null,
            recommended_reasoning_effort: null,
          },
          acceptance: {
            status: "insufficient_evidence",
            median_reduction_pct: null,
            reasons: [
              "historical_work_unit_map_unavailable",
              "minimum_sample_not_met",
            ],
          },
          ...extra,
        }),
      );
      writeFileSync(candidatePath, JSON.stringify(reportFixture()));

      expect(() =>
        runCodexEfficiencyCli([
          "compare",
          "--baseline",
          baselinePath,
          "--candidate",
          candidatePath,
          "--json",
        ]),
      ).toThrow(/invalid_efficiency_report/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function reportFixture(
  overrides: {
    readonly median?: number;
    readonly ordinary?: number;
    readonly highRisk?: number;
    readonly firstPass?: number;
    readonly escapedHigh?: number;
    readonly retryExhausted?: number;
    readonly incomplete?: number;
  } = {},
): EfficiencyReportV1 {
  return {
    schema_version: "autopilot-codex-efficiency-report-v1",
    generated_at: "2026-07-16T00:00:00.000Z",
    window: {
      since: "2026-07-10T00:00:00.000Z",
      until: "2026-07-16T00:00:00.000Z",
    },
    coverage: "estimated",
    contains_raw_content: false,
    samples: {
      ordinary: overrides.ordinary ?? 20,
      high_risk: overrides.highRisk ?? 5,
      completed: (overrides.ordinary ?? 20) + (overrides.highRisk ?? 5),
    },
    tokens: {
      median_per_completed: overrides.median ?? 1_000,
      cached_input: 10_000,
      uncached_input: 1_000,
      output: 500,
      reasoning_output: 100,
    },
    context: { input_p50: 80_000, input_p90: 120_000 },
    orchestration: {
      model_calls: 25,
      tool_calls: 100,
      poll_calls: 10,
      subagent_calls: 5,
      compactions: 2,
      total_wall_ms: 10_000,
    },
    quality: {
      first_pass_acceptance_pct: overrides.firstPass ?? 90,
      escaped_critical: 0,
      escaped_high: overrides.escapedHigh ?? 0,
      retry_exhausted: overrides.retryExhausted ?? 0,
      incomplete: overrides.incomplete ?? 0,
    },
    classes: emptyClasses(),
  };
}

function estimateFixture(): RolloutEfficiencyEstimate {
  return {
    source: "root.jsonl",
    root_session_id: "root-session",
    thread_source: "root",
    usage: {
      input_tokens: 50,
      cached_input_tokens: 35,
      output_tokens: 8,
      reasoning_output_tokens: 3,
    },
    token_events: 2,
    turn_count: 1,
    tool_calls: 2,
    tool_call_counts: { exec_command: 1, wait_agent: 1 },
    subagent_calls: 0,
    poll_calls: 1,
    compactions: 0,
    started_at: "2026-07-10T10:00:00.000Z",
    ended_at: "2026-07-10T10:00:03.500Z",
    total_wall_ms: 3_500,
    replay_events_excluded: 0,
    parse_errors: 0,
    coverage: "estimated",
  };
}

function emptyClasses(): EfficiencyReportV1["classes"] {
  return {
    deterministic_check: { completed: 0, median_tokens: null },
    mechanical_change: { completed: 0, median_tokens: null },
    bounded_implementation: { completed: 0, median_tokens: null },
    research_or_design: { completed: 0, median_tokens: null },
    review: { completed: 0, median_tokens: null },
    high_risk: { completed: 0, median_tokens: null },
  };
}
