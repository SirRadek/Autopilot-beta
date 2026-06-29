import {
  analyzeProductDesignVisualQa,
  type PdosVisualIssue,
  type PdosVisualQaInput,
  type PdosVisualQaReport,
  type PdosVisualViewportInput
} from "../../scripts/visual-qa-product-design-os";

export type VisualQaBrowserReportStatus = "passed" | "failed" | "skipped";
export type VisualQaBrowserSourceKind = "composition" | "html";
export type VisualQaBrowserFormat = "json" | "markdown";
export type VisualQaBrowserAxeImpact = "critical" | "serious" | "moderate" | "minor" | "unknown";

export interface VisualQaBrowserContrastFailure {
  readonly selector: string;
  readonly text_preview: string;
  readonly ratio: number;
  readonly min_ratio: number;
  readonly foreground: string;
  readonly background: string;
}

export interface VisualQaBrowserViewportSnapshot extends PdosVisualViewportInput {
  readonly h1_visible: boolean;
  readonly cta_target_min_44: boolean;
  readonly min_cta_target_px: number;
  readonly overlap_count: number;
  readonly overflow_px: number;
  readonly canvas_count: number;
  readonly active_motion_element_count: number;
  readonly reduce_motion_rule_count: number;
  readonly contrast_failures: readonly VisualQaBrowserContrastFailure[];
}

export interface VisualQaBrowserSnapshot extends Omit<PdosVisualQaInput, "viewports"> {
  readonly viewports: readonly VisualQaBrowserViewportSnapshot[];
}

export interface VisualQaBrowserAxeNode {
  readonly target: readonly string[];
  readonly html: string;
  readonly failure_summary?: string;
}

export interface VisualQaBrowserAxeViolation {
  readonly id: string;
  readonly impact: VisualQaBrowserAxeImpact;
  readonly help: string;
  readonly nodes: readonly VisualQaBrowserAxeNode[];
}

export type VisualQaBrowserAxeViolationsByImpact = Readonly<Record<VisualQaBrowserAxeImpact, readonly VisualQaBrowserAxeViolation[]>>;

export interface VisualQaBrowserAxeReport {
  readonly violations: readonly VisualQaBrowserAxeViolation[];
  readonly violations_by_impact: VisualQaBrowserAxeViolationsByImpact;
  readonly serious_or_critical_count: number;
}

export interface VisualQaBrowserReport {
  readonly schema: "autopilot-beta/pdos-visual-qa-browser-report@1";
  readonly status: VisualQaBrowserReportStatus;
  readonly source_kind: VisualQaBrowserSourceKind;
  readonly source_path: string;
  readonly html_path: string;
  readonly report_path: string;
  readonly checked_viewports: readonly number[];
  readonly snapshot: VisualQaBrowserSnapshot;
  readonly analyzer?: PdosVisualQaReport;
  readonly axe: VisualQaBrowserAxeReport;
  readonly blocking_reasons: readonly string[];
  readonly errors: readonly string[];
}

export interface VisualQaBrowserReportInput {
  readonly source_kind: VisualQaBrowserSourceKind;
  readonly source_path: string;
  readonly html_path: string;
  readonly report_path: string;
  readonly checked_viewports: readonly number[];
  readonly snapshot: VisualQaBrowserSnapshot;
  readonly axe_violations: readonly VisualQaBrowserAxeViolation[];
  readonly errors?: readonly string[];
}

export interface VisualQaBrowserClassification {
  readonly status: "passed" | "failed";
  readonly exitCode: 0 | 1;
  readonly blocking_reasons: readonly string[];
}

const axeImpacts = ["critical", "serious", "moderate", "minor", "unknown"] as const;

export function buildVisualQaBrowserReport(input: VisualQaBrowserReportInput): VisualQaBrowserReport {
  const analyzer = analyzeMeasuredVisualQaSnapshot(input.snapshot);
  const axeViolations = sortAxeViolations(input.axe_violations);
  const classification = classifyVisualQaBrowserReport({
    analyzerIssues: analyzer.issues,
    axeViolations,
    errors: input.errors ?? []
  });

  return {
    schema: "autopilot-beta/pdos-visual-qa-browser-report@1",
    status: classification.status,
    source_kind: input.source_kind,
    source_path: input.source_path,
    html_path: input.html_path,
    report_path: input.report_path,
    checked_viewports: input.checked_viewports,
    snapshot: input.snapshot,
    analyzer,
    axe: buildAxeReport(axeViolations),
    blocking_reasons: classification.blocking_reasons,
    errors: input.errors ?? []
  };
}

export function skippedVisualQaBrowserReport(input: {
  readonly source_kind: VisualQaBrowserSourceKind;
  readonly source_path: string;
  readonly html_path: string;
  readonly report_path: string;
  readonly checked_viewports: readonly number[];
  readonly message: string;
}): VisualQaBrowserReport {
  return {
    schema: "autopilot-beta/pdos-visual-qa-browser-report@1",
    status: "skipped",
    source_kind: input.source_kind,
    source_path: input.source_path,
    html_path: input.html_path,
    report_path: input.report_path,
    checked_viewports: input.checked_viewports,
    snapshot: { viewports: [] },
    axe: buildAxeReport([]),
    blocking_reasons: [input.message],
    errors: [input.message]
  };
}

export function analyzeMeasuredVisualQaSnapshot(snapshot: VisualQaBrowserSnapshot): PdosVisualQaReport {
  return analyzeProductDesignVisualQa(toAnalyzerInput(snapshot));
}

export function toAnalyzerInput(snapshot: VisualQaBrowserSnapshot): PdosVisualQaInput {
  const input: {
    url?: string;
    project_type?: string;
    primary_goal?: string;
    target_users?: readonly string[];
    viewports: readonly PdosVisualViewportInput[];
    headings?: readonly string[];
    ctas?: readonly string[];
    template_signals?: readonly string[];
  } = {
    viewports: snapshot.viewports.map(toAnalyzerViewport)
  };

  assignDefined(input, "url", snapshot.url);
  assignDefined(input, "project_type", snapshot.project_type);
  assignDefined(input, "primary_goal", snapshot.primary_goal);
  assignDefined(input, "target_users", snapshot.target_users);
  assignDefined(input, "headings", snapshot.headings);
  assignDefined(input, "ctas", snapshot.ctas);
  assignDefined(input, "template_signals", snapshot.template_signals);
  return input;
}

export function classifyVisualQaBrowserReport(input: {
  readonly analyzerIssues: readonly PdosVisualIssue[];
  readonly axeViolations: readonly VisualQaBrowserAxeViolation[];
  readonly errors?: readonly string[];
}): VisualQaBrowserClassification {
  const blockingReasons = [
    ...(input.errors ?? []).map((error) => `runner_error:${error}`),
    ...input.analyzerIssues
      .filter((issue) => issue.severity === "error")
      .map((issue) => `analyzer_error:${issue.code}${issue.viewport === undefined ? "" : `:${issue.viewport}`}`),
    ...sortAxeViolations(input.axeViolations)
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => `axe_${violation.impact}:${violation.id}`)
  ];

  return {
    status: blockingReasons.length === 0 ? "passed" : "failed",
    exitCode: blockingReasons.length === 0 ? 0 : 1,
    blocking_reasons: blockingReasons
  };
}

export function buildAxeReport(violations: readonly VisualQaBrowserAxeViolation[]): VisualQaBrowserAxeReport {
  const sorted = sortAxeViolations(violations);
  return {
    violations: sorted,
    violations_by_impact: groupAxeViolationsByImpact(sorted),
    serious_or_critical_count: sorted.filter((violation) => violation.impact === "critical" || violation.impact === "serious").length
  };
}

export function groupAxeViolationsByImpact(
  violations: readonly VisualQaBrowserAxeViolation[]
): VisualQaBrowserAxeViolationsByImpact {
  const grouped: Record<VisualQaBrowserAxeImpact, VisualQaBrowserAxeViolation[]> = {
    critical: [],
    serious: [],
    moderate: [],
    minor: [],
    unknown: []
  };

  for (const violation of sortAxeViolations(violations)) {
    grouped[violation.impact].push(violation);
  }

  return grouped;
}

export function formatVisualQaBrowserReport(
  report: VisualQaBrowserReport,
  format: VisualQaBrowserFormat = "json"
): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  const analyzerIssues = report.analyzer?.issues ?? [];
  return `${[
    "# Product Design OS Browser Visual QA",
    "",
    `- Status: ${report.status}`,
    `- Source: ${report.source_kind} ${report.source_path || "<missing>"}`,
    `- HTML: ${report.html_path || "<missing>"}`,
    `- Report: ${report.report_path || "<missing>"}`,
    `- Viewports: ${report.checked_viewports.join(", ") || "<none>"}`,
    `- Analyzer errors: ${analyzerIssues.filter((issue) => issue.severity === "error").length}`,
    `- Axe serious/critical: ${report.axe.serious_or_critical_count}`,
    "",
    "## Viewport Snapshot",
    ...formatViewportSnapshot(report.snapshot.viewports),
    "",
    "## Analyzer Issues",
    ...formatAnalyzerIssues(analyzerIssues),
    "",
    "## Axe Violations",
    ...formatAxeGroups(report.axe.violations_by_impact),
    "",
    "## Blocking Reasons",
    ...(report.blocking_reasons.length === 0 ? ["- None."] : report.blocking_reasons.map((reason) => `- ${reason}`)),
    "",
    "## Errors",
    ...(report.errors.length === 0 ? ["- None."] : report.errors.map((error) => `- ${error}`))
  ].join("\n").trimEnd()}\n`;
}

export function applyVisualQaBrowserCliExitCode(report: VisualQaBrowserReport): 0 | 1 {
  const exitCode = report.status === "passed" ? 0 : 1;
  process.exitCode = exitCode;
  return exitCode;
}

function toAnalyzerViewport(viewport: VisualQaBrowserViewportSnapshot): PdosVisualViewportInput {
  const output: {
    name: string;
    width?: number;
    height?: number;
    heading_count?: number;
    cta_count?: number;
    min_cta_target_px?: number;
    visible_text_characters?: number;
    repeated_card_count?: number;
    text_overlap?: boolean;
    horizontal_overflow?: boolean;
    low_contrast?: boolean;
    primary_content_in_canvas?: boolean;
    motion_level?: number;
    reduced_motion_supported?: boolean;
    text_fit?: boolean;
    clipped_text_count?: number;
    min_font_px?: number;
    max_line_length_ch?: number;
    fit_scale_min?: number;
  } = {
    name: viewport.name
  };

  assignDefined(output, "width", viewport.width);
  assignDefined(output, "height", viewport.height);
  assignDefined(output, "heading_count", viewport.heading_count);
  assignDefined(output, "cta_count", viewport.cta_count);
  assignDefined(output, "min_cta_target_px", viewport.min_cta_target_px);
  assignDefined(output, "visible_text_characters", viewport.visible_text_characters);
  assignDefined(output, "repeated_card_count", viewport.repeated_card_count);
  assignDefined(output, "text_overlap", viewport.text_overlap);
  assignDefined(output, "horizontal_overflow", viewport.horizontal_overflow);
  assignDefined(output, "low_contrast", viewport.low_contrast);
  assignDefined(output, "primary_content_in_canvas", viewport.primary_content_in_canvas);
  assignDefined(output, "motion_level", viewport.motion_level);
  assignDefined(output, "reduced_motion_supported", viewport.reduced_motion_supported);
  assignDefined(output, "text_fit", viewport.text_fit);
  assignDefined(output, "clipped_text_count", viewport.clipped_text_count);
  assignDefined(output, "min_font_px", viewport.min_font_px);
  assignDefined(output, "max_line_length_ch", viewport.max_line_length_ch);
  assignDefined(output, "fit_scale_min", viewport.fit_scale_min);
  return output;
}

function sortAxeViolations(violations: readonly VisualQaBrowserAxeViolation[]): readonly VisualQaBrowserAxeViolation[] {
  return [...violations].sort((first, second) => {
    const impactDelta = impactRank(first.impact) - impactRank(second.impact);
    if (impactDelta !== 0) {
      return impactDelta;
    }
    const idDelta = first.id.localeCompare(second.id);
    if (idDelta !== 0) {
      return idDelta;
    }
    return first.help.localeCompare(second.help);
  });
}

function impactRank(impact: VisualQaBrowserAxeImpact): number {
  const rank = axeImpacts.indexOf(impact);
  return rank === -1 ? axeImpacts.indexOf("unknown") : rank;
}

function formatViewportSnapshot(viewports: readonly VisualQaBrowserViewportSnapshot[]): readonly string[] {
  if (viewports.length === 0) {
    return ["- None."];
  }

  return viewports.map((viewport) => {
    return [
      `- ${viewport.name}:`,
      `overflow=${String(viewport.horizontal_overflow)}(${viewport.overflow_px}px)`,
      `overlap=${String(viewport.text_overlap)}(${viewport.overlap_count})`,
      `low_contrast=${String(viewport.low_contrast)}(${viewport.contrast_failures.length})`,
      `h1=${String(viewport.h1_visible)}`,
      `cta44=${String(viewport.cta_target_min_44)}`,
      `canvas_primary=${String(viewport.primary_content_in_canvas)}`,
      `motion=${viewport.motion_level ?? 0}`,
      `reduced_motion=${String(viewport.reduced_motion_supported)}`
    ].join(" ");
  });
}

function formatAnalyzerIssues(issues: readonly PdosVisualIssue[]): readonly string[] {
  if (issues.length === 0) {
    return ["- None."];
  }

  return issues.map((issue) => {
    const viewport = issue.viewport === undefined ? "" : ` (${issue.viewport})`;
    return `- [${issue.severity}] ${issue.code}${viewport}: ${issue.message}`;
  });
}

function formatAxeGroups(groups: VisualQaBrowserAxeViolationsByImpact): readonly string[] {
  const lines: string[] = [];
  for (const impact of axeImpacts) {
    const violations = groups[impact];
    lines.push(`- ${impact}: ${violations.length}`);
    for (const violation of violations) {
      lines.push(`  - ${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`);
    }
  }
  return lines;
}

function assignDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}
