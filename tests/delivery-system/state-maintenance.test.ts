import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { createStateBackup, validateStateBackup } from "../../src/data/delivery-system/stateBackup";
import { performStateMaintenance } from "../../src/data/delivery-system/stateMaintenance";
import { withStateMaintenanceLock } from "../../src/data/delivery-system/stateMaintenanceLock";
import { restoreStateBackup } from "../../src/data/delivery-system/stateRecovery";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "autopilot-maintenance-"));
  const stateDirectory = join(root, "state");
  const backupDirectory = join(stateDirectory, "backups");
  const environmentFile = join(root, "control-plane.env");
  mkdirSync(stateDirectory, { mode: 0o700 });
  writeFileSync(environmentFile, "CONTROL_PLANE_TOKEN=placeholder\n", { mode: 0o600 });
  chmodSync(stateDirectory, 0o700);
  chmodSync(environmentFile, 0o600);
  return { root, stateDirectory, backupDirectory, environmentFile };
}

describe("state maintenance transaction", () => {
  it("backs up and restores promotions.json byte-identically with mode 0600", () => {
    const fixture_ = fixture();
    const promotions = `${JSON.stringify({ schema_version: "v1", packets: [] }, null, 2)}\n`;
    writeFileSync(join(fixture_.stateDirectory, "promotions.json"), promotions, { mode: 0o600 });

    const backup = createStateBackup(fixture_.stateDirectory, fixture_.backupDirectory);
    const archive = JSON.parse(readFileSync(backup.path, "utf8")) as { manifest: { path: string }[] };
    const restoreDirectory = join(fixture_.root, "restored-state");
    const restored = restoreStateBackup(backup.path, restoreDirectory, { apply: true });

    expect(validateStateBackup(backup.path).valid).toBe(true);
    expect(archive.manifest.map((entry) => entry.path)).toContain("promotions.json");
    expect(restored.applied).toBe(true);
    expect(readFileSync(join(restoreDirectory, "promotions.json"), "utf8")).toBe(promotions);
    expect(statSync(join(restoreDirectory, "promotions.json")).mode & 0o777).toBe(0o600);
  });

  it("fails closed on preflight findings without backup, rotation, or pruning", () => {
    const fixture_ = fixture();
    const logPath = join(fixture_.stateDirectory, "audit.jsonl");
    const beforeLog = `${JSON.stringify({ authorization: "Bearer injected-secret-token" })}\n${"x".repeat(2 * 1024 * 1024)}\n`;
    writeFileSync(logPath, beforeLog);
    mkdirSync(fixture_.backupDirectory);
    writeFileSync(join(fixture_.backupDirectory, "existing.apbackup.json"), "existing");

    const result = performStateMaintenance({ ...fixture_, mode: "apply" });

    expect(result.ok).toBe(false);
    expect(result.backup).toBeNull();
    expect(result.rotated).toEqual([]);
    expect(readFileSync(logPath, "utf8")).toBe(beforeLog);
    expect(readdirSync(fixture_.backupDirectory)).toEqual(["existing.apbackup.json"]);
  });

  it("creates and validates a backup before rotating and pruning", () => {
    const fixture_ = fixture();
    const logPath = join(fixture_.stateDirectory, "audit.jsonl");
    writeFileSync(logPath, `${Array.from({ length: 170_000 }, (_, index) => JSON.stringify({ index })).join("\n")}\n`);
    for (let index = 0; index < 8; index += 1) {
      writeFileSync(join(fixture_.root, `seed-${index}`), "safe");
      createStateBackup(fixture_.stateDirectory, fixture_.backupDirectory, {
        now: new Date(1_700_000_000_000 + index * 1_000),
        keep_backups: 20
      });
    }

    const result = performStateMaintenance({ ...fixture_, mode: "apply" });

    expect(result).toMatchObject({ ok: true, mode: "apply", rotated: ["audit.jsonl"], incident_id: null });
    expect(result.backup?.valid).toBe(true);
    expect(validateStateBackup(result.backup!.path).valid).toBe(true);
    expect(statSync(logPath).size).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(readdirSync(fixture_.backupDirectory).filter((name) => name.endsWith(".apbackup.json"))).toHaveLength(7);
  }, 20_000);

  it("excludes nested backups, lock metadata, temporary files, and quarantine files", () => {
    const fixture_ = fixture();
    writeFileSync(join(fixture_.stateDirectory, "sessions.json"), "safe");
    mkdirSync(fixture_.backupDirectory);
    writeFileSync(join(fixture_.backupDirectory, "prior.apbackup.json"), "prior");
    writeFileSync(join(fixture_.stateDirectory, ".pending.tmp-123"), "temporary");
    writeFileSync(join(fixture_.stateDirectory, "failed.quarantine"), "quarantine");

    const backup = withStateMaintenanceLock(fixture_.stateDirectory, () =>
      createStateBackup(fixture_.stateDirectory, fixture_.backupDirectory)
    );
    const archive = JSON.parse(readFileSync(backup.path, "utf8")) as { manifest: { path: string }[] };

    expect(archive.manifest.map((entry) => entry.path)).toEqual(["sessions.json"]);
  });

  it("does not overwrite or prune when a backup name collides", () => {
    const fixture_ = fixture();
    writeFileSync(join(fixture_.stateDirectory, "sessions.json"), "safe");
    const now = new Date("2026-07-13T12:00:00.000Z");
    createStateBackup(fixture_.stateDirectory, fixture_.backupDirectory, { now, keep_backups: 20 });
    const before = readdirSync(fixture_.backupDirectory);

    expect(() => createStateBackup(fixture_.stateDirectory, fixture_.backupDirectory, { now, keep_backups: 1 }))
      .toThrow("backup_name_collision");
    expect(readdirSync(fixture_.backupDirectory)).toEqual(before);
  });

  it("does not rotate or prune when backup creation fails", () => {
    const fixture_ = fixture();
    const logPath = join(fixture_.stateDirectory, "audit.jsonl");
    const beforeLog = `${"x".repeat(2 * 1024 * 1024)}\n`;
    writeFileSync(logPath, beforeLog);
    writeFileSync(join(fixture_.stateDirectory, "oversized.bin"), Buffer.alloc(4 * 1024 * 1024 + 1));
    mkdirSync(fixture_.backupDirectory);
    for (let index = 0; index < 8; index += 1) {
      writeFileSync(join(fixture_.backupDirectory, `autopilot-state-old-${index}.apbackup.json`), "existing");
    }

    const result = performStateMaintenance({ ...fixture_, mode: "apply" });

    expect(result).toMatchObject({ ok: false, backup: null, rotated: [] });
    expect(result.findings[0]).toContain("backup_file_too_large");
    expect(readFileSync(logPath, "utf8")).toBe(beforeLog);
    expect(readdirSync(fixture_.backupDirectory)).toHaveLength(8);
  });

  it("does not mutate protected state when another process owns the maintenance lock", () => {
    const fixture_ = fixture();
    const sourcePath = join(fixture_.stateDirectory, "sessions.json");
    const lockDirectory = join(fixture_.stateDirectory, ".state-maintenance.lock");
    writeFileSync(sourcePath, "safe");
    mkdirSync(lockDirectory, { mode: 0o700 });
    writeFileSync(join(lockDirectory, "owner.json"), `${JSON.stringify({
      version: 1,
      token: "active-owner",
      pid: process.pid,
      hostname: hostname(),
      acquired_at: new Date().toISOString()
    })}\n`);

    const result = performStateMaintenance({ ...fixture_, mode: "apply" });
    const spoolDirectory = join(dirname(fixture_.stateDirectory), `.${basename(fixture_.stateDirectory)}-incident-spool`);

    expect(result).toMatchObject({
      ok: false,
      findings: ["maintenance_failed:state_lock_timeout"],
      backup: null,
      rotated: [],
      incident_id: expect.any(String)
    });
    expect(readFileSync(sourcePath, "utf8")).toBe("safe");
    expect(existsSync(fixture_.backupDirectory)).toBe(false);
    expect(readdirSync(spoolDirectory)).toHaveLength(1);
    rmSync(lockDirectory, { recursive: true, force: true });
    rmSync(spoolDirectory, { recursive: true, force: true });
  }, 15_000);
});
