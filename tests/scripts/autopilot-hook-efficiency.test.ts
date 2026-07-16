import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { hookTestInternals } from "../../.codex/hooks/autopilot-hook.mjs";

describe("Autopilot hook efficiency", () => {
  it("does not queue an investigator for one ordinary failed command", () => {
    expect(
      hookTestInternals.shouldQueueInvestigator({
        failed: true,
        flags: ["tool_result_failed"],
        recentFailureCount: 1
      })
    ).toBe(false);
  });

  it.each(["remote_mutation", "secret_like_input", "credential_surface"])(
    "queues immediately for %s",
    (flag) => {
      expect(
        hookTestInternals.shouldQueueInvestigator({
          failed: true,
          flags: [flag],
          recentFailureCount: 1
        })
      ).toBe(true);
    }
  );

  it("queues after the second ordinary failure", () => {
    expect(
      hookTestInternals.shouldQueueInvestigator({
        failed: true,
        flags: ["tool_result_failed"],
        recentFailureCount: 2
      })
    ).toBe(true);
  });

  it("uses a compact continuity pointer after compaction", () => {
    const source = readFileSync(".codex/hooks/autopilot-hook.mjs", "utf8");

    expect(source).toContain(
      "Read the saved continuity pointer and only the AGENTS.md section or mesh must_read entries needed for the active work unit."
    );
    expect(source).not.toContain(
      "Re-read AGENTS.md and obtain a fresh relevant mesh packet before further edits."
    );
  });
});
