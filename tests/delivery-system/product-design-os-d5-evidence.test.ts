import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  validateEvidenceRecords,
  validateProductDesignOs,
  type PdosValidationIssue
} from "../../product-design-os/scripts/validate-product-design-os";
import {
  analyzeEvidenceFreshness,
  getEvidenceFreshnessExitCode
} from "../../product-design-os/scripts/check-evidence-freshness-product-design-os";
import { validateJsonSchema } from "../../src/lib/delivery-system/validation";

const repoRoot = process.cwd();
const pdosRoot = join(repoRoot, "product-design-os");
const evidenceSchemaFile = join(pdosRoot, "evidence", "evidence.schema.json");
const exampleEvidenceFile = join(pdosRoot, "evidence", "records", "example-context7-evidence.json");

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function validEvidenceRecord(id = "synthetic-context7-evidence"): Record<string, unknown> {
  return {
    id,
    schema_version: "1.0.0",
    claim: "Context7 documentation was checked before adopting a library documentation claim.",
    claim_kind: "library_doc",
    library: "Example UI Library",
    query: "Example UI Library documentation",
    source: "context7:/example/ui-library",
    source_date: "2026-06-24",
    freshness_ttl_days: 30,
    covered_claim: "Library documentation evidence exists before the claim is treated as verified.",
    fallback: "Use official documentation if Context7 evidence is unavailable or stale."
  };
}

function validateTempEvidence(
  records: readonly Record<string, unknown>[],
  options: { readonly claimedEvidenceIds?: readonly string[] } = {}
): readonly string[] {
  const tempRoot = mkdtempSync(join(tmpdir(), "pdos-d5-evidence-"));
  const tempPdosRoot = join(tempRoot, "product-design-os");

  try {
    mkdirSync(join(tempPdosRoot, "evidence", "records"), { recursive: true });
    mkdirSync(join(tempPdosRoot, "tokens"), { recursive: true });
    writeJson(join(tempPdosRoot, "evidence", "evidence.schema.json"), readJson(evidenceSchemaFile));
    writeJson(join(tempPdosRoot, "tokens", "color.json"), {
      version: 1,
      tokens: {},
      governance_evidence_ids: options.claimedEvidenceIds ?? records.map((record) => record.id).filter((id): id is string => typeof id === "string")
    });

    records.forEach((record, index) => {
      writeJson(join(tempPdosRoot, "evidence", "records", `record-${index}.json`), record);
    });

    const errors: PdosValidationIssue[] = [];
    validateEvidenceRecords(tempPdosRoot, tempRoot, errors);
    return errors.map((error) => error.message);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function validateTempEvidenceSetup(setup: (paths: { tempRoot: string; tempPdosRoot: string; recordsRoot: string }) => void): readonly string[] {
  const tempRoot = mkdtempSync(join(tmpdir(), "pdos-d5-evidence-setup-"));
  const tempPdosRoot = join(tempRoot, "product-design-os");
  const recordsRoot = join(tempPdosRoot, "evidence", "records");

  try {
    mkdirSync(recordsRoot, { recursive: true });
    writeJson(join(tempPdosRoot, "evidence", "evidence.schema.json"), readJson(evidenceSchemaFile));
    setup({ tempRoot, tempPdosRoot, recordsRoot });

    const errors: PdosValidationIssue[] = [];
    validateEvidenceRecords(tempPdosRoot, tempRoot, errors);
    return errors.map((error) => error.message);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function validateTempPdosWithoutEvidence(): readonly string[] {
  const tempRoot = mkdtempSync(join(tmpdir(), "pdos-d5-evidence-none-"));
  const tempPdosRoot = join(tempRoot, "product-design-os");

  try {
    mkdirSync(tempPdosRoot, { recursive: true });

    const errors: PdosValidationIssue[] = [];
    validateEvidenceRecords(tempPdosRoot, tempRoot, errors);
    return errors.map((error) => error.message);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function validateTempEvidenceRootWithoutRecords(): readonly string[] {
  const tempRoot = mkdtempSync(join(tmpdir(), "pdos-d5-evidence-empty-"));
  const tempPdosRoot = join(tempRoot, "product-design-os");

  try {
    mkdirSync(join(tempPdosRoot, "evidence"), { recursive: true });

    const errors: PdosValidationIssue[] = [];
    validateEvidenceRecords(tempPdosRoot, tempRoot, errors);
    return errors.map((error) => error.message);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe("Product Design OS D5 governance evidence", () => {
  it("preserves the validation baseline with the committed evidence example present", () => {
    const report = validateProductDesignOs(repoRoot);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("validates the example evidence record against evidence.schema", () => {
    const schema = readJson(evidenceSchemaFile);
    const example = readJson(exampleEvidenceFile);

    expect(validateJsonSchema(example, schema)).toEqual([]);
  });

  it("does not require a schema when no evidence records exist", () => {
    expect(validateTempEvidenceRootWithoutRecords()).toEqual([]);
  });

  it("no-ops when no evidence directory exists", () => {
    expect(validateTempPdosWithoutEvidence()).toEqual([]);
  });

  it("reports schema-invalid evidence records with the D5 error code", () => {
    const record = validEvidenceRecord();
    delete record.fallback;

    const messages = validateTempEvidence([record]);

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_EVIDENCE_SCHEMA_INVALID")]));
  });

  it("rejects calendar-invalid evidence source dates", () => {
    const record = validEvidenceRecord();
    record.source_date = "2026-02-31";

    const messages = validateTempEvidence([record]);

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_EVIDENCE_SCHEMA_INVALID")]));
  });

  it("requires spdx_license for license evidence", () => {
    const record = validEvidenceRecord();
    record.claim_kind = "license";

    const messages = validateTempEvidence([record]);

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_EVIDENCE_SCHEMA_INVALID")]));
  });

  it("requires library for library_doc evidence", () => {
    const record = validEvidenceRecord();
    delete record.library;

    const messages = validateTempEvidence([record]);

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_EVIDENCE_SCHEMA_INVALID")]));
  });

  it("rejects evidence freshness ttl values above the shape cap", () => {
    const record = validEvidenceRecord();
    record.freshness_ttl_days = 366;

    const messages = validateTempEvidence([record]);

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_EVIDENCE_SCHEMA_INVALID")]));
  });

  it("rejects duplicate evidence ids", () => {
    const messages = validateTempEvidence([
      validEvidenceRecord("duplicate-context7-evidence"),
      validEvidenceRecord("duplicate-context7-evidence")
    ]);

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_EVIDENCE_DUPLICATE_ID")]));
  });

  it("rejects shape-valid evidence records that no governed artifact claims", () => {
    const messages = validateTempEvidence([validEvidenceRecord("unclaimed-context7-evidence")], {
      claimedEvidenceIds: []
    });

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_EVIDENCE_UNCLAIMED_RECORD")]));
  });

  it("rejects governed artifacts that claim missing evidence records", () => {
    const messages = validateTempEvidence([validEvidenceRecord("claimed-context7-evidence")], {
      claimedEvidenceIds: ["claimed-context7-evidence", "missing-context7-evidence"]
    });

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_EVIDENCE_UNKNOWN_CLAIM")]));
  });

  it("rejects malformed governed artifact evidence claim fields", () => {
    const messages = validateTempEvidenceSetup(({ tempPdosRoot }) => {
      mkdirSync(join(tempPdosRoot, "tokens"), { recursive: true });
      writeJson(join(tempPdosRoot, "tokens", "color.json"), {
        version: 1,
        tokens: {},
        governance_evidence_ids: "not-an-array"
      });
    });

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_EVIDENCE_CLAIM_INVALID")]));
  });

  it("rejects symlinked evidence record paths before reading records", () => {
    let symlinkCreated = false;
    const messages = validateTempEvidenceSetup(({ tempRoot, recordsRoot }) => {
      const outsideRoot = join(tempRoot, "outside-records");
      mkdirSync(outsideRoot, { recursive: true });
      writeJson(join(outsideRoot, "escaped-record.json"), validEvidenceRecord("escaped-symlink-record"));

      try {
        symlinkSync(outsideRoot, join(recordsRoot, "linked-out"), process.platform === "win32" ? "junction" : "dir");
        symlinkCreated = true;
      } catch {
        symlinkCreated = false;
      }
    });

    if (!symlinkCreated) {
      return;
    }

    expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("PDOS_EVIDENCE_SYMLINK_REJECTED")]));
  });

  it("marks evidence stale only when source_date plus ttl is earlier than now", () => {
    const results = analyzeEvidenceFreshness(
      [
        { id: "stale-record", source_date: "2026-01-01", freshness_ttl_days: 10 },
        { id: "fresh-record", source_date: "2026-01-02", freshness_ttl_days: 10 }
      ],
      "2026-01-12"
    );

    expect(results).toEqual([
      {
        id: "stale-record",
        source_date: "2026-01-01",
        freshness_ttl_days: 10,
        expires_on: "2026-01-11",
        status: "stale"
      },
      {
        id: "fresh-record",
        source_date: "2026-01-02",
        freshness_ttl_days: 10,
        expires_on: "2026-01-12",
        status: "fresh"
      }
    ]);
  });

  it("marks future-dated evidence as suspect and fail-on-stale as failing", () => {
    const results = analyzeEvidenceFreshness(
      [
        { id: "future-record", source_date: "2026-01-13", freshness_ttl_days: 10 },
        { id: "stale-record", source_date: "2026-01-01", freshness_ttl_days: 10 },
        { id: "fresh-record", source_date: "2026-01-02", freshness_ttl_days: 10 }
      ],
      "2026-01-12"
    );

    expect(results.map((result) => [result.id, result.status])).toEqual([
      ["future-record", "future"],
      ["stale-record", "stale"],
      ["fresh-record", "fresh"]
    ]);
    expect(getEvidenceFreshnessExitCode(results, true)).toBe(1);
    expect(getEvidenceFreshnessExitCode(results, false)).toBe(0);
  });
});
