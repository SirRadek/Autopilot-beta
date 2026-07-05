import { describe, expect, it } from "vitest";

import { parseVisualQaProgressValues } from "../../product-design-os/qa/visual-qa-browser/check-visual-qa-browser-product-design-os";
import {
  buildVisualQaBrowserReport,
  formatVisualQaBrowserReport,
  type VisualQaBrowserProgressSnapshot,
  type VisualQaBrowserSnapshot,
  type VisualQaBrowserViewportSnapshot
} from "../../product-design-os/qa/visual-qa-browser/visual-qa-browser-core";

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
    cta_top_px: input.cta_top_px ?? 120,
    viewport_height_px: input.viewport_height_px ?? 900,
    above_fold_mobile: input.above_fold_mobile ?? true,
    contrast_failures: input.contrast_failures ?? [],
    ...(input.progress_snapshots === undefined ? {} : { progress_snapshots: input.progress_snapshots })
  };
}

function progressSnapshot(input: Partial<VisualQaBrowserProgressSnapshot> = {}): VisualQaBrowserProgressSnapshot {
  return {
    p: input.p ?? 0.5,
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
    motion_level: input.motion_level ?? 2,
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
    text_overlap_count: input.text_overlap_count ?? input.overlap_count ?? 0,
    overflow_px: input.overflow_px ?? 0,
    canvas_count: input.canvas_count ?? 0,
    active_motion_element_count: input.active_motion_element_count ?? 1,
    reduce_motion_rule_count: input.reduce_motion_rule_count ?? 1,
    cta_top_px: input.cta_top_px ?? 120,
    viewport_height_px: input.viewport_height_px ?? 900,
    above_fold_mobile: input.above_fold_mobile ?? true,
    contrast_failures: input.contrast_failures ?? []
  };
}

function snapshot(viewports: readonly VisualQaBrowserViewportSnapshot[]): VisualQaBrowserSnapshot {
  return {
    url: "fixture://p5-progress",
    project_type: "marketing_web",
    primary_goal: "Explain the motion state.",
    target_users: ["buyer"],
    viewports,
    headings: ["Progressive proof"],
    ctas: ["Request a demo"],
    template_signals: []
  };
}

describe("Product Design OS P5 visual QA progress capture", () => {
  it("parses valid --progress lists and rejects out-of-range values", () => {
    expect(parseVisualQaProgressValues("0,0.25, 0.5,0.75,1")).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(() => parseVisualQaProgressValues("0,-0.1,1")).toThrow(/between 0 and 1/);
    expect(() => parseVisualQaProgressValues("0,1.2")).toThrow(/between 0 and 1/);
    expect(() => parseVisualQaProgressValues("0,,1")).toThrow(/non-empty/);
  });

  it("reports a missing canonical hook as advisory without failing the report", () => {
    const report = buildVisualQaBrowserReport({
      source_kind: "html",
      source_path: "fixture.html",
      html_path: "fixture.html",
      report_path: "output/visual-qa-browser/fixture.visual-qa-browser.json",
      checked_viewports: [1440],
      snapshot: snapshot([viewport()]),
      axe_violations: [],
      additional_issues: [
        {
          code: "motion_debug_hook_missing",
          severity: "error",
          message: "Progress capture requested but window.__autopilotSetProgress was not available.",
          viewport: "desktop-1440"
        }
      ]
    });

    expect(report.status).toBe("passed");
    expect(report.blocking_reasons).toEqual([]);
    expect(report.profile_downgraded_reasons).toEqual(["analyzer_error:motion_debug_hook_missing:desktop-1440"]);
    expect(report.analyzer?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "motion_debug_hook_missing",
          viewport: "desktop-1440"
        })
      ])
    );
  });

  it("keeps per-point progress snapshot metrics in the report and markdown", () => {
    const report = buildVisualQaBrowserReport({
      source_kind: "html",
      source_path: "fixture.html",
      html_path: "fixture.html",
      report_path: "output/visual-qa-browser/fixture.visual-qa-browser.json",
      checked_viewports: [1440],
      snapshot: snapshot([
        viewport({
          progress_snapshots: [
            progressSnapshot({ p: 0, overflow_px: 0, text_overlap_count: 0 }),
            progressSnapshot({ p: 0.5, overflow_px: 0, text_overlap_count: 0 })
          ]
        })
      ]),
      axe_violations: []
    });

    expect(report.snapshot.viewports[0]?.progress_snapshots).toEqual([
      expect.objectContaining({ p: 0, overflow_px: 0, text_overlap_count: 0 }),
      expect.objectContaining({ p: 0.5, overflow_px: 0, text_overlap_count: 0 })
    ]);
    expect(formatVisualQaBrowserReport(report, "markdown")).toContain("## Progress Snapshots");
    expect(formatVisualQaBrowserReport(report, "markdown")).toContain("desktop-1440 p=0.5");
  });

  it("applies profile severity resolution to progress-point findings", () => {
    const report = buildVisualQaBrowserReport({
      source_kind: "html",
      source_path: "fixture.html",
      html_path: "fixture.html",
      report_path: "output/visual-qa-browser/fixture.visual-qa-browser.json",
      checked_viewports: [1440],
      snapshot: snapshot([
        viewport({
          progress_snapshots: [
            progressSnapshot({
              p: 0.5,
              horizontal_overflow: true,
              overflow_px: 18,
              text_fit: false
            })
          ]
        })
      ]),
      axe_violations: []
    });

    expect(report.status).toBe("failed");
    expect(report.blocking_reasons).toContain("analyzer_error:horizontal_overflow:desktop-1440@p=0.5");
  });
});
