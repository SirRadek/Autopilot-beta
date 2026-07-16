#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PROFILE_BEGIN = "# BEGIN AUTOPILOT CODEX EFFICIENCY PROFILE";
const PROFILE_END = "# END AUTOPILOT CODEX EFFICIENCY PROFILE";
const MINIMUM_CODEX_VERSION = [0, 144, 4];
const currentFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(currentFile), "..");
const manifestPath = join(repoRoot, "ops/codex-efficiency/default-skill-profile.json");

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function requireNode24() {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
  if (major !== 24) {
    fail("node_24_required");
  }
}

async function requireCodexVersion() {
  let output;
  try {
    const { readCodexVersion } = await import("../src/data/delivery-system/codexVersionProbe.mjs");
    output = readCodexVersion();
  } catch {
    fail("codex_version_unavailable");
  }

  const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    fail("codex_version_unparseable");
  }
  const version = match.slice(1, 4).map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < MINIMUM_CODEX_VERSION.length; index += 1) {
    if (version[index] > MINIMUM_CODEX_VERSION[index]) {
      return match[0];
    }
    if (version[index] < MINIMUM_CODEX_VERSION[index]) {
      fail("codex_version_too_old");
    }
  }
  return match[0];
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!["plan", "apply", "rollback"].includes(command)) {
    fail("usage");
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("usage");
    }
    values.set(key, value);
  }
  const home = values.get("--home");
  if (!home) {
    fail("home_required");
  }
  return {
    command,
    home: resolve(home),
    backup: values.get("--backup") ? resolve(values.get("--backup")) : undefined
  };
}

function loadManifest() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    typeof manifest.version !== "string" ||
    typeof manifest.remove_exact_service_tier !== "string" ||
    !Array.isArray(manifest.disable_plugin_prefixes) ||
    !Array.isArray(manifest.disable_exact_skills)
  ) {
    fail("profile_manifest_invalid");
  }
  return manifest;
}

function validateConfig(home) {
  if (!existsSync(home) || lstatSync(home).isSymbolicLink()) {
    fail("codex_home_invalid");
  }
  const matches = readdirSync(home).filter((entry) => entry === "config.toml");
  if (matches.length !== 1) {
    fail("base_config_count_invalid");
  }
  const configPath = join(home, matches[0]);
  const configLstat = lstatSync(configPath);
  if (configLstat.isSymbolicLink() || !configLstat.isFile()) {
    fail("config_not_regular_file");
  }
  if (typeof process.getuid === "function" && configLstat.uid !== process.getuid()) {
    fail("config_not_user_owned");
  }
  return configPath;
}

function walkSkillFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      fail("skill_path_symlink");
    }
    if (entry.isDirectory()) {
      return walkSkillFiles(path);
    }
    return entry.isFile() && entry.name === "SKILL.md" ? [realpathSync(path)] : [];
  });
}

function exactlyOneVersionRoot(pluginRoot) {
  const candidates = readdirSync(pluginRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && walkSkillFiles(join(pluginRoot, entry.name)).length > 0)
    .map((entry) => join(pluginRoot, entry.name));
  if (candidates.length !== 1) {
    fail("skill_path_ambiguous");
  }
  return candidates[0];
}

function resolveSkillPaths(home, manifest) {
  const cacheRoot = join(home, "plugins/cache/openai-curated-remote");
  if (!existsSync(cacheRoot) || lstatSync(cacheRoot).isSymbolicLink()) {
    fail("skill_cache_missing");
  }
  const pluginNames = readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const paths = [];

  for (const prefix of manifest.disable_plugin_prefixes) {
    const matches = pluginNames.filter((name) => name === prefix || name.startsWith(`${prefix}-`));
    if (matches.length !== 1) {
      fail("skill_path_ambiguous");
    }
    const versionRoot = exactlyOneVersionRoot(join(cacheRoot, matches[0]));
    const pluginSkills = walkSkillFiles(versionRoot);
    if (pluginSkills.length === 0) {
      fail("skill_path_missing");
    }
    paths.push(...pluginSkills);
  }

  for (const exactSkill of manifest.disable_exact_skills) {
    const [plugin, ...skillParts] = exactSkill.split("/");
    const pluginMatches = pluginNames.filter((name) => name === plugin);
    if (pluginMatches.length !== 1) {
      fail("skill_path_ambiguous");
    }
    const versionRoot = exactlyOneVersionRoot(join(cacheRoot, pluginMatches[0]));
    const expectedSuffix = join("skills", ...skillParts);
    const matches = walkSkillFiles(versionRoot).filter((path) => path.endsWith(`${sep}${expectedSuffix}`));
    if (matches.length !== 1) {
      fail(matches.length === 0 ? "skill_path_missing" : "skill_path_ambiguous");
    }
    paths.push(matches[0]);
  }

  return [...new Set(paths)].sort();
}

function selectedKeyLines(content, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, "gm");
  return [...content.matchAll(pattern)].map((match) => match[0]);
}

function buildProfileBlock(manifest, skillPaths) {
  const lines = [PROFILE_BEGIN, `# profile_version = ${manifest.version}`];
  for (const path of skillPaths) {
    lines.push(
      "",
      "[[skills.config]]",
      `path = ${JSON.stringify(path)}`,
      "enabled = false"
    );
  }
  lines.push(PROFILE_END);
  return lines.join("\n");
}

function buildPlan(home, manifest) {
  const configPath = validateConfig(home);
  const content = readFileSync(configPath, "utf8");
  if (content.includes(PROFILE_BEGIN) || content.includes(PROFILE_END)) {
    fail("profile_marker_exists");
  }
  const exactLines = content.split(/\r?\n/).filter((line) => line === manifest.remove_exact_service_tier);
  if (exactLines.length > 1) {
    fail("duplicate_fast_line");
  }
  const skillPaths = resolveSkillPaths(home, manifest);
  const withoutFast = content
    .split(/\r?\n/)
    .filter((line) => line !== manifest.remove_exact_service_tier)
    .join("\n");
  const normalizedBase = withoutFast.endsWith("\n") ? withoutFast : `${withoutFast}\n`;
  const nextContent = `${normalizedBase}\n${buildProfileBlock(manifest, skillPaths)}\n`;
  const modelChanged =
    JSON.stringify(selectedKeyLines(content, "model")) !== JSON.stringify(selectedKeyLines(nextContent, "model"));
  const reasoningChanged =
    JSON.stringify(selectedKeyLines(content, "model_reasoning_effort")) !==
    JSON.stringify(selectedKeyLines(nextContent, "model_reasoning_effort"));
  if (modelChanged || reasoningChanged) {
    fail("model_or_reasoning_change_detected");
  }
  return {
    configPath,
    content,
    nextContent,
    skillPaths,
    oldHash: sha256(content),
    newHash: sha256(nextContent),
    removeFast: exactLines.length === 1,
    modelChanged,
    reasoningChanged
  };
}

function fsyncPath(path) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeMode0600(path, content, flags = "wx") {
  const fd = openSync(path, flags, 0o600);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function atomicReplace(path, content) {
  const parent = dirname(path);
  const temporary = join(parent, `.config.toml.autopilot-${process.pid}-${Date.now()}.tmp`);
  try {
    writeMode0600(temporary, content);
    renameSync(temporary, path);
    fsyncPath(parent);
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary);
    }
  }
}

function backupPathFor(configPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${configPath}.autopilot-efficiency-${timestamp}.bak`;
}

function applyProfile(plan, manifest, codexVersion) {
  if (sha256(readFileSync(plan.configPath, "utf8")) !== plan.oldHash) {
    fail("config_cas_mismatch");
  }
  const backup = backupPathFor(plan.configPath);
  writeMode0600(backup, plan.content);
  const metadata = {
    version: manifest.version,
    config_path: plan.configPath,
    backup_sha256: sha256(plan.content),
    original_hash: plan.oldHash,
    applied_hash: plan.newHash
  };
  writeMode0600(`${backup}.json`, `${JSON.stringify(metadata, null, 2)}\n`);
  atomicReplace(plan.configPath, plan.nextContent);

  return {
    ok: true,
    action: "apply",
    codex_version: codexVersion,
    remove_service_tier_fast: plan.removeFast,
    disabled_skill_count: plan.skillPaths.length,
    old_hash: plan.oldHash,
    new_hash: plan.newHash,
    model_changed: false,
    reasoning_changed: false,
    backup,
    backup_sha256: metadata.backup_sha256,
    restart_required: true
  };
}

function rollbackProfile(home, backup, codexVersion) {
  if (!backup) {
    fail("backup_required");
  }
  const configPath = validateConfig(home);
  const backupPath = resolve(backup);
  const metadataPath = `${backupPath}.json`;
  if (
    !existsSync(backupPath) ||
    !existsSync(metadataPath) ||
    lstatSync(backupPath).isSymbolicLink() ||
    lstatSync(metadataPath).isSymbolicLink()
  ) {
    fail("backup_invalid");
  }
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (metadata.config_path !== configPath) {
    fail("backup_config_mismatch");
  }
  const liveContent = readFileSync(configPath, "utf8");
  if (sha256(liveContent) !== metadata.applied_hash) {
    fail("config_cas_mismatch");
  }
  const backupContent = readFileSync(backupPath, "utf8");
  if (sha256(backupContent) !== metadata.backup_sha256 || metadata.original_hash !== metadata.backup_sha256) {
    fail("backup_hash_mismatch");
  }
  atomicReplace(configPath, backupContent);
  return {
    ok: true,
    action: "rollback",
    codex_version: codexVersion,
    restored_hash: metadata.original_hash,
    model_changed: false,
    reasoning_changed: false,
    remove_service_tier_fast: false,
    restart_required: true
  };
}

async function main() {
  requireNode24();
  const args = parseArgs(process.argv.slice(2));
  const codexVersion = await requireCodexVersion();
  const manifest = loadManifest();

  if (args.command === "rollback") {
    return rollbackProfile(args.home, args.backup, codexVersion);
  }

  const plan = buildPlan(args.home, manifest);
  if (args.command === "apply") {
    return applyProfile(plan, manifest, codexVersion);
  }
  return {
    ok: true,
    action: "plan",
    codex_version: codexVersion,
    remove_service_tier_fast: plan.removeFast,
    disabled_skill_count: plan.skillPaths.length,
    old_hash: plan.oldHash,
    new_hash: plan.newHash,
    model_changed: plan.modelChanged,
    reasoning_changed: plan.reasoningChanged,
    backup_destination: `${plan.configPath}.autopilot-efficiency-<timestamp>.bak`,
    restart_required: true
  };
}

try {
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : "profile_failed";
  console.error(JSON.stringify({ ok: false, error: code }));
  process.exit(1);
}
