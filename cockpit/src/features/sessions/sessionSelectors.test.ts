import { describe, expect, it } from "vitest";

import type { SessionRecord } from "../../types/controlPlane";
import { groupSessionsByProject, getSessionDisplayState } from "./sessionSelectors";

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  session_id: "s-1", agent_command: "claude_cli", cwd: "/work/alpha", name: "Manager", status: "active",
  created_at: "2026-07-11T09:00:00.000Z", updated_at: "2026-07-11T09:00:00.000Z", owner_expires_at: "2026-07-11T10:00:00.000Z", queue: [], ...overrides,
});

describe("session selectors", () => {
  it("groups sessions by cwd and exposes active, expired, and closed states", () => {
    const groups = groupSessionsByProject([
      session(),
      session({ session_id: "s-2", name: null, owner_expires_at: "2026-07-11T08:00:00.000Z" }),
      session({ session_id: "s-3", status: "closed", close_reason: "done" }),
      session({ session_id: "s-4", cwd: "/work/beta", name: "Research" }),
    ], new Date("2026-07-11T09:30:00.000Z"));

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ cwd: "/work/alpha", label: "alpha", active: [expect.objectContaining({ session_id: "s-1" })], expired: [expect.objectContaining({ session_id: "s-2" })], closed: [expect.objectContaining({ session_id: "s-3" })] });
    expect(groups[1]?.active.map(({ session_id }) => session_id)).toEqual(["s-4"]);
  });

  it("marks an active session with no expiry as active and handles empty input", () => {
    expect(getSessionDisplayState(session({ owner_expires_at: null }), new Date())).toBe("active");
    expect(groupSessionsByProject([])).toEqual([]);
  });
});
