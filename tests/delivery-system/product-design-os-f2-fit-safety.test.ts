import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  analyzeFitSafetyLint,
  createFitSafetyLintCliRun,
  hashFitSafetyComponentCss,
  type PdosFitSafetyBaseline
} from "../../product-design-os/qa/fit-safety/check-fit-safety-product-design-os";
import { analyzeProductDesignVisualQa } from "../../product-design-os/scripts/visual-qa-product-design-os";
import { validateJsonSchema } from "../../src/lib/delivery-system/validation";

const repoRoot = process.cwd();
const pdosRoot = join(repoRoot, "product-design-os");

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecordProperty(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const property = value[key];
  if (!isRecord(property)) {
    throw new Error(`Expected object property ${key}.`);
  }
  return property;
}

function getRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

function baselineFor(id: string, css: string): PdosFitSafetyBaseline {
  return {
    schema: "autopilot-beta/pdos-fit-safety-baseline@1",
    generated_on: "test",
    note: "test baseline",
    components: [
      {
        id,
        css_sha256: hashFitSafetyComponentCss(css),
        status: "warn-only"
      }
    ]
  };
}

describe("Product Design OS F2 fit-safety lint", () => {
  it("runs on committed components as clean matched baselines and exits zero", () => {
    const cliRun = createFitSafetyLintCliRun(["--no-pages"], repoRoot);
    const statuses = new Set(cliRun.report.components.map((component) => component.status));

    expect(cliRun.exitCode).toBe(0);
    expect(cliRun.report.ok).toBe(true);
    expect(cliRun.report.components.map((component) => component.id).sort()).toEqual([
      "dot-stage-hero",
      "outcome-cta",
      "point-cloud-background",
      "proof-led-section",
      "sharp-positioning-hero",
      "tactile-shadow-hero"
    ]);
    expect(statuses).toEqual(new Set(["pass"]));
    expect(cliRun.report.components.every((component) => component.baseline === "matched")).toBe(true);
    expect(cliRun.report.summary.warning_count).toBe(0);
  });

  it("fails a synthetic new component with a clamp minimum below the legible floor", () => {
    const css = `
.synthetic-new h1 {
  font-size: clamp(0.72rem, 5vw, 3rem);
}
`.trim();
    const report = analyzeFitSafetyLint(
      {
        components: [{ id: "synthetic-new", css }],
        pages: [],
        baseline: { schema: "test", generated_on: "test", note: "empty", components: [] }
      },
      repoRoot
    );

    expect(report.ok).toBe(false);
    expect(report.components[0]?.status).toBe("fail");
    expect(report.components[0]?.findings.map((finding) => finding.code)).toContain("font_clamp_min_below_floor");
    expect(report.components[0]?.findings.every((finding) => finding.severity === "error")).toBe(true);
  });

  it("flags R2/R3/R8 mobile violations on a synthetic new component (100vw, fixed min-width, fixed height floor)", () => {
    const css = `
.synthetic-mobile .full { width: 100vw; }
.synthetic-mobile .wide { min-width: 600px; }
.synthetic-mobile .tall { min-height: 100vh; }
`.trim();
    const report = analyzeFitSafetyLint(
      {
        components: [{ id: "synthetic-mobile", css }],
        pages: [],
        baseline: { schema: "test", generated_on: "test", note: "empty", components: [] }
      },
      repoRoot
    );

    const codes = report.components[0]?.findings.map((finding) => finding.code) ?? [];
    expect(codes).toContain("viewport_width_overflow_risk");
    expect(codes).toContain("fixed_min_width_over_viewport");
    expect(codes).toContain("fixed_height_floor_risk");
    expect(report.components[0]?.status).toBe("fail");
  });

  it("flags R7 sticky/fixed rules without an opaque background fallback", () => {
    const unsafeCss = `
.synthetic-sticky .bar {
  position: sticky;
  top: 0;
  backdrop-filter: blur(18px);
}
`.trim();
    const safeCss = `
.synthetic-sticky-solid .bar {
  position: sticky;
  top: 0;
  background-color: rgb(255 255 255);
  backdrop-filter: blur(18px);
}
`.trim();
    const report = analyzeFitSafetyLint(
      {
        components: [
          { id: "synthetic-sticky", css: unsafeCss },
          { id: "synthetic-sticky-solid", css: safeCss }
        ],
        pages: [],
        baseline: { schema: "test", generated_on: "test", note: "empty", components: [] }
      },
      repoRoot
    );

    const reportsById = new Map(report.components.map((component) => [component.id, component]));
    expect(reportsById.get("synthetic-sticky")?.findings.map((finding) => finding.code)).toContain(
      "sticky_background_opacity_missing"
    );
    expect(reportsById.get("synthetic-sticky")?.status).toBe("fail");
    expect(reportsById.get("synthetic-sticky-solid")?.findings.map((finding) => finding.code)).not.toContain(
      "sticky_background_opacity_missing"
    );
    expect(reportsById.get("synthetic-sticky-solid")?.status).toBe("pass");
  });

  it("honors data-fit-lint ignore markers with reasons", () => {
    const css = `
.synthetic-title {
  font-size: clamp(0.72rem, 5vw, 3rem);
}
`.trim();
    const report = analyzeFitSafetyLint(
      {
        components: [
          {
            id: "synthetic-ignored",
            css,
            html: '<section data-pattern-id="synthetic-ignored"><h1 class="synthetic-title" data-fit-lint="ignore:test escape hatch">Title</h1></section>'
          }
        ],
        pages: [],
        baseline: { schema: "test", generated_on: "test", note: "empty", components: [] }
      },
      repoRoot
    );

    expect(report.ok).toBe(true);
    expect(report.components[0]?.status).toBe("pass");
    expect(report.components[0]?.findings).toEqual([]);
  });

  it("grandfathers existing baseline hashes as warnings instead of failures", () => {
    const css = `
.legacy-component h2 {
  font-size: clamp(0.72rem, 5vw, 3rem);
}
`.trim();
    const report = analyzeFitSafetyLint(
      {
        components: [{ id: "legacy-component", css }],
        pages: [],
        baseline: baselineFor("legacy-component", css)
      },
      repoRoot
    );

    expect(report.ok).toBe(true);
    expect(report.components[0]?.status).toBe("warn");
    expect(report.components[0]?.baseline).toBe("matched");
    expect(report.components[0]?.findings.every((finding) => finding.severity === "warning")).toBe(true);
  });

  it("accepts advisory visual_qa_probe text-fit viewport fields", () => {
    const schema = readJson(join(pdosRoot, "specs", "composition.schema.json"));
    const example = cloneRecord(readJson(join(pdosRoot, "specs", "examples", "buildable-marketing.composition.json")) as Record<string, unknown>);
    const visualQaProbe = getRecordProperty(example, "visual_qa_probe");
    const viewports = getRecordArray(visualQaProbe.viewports);
    const firstViewport = viewports[0];
    if (firstViewport === undefined) {
      throw new Error("Expected at least one viewport in buildable-marketing example.");
    }

    visualQaProbe.viewports = [
      {
        ...firstViewport,
        text_fit: false,
        clipped_text_count: 1,
        min_font_px: 11.5,
        max_line_length_ch: 92,
        fit_scale_min: 0.8
      },
      ...viewports.slice(1)
    ];

    expect(validateJsonSchema(example, schema)).toEqual([]);
    const report = analyzeProductDesignVisualQa(visualQaProbe as never);
    expect(report.ok).toBe(true);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "text_fit_probe_failed",
        "clipped_text_detected",
        "min_font_below_legible_floor",
        "line_length_above_readability_band",
        "fit_scale_below_advisory_floor"
      ])
    );
  });
});
