import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Profile check matrix — the single deterministic data artifact behind
 * dual-track (normal fast web vs design showcase) QA enforcement.
 *
 * Both QA gates (fit-safety lint and the browser visual-QA gate) resolve every
 * check/issue code through this matrix for the active page profile:
 * - "blocking"  = current behavior (an error-severity finding fails the gate),
 * - "advisory"  = the finding is still reported but does not fail the gate,
 * - "skipped"   = the finding is not counted (reported as skipped where it
 *                 cannot be cheaply avoided).
 *
 * Fail-closed policy: an unknown code, a missing profile entry, or a matrix
 * that cannot be loaded/validated always resolves to "blocking".
 */

export const PAGE_PROFILES = ["seo_led", "balanced", "brand_led", "experimental_showcase"] as const;
export type PageProfile = (typeof PAGE_PROFILES)[number];

export const DEFAULT_PAGE_PROFILE: PageProfile = "balanced";

export const PROFILE_CHECK_SEVERITIES = ["blocking", "advisory", "skipped"] as const;
export type ProfileCheckSeverity = (typeof PROFILE_CHECK_SEVERITIES)[number];

export interface ProfileCheckMatrixEntry {
  readonly code: string;
  readonly seo_led: ProfileCheckSeverity;
  readonly balanced: ProfileCheckSeverity;
  readonly brand_led: ProfileCheckSeverity;
  readonly experimental_showcase: ProfileCheckSeverity;
  readonly notes?: string;
}

export interface ProfileCheckMatrix {
  readonly schema: "autopilot-beta/pdos-profile-check-matrix@1";
  readonly version: number;
  readonly checks: readonly ProfileCheckMatrixEntry[];
}

export const PROFILE_CHECK_MATRIX_SCHEMA = "autopilot-beta/pdos-profile-check-matrix@1";

const matrixCodePattern = /^[a-z][a-z0-9_-]*$/;
const allowedEntryKeys = new Set(["code", "seo_led", "balanced", "brand_led", "experimental_showcase", "notes"]);
const defaultMatrixPath = resolve(dirname(fileURLToPath(import.meta.url)), "profile-check-matrix.json");

export function isPageProfile(value: unknown): value is PageProfile {
  return typeof value === "string" && (PAGE_PROFILES as readonly string[]).includes(value);
}

export function isProfileCheckSeverity(value: unknown): value is ProfileCheckSeverity {
  return typeof value === "string" && (PROFILE_CHECK_SEVERITIES as readonly string[]).includes(value);
}

export function parsePageProfile(value: unknown): PageProfile {
  if (isPageProfile(value)) {
    return value;
  }
  throw new Error(`Unknown page profile ${JSON.stringify(value)}. Expected one of: ${PAGE_PROFILES.join(", ")}.`);
}

export function parseProfileCheckMatrix(value: unknown): ProfileCheckMatrix {
  if (!isRecord(value)) {
    throw new Error("Profile check matrix must be a JSON object.");
  }
  if (value.schema !== PROFILE_CHECK_MATRIX_SCHEMA) {
    throw new Error(`Profile check matrix schema must be "${PROFILE_CHECK_MATRIX_SCHEMA}".`);
  }
  if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) {
    throw new Error("Profile check matrix version must be an integer >= 1.");
  }
  if (!Array.isArray(value.checks) || value.checks.length === 0) {
    throw new Error("Profile check matrix checks must be a non-empty array.");
  }

  const seenCodes = new Set<string>();
  const checks = value.checks.map((entry, index) => parseMatrixEntry(entry, index, seenCodes));
  return { schema: PROFILE_CHECK_MATRIX_SCHEMA, version: value.version, checks };
}

export function loadProfileCheckMatrix(matrixPath = defaultMatrixPath): ProfileCheckMatrix {
  return parseProfileCheckMatrix(JSON.parse(readFileSync(matrixPath, "utf8")) as unknown);
}

let cachedDefaultMatrix: ProfileCheckMatrix | undefined;

export function loadDefaultProfileCheckMatrix(): ProfileCheckMatrix {
  cachedDefaultMatrix ??= loadProfileCheckMatrix();
  return cachedDefaultMatrix;
}

const matrixIndexCache = new WeakMap<ProfileCheckMatrix, ReadonlyMap<string, ProfileCheckMatrixEntry>>();

export function resolveCheckSeverity(
  matrixCode: string,
  profile: PageProfile,
  matrix: ProfileCheckMatrix = loadDefaultProfileCheckMatrix()
): ProfileCheckSeverity {
  const entry = matrixIndexFor(matrix).get(matrixCode);
  if (entry === undefined) {
    // Fail closed: a code the matrix does not know is always blocking.
    return "blocking";
  }
  const severity: unknown = entry[profile];
  // Fail closed: a malformed/missing profile entry is always blocking.
  return isProfileCheckSeverity(severity) ? severity : "blocking";
}

function matrixIndexFor(matrix: ProfileCheckMatrix): ReadonlyMap<string, ProfileCheckMatrixEntry> {
  const cached = matrixIndexCache.get(matrix);
  if (cached !== undefined) {
    return cached;
  }
  const index = new Map(matrix.checks.map((entry) => [entry.code, entry]));
  matrixIndexCache.set(matrix, index);
  return index;
}

function parseMatrixEntry(value: unknown, index: number, seenCodes: Set<string>): ProfileCheckMatrixEntry {
  if (!isRecord(value)) {
    throw new Error(`Profile check matrix checks[${index}] must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowedEntryKeys.has(key)) {
      throw new Error(`Profile check matrix checks[${index}] has unknown key "${key}".`);
    }
  }
  const code = value.code;
  if (typeof code !== "string" || !matrixCodePattern.test(code)) {
    throw new Error(`Profile check matrix checks[${index}] code must match ${String(matrixCodePattern)}.`);
  }
  if (seenCodes.has(code)) {
    throw new Error(`Profile check matrix has a duplicate code "${code}".`);
  }
  seenCodes.add(code);

  const entry: {
    code: string;
    seo_led: ProfileCheckSeverity;
    balanced: ProfileCheckSeverity;
    brand_led: ProfileCheckSeverity;
    experimental_showcase: ProfileCheckSeverity;
    notes?: string;
  } = {
    code,
    seo_led: parseSeverityField(value.seo_led, code, "seo_led"),
    balanced: parseSeverityField(value.balanced, code, "balanced"),
    brand_led: parseSeverityField(value.brand_led, code, "brand_led"),
    experimental_showcase: parseSeverityField(value.experimental_showcase, code, "experimental_showcase")
  };
  if (value.notes !== undefined) {
    if (typeof value.notes !== "string" || value.notes.length === 0) {
      throw new Error(`Profile check matrix code "${code}" notes must be a non-empty string.`);
    }
    entry.notes = value.notes;
  }
  return entry;
}

function parseSeverityField(value: unknown, code: string, profile: PageProfile): ProfileCheckSeverity {
  if (isProfileCheckSeverity(value)) {
    return value;
  }
  throw new Error(
    `Profile check matrix code "${code}" is missing a valid "${profile}" severity (expected one of: ${PROFILE_CHECK_SEVERITIES.join(", ")}).`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
