import { describe, expect, it } from "vitest";

import { SUPPORTED_REASONING_EFFORTS } from "../../src/data/delivery-system/executionProfile";
import { STATIC_PROVIDER_MODEL_CATALOG } from "../../src/data/delivery-system/providerModelCatalog";
import {
  expandQuotaLabel,
  isCanonicalModelId,
  QUOTA_LABEL_TO_CANONICAL
} from "../../src/data/delivery-system/providerModelId";
import { AGY_VERIFIED_MODELS } from "../../src/data/delivery-system/routingModes";

describe("provider model IDs", () => {
  it("accepts only bounded canonical CLI model IDs", () => {
    expect(isCanonicalModelId("gpt-5.6-sol")).toBe(true);
    expect(isCanonicalModelId("Vendor_1/model:2.0")).toBe(true);
    expect(isCanonicalModelId("a".repeat(200))).toBe(true);

    for (const value of [
      "",
      "-leading-option",
      "has whitespace",
      "has\nnewline",
      "has\u007fcontrol",
      "model@provider",
      "mødel",
      "a".repeat(201)
    ]) {
      expect(isCanonicalModelId(value)).toBe(false);
    }
  });

  it("maps only owner-approved quota labels to canonical IDs", () => {
    expect(QUOTA_LABEL_TO_CANONICAL).toEqual({
      claude_cli: {
        "Opus 4.8": ["claude-opus-4-8"],
        "Fable 5": ["claude-fable-5"],
        "Opus 5": ["claude-opus-5"],
        "Sonnet 5": ["claude-sonnet-5"],
        "Haiku 4.5": ["claude-haiku-4-5-20251001"],
        "Fable": ["claude-fable-5"],
        "Opus": ["claude-opus-5", "claude-opus-4-8"],
        "Sonnet": ["claude-sonnet-5"],
        "Haiku": ["claude-haiku-4-5-20251001"]
      },
      agy_cli: {
        "Gemini Flash": ["gemini-3.5-flash-medium", "gemini-3.5-flash-high"],
        "Gemini Pro": ["gemini-3.1-pro-high"],
        "Claude Sonnet": ["claude-4.6-sonnet"],
        "GPT-OSS": ["gpt-oss-120b"]
      }
    });
    expect(expandQuotaLabel("claude_cli", "Opus 4.8")).toEqual(["claude-opus-4-8"]);
    expect(expandQuotaLabel("claude_cli", "Fable 5")).toEqual(["claude-fable-5"]);
    expect(expandQuotaLabel("claude_cli", "Fable")).toEqual(["claude-fable-5"]);
    expect(expandQuotaLabel("agy_cli", "Gemini Flash")).toEqual([
      "gemini-3.5-flash-medium",
      "gemini-3.5-flash-high"
    ]);
    expect(expandQuotaLabel("claude_cli", "Zephyr 9")).toEqual([]);
    expect(expandQuotaLabel("claude_cli", "ultracode")).toEqual([]);
    expect(expandQuotaLabel("agy_cli", "Claude Opus")).toEqual([]);
    expect(expandQuotaLabel("agy_cli", "__proto__")).toEqual([]);
  });

  it("pins claude_cli reasoning efforts to the CLI-verified --effort choices", () => {
    // `claude --help` documents `--effort <level>` with exactly these values; `ultracode`
    // is a CLI mode alias, not a reasoning effort, and must never appear here.
    expect(SUPPORTED_REASONING_EFFORTS.claude_cli).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(SUPPORTED_REASONING_EFFORTS.claude_cli).not.toContain("ultracode");
  });
});

describe("static provider model catalog", () => {
  it("contains exactly the owner-approved canonical seed", () => {
    expect(STATIC_PROVIDER_MODEL_CATALOG).toEqual({
      claude_cli: {
        models: [
          "claude-opus-4-8",
          "claude-fable-5",
          "claude-opus-5",
          "claude-sonnet-5",
          "claude-haiku-4-5-20251001"
        ],
        reasoning_efforts: SUPPORTED_REASONING_EFFORTS.claude_cli
      },
      codex_cli: {
        models: [
          "gpt-5.6-sol",
          "gpt-5.6-terra",
          "gpt-5.6-luna",
          "gpt-daybreak-blue-latest",
          "gpt-5.5",
          "gpt-5.4",
          "gpt-5.4-mini",
          "gpt-5.3-codex-spark"
        ],
        reasoning_efforts: SUPPORTED_REASONING_EFFORTS.codex_cli
      },
      agy_cli: {
        models: [
          "gemini-3.5-flash-medium",
          "gemini-3.5-flash-high",
          "gemini-3.1-pro-high",
          "gpt-oss-120b",
          "claude-4.6-sonnet"
        ],
        reasoning_efforts: SUPPORTED_REASONING_EFFORTS.agy_cli
      }
    });
  });

  it("keeps every catalog and quota-mapping target canonical and executable", () => {
    for (const catalog of Object.values(STATIC_PROVIDER_MODEL_CATALOG)) {
      for (const model of catalog.models) expect(isCanonicalModelId(model)).toBe(true);
    }

    for (const provider of ["claude_cli", "agy_cli"] as const) {
      const catalogModels: readonly string[] = STATIC_PROVIDER_MODEL_CATALOG[provider].models;
      for (const targets of Object.values(QUOTA_LABEL_TO_CANONICAL[provider])) {
        for (const target of targets) expect(catalogModels).toContain(target);
      }
    }
  });

  it("includes every verified AGY model exactly once", () => {
    const catalogModels: readonly string[] = STATIC_PROVIDER_MODEL_CATALOG.agy_cli.models;
    const verifiedModels = Object.values(AGY_VERIFIED_MODELS);

    expect(catalogModels).toHaveLength(verifiedModels.length);
    for (const model of verifiedModels) {
      expect(catalogModels.filter((candidate) => candidate === model)).toHaveLength(1);
    }
  });

  it("does not retain display labels or removed provisional IDs", () => {
    const catalogModels: readonly string[] = Object.values(STATIC_PROVIDER_MODEL_CATALOG)
      .flatMap((catalog) => catalog.models);

    for (const removed of [
      "Opus 4.8",
      "Opus 5",
      "Sonnet 5",
      "Fable 5",
      "Haiku 4.5",
      "GPT-5.3-Codex-Spark",
      "Gemini Flash",
      "Gemini Pro",
      "Claude Opus",
      "Claude Sonnet",
      "GPT-OSS"
    ]) {
      expect(catalogModels).not.toContain(removed);
    }
  });
});
