import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const failedValidation = vi.hoisted(() => vi.fn(() => ({
  valid: false,
  file_count: 0,
  total_bytes: 0,
  errors: ["injected_validation_mismatch"]
})));

vi.mock("../../src/data/delivery-system/stateBackup", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/data/delivery-system/stateBackup")>(),
  validateStateBackup: failedValidation
}));

import { performStateMaintenance } from "../../src/data/delivery-system/stateMaintenance";

describe("state maintenance validation failure", () => {
  it("quarantines the new archive without rotation or retention pruning", () => {
    const root = mkdtempSync(join(tmpdir(), "autopilot-maintenance-invalid-"));
    const stateDirectory = join(root, "state");
    const backupDirectory = join(stateDirectory, "backups");
    const environmentFile = join(root, "control-plane.env");
    const logPath = join(stateDirectory, "audit.jsonl");
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(environmentFile, "SAFE=value\n", { mode: 0o600 });
    chmodSync(stateDirectory, 0o700);
    chmodSync(environmentFile, 0o600);
    const beforeLog = `${"x".repeat(2 * 1024 * 1024)}\n`;
    writeFileSync(logPath, beforeLog);
    for (let index = 0; index < 8; index += 1) {
      writeFileSync(join(backupDirectory, `autopilot-state-2026-01-0${index + 1}T00-00-00-000Z.apbackup.json`), "existing");
    }

    const result = performStateMaintenance({ stateDirectory, backupDirectory, environmentFile, mode: "apply" });
    const after = readdirSync(backupDirectory);

    expect(result).toMatchObject({
      ok: false,
      findings: ["maintenance_failed:backup_validation_failed"],
      rotated: [],
      backup: { valid: false }
    });
    expect(result.backup?.path.includes(".quarantine")).toBe(true);
    expect(existsSync(result.backup!.path)).toBe(true);
    expect(after.filter((name) => name.endsWith(".apbackup.json"))).toHaveLength(8);
    expect(readFileSync(logPath, "utf8")).toBe(beforeLog);
  });
});
