import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("maintenance command wiring", () => {
  it("uses one apply transaction in the systemd service", () => {
    const unit = readFileSync("ops/systemd/autopilot-state-maintenance.service", "utf8");
    const starts = unit.split(/\r?\n/).filter((line) => line.startsWith("ExecStart="));

    expect(starts).toHaveLength(1);
    expect(starts[0]).toContain("ops:maintenance");
    expect(starts[0]).toContain("--apply");
    expect(starts[0]).not.toContain("--apply-rotation");
  });

  it("routes the maintenance CLI through performStateMaintenance", () => {
    const source = readFileSync("scripts/ops-maintenance.ts", "utf8");

    expect(source).toContain("performStateMaintenance");
    expect(source).not.toContain("rotateStateLogs(");
  });
});
