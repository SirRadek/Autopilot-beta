import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

interface ProfileResult {
  readonly backup?: string;
  readonly model_changed: boolean;
  readonly reasoning_changed: boolean;
  readonly remove_service_tier_fast: boolean;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const profileScript = join(repoRoot, "scripts/codex-efficiency-profile.mjs");
const manifest = JSON.parse(
  readFileSync(join(repoRoot, "ops/codex-efficiency/default-skill-profile.json"), "utf8")
) as {
  disable_plugin_prefixes: string[];
  disable_exact_skills: string[];
};
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Codex efficiency profile", () => {
  it("plans removal of Fast without changing model or reasoning", () => {
    const home = fakeHome();
    const before = readFileSync(join(home, "config.toml"), "utf8");

    const plan = runProfile("plan", home);

    expect(plan).toMatchObject({
      remove_service_tier_fast: true,
      model_changed: false,
      reasoning_changed: false
    });
    expect(readFileSync(join(home, "config.toml"), "utf8")).toBe(before);
  });

  it("applies atomically and records a mode-0600 backup", () => {
    const home = fakeHome();
    const configPath = join(home, "config.toml");

    const result = runProfile("apply", home);
    const applied = readFileSync(configPath, "utf8");

    expect(applied).not.toContain('service_tier = "fast"');
    expect(applied).toContain('model = "gpt-5.6-sol"');
    expect(applied).toContain('model_reasoning_effort = "medium"');
    expect(applied).toContain("# BEGIN AUTOPILOT CODEX EFFICIENCY PROFILE");
    expect(result.backup).toBeTypeOf("string");
    expect(statSync(result.backup!).mode & 0o777).toBe(0o600);
  });

  it("refuses rollback after foreign config modification", () => {
    const home = fakeHome();
    const configPath = join(home, "config.toml");
    const applied = runProfile("apply", home);
    appendFileSync(configPath, "# foreign\n");

    expect(() => runProfile("rollback", home, applied.backup)).toThrow(/config_cas_mismatch/);
  });

  it("restores the exact original config when the applied hash still matches", () => {
    const home = fakeHome();
    const configPath = join(home, "config.toml");
    const original = readFileSync(configPath, "utf8");
    const applied = runProfile("apply", home);

    runProfile("rollback", home, applied.backup);

    expect(readFileSync(configPath, "utf8")).toBe(original);
  });

  it("refuses duplicate Fast lines and existing profile markers", () => {
    const duplicateHome = fakeHome();
    appendFileSync(join(duplicateHome, "config.toml"), 'service_tier = "fast"\n');
    expect(() => runProfile("plan", duplicateHome)).toThrow(/duplicate_fast_line/);

    const markedHome = fakeHome();
    appendFileSync(join(markedHome, "config.toml"), "# BEGIN AUTOPILOT CODEX EFFICIENCY PROFILE\n");
    expect(() => runProfile("plan", markedHome)).toThrow(/profile_marker_exists/);
  });

  it("refuses missing selected skills and symlink configs", () => {
    const missingSkillHome = fakeHome();
    rmSync(join(missingSkillHome, "plugins/cache/openai-curated-remote/teams"), {
      recursive: true,
      force: true
    });
    expect(() => runProfile("plan", missingSkillHome)).toThrow(/skill_path_ambiguous/);

    const symlinkHome = fakeHome();
    const configPath = join(symlinkHome, "config.toml");
    const targetPath = join(symlinkHome, "real-config.toml");
    writeFileSync(targetPath, readFileSync(configPath));
    unlinkSync(configPath);
    symlinkSync(targetPath, configPath);
    expect(() => runProfile("plan", symlinkHome)).toThrow(/config_not_regular_file/);
  });

  it("refuses Codex versions older than the documented profile contract", () => {
    const home = fakeHome();
    writeFileSync(join(dirname(home), "bin/codex"), '#!/bin/sh\nprintf "codex-cli 0.144.3\\n"\n', { mode: 0o700 });

    expect(() => runProfile("plan", home)).toThrow(/codex_version_too_old/);
  });
});

function fakeHome(): string {
  const root = mkdtempSync(join(tmpdir(), "codex-efficiency-profile-"));
  tempRoots.push(root);
  const home = join(root, ".codex");
  const bin = join(root, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(home, "config.toml"),
    ['model = "gpt-5.6-sol"', 'model_reasoning_effort = "medium"', 'service_tier = "fast"', ""].join("\n"),
    { mode: 0o600 }
  );
  writeFileSync(join(bin, "codex"), '#!/bin/sh\nprintf "codex-cli 0.144.4\\n"\n', { mode: 0o700 });
  chmodSync(join(bin, "codex"), 0o700);

  for (const prefix of manifest.disable_plugin_prefixes) {
    const path = join(home, "plugins/cache/openai-curated-remote", prefix, "1.0.0/skills/example/SKILL.md");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `# ${prefix}\n`);
  }
  for (const relativeSkill of manifest.disable_exact_skills) {
    const path = join(home, "plugins/cache/openai-curated-remote", relativeSkill.replace("superpowers/", "superpowers/1.0.0/skills/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "# exact skill\n");
  }

  return home;
}

function runProfile(command: "plan" | "apply" | "rollback", home: string, backup?: string): ProfileResult {
  const args = [profileScript, command, "--home", home];
  if (backup) {
    args.push("--backup", backup);
  }

  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(dirname(home), "bin")}:${process.env.PATH ?? ""}`
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    return JSON.parse(stdout) as ProfileResult;
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? "")
        : String(error);
    throw new Error(stderr);
  }
}
