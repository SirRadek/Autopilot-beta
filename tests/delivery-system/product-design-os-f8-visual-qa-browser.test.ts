import { describe, expect, it } from "vitest";

import {
  buildVisualQaBrowserReport,
  classifyVisualQaBrowserReport,
  type VisualQaBrowserAxeViolation,
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
    contrast_failures: input.contrast_failures ?? []
  };
}

function snapshot(viewports: readonly VisualQaBrowserViewportSnapshot[] = [
  viewport(),
  viewport({ name: "mobile-390", width: 390, height: 844 })
]): VisualQaBrowserSnapshot {
  return {
    url: "fixture://visual-qa-browser",
    project_type: "marketing_web",
    primary_goal: "Generate qualified requests.",
    target_users: ["buyer"],
    viewports,
    headings: ["Clear offer", "Proof before request"],
    ctas: ["Request a plan"],
    template_signals: []
  };
}

function axeViolation(input: Partial<VisualQaBrowserAxeViolation> = {}): VisualQaBrowserAxeViolation {
  return {
    id: input.id ?? "color-contrast",
    impact: input.impact ?? "moderate",
    help: input.help ?? "Elements must meet contrast requirements",
    nodes: input.nodes ?? [
      {
        target: ["a.cta"],
        html: "<a class=\"cta\">Request a plan</a>",
        failure_summary: "[desktop-1440] Fix contrast."
      }
    ]
  };
}

describe("Product Design OS F8 browser visual QA core integration", () => {
  it("passes a clean fake measured snapshot with no axe violations", () => {
    const report = buildVisualQaBrowserReport({
      source_kind: "composition",
      source_path: "product-design-os/specs/examples/buildable-marketing.composition.json",
      html_path: "output/visual-qa-browser/buildable-marketing.visual-qa-browser.html",
      report_path: "output/visual-qa-browser/buildable-marketing.visual-qa-browser.json",
      checked_viewports: [1440, 390],
      snapshot: snapshot(),
      axe_violations: []
    });

    expect(report.status).toBe("passed");
    expect(report.analyzer?.ok).toBe(true);
    expect(report.axe.serious_or_critical_count).toBe(0);
    expect(report.blocking_reasons).toEqual([]);
  });

  it("fails on analyzer errors derived from fake browser measurements", () => {
    const report = buildVisualQaBrowserReport({
      source_kind: "html",
      source_path: "fixture.html",
      html_path: "fixture.html",
      report_path: "output/visual-qa-browser/fixture.visual-qa-browser.json",
      checked_viewports: [1440, 390],
      snapshot: snapshot([
        viewport({
          name: "desktop-1440",
          horizontal_overflow: true,
          overflow_px: 18
        }),
        viewport({
          name: "mobile-390",
          width: 390,
          height: 844,
          low_contrast: true,
          contrast_failures: [
            {
              selector: ".muted",
              text_preview: "Muted text",
              ratio: 3.2,
              min_ratio: 4.5,
              foreground: "rgba(120, 120, 120, 1)",
              background: "rgba(255, 255, 255, 1)"
            }
          ]
        })
      ]),
      axe_violations: []
    });

    expect(report.status).toBe("failed");
    expect(report.blocking_reasons).toEqual(
      expect.arrayContaining([
        "analyzer_error:horizontal_overflow:desktop-1440",
        "analyzer_error:low_contrast:mobile-390"
      ])
    );
  });

  it("groups fake axe violations by impact and blocks serious or critical findings", () => {
    const report = buildVisualQaBrowserReport({
      source_kind: "composition",
      source_path: "product-design-os/specs/examples/zednik.composition.json",
      html_path: "output/visual-qa-browser/zednik.visual-qa-browser.html",
      report_path: "output/visual-qa-browser/zednik.visual-qa-browser.json",
      checked_viewports: [1440, 390],
      snapshot: snapshot(),
      axe_violations: [
        axeViolation({ id: "label", impact: "serious", help: "Form elements must have labels" }),
        axeViolation({ id: "document-title", impact: "critical", help: "Documents must have a title" }),
        axeViolation({ id: "landmark-one-main", impact: "moderate", help: "Document should have one main landmark" })
      ]
    });

    expect(report.status).toBe("failed");
    expect(report.axe.serious_or_critical_count).toBe(2);
    expect(report.axe.violations_by_impact.critical.map((violation) => violation.id)).toEqual(["document-title"]);
    expect(report.axe.violations_by_impact.serious.map((violation) => violation.id)).toEqual(["label"]);
    expect(report.blocking_reasons).toEqual([
      "axe_critical:document-title",
      "axe_serious:label"
    ]);
  });

  it("keeps moderate and minor axe findings non-blocking in the classifier", () => {
    const classification = classifyVisualQaBrowserReport({
      analyzerIssues: [],
      axeViolations: [
        axeViolation({ id: "region", impact: "moderate" }),
        axeViolation({ id: "skip-link", impact: "minor" })
      ],
      errors: []
    });

    expect(classification.status).toBe("passed");
    expect(classification.exitCode).toBe(0);
    expect(classification.blocking_reasons).toEqual([]);
  });
});
