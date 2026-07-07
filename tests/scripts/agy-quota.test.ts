import { describe, expect, it } from "vitest";

import {
  buildAgyQuotaReport,
  parseAgyQuotaTable
} from "../../scripts/agy-quota";

const measuredQuotaTable = `
┌─────────────────────────────┬───────────┬─────────┐
│ Model                       │ Remaining │ Resets  │
├─────────────────────────────┼───────────┼─────────┤
│ Claude Opus 4.6 (Thinking)  │ 🟢 100%   │ 4h 59m  │
│ Gemini 3.1 Pro (High)       │ 🟡 42%    │ 2h 01m  │
│ Gemini 3.1 Pro (High)       │ 🔴 7%     │ 1h 14m  │
│ GPT-5.4                     │ 🟢 88%    │ 5h      │
│ malformed row               │ no quota  │ later   │
└─────────────────────────────┴───────────┴─────────┘
`;

describe("agy quota reader", () => {
  it("parses measured box-drawing quota output and dedupes duplicate models", () => {
    const rows = parseAgyQuotaTable(measuredQuotaTable);

    expect(rows).toEqual([
      {
        model: "Claude Opus 4.6 (Thinking)",
        remaining_pct: 100,
        resets_in: "4h 59m"
      },
      {
        model: "Gemini 3.1 Pro (High)",
        remaining_pct: 42,
        resets_in: "2h 01m"
      },
      {
        model: "GPT-5.4",
        remaining_pct: 88,
        resets_in: "5h"
      }
    ]);
  });

  it("builds group minimums for Gemini and Claude/GPT quota lanes", () => {
    expect(buildAgyQuotaReport(parseAgyQuotaTable(measuredQuotaTable)).groups).toEqual({
      gemini: {
        min_remaining_pct: 42
      },
      claude_gpt: {
        min_remaining_pct: 88
      }
    });
  });

  it("returns no rows for empty or garbage input", () => {
    expect(parseAgyQuotaTable("")).toEqual([]);
    expect(parseAgyQuotaTable("not a table\nstill not a table")).toEqual([]);
  });
});
