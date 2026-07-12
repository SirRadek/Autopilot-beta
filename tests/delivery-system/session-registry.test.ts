import { describe, expect, it } from "vitest";

import {
  cancelSession,
  createSessionRecord,
  enqueuePrompt,
  isSessionOwnerExpired,
  resumeSession,
  selectScopedSession,
  type SessionRegistryRecord
} from "../../src/data/delivery-system/sessionRegistry";

const NOW = "2026-07-10T16:00:00.000Z";

describe("session registry", () => {
  it("selects the active session by agent, project scope, and optional name", () => {
    const sessions = [
      createSessionRecord({ sessionId: "api", agentCommand: "codex", cwd: "/repo", now: NOW }),
      createSessionRecord({ sessionId: "docs", agentCommand: "codex", cwd: "/repo", name: "docs", now: NOW }),
      createSessionRecord({ sessionId: "other", agentCommand: "agy", cwd: "/repo", now: NOW })
    ];

    expect(selectScopedSession(sessions, { agentCommand: "codex", cwd: "/repo" })?.session_id).toBe("api");
    expect(selectScopedSession(sessions, { agentCommand: "codex", cwd: "/repo", name: "docs" })?.session_id).toBe("docs");
    expect(selectScopedSession(sessions, { agentCommand: "claude", cwd: "/repo" })).toBeNull();
  });

  it("queues prompts without losing existing queue order", () => {
    const session = createSessionRecord({ sessionId: "api", agentCommand: "codex", cwd: "/repo", now: NOW });
    const queued = enqueuePrompt(enqueuePrompt(session, "p1", NOW), "p2", NOW);

    expect(queued.queue).toEqual([
      { prompt_id: "p1", queued_at: NOW },
      { prompt_id: "p2", queued_at: NOW }
    ]);
    expect(queued.updated_at).toBe(NOW);
  });

  it("expires owners and supports cancel followed by explicit resume", () => {
    const session = createSessionRecord({
      sessionId: "api",
      agentCommand: "codex",
      cwd: "/repo",
      ownerExpiresAt: "2026-07-10T15:59:00.000Z",
      now: NOW
    });

    expect(isSessionOwnerExpired(session, NOW)).toBe(true);
    const cancelled = cancelSession(session, "operator_cancelled", NOW);
    expect(cancelled.status).toBe("closed");
    expect(cancelled.close_reason).toBe("operator_cancelled");
    expect(resumeSession(cancelled, NOW).status).toBe("active");
  });
});
