import { describe, expect, it } from "vitest";

import {
  buildTextFitVisualQaRecord,
  classifyFitProbeFailures,
  classifyFitProbeViewport,
  computeVorMetric,
  type FitProbeElementMeasurement,
  type FitProbeRect,
  type FitProbeViewportMeasurement
} from "../../product-design-os/qa/fit-probe/fit-probe-core";

const rect: FitProbeRect = {
  x: 0,
  y: 0,
  width: 100,
  height: 40,
  right: 100,
  bottom: 40
};

function element(input: Partial<FitProbeElementMeasurement> = {}): FitProbeElementMeasurement {
  return {
    selector: input.selector ?? "p",
    role: input.role ?? "paragraph",
    tagName: input.tagName ?? "p",
    textPreview: input.textPreview ?? "Readable paragraph text.",
    textLength: input.textLength ?? 24,
    visible: input.visible ?? true,
    isHeading: input.isHeading ?? false,
    isCta: input.isCta ?? false,
    isCaption: input.isCaption ?? false,
    rect: input.rect ?? rect,
    clientWidth: input.clientWidth ?? 100,
    scrollWidth: input.scrollWidth ?? 100,
    clientHeight: input.clientHeight ?? 40,
    scrollHeight: input.scrollHeight ?? 40,
    fontPx: input.fontPx ?? 16,
    lineHeightPx: input.lineHeightPx ?? 24,
    lineCount: input.lineCount ?? 1,
    maxLineLengthCh: input.maxLineLengthCh ?? 48,
    maxUnbreakableTokenPx: input.maxUnbreakableTokenPx ?? 80,
    longestUnbreakableToken: input.longestUnbreakableToken ?? "Readable",
    overflowX: input.overflowX ?? "visible",
    overflowY: input.overflowY ?? "visible",
    textOverflow: input.textOverflow ?? "clip",
    webkitLineClamp: input.webkitLineClamp ?? "none"
  };
}

function measurement(input: Partial<FitProbeViewportMeasurement> = {}): FitProbeViewportMeasurement {
  return {
    name: input.name ?? "mobile-360",
    width: input.width ?? 360,
    height: input.height ?? 844,
    documentClientWidth: input.documentClientWidth ?? input.width ?? 360,
    documentScrollWidth: input.documentScrollWidth ?? input.width ?? 360,
    bodyClientWidth: input.bodyClientWidth ?? input.width ?? 360,
    bodyScrollWidth: input.bodyScrollWidth ?? input.width ?? 360,
    elements: input.elements ?? [element()],
    overlaps: input.overlaps ?? []
  };
}

describe("Product Design OS F3 fit probe core", () => {
  it("computes VOR from document horizontal scroll or clipped text only", () => {
    const passing = classifyFitProbeViewport(measurement({ name: "sweep-370", width: 370 }));
    const documentOverflow = classifyFitProbeViewport(
      measurement({ name: "sweep-360", width: 360, documentClientWidth: 360, documentScrollWidth: 372 })
    );
    const clipped = classifyFitProbeViewport(
      measurement({
        name: "sweep-380",
        width: 380,
        elements: [
          element({
            selector: ".clipped",
            clientWidth: 120,
            scrollWidth: 150,
            overflowX: "hidden"
          })
        ]
      })
    );
    const elementOverflowOnly = classifyFitProbeViewport(
      measurement({
        name: "sweep-390",
        width: 390,
        elements: [
          element({
            selector: ".overflowing-child",
            clientWidth: 120,
            scrollWidth: 150,
            overflowX: "visible"
          })
        ]
      })
    );

    const vor = computeVorMetric([passing, documentOverflow, clipped, elementOverflowOnly]);

    expect(vor.checkedWidthCount).toBe(4);
    expect(vor.failedWidthCount).toBe(2);
    expect(vor.failedWidths).toEqual([360, 380]);
    expect(vor.ratePercent).toBe(50);
  });

  it("builds F2-compatible text_fit visual_qa_probe viewport records", () => {
    const viewport = measurement({
      name: "desktop-1440",
      width: 1440,
      height: 1000,
      elements: [
        element({
          selector: "h1",
          role: "heading",
          tagName: "h1",
          isHeading: true,
          textLength: 36,
          fontPx: 48,
          maxLineLengthCh: 12
        }),
        element({
          selector: "a.cta",
          role: "cta",
          tagName: "a",
          isCta: true,
          textLength: 14,
          fontPx: 16,
          maxLineLengthCh: 14
        }),
        element({
          selector: ".source",
          role: "caption",
          isCaption: true,
          textLength: 18,
          fontPx: 12,
          maxLineLengthCh: 18
        })
      ]
    });

    const record = buildTextFitVisualQaRecord(viewport, []);

    expect(record).toMatchObject({
      name: "desktop-1440",
      width: 1440,
      height: 1000,
      heading_count: 1,
      cta_count: 1,
      visible_text_characters: 68,
      text_overlap: false,
      horizontal_overflow: false,
      text_fit: true,
      clipped_text_count: 0,
      min_font_px: 12,
      max_line_length_ch: 18,
      fit_scale_min: 1
    });
  });

  it("classifies fail signals with F2 invariant and QA issue codes", () => {
    const failures = classifyFitProbeFailures(
      measurement({
        width: 390,
        elements: [
          element({
            selector: ".bad-copy",
            clientWidth: 100,
            scrollWidth: 150,
            clientHeight: 40,
            scrollHeight: 64,
            overflowX: "hidden",
            overflowY: "hidden",
            fontPx: 14,
            maxUnbreakableTokenPx: 142,
            longestUnbreakableToken: "UnbreakableToken",
            maxLineLengthCh: 92
          })
        ],
        overlaps: [
          {
            firstSelector: ".bad-copy",
            secondSelector: "a.cta",
            firstPreview: "Bad copy",
            secondPreview: "CTA",
            areaPx: 18,
            rect
          }
        ]
      })
    );

    expect(failures.map((failure) => failure.kind)).toEqual(
      expect.arrayContaining([
        "clipped_text",
        "text_control_overlap",
        "font_below_legible_floor",
        "unbreakable_token_overflow",
        "excessive_line_length"
      ])
    );
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "clipped_text",
          invariantCode: "fits_viewport_range",
          qaIssueCode: "clipped_text_detected"
        }),
        expect.objectContaining({
          kind: "font_below_legible_floor",
          invariantCode: "min_legible_text",
          qaIssueCode: "min_font_below_legible_floor"
        }),
        expect.objectContaining({
          kind: "unbreakable_token_overflow",
          invariantCode: "no_text_overflow_at_breakpoints",
          qaIssueCode: "horizontal_overflow"
        })
      ])
    );
  });
});
