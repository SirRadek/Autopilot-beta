import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createStateBackup } from "../../src/data/delivery-system/stateBackup";
import { drillStateRecovery } from "../../src/data/delivery-system/stateRecovery";

function archiveFixture() {
  const root = mkdtempSync(join(tmpdir(), "autopilot-recovery-drill-"));
  const state = join(root, "state");
  const temporaryRoot = join(root, "drills");
  mkdirSync(state);
  writeFileSync(join(state, "sessions.json"), "safe");
  const archive = createStateBackup(state, join(root, "backups")).path;
  return { root, archive, temporaryRoot };
}

describe("recovery drill", () => {
  it("restores, validates reconciliation/readiness, and cleans its temporary root", () => {
    const fixture = archiveFixture();
    const result = drillStateRecovery(fixture.archive, {
      temporaryRoot: fixture.temporaryRoot,
      validateRestoredState: (stateDir) => ({
        ready: readFileSync(join(stateDir, "sessions.json"), "utf8") === "safe",
        reconciled: true,
        errors: []
      })
    });

    expect(result).toEqual({
      ok: true,
      validation: { ready: true, reconciled: true, errors: [] },
      restored_file_count: 1
    });
    expect(existsSync(fixture.temporaryRoot) ? readdirSync(fixture.temporaryRoot) : []).toEqual([]);
  });

  it("reports corrupt archives and failed readiness without retaining restored state", () => {
    const fixture = archiveFixture();
    writeFileSync(fixture.archive, "not-json injected-secret");
    const corrupt = drillStateRecovery(fixture.archive, {
      temporaryRoot: fixture.temporaryRoot,
      validateRestoredState: () => ({ ready: true, reconciled: true, errors: [] })
    });

    expect(corrupt).toEqual({
      ok: false,
      validation: { ready: false, reconciled: false, errors: ["recovery_failed"] },
      restored_file_count: 0
    });
    expect(JSON.stringify(corrupt)).not.toContain("injected-secret");

    const valid = archiveFixture();
    const notReady = drillStateRecovery(valid.archive, {
      temporaryRoot: valid.temporaryRoot,
      validateRestoredState: () => ({ ready: false, reconciled: true, errors: ["readiness_failed"] })
    });
    expect(notReady.ok).toBe(false);
    expect(existsSync(valid.temporaryRoot) ? readdirSync(valid.temporaryRoot) : []).toEqual([]);
  });

  it("keeps the CLI archive-only and exposes the package command", () => {
    const source = readFileSync("scripts/ops-recovery-drill.ts", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(source).toContain("const [archivePath]");
    expect(source).not.toContain("targetDirectory");
    expect(packageJson.scripts["ops:recovery-drill"]).toBe("tsx scripts/ops-recovery-drill.ts");
  });
});
