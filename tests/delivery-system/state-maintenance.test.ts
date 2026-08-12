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
import { performStateMaintenance, scanOperationalSecrets } from "../../src/data/delivery-system/stateMaintenance";
import { withStateMaintenanceLock } from "../../src/data/delivery-system/stateMaintenanceLock";
import { restoreStateBackup } from "../../src/data/delivery-system/stateRecovery";
import { authStateRoot } from "../../src/data/delivery-system/authSessionRegistry";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "autopilot-maintenance-"));
  const stateDirectory = join(root, "state");
  const backupDirectory = join(stateDirectory, "backups");
  const environmentFile = join(root, "control-plane.env");
  mkdirSync(stateDirectory, { mode: 0o700 });
  writeFileSync(environmentFile, "AUTOPILOT_STATE_DIR=/state\n", { mode: 0o600 });
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

  it("retires recognized environment backups before apply preflight", () => {
    const fixture_ = fixture();
    mkdirSync(fixture_.backupDirectory);
    const marker = `${["CONTROL", "PLANE", "TOKEN"].join("_")}=${["fixture", "only", "value"].join("-")}`;
    const legacyBackup = join(fixture_.backupDirectory, "control-plane.env.20260812T120000Z.bak");
    const unrecognizedBackup = join(fixture_.backupDirectory, "control-plane.env.manual.bak");
    writeFileSync(legacyBackup, `${marker}\n`, { mode: 0o600 });
    writeFileSync(unrecognizedBackup, "review manually\n", { mode: 0o600 });
    writeFileSync(join(fixture_.stateDirectory, "sessions.json"), "safe", { mode: 0o600 });

    const dryRun = performStateMaintenance({ ...fixture_, mode: "dry_run" });
    expect(dryRun).toMatchObject({ ok: false, findings: ["secret:environment_credential"] });
    expect(existsSync(legacyBackup)).toBe(true);

    const result = performStateMaintenance({ ...fixture_, mode: "apply" });

    expect(result).toMatchObject({ ok: true, mode: "apply", findings: [], incident_id: null });
    expect(existsSync(legacyBackup)).toBe(false);
    expect(existsSync(unrecognizedBackup)).toBe(true);
    expect(result.backup?.valid).toBe(true);
    expect(validateStateBackup(result.backup!.path).valid).toBe(true);
  });

  it("does not retire legacy environment backups before permission preflight passes", () => {
    const fixture_ = fixture();
    mkdirSync(fixture_.backupDirectory);
    const legacyBackup = join(fixture_.backupDirectory, "control-plane.env.20260812T120000Z.bak");
    writeFileSync(legacyBackup, "review only\n", { mode: 0o600 });
    chmodSync(fixture_.stateDirectory, 0o755);

    const result = performStateMaintenance({ ...fixture_, mode: "apply" });

    expect(result).toMatchObject({ ok: false, findings: ["state_dir_permissions"], backup: null });
    expect(existsSync(legacyBackup)).toBe(true);
  });

  it("scans disguised snapshots and quarantines while skipping a canonical backup header", () => {
    const fixture_ = fixture();
    writeFileSync(join(fixture_.stateDirectory, "sessions.json"), "safe", { mode: 0o600 });
    createStateBackup(fixture_.stateDirectory, fixture_.backupDirectory, { keep_backups: 20 });
    const marker = `${["CONTROL", "PLANE", "TOKEN"].join("_")}=${["fixture", "only", "value"].join("-")}`;
    const nestedBackupDirectory = join(fixture_.backupDirectory, "nested");
    mkdirSync(nestedBackupDirectory);
    writeFileSync(
      join(fixture_.backupDirectory, "autopilot-state-disguised.apbackup.json"),
      `${marker}\n`,
      { mode: 0o600 }
    );
    writeFileSync(
      join(nestedBackupDirectory, "autopilot-state-disguised.apbackup.json"),
      `${marker}\n`,
      { mode: 0o600 }
    );
    writeFileSync(
      join(fixture_.backupDirectory, "autopilot-state-broken.apbackup.json.quarantine"),
      `${marker}\n`,
      { mode: 0o600 }
    );

    const findings = scanOperationalSecrets(fixture_.stateDirectory);

    expect(findings).toEqual([
      { file: "backups/autopilot-state-broken.apbackup.json.quarantine", rule: "environment_credential" },
      { file: "backups/autopilot-state-disguised.apbackup.json", rule: "environment_credential" },
      { file: "backups/nested/autopilot-state-disguised.apbackup.json", rule: "environment_credential" }
    ]);
  });

  it.each([
    ["bare token name", `${["TOK", "EN"].join("")}=${["fixture", "value", "123"].join("-")}\n`],
    ["bare secret name", `${["SEC", "RET"].join("")}=${["fixture", "value", "123"].join("-")}\n`],
    ["bare password name", `${["PASS", "WORD"].join("")}=${["fixture", "value", "123"].join("-")}\n`],
    ["exported service token", `export ${["SERVICE", "TOKEN"].join("_")}=${["fixture", "value", "123"].join("-")}\n`],
    ["CRLF assignment", `${["SERVICE", "SECRET"].join("_")}=${["fixture", "value", "123"].join("-")}\r\n`]
  ])("detects environment credentials with %s", (_description, assignment) => {
    const fixture_ = fixture();
    writeFileSync(join(fixture_.stateDirectory, "credential.txt"), assignment, { mode: 0o600 });

    expect(scanOperationalSecrets(fixture_.stateDirectory)).toEqual([
      { file: "credential.txt", rule: "environment_credential" }
    ]);
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

  it("excludes the auth state root and restore cannot resurrect sessions or service tokens", () => {
    const fixture_ = fixture();
    writeFileSync(join(fixture_.stateDirectory, "sessions.json"), "managed");
    const authRoot = authStateRoot(fixture_.stateDirectory);
    mkdirSync(authRoot, { mode: 0o700 });
    writeFileSync(join(authRoot, "sessions.json"), "logged-in-session", { mode: 0o600 });
    writeFileSync(join(authRoot, "service-token.json"), "stale-service-digest", { mode: 0o600 });

    const backup = createStateBackup(fixture_.stateDirectory, fixture_.backupDirectory);
    const archive = JSON.parse(readFileSync(backup.path, "utf8")) as { manifest: { path: string }[] };
    const restoreDirectory = join(fixture_.root, "restored-without-auth");
    restoreStateBackup(backup.path, restoreDirectory, { apply: true });

    expect(archive.manifest.map((entry) => entry.path)).toEqual(["sessions.json"]);
    expect(existsSync(authStateRoot(restoreDirectory))).toBe(false);
  });

  it("rejects legacy or crafted archives containing auth-root entries", () => {
    const fixture_ = fixture();
    writeFileSync(join(fixture_.stateDirectory, "sessions.json"), "stale-auth-record");
    const backup = createStateBackup(fixture_.stateDirectory, fixture_.backupDirectory);
    const archive = JSON.parse(readFileSync(backup.path, "utf8")) as {
      manifest: Array<{ path: string }>;
      files: Array<{ path: string }>;
    };
    archive.manifest[0]!.path = "auth/sessions.json";
    archive.files[0]!.path = "auth/sessions.json";
    writeFileSync(backup.path, JSON.stringify(archive), { mode: 0o600 });
    const restoreDirectory = join(fixture_.root, "crafted-auth-restore");

    expect(validateStateBackup(backup.path).valid).toBe(false);
    expect(() => restoreStateBackup(backup.path, restoreDirectory, { apply: true }))
      .toThrow(/backup_validation_failed/);
    expect(existsSync(authStateRoot(restoreDirectory))).toBe(false);
  });

  it.each([
    "padding/../auth/service-token.json",
    "./auth/sessions.json"
  ])("rejects non-canonical archive paths that alias the auth root: %s", (craftedPath) => {
    const fixture_ = fixture();
    writeFileSync(join(fixture_.stateDirectory, "sessions.json"), "stale-auth-record");
    const backup = createStateBackup(fixture_.stateDirectory, fixture_.backupDirectory);
    const archive = JSON.parse(readFileSync(backup.path, "utf8")) as {
      manifest: Array<{ path: string }>;
      files: Array<{ path: string }>;
    };
    archive.manifest[0]!.path = craftedPath;
    archive.files[0]!.path = craftedPath;
    writeFileSync(backup.path, JSON.stringify(archive), { mode: 0o600 });
    const restoreDirectory = join(fixture_.root, "crafted-auth-alias-restore");

    expect(validateStateBackup(backup.path).valid).toBe(false);
    expect(() => restoreStateBackup(backup.path, restoreDirectory, { apply: true }))
      .toThrow(/backup_validation_failed/);
    expect(existsSync(authStateRoot(restoreDirectory))).toBe(false);
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
