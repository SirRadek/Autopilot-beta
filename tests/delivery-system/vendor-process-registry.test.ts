import { describe, expect, it } from "vitest";

import {
  buildVendorProcessRecord,
  killVendorProcess,
  parseVendorProcessRegistryLines,
  selectOrphanedVendorPids,
  type VendorProcessRecord
} from "../../src/data/delivery-system/cliWorkerCapture";

const NOW_MS = Date.parse("2026-07-06T12:00:00.000Z");
const MAX_AGE_MS = 30 * 60_000;

function record(
  event: VendorProcessRecord["event"],
  pid: number,
  ageMs: number,
  workerRunId = "cli-agy-hp-test-20260706T120000"
): VendorProcessRecord {
  return buildVendorProcessRecord({
    recordedAt: new Date(NOW_MS - ageMs).toISOString(),
    event,
    pid,
    workerRunId
  });
}

function select(records: readonly VendorProcessRecord[], alivePids: readonly number[]): readonly number[] {
  const alive = new Set(alivePids);
  return selectOrphanedVendorPids({
    records,
    nowMs: NOW_MS,
    maxAgeMs: MAX_AGE_MS,
    isPidAlive: (pid) => alive.has(pid)
  });
}

describe("vendor process registry orphan selection", () => {
  it("does not return a spawned process with a later exited record", () => {
    const spawned = record("spawned", 1234, MAX_AGE_MS + 1);
    const exited = buildVendorProcessRecord({
      recordedAt: new Date(NOW_MS - 1).toISOString(),
      event: "exited",
      pid: spawned.pid,
      workerRunId: spawned.worker_run_id
    });

    expect(select([spawned, exited], [1234])).toEqual([]);
  });

  it("returns spawned-only old live pids", () => {
    expect(select([record("spawned", 1235, MAX_AGE_MS + 1)], [1235])).toEqual([1235]);
  });

  it("does not return old pids that are no longer alive", () => {
    expect(select([record("spawned", 1236, MAX_AGE_MS + 1)], [])).toEqual([]);
  });

  it("does not return young pids", () => {
    expect(select([record("spawned", 1237, MAX_AGE_MS - 1)], [1237])).toEqual([]);
  });

  it("does not return pids exactly at the age boundary", () => {
    expect(select([record("spawned", 1238, MAX_AGE_MS)], [1238])).toEqual([]);
  });

  it("dedupes duplicate spawned records for the same pid", () => {
    expect(select([
      record("spawned", 1239, MAX_AGE_MS + 2),
      record("spawned", 1239, MAX_AGE_MS + 1)
    ], [1239])).toEqual([1239]);
  });

  it("skips malformed registry lines through the parser helper", () => {
    const valid = record("spawned", 1240, MAX_AGE_MS + 1);
    const parsed = parseVendorProcessRegistryLines([
      "not-json",
      JSON.stringify({ ...valid, pid: "not-a-number" }),
      JSON.stringify(valid),
      ""
    ].join("\n"));

    expect(parsed).toEqual([valid]);
    expect(select(parsed, [1240])).toEqual([1240]);
  });
});

describe("vendor process registry records", () => {
  it("builds a redacted agy spawned record", () => {
    const built = buildVendorProcessRecord({
      recordedAt: "2026-07-06T12:00:00.000Z",
      event: "spawned",
      pid: 4321,
      workerRunId: "cli-agy-hp-test-20260706T120000"
    });

    expect(built).toEqual({
      schema_version: "v1",
      recorded_at: "2026-07-06T12:00:00.000Z",
      event: "spawned",
      vendor: "agy_cli",
      pid: 4321,
      worker_run_id: "cli-agy-hp-test-20260706T120000"
    });
    expect(typeof built.pid).toBe("number");
    expect("prompt" in built).toBe(false);
    expect("rawOutput" in built).toBe(false);
    expect("cleanOutput" in built).toBe(false);
  });
});

describe("vendor process killer", () => {
  it("returns false and does not throw for a bogus pid", () => {
    let result = true;

    expect(() => {
      result = killVendorProcess(999_999_999);
    }).not.toThrow();
    expect(result).toBe(false);
  });
});
