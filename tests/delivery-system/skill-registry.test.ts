import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadSkill,
  importSkillFromGit,
  discoverSkillManifest,
  curateSkillManifests,
  loadGovernedSkillCatalog,
  selectSkillManifestsForTask,
  verifySkillSourceCommit,
  validateSkillManifest,
  type SkillManifest
} from "../../src/data/delivery-system/skillRegistry";
import { selectGovernedToolsForTask } from "../../src/data/delivery-system/toolInventory";

const baseManifest: SkillManifest = {
  schema_version: "v1",
  id: "example",
  version: "1.0.0",
  source: { kind: "local", locator: "skills/example", commit_sha: null },
  trust: "approved",
  triggers: ["example task"],
  capabilities: ["read_repo"],
  required_bins: [],
  required_env: [],
  permissions: { network: false, filesystem: "workspace-read" },
  hot_path: "SKILL.md",
  cold_paths: ["references/details.md"]
};

describe("skill registry", () => {
  it("rejects incomplete manifests before activation", () => {
    expect(validateSkillManifest({ ...baseManifest, id: "" })).toContain("id");
    expect(validateSkillManifest({ ...baseManifest, version: "latest" })).toContain("version");
  });

  it("loads the hot skill path and keeps cold references lazy", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-registry-"));
    writeFileSync(join(root, "SKILL.md"), "# Hot instructions\n", "utf8");
    writeFileSync(join(root, "references-details.md"), "cold", "utf8");

    const loaded = loadSkill(root, baseManifest);

    expect(loaded).toEqual({
      manifest: baseManifest,
      hot_content: "# Hot instructions\n",
      cold_content: {}
    });
  });

  it("refuses unverified skills unless explicitly admitted", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-registry-"));
    writeFileSync(join(root, "SKILL.md"), "# Unverified\n", "utf8");
    const manifest = { ...baseManifest, trust: "unverified" as const };

    expect(() => loadSkill(root, manifest)).toThrow("skill_not_trusted");
    expect(loadSkill(root, manifest, { allowedTrust: ["unverified"] }).manifest.trust).toBe("unverified");
  });

  it("matches only trusted skills by trigger or capability", () => {
    const result = selectSkillManifestsForTask("run an example task", [
      baseManifest,
      { ...baseManifest, id: "untrusted", trust: "unverified" as const, triggers: ["example task"] },
      { ...baseManifest, id: "other", triggers: ["unrelated"] }
    ]);

    expect(result.map((manifest) => manifest.id)).toEqual(["example"]);
  });

  it("returns tool inventory and trusted skill matches through one route", () => {
    const route = selectGovernedToolsForTask({ task: "run an example task" }, [baseManifest]);

    expect(route.skillManifests.map((manifest) => manifest.id)).toEqual(["example"]);
    expect(route.matchingItems).toContain("local_core_skills");
  });

  it("requires a pinned commit for remote skill sources", () => {
    const remote = {
      ...baseManifest,
      source: { kind: "git" as const, locator: "https://github.com/example/skill", commit_sha: "a".repeat(40) }
    };

    expect(verifySkillSourceCommit(remote, "a".repeat(40))).toEqual({ status: "verified" });
    expect(verifySkillSourceCommit(remote, "b".repeat(40))).toEqual({
      status: "mismatch",
      expected: "a".repeat(40),
      actual: "b".repeat(40)
    });
    expect(() => verifySkillSourceCommit({ ...remote, source: { ...remote.source, commit_sha: null } }, "a".repeat(40)))
      .toThrow("skill_source_unpinned");
  });

  it("enforces the source pin during remote skill loading", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-registry-"));
    writeFileSync(join(root, "SKILL.md"), "# Remote\n", "utf8");
    const remote = {
      ...baseManifest,
      source: { kind: "git" as const, locator: "https://github.com/example/skill", commit_sha: "a".repeat(40) }
    };

    expect(() => loadSkill(root, remote)).toThrow("skill_source_unpinned");
    expect(() => loadSkill(root, remote, { sourceCommitSha: "b".repeat(40) })).toThrow("skill_source_mismatch");
    expect(loadSkill(root, remote, { sourceCommitSha: "a".repeat(40) }).manifest.id).toBe("example");
  });

  it("imports a local git skill only at the pinned commit", () => {
    const source = mkdtempSync(join(tmpdir(), "skill-source-"));
    const staging = mkdtempSync(join(tmpdir(), "skill-staging-"));
    mkdirSync(join(source, "references"));
    writeFileSync(join(source, "SKILL.md"), "# Imported\n", "utf8");
    writeFileSync(join(source, "references", "details.md"), "details", "utf8");
    writeFileSync(join(source, "skill.manifest.json"), JSON.stringify({
      ...baseManifest,
      source: { kind: "git", locator: source, commit_sha: null }
    }), "utf8");
    execFileSync("git", ["-C", source, "init", "-q"]);
    execFileSync("git", ["-C", source, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", source, "config", "user.name", "Test"]);
    execFileSync("git", ["-C", source, "add", "."]);
    execFileSync("git", ["-C", source, "commit", "-qm", "initial"]);
    const commit = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const imported = importSkillFromGit(source, commit, staging);

    expect(imported.manifest.id).toBe("example");
    expect(imported.source_commit_sha).toBe(commit);
    expect(imported.loaded.hot_content).toBe("# Imported\n");
  });

  it("discovers OpenClaw-style frontmatter as unverified and read-only", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-discovery-"));
    mkdirSync(join(root, "skills", "coding-agent"), { recursive: true });
    writeFileSync(join(root, "skills", "coding-agent", "SKILL.md"), [
      "---",
      "name: coding-agent",
      "description: Delegate coding work to Codex or Claude Code.",
      "metadata:",
      "  openclaw:",
      "    requires:",
      "      bins: [codex, claude]",
      "      env: [OPENROUTER_API_KEY]",
      "---",
      "# Coding agent",
      ""
    ].join("\n"), "utf8");

    const manifest = discoverSkillManifest(root, {
      sourceLocator: "https://github.com/openclaw/openclaw",
      sourceCommitSha: "a".repeat(40),
      relativeSkillPath: "skills/coding-agent"
    });

    expect(manifest).toEqual({
      schema_version: "v1",
      id: "coding-agent",
      version: "0.0.0",
      source: {
        kind: "git",
        locator: "https://github.com/openclaw/openclaw",
        commit_sha: "a".repeat(40)
      },
      trust: "unverified",
      triggers: ["coding-agent"],
      capabilities: ["skill_discovery", "requires:codex", "requires:claude"],
      required_bins: ["codex", "claude"],
      required_env: ["OPENROUTER_API_KEY"],
      permissions: { network: false, filesystem: "workspace-read" },
      hot_path: "skills/coding-agent/SKILL.md",
      cold_paths: []
    });
  });

  it("promotes only an explicitly pinned curation rule", () => {
    const curated = curateSkillManifests([baseManifest, {
      ...baseManifest,
      id: "other",
      source: { kind: "git", locator: "https://example.invalid/skills", commit_sha: "b".repeat(40) }
    }], [{ id: "example", sourceCommitSha: "a".repeat(40), trust: "reviewed" }]);

    expect(curated).toHaveLength(0);
    expect(curateSkillManifests([{
      ...baseManifest,
      source: { kind: "git", locator: "https://example.invalid/skills", commit_sha: "a".repeat(40) }
    }], [{ id: "example", sourceCommitSha: "a".repeat(40), trust: "reviewed" }])[0]?.trust).toBe("reviewed");
  });

  it("loads only reviewed or approved pinned catalogs", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-catalog-"));
    const manifest = {
      ...baseManifest,
      source: { kind: "git" as const, locator: "https://example.invalid/skills", commit_sha: "a".repeat(40) },
      trust: "reviewed" as const
    };
    const path = join(root, "governed.json");
    writeFileSync(path, JSON.stringify([manifest]), "utf8");
    expect(loadGovernedSkillCatalog([path])).toEqual([manifest]);
    writeFileSync(path, JSON.stringify([{ ...manifest, trust: "unverified" }]), "utf8");
    expect(() => loadGovernedSkillCatalog([path])).toThrow("skill_catalog_rejected");
  });
});
