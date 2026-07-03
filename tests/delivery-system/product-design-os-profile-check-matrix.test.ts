import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeFitSafetyLint, createFitSafetyLintCliRun } from "../../product-design-os/qa/fit-safety/check-fit-safety-product-design-os";
import {
  DEFAULT_PAGE_PROFILE,
  PAGE_PROFILES,
  loadProfileCheckMatrix,
  parsePageProfile,
  parseProfileCheckMatrix,
  resolveCheckSeverity,
  type PageProfile,
  type ProfileCheckMatrix,
  type ProfileCheckSeverity
} from "../../product-design-os/qa/profile-check-matrix";
import {
  buildVisualQaBrowserReport,
  classifyVisualQaBrowserReport,
  type VisualQaBrowserSnapshot,
  type VisualQaBrowserViewportSnapshot
} from "../../product-design-os/qa/visual-qa-browser/visual-qa-browser-core";
import type { PdosVisualIssue } from "../../product-design-os/scripts/visual-qa-product-design-os";
import { validateJsonSchema } from "../../src/lib/delivery-system/validation";

const repoRoot = process.cwd();
const matrixPath = join(repoRoot, "product-design-os", "qa", "profile-check-matrix.json");
const matrixSchemaPath = join(repoRoot, "product-design-os", "qa", "profile-check-matrix.schema.json");

// Every check/issue code the two QA gates and the shared analyzer can emit today.
const fitSafetyCodes = [
  "font_clamp_min_below_floor",
  "grid_track_overflow_risk",
  "fixed_text_container_inline_cap",
  "text_wrap_safety_missing",
  "viewport_width_overflow_risk",
  "fixed_min_width_over_viewport",
  "fixed_height_floor_risk",
  "sticky_background_opacity_missing",
  "transform_scale_on_interactive",
  "page_lang_missing",
  "page_lang_invalid"
] as const;

const analyzerCodes = [
  "missing_viewports",
  "desktop_viewport_missing",
  "mobile_viewport_missing",
  "horizontal_overflow",
  "fluid_floor_overflow",
  "text_overlap",
  "low_contrast",
  "primary_content_hidden_in_canvas",
  "missing_reduced_motion_fallback",
  "touch_target_below_44px",
  "text_fit_probe_failed",
  "clipped_text_detected",
  "fluid_floor_clipped_text",
  "min_font_below_legible_floor",
  "line_length_above_readability_band",
  "fit_scale_below_advisory_floor",
  "weak_heading_hierarchy",
  "missing_primary_action",
  "repeated_card_grid",
  "thin_visible_content",
  "headings_missing",
  "ctas_missing",
  "public_sector_motion_too_high",
  "template_generic-saas-hero",
  "template_repeated-equal-card-grid",
  "template_fake-dashboard",
  "template_gradient-background",
  "template_bento-grid",
  "template_dark-neon-default",
  "template_stock-like-media"
] as const;

const browserGateCodes = ["runner_error", "axe_critical", "axe_serious"] as const;

const expectedCodes = [...fitSafetyCodes, ...analyzerCodes, ...browserGateCodes];

// Floor codes: must stay blocking in ALL FOUR profiles (dual-track hard floor).
const floorCodes = [
  "horizontal_overflow",
  "fluid_floor_overflow",
  "viewport_width_overflow_risk",
  "fixed_min_width_over_viewport",
  "grid_track_overflow_risk",
  "text_overlap",
  "fluid_floor_clipped_text",
  "min_font_below_legible_floor",
  "font_clamp_min_below_floor",
  "text_wrap_safety_missing",
  "fixed_text_container_inline_cap",
  "sticky_background_opacity_missing",
  "headings_missing",
  "weak_heading_hierarchy",
  "ctas_missing",
  "missing_primary_action",
  "touch_target_below_44px",
  "transform_scale_on_interactive",
  "low_contrast",
  "axe_serious",
  "axe_critical",
  "missing_reduced_motion_fallback",
  "primary_content_hidden_in_canvas",
  "page_lang_missing",
  "page_lang_invalid",
  "missing_viewports",
  "runner_error"
] as const;

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function matrixEntry(
  code: string,
  severities: Partial<Record<PageProfile, ProfileCheckSeverity>> = {}
): Record<string, unknown> {
  return {
    code,
    seo_led: severities.seo_led ?? "blocking",
    balanced: severities.balanced ?? "blocking",
    brand_led: severities.brand_led ?? "blocking",
    experimental_showcase: severities.experimental_showcase ?? "blocking"
  };
}

function syntheticMatrix(entries: readonly Record<string, unknown>[]): ProfileCheckMatrix {
  return parseProfileCheckMatrix({
    schema: "autopilot-beta/pdos-profile-check-matrix@1",
    version: 1,
    checks: entries
  });
}

function viewport(input: Partial<VisualQaBrowserViewportSnapshot> = {}): VisualQaBrowserViewportSnapshot {
  return {
    name: input.name ?? "desktop-1440",
    width: input.width ?? 1440,
    height: input.height ?? 900,
    heading_count: input.heading_count ?? 2,
    cta_count: input.cta_count ?? 2,
    visible_text_characters: input.visible_text_characters ?? 520,
    repeated_card_count: input.repeated_card_count ?? 0,
    text_overlap: input.text_overlap ?? false,
    horizontal_overflow: input.horizontal_overflow ?? false,
    low_contrast: input.low_contrast ?? false,
    primary_content_in_canvas: input.primary_content_in_canvas ?? false,
    motion_level: input.motion_level ?? 1,
    reduced_motion_supported: input.reduced_motion_supported ?? true,
    text_fit: input.text_fit ?? true,
    clipped_text_count: input.clipped_text_count ?? 0,
    min_font_px: input.min_font_px ?? 16,
    max_line_length_ch: input.max_line_length_ch ?? 56,
    fit_scale_min: input.fit_scale_min ?? 1,
    h1_visible: input.h1_visible ?? true,
    cta_target_min_44: input.cta_target_min_44 ?? true,
    min_cta_target_px: input.min_cta_target_px ?? 44,
    overlap_count: input.overlap_count ?? 0,
    overflow_px: input.overflow_px ?? 0,
    canvas_count: input.canvas_count ?? 0,
    active_motion_element_count: input.active_motion_element_count ?? 0,
    reduce_motion_rule_count: input.reduce_motion_rule_count ?? 1,
    contrast_failures: input.contrast_failures ?? []
  };
}

function snapshot(): VisualQaBrowserSnapshot {
  return {
    url: "fixture://profile-check-matrix",
    project_type: "marketing_web",
    primary_goal: "Generate qualified requests.",
    target_users: ["buyer"],
    viewports: [viewport(), viewport({ name: "mobile-390", width: 390, height: 844 })],
    headings: ["Clear offer"],
    ctas: ["Request a plan"],
    template_signals: []
  };
}

function analyzerIssue(input: Partial<PdosVisualIssue> = {}): PdosVisualIssue {
  return {
    code: input.code ?? "horizontal_overflow",
    severity: input.severity ?? "error",
    message: input.message ?? "Synthetic issue.",
    ...(input.viewport === undefined ? {} : { viewport: input.viewport })
  };
}

const emptyBaseline = { schema: "test", generated_on: "test", note: "empty", components: [] } as const;

describe("Product Design OS profile check matrix", () => {
  it("parses, is schema-valid, and enumerates every known gate code with all four profiles", () => {
    const rawMatrix = readJson(matrixPath);
    const schema = readJson(matrixSchemaPath);
    expect(validateJsonSchema(rawMatrix, schema)).toEqual([]);

    const matrix = loadProfileCheckMatrix(matrixPath);
    const codes = matrix.checks.map((entry) => entry.code);
    expect([...codes].sort()).toEqual([...expectedCodes].sort());

    for (const entry of matrix.checks) {
      for (const profile of PAGE_PROFILES) {
        expect(["blocking", "advisory", "skipped"]).toContain(entry[profile]);
      }
    }
  });

  it("keeps balanced and seo_led fully blocking and floor codes blocking in every profile", () => {
    const matrix = loadProfileCheckMatrix(matrixPath);
    const byCode = new Map(matrix.checks.map((entry) => [entry.code, entry]));

    for (const entry of matrix.checks) {
      expect(`${entry.code}:balanced:${entry.balanced}`).toBe(`${entry.code}:balanced:blocking`);
      expect(`${entry.code}:seo_led:${entry.seo_led}`).toBe(`${entry.code}:seo_led:blocking`);
    }

    for (const code of floorCodes) {
      const entry = byCode.get(code);
      expect(entry).toBeDefined();
      for (const profile of PAGE_PROFILES) {
        expect(`${code}:${profile}:${entry?.[profile]}`).toBe(`${code}:${profile}:blocking`);
      }
    }

    // Regression guard: the ONLY non-blocking cells in the shipped matrix are the
    // two recorded experimental_showcase downgrades.
    const nonBlockingCells = matrix.checks.flatMap((entry) =>
      PAGE_PROFILES.filter((profile) => entry[profile] !== "blocking").map((profile) => `${entry.code}:${profile}:${entry[profile]}`)
    );
    expect(nonBlockingCells.sort()).toEqual([
      "fixed_height_floor_risk:experimental_showcase:advisory",
      "thin_visible_content:experimental_showcase:advisory"
    ]);
  });

  it("fails closed: unknown codes and missing profile entries resolve to blocking", () => {
    const matrix = loadProfileCheckMatrix(matrixPath);
    expect(resolveCheckSeverity("definitely_not_a_known_code", "experimental_showcase", matrix)).toBe("blocking");
    expect(resolveCheckSeverity("definitely_not_a_known_code", "balanced", matrix)).toBe("blocking");

    const brokenMatrix = {
      schema: "autopilot-beta/pdos-profile-check-matrix@1",
      version: 1,
      checks: [{ code: "half_defined_code", seo_led: "advisory", balanced: "advisory" }]
    } as unknown as ProfileCheckMatrix;
    expect(resolveCheckSeverity("half_defined_code", "experimental_showcase", brokenMatrix)).toBe("blocking");
  });

  it("rejects structurally invalid matrices and unknown profiles loudly", () => {
    expect(() => syntheticMatrix([matrixEntry("dup_code"), matrixEntry("dup_code")])).toThrow(/duplicate/i);
    expect(() =>
      syntheticMatrix([{ ...matrixEntry("bad_severity"), balanced: "warn" }])
    ).toThrow(/balanced/);
    expect(() =>
      syntheticMatrix([{ ...matrixEntry("extra_key"), unexpected: true }])
    ).toThrow(/unknown key/i);
    expect(() => syntheticMatrix([])).toThrow(/non-empty/i);
    expect(() => parsePageProfile("bogus_profile")).toThrow(/bogus_profile/);
    for (const profile of PAGE_PROFILES) {
      expect(parsePageProfile(profile)).toBe(profile);
    }
    expect(DEFAULT_PAGE_PROFILE).toBe("balanced");
  });
});

describe("Product Design OS fit-safety gate under page profiles", () => {
  const fixedHeightCss = `
.synthetic-stage .stage {
  min-height: 100vh;
}
`.trim();

  it("keeps default (balanced) behavior identical: fixed height floor blocks", () => {
    const report = analyzeFitSafetyLint(
      { components: [{ id: "synthetic-stage", css: fixedHeightCss }], pages: [], baseline: emptyBaseline },
      repoRoot
    );

    expect(report.ok).toBe(false);
    expect(report.profile_gate.profile).toBe("balanced");
    expect(report.profile_gate.downgraded_to_advisory).toEqual([]);
    expect(report.profile_gate.skipped).toEqual([]);
    expect(report.components[0]?.status).toBe("fail");
    expect(report.components[0]?.findings[0]?.code).toBe("fixed_height_floor_risk");
    expect(report.components[0]?.findings[0]?.severity).toBe("error");
    expect(report.components[0]?.findings[0]?.gate).toBe("blocking");
  });

  it("downgrades fixed_height_floor_risk to reported-advisory under experimental_showcase", () => {
    const report = analyzeFitSafetyLint(
      {
        components: [{ id: "synthetic-stage", css: fixedHeightCss }],
        pages: [],
        baseline: emptyBaseline,
        profile: "experimental_showcase"
      },
      repoRoot
    );

    expect(report.ok).toBe(true);
    expect(report.components[0]?.status).toBe("warn");
    // Not silently hidden: the finding is still reported and the downgrade is recorded.
    expect(report.components[0]?.findings[0]?.code).toBe("fixed_height_floor_risk");
    expect(report.components[0]?.findings[0]?.severity).toBe("warning");
    expect(report.components[0]?.findings[0]?.gate).toBe("advisory_profile");
    expect(report.profile_gate.profile).toBe("experimental_showcase");
    expect(report.profile_gate.downgraded_to_advisory).toEqual([{ code: "fixed_height_floor_risk", count: 1 }]);
  });

  it("keeps floor codes blocking even under experimental_showcase", () => {
    const report = analyzeFitSafetyLint(
      {
        components: [{ id: "synthetic-floor", css: ".synthetic-floor .full { width: 100vw; }" }],
        pages: [],
        baseline: emptyBaseline,
        profile: "experimental_showcase"
      },
      repoRoot
    );

    expect(report.ok).toBe(false);
    expect(report.components[0]?.status).toBe("fail");
    expect(report.components[0]?.findings.map((finding) => finding.code)).toContain("viewport_width_overflow_risk");
    expect(report.profile_gate.downgraded_to_advisory).toEqual([]);
  });

  it("drops skipped findings from counting but records them (synthetic matrix)", () => {
    const matrix = syntheticMatrix([matrixEntry("fixed_height_floor_risk", { balanced: "skipped" })]);
    const report = analyzeFitSafetyLint(
      {
        components: [{ id: "synthetic-stage", css: fixedHeightCss }],
        pages: [],
        baseline: emptyBaseline,
        profile: "balanced",
        profileMatrix: matrix
      },
      repoRoot
    );

    expect(report.ok).toBe(true);
    expect(report.components[0]?.status).toBe("pass");
    expect(report.components[0]?.findings).toEqual([]);
    expect(report.profile_gate.skipped).toEqual([{ code: "fixed_height_floor_risk", count: 1 }]);
  });

  it("accepts --profile on the CLI, defaults to balanced, and rejects unknown profiles", () => {
    const defaultRun = createFitSafetyLintCliRun(["--no-pages"], repoRoot);
    const balancedRun = createFitSafetyLintCliRun(["--no-pages", "--profile", "balanced"], repoRoot);

    expect(defaultRun.exitCode).toBe(0);
    expect(balancedRun.exitCode).toBe(0);
    expect(defaultRun.report.profile_gate.profile).toBe("balanced");
    // Explicit balanced is exactly the default behavior.
    expect(balancedRun.report).toEqual(defaultRun.report);
    expect(() => createFitSafetyLintCliRun(["--no-pages", "--profile", "bogus"], repoRoot)).toThrow(/bogus/);
  });
});

describe("Product Design OS browser visual QA gate under page profiles", () => {
  it("keeps floor analyzer errors blocking in every profile", () => {
    for (const profile of PAGE_PROFILES) {
      const classification = classifyVisualQaBrowserReport({
        analyzerIssues: [analyzerIssue({ code: "horizontal_overflow", viewport: "mobile-320" })],
        axeViolations: [],
        errors: [],
        profile
      });
      expect(classification.status).toBe("failed");
      expect(classification.blocking_reasons).toContain("analyzer_error:horizontal_overflow:mobile-320");
      expect(classification.profile).toBe(profile);
    }
  });

  it("downgrades matrix-advisory analyzer errors to reported-not-blocking under experimental_showcase only", () => {
    const issue = analyzerIssue({ code: "thin_visible_content", viewport: "mobile-320" });

    const balanced = classifyVisualQaBrowserReport({ analyzerIssues: [issue], axeViolations: [], errors: [] });
    expect(balanced.status).toBe("failed");
    expect(balanced.profile).toBe("balanced");
    expect(balanced.blocking_reasons).toEqual(["analyzer_error:thin_visible_content:mobile-320"]);
    expect(balanced.downgraded_reasons).toEqual([]);

    const showcase = classifyVisualQaBrowserReport({
      analyzerIssues: [issue],
      axeViolations: [],
      errors: [],
      profile: "experimental_showcase"
    });
    expect(showcase.status).toBe("passed");
    expect(showcase.exitCode).toBe(0);
    expect(showcase.blocking_reasons).toEqual([]);
    // Not silently hidden: the downgraded reason is reported.
    expect(showcase.downgraded_reasons).toEqual(["analyzer_error:thin_visible_content:mobile-320"]);
  });

  it("keeps axe serious/critical blocking in every profile", () => {
    for (const profile of PAGE_PROFILES) {
      const classification = classifyVisualQaBrowserReport({
        analyzerIssues: [],
        axeViolations: [
          {
            id: "label",
            impact: "serious",
            help: "Form elements must have labels",
            nodes: [{ target: ["input"], html: "<input>" }]
          }
        ],
        errors: [],
        profile
      });
      expect(classification.status).toBe("failed");
      expect(classification.blocking_reasons).toEqual(["axe_serious:label"]);
    }
  });

  it("never downgrades runner errors, even when a matrix tries to", () => {
    const permissiveMatrix = syntheticMatrix([
      matrixEntry("runner_error", {
        seo_led: "advisory",
        balanced: "advisory",
        brand_led: "advisory",
        experimental_showcase: "advisory"
      })
    ]);
    const classification = classifyVisualQaBrowserReport({
      analyzerIssues: [],
      axeViolations: [],
      errors: ["Chromium crashed"],
      profile: "experimental_showcase",
      profileMatrix: permissiveMatrix
    });

    expect(classification.status).toBe("failed");
    expect(classification.blocking_reasons).toEqual(["runner_error:Chromium crashed"]);
    expect(classification.downgraded_reasons).toEqual([]);
  });

  it("reports the profile on the built report and defaults to balanced", () => {
    const defaultReport = buildVisualQaBrowserReport({
      source_kind: "html",
      source_path: "fixture.html",
      html_path: "fixture.html",
      report_path: "output/visual-qa-browser/fixture.visual-qa-browser.json",
      checked_viewports: [1440, 390],
      snapshot: snapshot(),
      axe_violations: []
    });
    expect(defaultReport.status).toBe("passed");
    expect(defaultReport.profile).toBe("balanced");
    expect(defaultReport.profile_downgraded_reasons).toEqual([]);
    expect(defaultReport.profile_skipped_reasons).toEqual([]);

    const brandLedReport = buildVisualQaBrowserReport({
      source_kind: "html",
      source_path: "fixture.html",
      html_path: "fixture.html",
      report_path: "output/visual-qa-browser/fixture.visual-qa-browser.json",
      checked_viewports: [1440, 390],
      snapshot: snapshot(),
      axe_violations: [],
      profile: "brand_led"
    });
    expect(brandLedReport.status).toBe("passed");
    expect(brandLedReport.profile).toBe("brand_led");
  });
});
