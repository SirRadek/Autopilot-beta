import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  restoreStateBackup,
  createStateBackup,
  pruneOperationalBackups,
  rotateStateLogs,
  scanOperationalSecrets,
  validateStateBackup,
  verifyOperationalPermissions
} from "../../src/data/delivery-system/operationalHardening";

function fixture(): string {
  return mkdtempSync(join(tmpdir(), "autopilot-ops-"));
}

describe("operational hardening", () => {
  it("creates an atomic bounded backup with a verifiable checksum manifest", () => {
    const root = fixture();
    const state = join(root, "state");
    const backups = join(root, "backups");
    mkdirSync(state, { mode: 0o700 });
    writeFileSync(join(state, "sessions.json"), "{\"sessions\":[]}", { mode: 0o600 });

    const result = createStateBackup(state, backups, { now: new Date("2026-07-12T10:00:00Z") });

    expect(result.file_count).toBe(1);
    expect(result.total_bytes).toBe(15);
    expect(result.path.endsWith(".apbackup.json")).toBe(true);
    expect(statSync(result.path).mode & 0o777).toBe(0o600);
    expect(validateStateBackup(result.path)).toEqual({ valid: true, file_count: 1, total_bytes: 15, errors: [] });
  });

  it("caps retained state backups", () => {
    const root = fixture();
    const state = join(root, "state");
    const backups = join(root, "backups");
    mkdirSync(state);
    writeFileSync(join(state, "sessions.json"), "safe");
    for (let index = 0; index < 5; index += 1) {
      createStateBackup(state, backups, { now: new Date(1_700_000_000_000 + index * 1_000), keep_backups: 3 });
    }

    expect(readdirSync(backups).filter((name) => name.endsWith(".apbackup.json"))).toHaveLength(3);
  });

  it("retains seven state snapshots and no environment backups by default", () => {
    const root = fixture();
    const backups = join(root, "backups");
    mkdirSync(backups);
    for (let index = 0; index < 8; index += 1) {
      writeFileSync(join(backups, `autopilot-state-${index}.apbackup.json`), "state");
    }
    writeFileSync(join(backups, "control-plane.env.20260811T120000Z.bak"), "retired");
    writeFileSync(join(backups, "control-plane.env.20260812T120000Z.bak"), "retired");

    const removed = pruneOperationalBackups(backups);

    expect(readdirSync(backups).filter((name) => name.endsWith(".apbackup.json"))).toHaveLength(7);
    expect(readdirSync(backups).filter((name) => name.startsWith("control-plane.env."))).toEqual([]);
    expect(removed).toHaveLength(3);
  });

  it("refuses a backup whose payload no longer matches its manifest", () => {
    const root = fixture();
    const state = join(root, "state");
    mkdirSync(state);
    writeFileSync(join(state, "sessions.json"), "safe");
    const result = createStateBackup(state, join(root, "backups"));
    const archive = JSON.parse(readFileSync(result.path, "utf8"));
    archive.files[0].data = Buffer.from("evil").toString("base64");
    writeFileSync(result.path, JSON.stringify(archive));

    const validation = validateStateBackup(result.path);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain("checksum_mismatch:sessions.json");
    expect(() => restoreStateBackup(result.path, join(root, "restore"), { apply: true })).toThrow(/backup_validation_failed/);
  });

  it("keeps restore validation dry-run by default", () => {
    const root = fixture();
    const state = join(root, "state");
    const target = join(root, "restore");
    mkdirSync(state);
    writeFileSync(join(state, "sessions.json"), "safe");
    const backup = createStateBackup(state, join(root, "backups"));

    const result = restoreStateBackup(backup.path, target);

    expect(result).toEqual({ applied: false, file_count: 1, total_bytes: 4 });
    expect(() => statSync(target)).toThrow();
  });

  it("refuses symlink and non-empty restore targets without touching their contents", () => {
    const root = fixture();
    const state = join(root, "state");
    const live = join(root, "live");
    const symlinkTarget = join(root, "restore-link");
    mkdirSync(state);
    mkdirSync(live);
    writeFileSync(join(state, "sessions.json"), "backup");
    const sentinel = join(live, "sentinel.txt");
    writeFileSync(sentinel, "live-bytes");
    symlinkSync(live, symlinkTarget, "dir");
    const backup = createStateBackup(state, join(root, "backups"));

    expect(() => restoreStateBackup(backup.path, symlinkTarget, { apply: true })).toThrow("unsafe_restore_target");
    expect(() => restoreStateBackup(backup.path, live, { apply: true })).toThrow("restore_target_not_empty");
    expect(readFileSync(sentinel, "utf8")).toBe("live-bytes");
  });

  it("cleans sibling staging when materialization fails before publication", () => {
    const root = fixture();
    const state = join(root, "state");
    const backups = join(root, "backups");
    const target = join(root, "restore");
    mkdirSync(state);
    writeFileSync(join(state, "first.json"), "first");
    writeFileSync(join(state, "second.json"), "second");
    const backup = createStateBackup(state, backups);
    const archive = JSON.parse(readFileSync(backup.path, "utf8"));
    const impossible = "x".repeat(300);
    archive.manifest[1].path = impossible;
    archive.files[1].path = impossible;
    writeFileSync(backup.path, JSON.stringify(archive));

    expect(() => restoreStateBackup(backup.path, target, { apply: true })).toThrow();
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(root).filter((name) => name.startsWith(".restore-staging-"))).toEqual([]);
  });

  it("rejects non-canonical base64 even when decoded bytes match the manifest", () => {
    const root = fixture();
    const state = join(root, "state");
    mkdirSync(state);
    writeFileSync(join(state, "sessions.json"), "safe");
    const backup = createStateBackup(state, join(root, "backups"));
    const archive = JSON.parse(readFileSync(backup.path, "utf8"));
    archive.files[0].data = `${archive.files[0].data}====`;
    writeFileSync(backup.path, JSON.stringify(archive));

    expect(validateStateBackup(backup.path)).toMatchObject({ valid: false });
  });

  it("publishes a complete restore with private directory and file permissions", () => {
    const root = fixture();
    const state = join(root, "state");
    const target = join(root, "restore");
    mkdirSync(state);
    mkdirSync(target);
    writeFileSync(join(state, "sessions.json"), "safe");
    const backup = createStateBackup(state, join(root, "backups"));

    const result = restoreStateBackup(backup.path, target, { apply: true });

    expect(result).toEqual({ applied: true, file_count: 1, total_bytes: 4 });
    expect(readFileSync(join(target, "sessions.json"), "utf8")).toBe("safe");
    expect(statSync(target).mode & 0o777).toBe(0o700);
    expect(statSync(join(target, "sessions.json")).mode & 0o777).toBe(0o600);
    expect(readdirSync(root).filter((name) => name.startsWith(".restore-staging-"))).toEqual([]);
  });

  it("rejects duplicate archive paths", () => {
    const root = fixture();
    const state = join(root, "state");
    mkdirSync(state);
    writeFileSync(join(state, "first.json"), "same");
    writeFileSync(join(state, "second.json"), "same");
    const backup = createStateBackup(state, join(root, "backups"));
    const archive = JSON.parse(readFileSync(backup.path, "utf8"));
    archive.manifest[1].path = archive.manifest[0].path;
    archive.files[1].path = archive.files[0].path;
    writeFileSync(backup.path, JSON.stringify(archive));

    expect(validateStateBackup(backup.path)).toMatchObject({ valid: false });
  });

  it("rotates complete JSONL records and enforces archive count", () => {
    const root = fixture();
    const log = join(root, "audit.jsonl");
    writeFileSync(log, `${Array.from({ length: 20 }, (_, index) => JSON.stringify({ index })).join("\n")}\n`);

    for (let index = 0; index < 4; index += 1) rotateStateLogs(root, { max_bytes: 80, keep_archives: 2 });

    const current = readFileSync(log, "utf8");
    expect(current.startsWith("{")).toBe(true);
    expect(current.endsWith("\n")).toBe(true);
    expect(resultFiles(root).filter((name) => name.startsWith("audit.jsonl.")).length).toBeLessThanOrEqual(2);
    expect(resultFiles(root).filter((name) => name.startsWith("audit.jsonl.")).every((name) => statSync(join(root, name)).size <= 80)).toBe(true);
  });

  it("rotates a sparse oversized log without retaining an unbounded archive", () => {
    const root = fixture();
    const path = join(root, "huge.jsonl");
    const descriptor = openSync(path, "w");
    writeSync(descriptor, Buffer.from('{"tail":true}\n'), 0, 14, 16 * 1024 * 1024);
    closeSync(descriptor);

    rotateStateLogs(root, { max_bytes: 1_024, keep_archives: 1 });

    expect(statSync(path).size).toBeLessThanOrEqual(1_024);
    expect(resultFiles(root).filter((name) => name.endsWith(".archive")).every((name) => statSync(join(root, name)).size <= 1_024)).toBe(true);
  });

  it("detects secret-like state content without returning the secret", () => {
    const root = fixture();
    writeFileSync(join(root, "event.jsonl"), '{"authorization":"Bearer top-secret-token-value"}\n');

    const findings = scanOperationalSecrets(root);

    expect(findings).toEqual([{ file: "event.jsonl", rule: "bearer_token" }]);
    expect(JSON.stringify(findings)).not.toContain("top-secret-token-value");
  });

  it("scans the bounded tail of an oversized state file for secrets", () => {
    const root = fixture();
    writeFileSync(join(root, "large.log"), `${"x".repeat(2 * 1024 * 1024 + 10)}\nAuthorization: Bearer tail-secret-token\n`);

    expect(scanOperationalSecrets(root)).toContainEqual({ file: "large.log", rule: "bearer_token" });
  });

  it("requires private state and environment permissions", () => {
    const root = fixture();
    const state = join(root, "state");
    const environment = join(root, "control-plane.env");
    mkdirSync(state, { mode: 0o755 });
    writeFileSync(environment, "AUTOPILOT_STATE_DIR=/state\n", { mode: 0o644 });
    chmodSync(state, 0o755);
    chmodSync(environment, 0o644);

    expect(verifyOperationalPermissions(state, environment).map((finding) => finding.code)).toEqual([
      "state_dir_permissions",
      "environment_file_permissions"
    ]);
  });
});

function resultFiles(directory: string): string[] {
  return readdirSync(directory);
}
