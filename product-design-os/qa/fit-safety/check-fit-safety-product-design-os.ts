import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getDefaultPdosCompositionSpecPaths } from "../../scripts/check-renderability-product-design-os";
import { patternComponentRegistry } from "../../renderer/pattern-component-registry";
import { renderCompositionPage } from "../../renderer/render-composition";

export type PdosFitSafetyStatus = "pass" | "warn" | "fail";
export type PdosFitSafetySeverity = "warning" | "error";
export type PdosFitSafetyFindingSource = "component_css" | "rendered_page";
export type PdosFitSafetyGate = "blocking" | "warn_only_baseline" | "advisory_page";

export type PdosFitSafetyPreconditionCode =
  | "font_clamp_min_below_floor"
  | "missing_mobile_breakpoint"
  | "grid_track_overflow_risk"
  | "fixed_text_container_inline_cap"
  | "text_wrap_safety_missing"
  | "viewport_width_overflow_risk"
  | "fixed_min_width_over_viewport"
  | "fixed_height_floor_risk"
  | "sticky_background_opacity_missing"
  | "transform_scale_on_interactive"
  | "page_lang_missing"
  | "page_lang_invalid";

export interface PdosFitSafetyFinding {
  readonly code: PdosFitSafetyPreconditionCode;
  readonly severity: PdosFitSafetySeverity;
  readonly source: PdosFitSafetyFindingSource;
  readonly gate: PdosFitSafetyGate;
  readonly precondition: string;
  readonly message: string;
  readonly snippet: string;
  readonly selector?: string;
  readonly property?: string;
  readonly path?: string | undefined;
}

export interface PdosFitSafetyComponentSource {
  readonly id: string;
  readonly css: string;
  readonly html?: string;
  readonly sourcePath?: string;
}

export interface PdosFitSafetyPageSource {
  readonly id: string;
  readonly path: string;
  readonly html: string;
}

export interface PdosFitSafetyBaselineComponent {
  readonly id: string;
  readonly css_sha256: string;
  readonly status: "warn-only";
  readonly reason?: string;
}

export interface PdosFitSafetyBaseline {
  readonly schema: string;
  readonly generated_on: string;
  readonly note: string;
  readonly components: readonly PdosFitSafetyBaselineComponent[];
}

export interface PdosFitSafetyComponentReport {
  readonly id: string;
  readonly status: PdosFitSafetyStatus;
  readonly baseline: "matched" | "changed" | "missing";
  readonly css_sha256: string;
  readonly source_path?: string;
  readonly findings: readonly PdosFitSafetyFinding[];
}

export interface PdosFitSafetyPageReport {
  readonly id: string;
  readonly path: string;
  readonly findings: readonly PdosFitSafetyFinding[];
}

export interface PdosFitSafetySummary {
  readonly component_count: number;
  readonly component_pass_count: number;
  readonly component_warn_count: number;
  readonly component_fail_count: number;
  readonly page_count: number;
  readonly warning_count: number;
  readonly error_count: number;
  readonly reason_counts: Readonly<Record<PdosFitSafetyPreconditionCode, number>>;
}

export interface PdosFitSafetyReport {
  readonly ok: boolean;
  readonly lint_kind: "source_precondition_lint_not_fit_proof";
  readonly components: readonly PdosFitSafetyComponentReport[];
  readonly pages: readonly PdosFitSafetyPageReport[];
  readonly summary: PdosFitSafetySummary;
}

export interface PdosFitSafetyLintInput {
  readonly components?: readonly PdosFitSafetyComponentSource[];
  readonly pages?: readonly PdosFitSafetyPageSource[];
  readonly baseline?: PdosFitSafetyBaseline;
  readonly includeRenderedExamples?: boolean;
}

export interface PdosFitSafetyCliRun {
  readonly report: PdosFitSafetyReport;
  readonly output: string;
  readonly exitCode: 0 | 1;
}

interface CssDeclaration {
  readonly property: string;
  readonly value: string;
}

interface CssRule {
  readonly selector: string;
  readonly declarations: readonly CssDeclaration[];
  readonly snippet: string;
}

interface RawFitSafetyFinding {
  readonly code: PdosFitSafetyPreconditionCode;
  readonly source: PdosFitSafetyFindingSource;
  readonly precondition: string;
  readonly message: string;
  readonly snippet: string;
  readonly selector?: string;
  readonly property?: string;
  readonly path?: string | undefined;
}

const DEFAULT_BASELINE_PATH = "product-design-os/qa/fit-safety/fit-safety-baseline.json";
const REM_IN_PX = 16;
const htmlLangPattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;

const componentSourcePaths: Readonly<Record<string, string>> = {
  "sharp-positioning-hero": "product-design-os/renderer/components/sharp-positioning-hero.ts",
  "proof-led-section": "product-design-os/renderer/components/proof-led-section.ts",
  "outcome-cta": "product-design-os/renderer/components/outcome-cta.ts",
  "dot-stage-hero": "product-design-os/renderer/components/dot-stage-hero.ts"
};

export function analyzeFitSafetyLint(input: PdosFitSafetyLintInput = {}, repoRoot = process.cwd()): PdosFitSafetyReport {
  const baseline = input.baseline ?? loadFitSafetyBaseline(repoRoot);
  const pages =
    input.pages ?? (input.includeRenderedExamples === false ? [] : renderDefaultExamplePages(repoRoot));
  const components = input.components ?? loadRegisteredComponentSources(pages);
  const baselineById = new Map(baseline.components.map((entry) => [entry.id, entry]));

  const componentReports = components
    .map((component) => analyzeComponent(component, baselineById))
    .sort((first, second) => first.id.localeCompare(second.id));
  const pageReports = pages.map(analyzeRenderedPage).sort((first, second) => first.path.localeCompare(second.path));
  const summary = summarizeFitSafety(componentReports, pageReports);

  return {
    ok: componentReports.every((component) => component.status !== "fail") && pageReports.every((page) =>
      page.findings.every((finding) => finding.severity !== "error")
    ),
    lint_kind: "source_precondition_lint_not_fit_proof",
    components: componentReports,
    pages: pageReports,
    summary
  };
}

export function hashFitSafetyComponentCss(css: string): string {
  return createHash("sha256").update(css).digest("hex");
}

export function loadFitSafetyBaseline(repoRoot = process.cwd(), baselinePath = DEFAULT_BASELINE_PATH): PdosFitSafetyBaseline {
  const absolutePath = resolve(repoRoot, baselinePath);
  if (!existsSync(absolutePath)) {
    return {
      schema: "autopilot-beta/pdos-fit-safety-baseline@1",
      generated_on: "missing",
      note: "Missing baseline; all components are treated as new.",
      components: []
    };
  }

  const value = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
  if (!isRecord(value) || !Array.isArray(value.components)) {
    throw new Error(`Fit-safety baseline must be an object with components: ${baselinePath}`);
  }

  return {
    schema: typeof value.schema === "string" ? value.schema : "autopilot-beta/pdos-fit-safety-baseline@1",
    generated_on: typeof value.generated_on === "string" ? value.generated_on : "unknown",
    note: typeof value.note === "string" ? value.note : "",
    components: value.components.filter(isBaselineComponent)
  };
}

export function formatFitSafetyReport(report: PdosFitSafetyReport, format: "json" | "markdown" = "json"): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  return `${[
    "# Product & Design OS Fit Safety Lint Report",
    "",
    "This is a source-precondition lint, not a browser fit proof.",
    "",
    "## Summary",
    `- OK: ${String(report.ok)}`,
    `- Components: ${report.summary.component_count}`,
    `- Component pass/warn/fail: ${report.summary.component_pass_count}/${report.summary.component_warn_count}/${report.summary.component_fail_count}`,
    `- Pages: ${report.summary.page_count}`,
    `- Warnings: ${report.summary.warning_count}`,
    `- Errors: ${report.summary.error_count}`,
    "",
    "## Components",
    ...report.components.flatMap(formatComponentMarkdown),
    "",
    "## Rendered Pages",
    ...report.pages.flatMap(formatPageMarkdown)
  ].join("\n").trimEnd()}\n`;
}

export function createFitSafetyLintCliRun(cliArgs: readonly string[], repoRoot = process.cwd()): PdosFitSafetyCliRun {
  const args = parseArgs(cliArgs);
  const baseline = loadFitSafetyBaseline(repoRoot, args.baselinePath ?? DEFAULT_BASELINE_PATH);
  const report = analyzeFitSafetyLint({ baseline, includeRenderedExamples: !args.noPages }, repoRoot);

  return {
    report,
    output: formatFitSafetyReport(report, args.format),
    exitCode: report.ok ? 0 : 1
  };
}

export function applyFitSafetyLintCliExitCode(report: PdosFitSafetyReport): 0 | 1 {
  const exitCode = report.ok ? 0 : 1;
  process.exitCode = exitCode;
  return exitCode;
}

function analyzeComponent(
  component: PdosFitSafetyComponentSource,
  baselineById: ReadonlyMap<string, PdosFitSafetyBaselineComponent>
): PdosFitSafetyComponentReport {
  const cssHash = hashFitSafetyComponentCss(component.css);
  const baselineEntry = baselineById.get(component.id);
  const baselineStatus = baselineEntry === undefined ? "missing" : baselineEntry.css_sha256 === cssHash ? "matched" : "changed";
  const gate: PdosFitSafetyGate = baselineStatus === "matched" ? "warn_only_baseline" : "blocking";
  const severity: PdosFitSafetySeverity = gate === "blocking" ? "error" : "warning";
  const findings = lintComponentCss(component).map((finding) => toGatedFinding(finding, gate, severity));
  const status: PdosFitSafetyStatus = findings.length === 0 ? "pass" : gate === "blocking" ? "fail" : "warn";

  const report: {
    id: string;
    status: PdosFitSafetyStatus;
    baseline: "matched" | "changed" | "missing";
    css_sha256: string;
    source_path?: string;
    findings: readonly PdosFitSafetyFinding[];
  } = {
    id: component.id,
    status,
    baseline: baselineStatus,
    css_sha256: cssHash,
    findings
  };

  if (component.sourcePath !== undefined) {
    report.source_path = component.sourcePath;
  }

  return report;
}

function analyzeRenderedPage(page: PdosFitSafetyPageSource): PdosFitSafetyPageReport {
  const findings = lintRenderedPage(page).map((finding) => {
    const isLangProblem =
      finding.code === "page_lang_missing" || finding.code === "page_lang_invalid";
    return toGatedFinding(finding, "advisory_page", isLangProblem ? "error" : "warning");
  });

  return {
    id: page.id,
    path: page.path,
    findings
  };
}

// R2/R8: a PURE fixed unit (e.g. "600px", "100vh") — not inside clamp/calc/min/max/var — returns its number.
function fixedUnit(value: string, unit: "px" | "vh"): number | undefined {
  const trimmed = value.trim();
  if (/\b(?:clamp|calc|min|max|var)\s*\(/i.test(trimmed)) {
    return undefined;
  }
  const match = new RegExp(`^(\\d+(?:\\.\\d+)?)${unit}$`, "i").exec(trimmed);
  return match && match[1] !== undefined ? Number.parseFloat(match[1]) : undefined;
}

function lintComponentCss(component: PdosFitSafetyComponentSource): readonly RawFitSafetyFinding[] {
  const rules = parseCssRules(component.css);
  const customProperties = extractCustomProperties(component.css);
  const findings: RawFitSafetyFinding[] = [];

  if (!hasMobileMaxWidthBreakpoint(component.css)) {
    findings.push({
      code: "missing_mobile_breakpoint",
      source: "component_css",
      precondition: "Component responsive CSS must include a phone breakpoint at max-width 480px or narrower.",
      message: `${component.id} has no @media max-width <= 480px breakpoint.`,
      snippet: "@media (max-width: 480px)",
      path: component.sourcePath
    });
  }

  for (const rule of rules) {
    if (isRuleIgnored(rule.selector, component.html)) {
      continue;
    }

    const stickyPositionDeclaration = rule.declarations.find((declaration) => {
      return declaration.property.toLowerCase() === "position" && /\b(?:sticky|fixed)\b/i.test(declaration.value);
    });
    if (stickyPositionDeclaration !== undefined && !hasOpaqueBackgroundColor(rule, customProperties)) {
      findings.push({
        code: "sticky_background_opacity_missing",
        source: "component_css",
        precondition: "Sticky/fixed elements must declare an opaque background-color fallback so content cannot bleed through without backdrop-filter.",
        message: `${component.id} ${rule.selector} uses position: ${stickyPositionDeclaration.value} without an opaque background-color fallback.`,
        selector: rule.selector,
        property: stickyPositionDeclaration.property,
        snippet: declarationSnippet(rule, stickyPositionDeclaration),
        path: component.sourcePath
      });
    }

    for (const declaration of rule.declarations) {
      if (declaration.property === "font-size" && declaration.value.includes("clamp(")) {
        findings.push(...lintFontClamp(component, rule, declaration, customProperties, "component_css"));
      }

      if (declaration.property === "grid-template-columns") {
        const gridIssue = lintGridTrack(component, rule, declaration, "component_css");
        if (gridIssue !== undefined) {
          findings.push(gridIssue);
        }
      }

      if (
        declaration.property === "transform" &&
        isTextishSelector(rule.selector) &&
        /\bscale\s*\(/i.test(declaration.value)
      ) {
        findings.push({
          code: "transform_scale_on_interactive",
          source: "component_css",
          precondition: "Interactive/text-ish selectors must not use transform scale() as a fit fix; use responsive sizing and layout instead.",
          message: `${component.id} ${rule.selector} uses ${declaration.property}: ${declaration.value}.`,
          selector: rule.selector,
          property: declaration.property,
          snippet: declarationSnippet(rule, declaration),
          path: component.sourcePath
        });
      }

      if (
        (declaration.property === "width" || declaration.property === "max-width") &&
        isTextishSelector(rule.selector) &&
        isFixedInlineCap(declaration.value)
      ) {
        findings.push({
          code: "fixed_text_container_inline_cap",
          source: "component_css",
          precondition: "Text containers must avoid fixed px/rem width or max-width caps that can clip responsive copy.",
          message: `${component.id} ${rule.selector} uses ${declaration.property}: ${declaration.value}.`,
          selector: rule.selector,
          property: declaration.property,
          snippet: declarationSnippet(rule, declaration),
          path: component.sourcePath
        });
      }

      // R3: 100vw on a content width includes the scrollbar gutter -> horizontal overflow (calc(100vw - …) is OK).
      if (
        (declaration.property === "width" || declaration.property === "min-width") &&
        /\b100vw\b/.test(declaration.value) &&
        !/\b(?:calc|clamp|min|max|var)\s*\(/i.test(declaration.value)
      ) {
        findings.push({
          code: "viewport_width_overflow_risk",
          source: "component_css",
          precondition: "Content width must not use 100vw (it includes the scrollbar gutter and overflows horizontally); use 100%.",
          message: `${component.id} ${rule.selector} uses ${declaration.property}: ${declaration.value}.`,
          selector: rule.selector,
          property: declaration.property,
          snippet: declarationSnippet(rule, declaration),
          path: component.sourcePath
        });
      }

      // R2: a fixed min-width wider than the smallest phone viewport (320px) forces horizontal scroll.
      if (declaration.property === "min-width") {
        const px = fixedUnit(declaration.value, "px");
        if (px !== undefined && px > 320) {
          findings.push({
            code: "fixed_min_width_over_viewport",
            source: "component_css",
            precondition: "Content must not set a fixed min-width above the 320px viewport floor; wide tables/media use an overflow wrapper.",
            message: `${component.id} ${rule.selector} sets min-width: ${declaration.value} (> 320px).`,
            selector: rule.selector,
            property: declaration.property,
            snippet: declarationSnippet(rule, declaration),
            path: component.sourcePath
          });
        }
      }

      // R8: fixed px/vh height floors on content clip copy that wraps to more lines on narrow screens.
      if (declaration.property === "height" || declaration.property === "min-height") {
        const px = fixedUnit(declaration.value, "px");
        const vh = fixedUnit(declaration.value, "vh");
        if ((px !== undefined && px >= 240) || (vh !== undefined && vh >= 100)) {
          findings.push({
            code: "fixed_height_floor_risk",
            source: "component_css",
            precondition: "Content heights should follow content, not fixed px/vh floors that clip copy on narrow screens.",
            message: `${component.id} ${rule.selector} uses ${declaration.property}: ${declaration.value}.`,
            selector: rule.selector,
            property: declaration.property,
            snippet: declarationSnippet(rule, declaration),
            path: component.sourcePath
          });
        }
      }
    }
  }

  return findings;
}

function lintRenderedPage(page: PdosFitSafetyPageSource): readonly RawFitSafetyFinding[] {
  const findings: RawFitSafetyFinding[] = [];
  const langMatch = /<html\b[^>]*\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(page.html);
  const lang = langMatch?.[1] ?? langMatch?.[2] ?? langMatch?.[3];

  if (lang === undefined || lang.trim().length === 0) {
    findings.push({
      code: "page_lang_missing",
      source: "rendered_page",
      precondition: "Rendered pages must emit a real lang attribute.",
      message: `${page.path} does not emit an html lang attribute.`,
      snippet: page.html.slice(0, 120),
      path: page.path
    });
  } else if (!htmlLangPattern.test(lang.trim())) {
    findings.push({
      code: "page_lang_invalid",
      source: "rendered_page",
      precondition: "Rendered page lang must be a short BCP 47 language tag.",
      message: `${page.path} emits invalid lang="${lang}".`,
      snippet: langMatch?.[0] ?? `<html lang="${lang}">`,
      path: page.path
    });
  }

  const css = extractStyleBlocks(page.html).join("\n\n");
  findings.push(...lintRenderedPageTextWrap(page, css));
  findings.push(...lintRenderedPageFluidTypeVars(page, css));

  return findings;
}

function lintRenderedPageTextWrap(page: PdosFitSafetyPageSource, css: string): readonly RawFitSafetyFinding[] {
  const rules = parseCssRules(css);
  const hasHeadingWrap = rules.some((rule) => {
    const selector = rule.selector.toLowerCase();
    return selector.includes(":where(h1") && hasDeclaration(rule, "overflow-wrap") && hasDeclaration(rule, "hyphens");
  });
  const hasBodyWrap = rules.some((rule) => {
    const selector = rule.selector.toLowerCase();
    return selector.includes(":where(p") && selector.includes("span") && hasDeclaration(rule, "overflow-wrap") && hasDeclaration(rule, "hyphens");
  });
  const findings: RawFitSafetyFinding[] = [];

  if (!hasHeadingWrap) {
    findings.push({
      code: "text_wrap_safety_missing",
      source: "rendered_page",
      precondition: "Rendered pages must emit heading overflow-wrap and hyphens rules from the F1 type system.",
      message: `${page.path} is missing the heading wrap safety rule.`,
      snippet: ".pdos-page :where(h1, h2, h3, h4, h5, h6)",
      path: page.path
    });
  }

  if (!hasBodyWrap) {
    findings.push({
      code: "text_wrap_safety_missing",
      source: "rendered_page",
      precondition: "Rendered pages must emit body/link/span overflow-wrap and hyphens rules from the F1 type system.",
      message: `${page.path} is missing the body text wrap safety rule.`,
      snippet: ".pdos-page :where(p, li, a, span)",
      path: page.path
    });
  }

  return findings;
}

function lintRenderedPageFluidTypeVars(page: PdosFitSafetyPageSource, css: string): readonly RawFitSafetyFinding[] {
  const rules = parseCssRules(css);
  const customProperties = extractCustomProperties(css);
  const findings: RawFitSafetyFinding[] = [];

  for (const rule of rules) {
    for (const declaration of rule.declarations) {
      if (!declaration.property.startsWith("--pdos-type-") || !declaration.value.includes("clamp(")) {
        continue;
      }
      findings.push(...lintFontClamp({ id: page.id, sourcePath: page.path }, rule, declaration, customProperties, "rendered_page"));
    }
  }

  return findings;
}

function lintFontClamp(
  owner: { readonly id: string; readonly sourcePath?: string },
  rule: CssRule,
  declaration: CssDeclaration,
  customProperties: ReadonlyMap<string, string>,
  source: PdosFitSafetyFindingSource
): readonly RawFitSafetyFinding[] {
  const findings: RawFitSafetyFinding[] = [];
  const clamps = extractCssFunctionArgs(declaration.value, "clamp");
  const floor = legibleFloorFor(rule.selector, declaration.property);

  for (const args of clamps) {
    const minArg = args[0];
    if (minArg === undefined) {
      continue;
    }
    const minRem = resolveCssLengthToRem(minArg, customProperties);
    if (minRem === undefined || minRem >= floor.rem) {
      continue;
    }

    findings.push({
      code: "font_clamp_min_below_floor",
      source,
      precondition: `Text-ish clamp() minimums must stay at or above the ${floor.label} legibility floor.`,
      message: `${owner.id} ${rule.selector} has ${declaration.property} clamp min ${minArg.trim()} (${minRem.toFixed(3)}rem), below ${floor.rem}rem.`,
      selector: rule.selector,
      property: declaration.property,
      snippet: declarationSnippet(rule, declaration),
      path: owner.sourcePath
    });
  }

  return findings;
}

function lintGridTrack(
  component: PdosFitSafetyComponentSource,
  rule: CssRule,
  declaration: CssDeclaration,
  source: PdosFitSafetyFindingSource
): RawFitSafetyFinding | undefined {
  const reason = gridTrackOverflowReason(declaration.value);
  if (reason === undefined) {
    return undefined;
  }

  return {
    code: "grid_track_overflow_risk",
    source,
    precondition: "Grid tracks should use minmax(0, 1fr) or minmax(min(100%, ...), 1fr)-style guards instead of fixed tracks.",
    message: `${component.id} ${rule.selector} has ${declaration.property}: ${declaration.value}. ${reason}`,
    selector: rule.selector,
    property: declaration.property,
    snippet: declarationSnippet(rule, declaration),
    path: component.sourcePath
  };
}

function gridTrackOverflowReason(value: string): string | undefined {
  if (/\b\d+(?:\.\d+)?px\b/i.test(value)) {
    return "Fixed px grid tracks can create horizontal overflow.";
  }

  if (/(^|[\s,])(?:auto|max-content|min-content)(?=$|[\s,)])/i.test(value)) {
    return "Intrinsic grid tracks can refuse to shrink around long text.";
  }

  const minmaxCalls = extractCssFunctionArgs(value, "minmax");
  for (const args of minmaxCalls) {
    const minTrack = args[0]?.trim().toLowerCase();
    if (minTrack === undefined) {
      continue;
    }
    if (minTrack === "0" || minTrack === "0px" || minTrack === "0rem" || minTrack.startsWith("min(100%")) {
      continue;
    }
    return `minmax() uses a non-zero minimum track (${args[0]?.trim()}) without min(100%, ...).`;
  }

  return undefined;
}

function toGatedFinding(
  finding: RawFitSafetyFinding,
  gate: PdosFitSafetyGate,
  severity: PdosFitSafetySeverity
): PdosFitSafetyFinding {
  const output: {
    code: PdosFitSafetyPreconditionCode;
    severity: PdosFitSafetySeverity;
    source: PdosFitSafetyFindingSource;
    gate: PdosFitSafetyGate;
    precondition: string;
    message: string;
    snippet: string;
    selector?: string;
    property?: string;
    path?: string;
  } = {
    code: finding.code,
    severity,
    source: finding.source,
    gate,
    precondition: finding.precondition,
    message: finding.message,
    snippet: finding.snippet
  };

  if (finding.selector !== undefined) {
    output.selector = finding.selector;
  }
  if (finding.property !== undefined) {
    output.property = finding.property;
  }
  if (finding.path !== undefined) {
    output.path = finding.path;
  }

  return output;
}

function loadRegisteredComponentSources(pages: readonly PdosFitSafetyPageSource[]): readonly PdosFitSafetyComponentSource[] {
  return Object.entries(patternComponentRegistry).map(([id, component]) => {
    const source: {
      id: string;
      css: string;
      html?: string;
      sourcePath?: string;
    } = {
      id,
      css: component.css
    };
    const html = pages
      .filter((page) => page.html.includes(`data-pattern-id="${id}"`))
      .map((page) => page.html)
      .join("\n\n");
    if (html.length > 0) {
      source.html = html;
    }
    const sourcePath = componentSourcePaths[id];
    if (sourcePath !== undefined) {
      source.sourcePath = sourcePath;
    }
    return source;
  });
}

function renderDefaultExamplePages(repoRoot: string): readonly PdosFitSafetyPageSource[] {
  const pdosRoot = join(repoRoot, "product-design-os");
  return getDefaultPdosCompositionSpecPaths(repoRoot).map((specPath) => {
    const absolutePath = resolve(repoRoot, specPath);
    const spec = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
    const page = renderCompositionPage(spec, pdosRoot);
    return {
      id: isRecord(spec) && typeof spec.id === "string" ? spec.id : basename(specPath, ".composition.json"),
      path: specPath,
      html: page.html
    };
  });
}

function summarizeFitSafety(
  components: readonly PdosFitSafetyComponentReport[],
  pages: readonly PdosFitSafetyPageReport[]
): PdosFitSafetySummary {
  const reasonCounts: Partial<Record<PdosFitSafetyPreconditionCode, number>> = {};
  let warningCount = 0;
  let errorCount = 0;

  for (const finding of [...components.flatMap((component) => component.findings), ...pages.flatMap((page) => page.findings)]) {
    reasonCounts[finding.code] = (reasonCounts[finding.code] ?? 0) + 1;
    if (finding.severity === "error") {
      errorCount += 1;
    } else {
      warningCount += 1;
    }
  }

  return {
    component_count: components.length,
    component_pass_count: components.filter((component) => component.status === "pass").length,
    component_warn_count: components.filter((component) => component.status === "warn").length,
    component_fail_count: components.filter((component) => component.status === "fail").length,
    page_count: pages.length,
    warning_count: warningCount,
    error_count: errorCount,
    reason_counts: Object.fromEntries(Object.entries(reasonCounts).sort()) as Readonly<Record<PdosFitSafetyPreconditionCode, number>>
  };
}

function parseCssRules(css: string): readonly CssRule[] {
  return parseCssBlock(stripCssComments(css));
}

function hasMobileMaxWidthBreakpoint(css: string): boolean {
  return extractMediaConditions(stripCssComments(css)).some(mediaConditionHasMobileMaxWidth);
}

function extractMediaConditions(css: string): readonly string[] {
  const conditions: string[] = [];
  const lowerCss = css.toLowerCase();
  let cursor = 0;

  while (cursor < css.length) {
    const mediaIndex = lowerCss.indexOf("@media", cursor);
    if (mediaIndex === -1) {
      break;
    }

    const conditionStart = mediaIndex + "@media".length;
    const openBrace = css.indexOf("{", conditionStart);
    if (openBrace === -1) {
      break;
    }

    const closeBrace = findMatchingBrace(css, openBrace);
    if (closeBrace === -1) {
      break;
    }

    conditions.push(normalizeWhitespace(css.slice(conditionStart, openBrace)));
    conditions.push(...extractMediaConditions(css.slice(openBrace + 1, closeBrace)));
    cursor = closeBrace + 1;
  }

  return conditions;
}

function mediaConditionHasMobileMaxWidth(condition: string): boolean {
  return (
    anyCssLengthAtOrBelow480(/\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)(px|rem|em)\s*\)/gi, condition) ||
    anyCssLengthAtOrBelow480(/\(\s*width\s*<=\s*(\d+(?:\.\d+)?)(px|rem|em)\s*\)/gi, condition) ||
    anyCssLengthAtOrBelow480(/\(\s*(\d+(?:\.\d+)?)(px|rem|em)\s*>=\s*width\s*\)/gi, condition)
  );
}

function anyCssLengthAtOrBelow480(pattern: RegExp, condition: string): boolean {
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(condition)) !== null) {
    const value = match[1];
    const unit = match[2];
    if (value !== undefined && unit !== undefined && cssLengthToPx(value, unit) <= 480) {
      return true;
    }
  }
  return false;
}

function cssLengthToPx(value: string, unit: string): number {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return Number.POSITIVE_INFINITY;
  }
  return unit.toLowerCase() === "px" ? numeric : numeric * REM_IN_PX;
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseCssBlock(css: string): readonly CssRule[] {
  const rules: CssRule[] = [];
  let cursor = 0;

  while (cursor < css.length) {
    const openBrace = css.indexOf("{", cursor);
    if (openBrace === -1) {
      break;
    }

    const selector = css.slice(cursor, openBrace).trim();
    const closeBrace = findMatchingBrace(css, openBrace);
    if (closeBrace === -1) {
      break;
    }

    const body = css.slice(openBrace + 1, closeBrace);
    if (body.includes("{")) {
      rules.push(...parseCssBlock(body));
    } else if (selector.length > 0 && !selector.startsWith("@")) {
      const normalizedSelector = normalizeWhitespace(selector);
      rules.push({
        selector: normalizedSelector,
        declarations: parseDeclarations(body),
        snippet: `${normalizedSelector} { ${normalizeWhitespace(body)} }`
      });
    }

    cursor = closeBrace + 1;
  }

  return rules;
}

function findMatchingBrace(value: string, openBrace: number): number {
  let depth = 0;
  for (let index = openBrace; index < value.length; index += 1) {
    const character = value[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function parseDeclarations(body: string): readonly CssDeclaration[] {
  return body
    .split(";")
    .map((rawDeclaration) => {
      const colon = rawDeclaration.indexOf(":");
      if (colon === -1) {
        return undefined;
      }
      const property = rawDeclaration.slice(0, colon).trim();
      const value = rawDeclaration.slice(colon + 1).trim();
      if (property.length === 0 || value.length === 0) {
        return undefined;
      }
      return { property, value };
    })
    .filter((declaration): declaration is CssDeclaration => declaration !== undefined);
}

function extractCustomProperties(css: string): ReadonlyMap<string, string> {
  const customProperties = new Map<string, string>();
  for (const rule of parseCssRules(css)) {
    for (const declaration of rule.declarations) {
      if (declaration.property.startsWith("--")) {
        customProperties.set(declaration.property, declaration.value);
      }
    }
  }
  return customProperties;
}

function extractStyleBlocks(html: string): readonly string[] {
  const blocks: string[] = [];
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

function extractCssFunctionArgs(value: string, functionName: string): readonly (readonly string[])[] {
  const calls: string[][] = [];
  const needle = `${functionName}(`.toLowerCase();
  let cursor = 0;
  const lowerValue = value.toLowerCase();

  while (cursor < value.length) {
    const start = lowerValue.indexOf(needle, cursor);
    if (start === -1) {
      break;
    }
    const argsStart = start + needle.length;
    const end = findMatchingParen(value, argsStart - 1);
    if (end === -1) {
      break;
    }
    calls.push(splitTopLevelComma(value.slice(argsStart, end)));
    cursor = end + 1;
  }

  return calls;
}

function findMatchingParen(value: string, openParen: number): number {
  let depth = 0;
  for (let index = openParen; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function splitTopLevelComma(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function resolveCssLengthToRem(value: string, customProperties: ReadonlyMap<string, string>, depth = 0): number | undefined {
  if (depth > 6) {
    return undefined;
  }

  const trimmed = value.trim();
  const varMatch = /^var\(\s*(--[a-z0-9-_]+)(?:\s*,\s*([\s\S]+))?\)$/i.exec(trimmed);
  if (varMatch !== null) {
    const variableName = varMatch[1];
    if (variableName === undefined) {
      return undefined;
    }
    const resolved = customProperties.get(variableName) ?? varMatch[2];
    return resolved === undefined ? undefined : resolveCssLengthToRem(resolved, customProperties, depth + 1);
  }

  const numberMatch = /^(-?(?:\d+|\d*\.\d+))(px|rem|em)?$/i.exec(trimmed);
  if (numberMatch === null) {
    return undefined;
  }

  const numeric = Number(numberMatch[1]);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  const unit = (numberMatch[2] ?? "rem").toLowerCase();
  return unit === "px" ? numeric / REM_IN_PX : numeric;
}

function legibleFloorFor(selector: string, property: string): { readonly rem: number; readonly label: string } {
  const normalized = `${selector} ${property}`.toLowerCase();
  if (normalized.includes("caption") || normalized.includes("kicker") || normalized.includes("eyebrow") || normalized.includes("source")) {
    return { rem: 0.8, label: "caption" };
  }
  return { rem: 1, label: "body/CTA" };
}

function isFixedInlineCap(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("min(100%") || normalized.includes("fit-content") || normalized.includes("max-content")) {
    return false;
  }
  return /^-?(?:\d+|\d*\.\d+)(?:px|rem)$/.test(normalized);
}

function hasOpaqueBackgroundColor(rule: CssRule, customProperties: ReadonlyMap<string, string>): boolean {
  return rule.declarations.some((declaration) => {
    return declaration.property.toLowerCase() === "background-color" && isOpaqueCssBackgroundColor(declaration.value, customProperties);
  });
}

function isOpaqueCssBackgroundColor(value: string, customProperties: ReadonlyMap<string, string>, depth = 0): boolean {
  if (depth > 6) {
    return false;
  }

  const trimmed = stripCssImportant(value).trim();
  const normalized = trimmed.toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  const varMatch = /^var\(\s*(--[a-z0-9-_]+)(?:\s*,\s*([\s\S]+))?\)$/i.exec(trimmed);
  if (varMatch !== null) {
    const variableName = varMatch[1];
    if (variableName === undefined) {
      return false;
    }
    const resolved = customProperties.get(variableName) ?? varMatch[2];
    return resolved !== undefined && isOpaqueCssBackgroundColor(resolved, customProperties, depth + 1);
  }

  if (["transparent", "none", "inherit", "initial", "unset", "revert", "revert-layer"].includes(normalized)) {
    return false;
  }

  if (/^#[0-9a-f]{3}$/i.test(trimmed) || /^#[0-9a-f]{6}$/i.test(trimmed)) {
    return true;
  }
  if (/^#[0-9a-f]{4}$/i.test(trimmed)) {
    return normalized[4] === "f";
  }
  if (/^#[0-9a-f]{8}$/i.test(trimmed)) {
    return normalized.slice(7) === "ff";
  }

  if (/^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(trimmed)) {
    return hasOpaqueCssColorAlpha(trimmed);
  }

  if (/\b(?:gradient|color-mix)\s*\(/i.test(trimmed)) {
    return false;
  }

  return /^[a-z][a-z0-9-]*$/i.test(trimmed);
}

function hasOpaqueCssColorAlpha(value: string): boolean {
  const openParen = value.indexOf("(");
  if (openParen === -1) {
    return false;
  }
  const closeParen = findMatchingParen(value, openParen);
  if (closeParen === -1) {
    return false;
  }

  const functionName = value.slice(0, openParen).trim().toLowerCase();
  const body = value.slice(openParen + 1, closeParen);
  const slash = topLevelCharacterIndex(body, "/");
  if (slash !== -1) {
    const alpha = parseCssAlpha(body.slice(slash + 1));
    return alpha !== undefined && alpha >= 1;
  }

  const commaParts = splitTopLevelComma(body);
  if (commaParts.length >= 4) {
    const alpha = parseCssAlpha(commaParts[3] ?? "");
    return alpha !== undefined && alpha >= 1;
  }

  return functionName !== "rgba" && functionName !== "hsla";
}

function topLevelCharacterIndex(value: string, needle: string): number {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === needle && depth === 0) {
      return index;
    }
  }
  return -1;
}

function parseCssAlpha(value: string): number | undefined {
  const normalized = stripCssImportant(value).trim();
  const percentageMatch = /^(-?(?:\d+|\d*\.\d+))%$/.exec(normalized);
  if (percentageMatch?.[1] !== undefined) return Number(percentageMatch[1]) / 100;
  const numberMatch = /^(-?(?:\d+|\d*\.\d+))$/.exec(normalized);
  return numberMatch?.[1] === undefined ? undefined : Number(numberMatch[1]);
}

function stripCssImportant(value: string): string {
  return value.replace(/\s*!important\s*$/i, "");
}

function isTextishSelector(selector: string): boolean {
  return /(^|[\s>+~,.#:])(?:h[1-6]|p|a|span|li)\b/i.test(selector) || /(?:^|[-_])(copy|text|title|headline|heading|eyebrow|kicker|source|proof|trust|statement|cta|label|content)(?:$|[-_])/i.test(selector) || /\.cta\b/i.test(selector);
}

function isRuleIgnored(selector: string, html: string | undefined): boolean {
  if (html === undefined) {
    return false;
  }
  if (selector.includes("dot-stage-hero__twin") && html.includes("data-dot-word") && html.includes("data-dot-twin")) {
    return true;
  }
  const classes = [...selector.matchAll(/\.([_a-zA-Z]+[_a-zA-Z0-9-]*)/g)].map((match) => match[1]).filter(isString);
  if (classes.length === 0 || !html.includes('data-fit-lint="ignore:')) {
    return false;
  }
  return classes.some((className) => elementWithClassHasIgnore(html, className));
}

function elementWithClassHasIgnore(html: string, className: string): boolean {
  const escapedClass = escapeRegExp(className);
  const classThenIgnore = new RegExp(`<[^>]*\\bclass=["'][^"']*\\b${escapedClass}\\b[^"']*["'][^>]*\\bdata-fit-lint=["']ignore:[^"']+["'][^>]*>`, "i");
  const ignoreThenClass = new RegExp(`<[^>]*\\bdata-fit-lint=["']ignore:[^"']+["'][^>]*\\bclass=["'][^"']*\\b${escapedClass}\\b[^"']*["'][^>]*>`, "i");
  return classThenIgnore.test(html) || ignoreThenClass.test(html);
}

function hasDeclaration(rule: CssRule, property: string): boolean {
  return rule.declarations.some((declaration) => declaration.property === property);
}

function declarationSnippet(rule: CssRule, declaration: CssDeclaration): string {
  return `${rule.selector} { ${declaration.property}: ${declaration.value}; }`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isBaselineComponent(value: unknown): value is PdosFitSafetyBaselineComponent {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.css_sha256 === "string" &&
    value.status === "warn-only"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatComponentMarkdown(component: PdosFitSafetyComponentReport): readonly string[] {
  return [
    `### ${component.id}`,
    `- Status: ${component.status}`,
    `- Baseline: ${component.baseline}`,
    `- Findings: ${component.findings.length}`,
    ...formatFindings(component.findings)
  ];
}

function formatPageMarkdown(page: PdosFitSafetyPageReport): readonly string[] {
  return [
    `### ${page.path}`,
    `- Findings: ${page.findings.length}`,
    ...formatFindings(page.findings)
  ];
}

function formatFindings(findings: readonly PdosFitSafetyFinding[]): readonly string[] {
  if (findings.length === 0) {
    return ["- None."];
  }
  return findings.map((finding) => {
    const selector = finding.selector !== undefined ? ` ${finding.selector}` : "";
    return `- [${finding.severity}] ${finding.code}${selector}: ${finding.message}`;
  });
}

function parseArgs(args: readonly string[]): {
  baselinePath?: string;
  format?: "json" | "markdown";
  noPages: boolean;
} {
  const result: {
    baselinePath?: string;
    format?: "json" | "markdown";
    noPages: boolean;
  } = { noPages: false };

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key === "--no-pages") {
      result.noPages = true;
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (key === "--baseline") {
      result.baselinePath = value;
      index += 1;
    } else if (key === "--format" && (value === "json" || value === "markdown")) {
      result.format = value;
      index += 1;
    }
  }

  return result;
}

function runCli(): void {
  try {
    const cliRun = createFitSafetyLintCliRun(process.argv.slice(2), process.cwd());
    process.stdout.write(cliRun.output);
    applyFitSafetyLintCliExitCode(cliRun.report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fit-safety lint failure.";
    console.error(`Fit-safety lint failed: ${message}`);
    process.exitCode = 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (invokedFile === currentFile || (invokedFile.length > 0 && relative(process.cwd(), invokedFile) === relative(process.cwd(), currentFile))) {
  runCli();
}
