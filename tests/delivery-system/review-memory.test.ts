import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildReviewMemoryPacket,
  extractReviewMemoryDocument,
} from "../../src/data/delivery-system/reviewMemory";

const managed = extractReviewMemoryDocument(
  "docs/superpowers/review-memory/managed.md",
  readFileSync("tests/fixtures/review-memory/managed.md", "utf8"),
);
const ui = extractReviewMemoryDocument(
  "docs/superpowers/review-memory/ui.md",
  readFileSync("tests/fixtures/review-memory/ui.md", "utf8"),
);
const base = "a".repeat(40);
const head = "b".repeat(40);

describe("review memory", () => {
  it("extracts ordered unique invariant IDs and a content digest", () => {
    expect(managed.invariant_ids).toEqual(["MM-01", "MM-02"]);
    expect(managed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts invariant headings directly below the document title", () => {
    const document = extractReviewMemoryDocument(
      "docs/superpowers/review-memory/ui.md",
      [
        "# UI Control Review Memory",
        "",
        "## UI-01 — Explicit completion",
        "",
        "## UI-02 — Stable search target",
      ].join("\n"),
    );

    expect(document.invariant_ids).toEqual(["UI-01", "UI-02"]);
  });

  it("builds a delta packet with only explicitly selected memory", () => {
    const packet = buildReviewMemoryPacket({
      mode: "delta",
      base_sha: base,
      head_sha: head,
      changed_files: ["src/state.ts", "tests/state.test.ts"],
      documents: [managed, ui],
      memory_decision: { kind: "selected", invariant_ids: ["MM-02"] },
      test_evidence: [
        {
          check_id: "focused-state",
          status: "passed",
          source_path: "tests/state.test.ts",
        },
      ],
    });

    expect(packet.memory_files.map((item) => item.path)).toEqual([
      "docs/superpowers/review-memory/managed.md",
    ]);
    expect(packet.affected_invariant_ids).toEqual(["MM-02"]);
    expect(packet.contains_raw_content).toBe(false);
    expect(JSON.stringify(packet)).not.toContain("Write and validate");
  });

  it("requires a bounded reason when no memory applies", () => {
    expect(() =>
      buildReviewMemoryPacket({
        mode: "delta",
        base_sha: base,
        head_sha: head,
        changed_files: ["README.md"],
        documents: [managed, ui],
        memory_decision: { kind: "none", reason: "" },
        test_evidence: [],
      }),
    ).toThrow("review_memory_reason_required");
  });

  it("fails closed on unknown or duplicate invariant IDs", () => {
    expect(() =>
      buildReviewMemoryPacket({
        mode: "delta",
        base_sha: base,
        head_sha: head,
        changed_files: ["src/state.ts"],
        documents: [managed, ui],
        memory_decision: { kind: "selected", invariant_ids: ["MM-99"] },
        test_evidence: [],
      }),
    ).toThrow("unknown_review_invariant:MM-99");

    expect(() =>
      extractReviewMemoryDocument(
        "duplicate.md",
        ["### MM-01 — One", "", "### MM-01 — Two"].join("\n"),
      ),
    ).toThrow("duplicate_review_invariant:MM-01");
  });

  it("selects every document for a release packet", () => {
    const packet = buildReviewMemoryPacket({
      mode: "release",
      base_sha: base,
      head_sha: head,
      changed_files: ["src/state.ts", "src/ui.ts"],
      documents: [managed, ui],
      memory_decision: { kind: "release_all" },
      test_evidence: [
        { check_id: "full-suite", status: "passed", source_path: null },
      ],
    });
    expect(packet.memory_files).toHaveLength(2);
    expect(packet.review_requirements).toContain(
      "review_complete_branch_diff",
    );
  });
});
