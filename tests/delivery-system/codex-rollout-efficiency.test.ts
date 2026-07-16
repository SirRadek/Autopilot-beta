import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { summarizeCodexRolloutJsonl } from "../../src/data/delivery-system/codexRolloutEfficiency";

const fixture = (name: string): string =>
  readFileSync(
    join(process.cwd(), "tests/fixtures/codex-efficiency", name),
    "utf8",
  );

describe("Codex rollout efficiency", () => {
  it("measures a root rollout using cumulative positive deltas", () => {
    const result = summarizeCodexRolloutJsonl(
      fixture("root.jsonl"),
      "root.jsonl",
    );

    expect(result).toMatchObject({
      root_session_id: "root-session",
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
      replay_events_excluded: 0,
      coverage: "estimated",
    });
    expect(result.total_wall_ms).toBe(3_500);
  });

  it("subtracts inherited replay counters before the first current turn", () => {
    const result = summarizeCodexRolloutJsonl(
      fixture("fork-with-replay.jsonl"),
      "fork.jsonl",
    );

    expect(result.usage).toEqual({
      input_tokens: 40,
      cached_input_tokens: 30,
      output_tokens: 5,
      reasoning_output_tokens: 2,
    });
    expect(result.replay_events_excluded).toBe(1);
    expect(result.subagent_calls).toBe(1);
  });

  it("continues with positive deltas after a resumed counter reset", () => {
    const result = summarizeCodexRolloutJsonl(
      fixture("resumed-counter-reset.jsonl"),
      "resume.jsonl",
    );

    expect(result.usage).toEqual({
      input_tokens: 35,
      cached_input_tokens: 25,
      output_tokens: 5,
      reasoning_output_tokens: 2,
    });
    expect(result.replay_events_excluded).toBe(1);
  });

  it("counts compaction without serializing its content", () => {
    const result = summarizeCodexRolloutJsonl(
      fixture("compaction.jsonl"),
      "compaction.jsonl",
    );

    expect(result.compactions).toBe(1);
    expect(JSON.stringify(result)).not.toContain("private compacted summary");
  });

  it("reports truncation without leaking event content", () => {
    const result = summarizeCodexRolloutJsonl(
      fixture("truncated.jsonl"),
      "truncated.jsonl",
    );

    expect(result.parse_errors).toBe(1);
    expect(JSON.stringify(result)).not.toContain("private prompt");
  });

  it("returns insufficient evidence when current-turn counters are missing", () => {
    const result = summarizeCodexRolloutJsonl(
      fixture("missing-counters.jsonl"),
      "missing.jsonl",
    );

    expect(result.coverage).toBe("insufficient_evidence");
    expect(result.usage).toEqual({
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
    });
  });
});
