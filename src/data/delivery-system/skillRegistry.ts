import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export type SkillTrust = "unverified" | "reviewed" | "approved" | "rejected";

export const SKILL_MANIFEST_FILE = "skill.manifest.json";

export interface SkillManifest {
  readonly schema_version: "v1";
  readonly id: string;
  readonly version: string;
  readonly source: {
    readonly kind: "local" | "git" | "catalog";
    readonly locator: string;
    readonly commit_sha: string | null;
  };
  readonly trust: SkillTrust;
  readonly triggers: readonly string[];
  readonly capabilities: readonly string[];
  readonly required_bins: readonly string[];
  readonly required_env: readonly string[];
  readonly permissions: {
    readonly network: boolean;
    readonly filesystem: "workspace-read" | "workspace-write" | "none";
  };
  readonly hot_path: string;
  readonly cold_paths: readonly string[];
}

export interface LoadedSkill {
  readonly manifest: SkillManifest;
  readonly hot_content: string;
  readonly cold_content: Readonly<Record<string, string>>;
}

export interface SkillDiscoveryOptions {
  readonly sourceLocator: string;
  readonly sourceCommitSha: string;
  readonly relativeSkillPath: string;
}

export interface SkillCurationRule {
  readonly id: string;
  readonly sourceCommitSha: string;
  readonly trust: "reviewed" | "approved";
}

export type SkillSourceVerification =
  | { readonly status: "verified" }
  | { readonly status: "mismatch"; readonly expected: string; readonly actual: string }
  | { readonly status: "local" };

/**
 * Converts a SKILL.md frontmatter document into an unverified candidate.
 * Discovery never grants trust or activates the skill; a later review step
 * must explicitly promote the returned manifest to `reviewed` or `approved`.
 */
export function discoverSkillManifest(
  root: string,
  options: SkillDiscoveryOptions
): SkillManifest {
  if (!/^[a-f0-9]{40,64}$/i.test(options.sourceCommitSha)) {
    throw new Error("skill_discovery_sha_invalid");
  }

  const hotPath = join(options.relativeSkillPath, "SKILL.md");
  const document = readFileSync(join(root, hotPath), "utf8");
  const frontmatter = parseFrontmatter(document);
  const name = typeof frontmatter.name === "string" ? frontmatter.name : basenameSkillId(options.relativeSkillPath);
  const id = normalizeSkillId(name);
  const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
  const metadata = isRecord(frontmatter.metadata) ? frontmatter.metadata : {};
  const openclaw = isRecord(metadata.openclaw) ? metadata.openclaw : {};
  const requires = isRecord(openclaw.requires) ? openclaw.requires : {};
  const requiredBins = stringArray(requires.bins);
  const requiredEnv = stringArray(requires.env);

  return {
    schema_version: "v1",
    id,
    version: "0.0.0",
    source: {
      kind: "git",
      locator: options.sourceLocator,
      commit_sha: options.sourceCommitSha
    },
    trust: "unverified",
    triggers: uniqueStrings([id, name]),
    capabilities: uniqueStrings(["skill_discovery", ...requiredBins.map((bin) => `requires:${bin}`)]),
    required_bins: requiredBins,
    required_env: requiredEnv,
    permissions: { network: false, filesystem: "workspace-read" },
    hot_path: hotPath,
    cold_paths: []
  };
}

/** Applies an explicit id+commit allowlist; discovery results never self-promote. */
export function curateSkillManifests(
  manifests: readonly SkillManifest[],
  rules: readonly SkillCurationRule[]
): readonly SkillManifest[] {
  return manifests.flatMap((manifest) => {
    const rule = rules.find((candidate) => candidate.id === manifest.id);
    if (!rule || manifest.source.commit_sha?.toLowerCase() !== rule.sourceCommitSha.toLowerCase()) return [];
    return [{ ...manifest, trust: rule.trust }];
  });
}

/** Loads only generated governed catalogs; malformed or untrusted entries fail closed. */
export function loadGovernedSkillCatalog(paths: readonly string[]): readonly SkillManifest[] {
  const manifests: SkillManifest[] = [];
  for (const path of paths) {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`skill_catalog_invalid: ${path}`);
    for (const candidate of parsed) {
      const manifest = candidate as SkillManifest;
      const errors = validateSkillManifest(manifest);
      if (errors.length > 0 || (manifest.trust !== "reviewed" && manifest.trust !== "approved")) {
        throw new Error(`skill_catalog_rejected: ${path}`);
      }
      if (manifest.source.kind !== "local" && manifest.source.commit_sha === null) {
        throw new Error(`skill_catalog_unpinned: ${manifest.id}`);
      }
      manifests.push(manifest);
    }
  }
  return manifests;
}

export function selectSkillManifestsForTask(
  task: string,
  manifests: readonly SkillManifest[]
): readonly SkillManifest[] {
  const normalizedTask = normalize(task);
  return manifests.filter((manifest) =>
    [manifest.id, ...manifest.triggers, ...manifest.capabilities]
      .some((term) => term.length > 2 && normalizedTask.includes(normalize(term))) &&
    (manifest.trust === "reviewed" || manifest.trust === "approved")
  );
}

export function verifySkillSourceCommit(
  manifest: SkillManifest,
  actualCommitSha: string
): SkillSourceVerification {
  if (manifest.source.kind === "local") {
    return { status: "local" };
  }

  const expected = manifest.source.commit_sha;
  if (expected === null || !/^[a-f0-9]{40,64}$/i.test(expected)) {
    throw new Error(`skill_source_unpinned: ${manifest.id}@${manifest.version}`);
  }

  if (!/^[a-f0-9]{40,64}$/i.test(actualCommitSha)) {
    throw new Error(`skill_source_sha_invalid: ${manifest.id}@${manifest.version}`);
  }

  return expected.toLowerCase() === actualCommitSha.toLowerCase()
    ? { status: "verified" }
    : { status: "mismatch", expected, actual: actualCommitSha };
}

export function validateSkillManifest(manifest: Partial<SkillManifest>): readonly string[] {
  const errors: string[] = [];
  if (manifest.schema_version !== "v1") errors.push("schema_version");
  if (!manifest.id || !/^[a-z0-9][a-z0-9._-]*$/.test(manifest.id)) errors.push("id");
  if (!manifest.version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) errors.push("version");
  if (!manifest.source?.locator || !manifest.source.kind) errors.push("source");
  if (!manifest.trust || !["unverified", "reviewed", "approved", "rejected"].includes(manifest.trust)) errors.push("trust");
  if (!manifest.hot_path) errors.push("hot_path");
  if (!manifest.permissions || typeof manifest.permissions.network !== "boolean") errors.push("permissions");
  return errors;
}

export function loadSkill(
  root: string,
  manifest: SkillManifest,
  options: {
    readonly allowedTrust?: readonly SkillTrust[];
    readonly includeCold?: boolean;
    readonly sourceCommitSha?: string;
  } = {}
): LoadedSkill {
  const errors = validateSkillManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`invalid_skill_manifest: ${errors.join(",")}`);
  }

  const allowedTrust = options.allowedTrust ?? ["reviewed", "approved"];
  if (!allowedTrust.includes(manifest.trust)) {
    throw new Error(`skill_not_trusted: ${manifest.id}@${manifest.version}`);
  }

  if (manifest.source.kind !== "local") {
    if (options.sourceCommitSha === undefined) {
      throw new Error(`skill_source_unpinned: ${manifest.id}@${manifest.version}`);
    }
    const sourceVerification = verifySkillSourceCommit(manifest, options.sourceCommitSha);
    if (sourceVerification.status === "mismatch") {
      throw new Error(`skill_source_mismatch: ${manifest.id}@${manifest.version}`);
    }
  }

  const hotPath = join(root, manifest.hot_path);
  if (!existsSync(hotPath)) {
    throw new Error(`skill_hot_path_missing: ${manifest.hot_path}`);
  }

  const coldContent: Record<string, string> = {};
  if (options.includeCold === true) {
    for (const coldPath of manifest.cold_paths) {
      const path = join(root, coldPath);
      if (!existsSync(path)) {
        throw new Error(`skill_cold_path_missing: ${coldPath}`);
      }
      coldContent[coldPath] = readFileSync(path, "utf8");
    }
  }

  return {
    manifest,
    hot_content: readFileSync(hotPath, "utf8"),
    cold_content: coldContent
  };
}

export function importSkillFromGit(
  locator: string,
  commitSha: string,
  stagingRoot: string
): {
  readonly root: string;
  readonly source_commit_sha: string;
  readonly manifest: SkillManifest;
  readonly loaded: LoadedSkill;
} {
  if (!locator || !/^[a-f0-9]{40,64}$/i.test(commitSha)) {
    throw new Error("skill_import_invalid_source");
  }

  const destination = join(stagingRoot, "skill");
  execFileSync("git", ["clone", "--quiet", "--no-checkout", locator, destination], { stdio: "pipe" });
  execFileSync("git", ["-C", destination, "checkout", "--quiet", "--detach", commitSha], { stdio: "pipe" });
  const actualCommitSha = execFileSync("git", ["-C", destination, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (actualCommitSha.toLowerCase() !== commitSha.toLowerCase()) {
    throw new Error("skill_source_mismatch");
  }

  const manifestPath = join(destination, SKILL_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error("skill_manifest_missing");
  }
  const parsedManifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SkillManifest;
  const manifest = parsedManifest.source.commit_sha === null
    ? { ...parsedManifest, source: { ...parsedManifest.source, commit_sha: actualCommitSha } }
    : parsedManifest;
  const loaded = loadSkill(destination, manifest, { sourceCommitSha: actualCommitSha });

  return {
    root: destination,
    source_commit_sha: actualCommitSha,
    manifest,
    loaded
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, " ");
}

function parseFrontmatter(document: string): Record<string, unknown> {
  const match = document.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return {};
  try {
    const parsed = parseYaml(match[1] ?? "") as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function basenameSkillId(relativePath: string): string {
  return relativePath.split(/[\\/]/).filter(Boolean).at(-1) ?? "skill";
}

function normalizeSkillId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "skill";
}
