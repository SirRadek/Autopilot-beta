import { describe, expect, it } from "vitest";

import {
  DEFAULT_VENDOR_ARTIFACT_TTL_DAYS,
  filesToPurge
} from "../../src/data/delivery-system/cliWorkerCapture";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("vendor artifact TTL selection", () => {
  it("returns only files older than the TTL", () => {
    const now = Date.parse("2026-07-06T12:00:00.000Z");
    const ttlMs = DEFAULT_VENDOR_ARTIFACT_TTL_DAYS * MS_PER_DAY;

    expect(filesToPurge([
      { path: "stale.md", mtimeMs: now - ttlMs - 1 },
      { path: "boundary.md", mtimeMs: now - ttlMs },
      { path: "fresh.md", mtimeMs: now - ttlMs + 1 }
    ], ttlMs, now)).toEqual(["stale.md"]);
  });
});
