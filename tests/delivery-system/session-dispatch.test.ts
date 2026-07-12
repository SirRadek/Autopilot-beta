import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { prepareGovernedSessionDispatch, skillIdsForHandoff } from "../../src/data/delivery-system/sessionDispatch";
import { createSessionRecord } from "../../src/data/delivery-system/sessionRegistry";
import type { SkillManifest } from "../../src/data/delivery-system/skillRegistry";

const manifest: SkillManifest = {
  schema_version: "v1",
  id: "model-usage",
  version: "0.0.0",
  source: { kind: "git", locator: "https://example.invalid/openclaw", commit_sha: "a".repeat(40) },
  trust: "reviewed",
  triggers: ["model usage"],
  capabilities: ["skill_discovery"],
  required_bins: [],
  required_env: [],
  permissions: { network: false, filesystem: "workspace-read" },
  hot_path: "skills/model-usage/SKILL.md",
  cold_paths: []
};

describe("session dispatch", () => {
  it("routes only after resolving the scoped live session", () => {
    const root = mkdtempSync(join(tmpdir(), "session-dispatch-"));
    const catalog = join(root, "governed.json");
    writeFileSync(catalog, JSON.stringify([manifest]), "utf8");
    const session = createSessionRecord({
      sessionId: "session-1",
      agentCommand: "claude",
      cwd: "/workspace/project",
      name: "manager",
      now: "2026-07-10T15:00:00.000Z"
    });

    const plan = prepareGovernedSessionDispatch({
      sessions: [session],
      scope: { agentCommand: "claude", cwd: "/workspace/project", name: "manager" },
      task: "show model usage",
      catalogPaths: [catalog],
      now: "2026-07-10T15:01:00.000Z"
    });

    expect(plan.session.session_id).toBe("session-1");
    expect(plan.route.skillManifests.map((item) => item.id)).toEqual(["model-usage"]);
    expect(plan.skillIds).toEqual(["model-usage"]);
    expect(skillIdsForHandoff(plan, ["model-usage", "model-usage"])).toEqual(["model-usage"]);
    expect(() => skillIdsForHandoff(plan, ["untrusted-skill"])).toThrow("skill_not_in_governed_route");
  });

  it("fails closed for an expired or missing session", () => {
    const root = mkdtempSync(join(tmpdir(), "session-dispatch-"));
    const catalog = join(root, "governed.json");
    writeFileSync(catalog, JSON.stringify([manifest]), "utf8");
    const expired = createSessionRecord({
      sessionId: "session-1",
      agentCommand: "claude",
      cwd: "/workspace/project",
      ownerExpiresAt: "2026-07-10T14:00:00.000Z"
    });

    expect(() => prepareGovernedSessionDispatch({
      sessions: [expired],
      scope: { agentCommand: "claude", cwd: "/workspace/project" },
      task: "show model usage",
      catalogPaths: [catalog],
      now: "2026-07-10T15:01:00.000Z"
    })).toThrow("session_owner_expired");
    expect(() => prepareGovernedSessionDispatch({
      sessions: [],
      scope: { agentCommand: "claude", cwd: "/workspace/project" },
      task: "show model usage",
      catalogPaths: [catalog],
      now: "2026-07-10T15:01:00.000Z"
    })).toThrow("session_not_found");
  });
});
