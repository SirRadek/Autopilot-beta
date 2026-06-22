import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PdosVisualIssueSeverity = "info" | "warning" | "error";

export interface PdosVisualViewportInput {
  readonly name: string;
  readonly width?: number;
  readonly height?: number;
  readonly heading_count?: number;
  readonly cta_count?: number;
  readonly visible_text_characters?: number;
  readonly repeated_card_count?: number;
  readonly text_overlap?: boolean;
  readonly horizontal_overflow?: boolean;
  readonly low_contrast?: boolean;
  readonly primary_content_in_canvas?: boolean;
  readonly motion_level?: number;
  readonly reduced_motion_supported?: boolean;
}

export interface PdosVisualQaInput {
  readonly url?: string;
  readonly project_type?: string;
  readonly primary_goal?: string;
  readonly target_users?: readonly string[];
  readonly viewports: readonly PdosVisualViewportInput[];
  readonly headings?: readonly string[];
  readonly ctas?: readonly string[];
  readonly template_signals?: readonly string[];
}

export interface PdosVisualIssue {
  readonly code: string;
  readonly severity: PdosVisualIssueSeverity;
  readonly message: string;
  readonly viewport?: string;
}

export interface PdosVisualQaReport {
  readonly ok: boolean;
  readonly checked_viewports: readonly string[];
  readonly issues: readonly PdosVisualIssue[];
  readonly template_risk_score: number;
  readonly suggested_actions: readonly string[];
  readonly report_markdown: string;
}

const TEMPLATE_SIGNAL_WEIGHTS: Record<string, number> = {
  "generic-saas-hero": 3,
  "repeated-equal-card-grid": 3,
  "fake-dashboard": 4,
  "gradient-background": 2,
  "bento-grid": 2,
  "dark-neon-default": 3,
  "stock-like-media": 2
};

export function analyzeProductDesignVisualQa(input: PdosVisualQaInput | string): PdosVisualQaReport {
  const normalized = typeof input === "string" ? parseVisualQaInput(input) : input;
  const issues = [
    ...validateViewports(normalized),
    ...validateGlobalContent(normalized),
    ...detectTemplateRisk(normalized)
  ];
  const templateRiskScore = calculateTemplateRisk(normalized, issues);
  const suggestedActions = suggestActions(issues, templateRiskScore);
  const reportWithoutMarkdown = {
    ok: !issues.some((issue) => issue.severity === "error"),
    checked_viewports: normalized.viewports.map((viewport) => viewport.name),
    issues,
    template_risk_score: templateRiskScore,
    suggested_actions: suggestedActions
  };

  return {
    ...reportWithoutMarkdown,
    report_markdown: buildVisualQaMarkdown(normalized, reportWithoutMarkdown)
  };
}

export function formatVisualQaReport(report: PdosVisualQaReport, format: "json" | "markdown" = "json"): string {
  if (format === "markdown") {
    return `${report.report_markdown.trimEnd()}\n`;
  }
  const { report_markdown: _reportMarkdown, ...jsonReport } = report;
  return `${JSON.stringify(jsonReport, null, 2)}\n`;
}

function validateViewports(input: PdosVisualQaInput): readonly PdosVisualIssue[] {
  const issues: PdosVisualIssue[] = [];
  const viewportNames = input.viewports.map((viewport) => viewport.name.toLowerCase());

  if (input.viewports.length === 0) {
    return [
      {
        code: "missing_viewports",
        severity: "error",
        message: "Visual QA requires at least one checked viewport."
      }
    ];
  }

  if (!viewportNames.some((name) => name.includes("desktop"))) {
    issues.push({
      code: "desktop_viewport_missing",
      severity: "warning",
      message: "No desktop viewport was recorded."
    });
  }

  if (!viewportNames.some((name) => name.includes("mobile"))) {
    issues.push({
      code: "mobile_viewport_missing",
      severity: "warning",
      message: "No mobile viewport was recorded."
    });
  }

  for (const viewport of input.viewports) {
    if (viewport.horizontal_overflow) {
      issues.push({
        code: "horizontal_overflow",
        severity: "error",
        message: "Viewport has horizontal overflow.",
        viewport: viewport.name
      });
    }
    if (viewport.text_overlap) {
      issues.push({
        code: "text_overlap",
        severity: "error",
        message: "Viewport has overlapping text or controls.",
        viewport: viewport.name
      });
    }
    if (viewport.low_contrast) {
      issues.push({
        code: "low_contrast",
        severity: "error",
        message: "Viewport has low-contrast content.",
        viewport: viewport.name
      });
    }
    if (viewport.primary_content_in_canvas) {
      issues.push({
        code: "primary_content_hidden_in_canvas",
        severity: "error",
        message: "Primary content appears to be hidden inside canvas or non-DOM media.",
        viewport: viewport.name
      });
    }
    if ((viewport.motion_level ?? 0) >= 5 && !viewport.reduced_motion_supported) {
      issues.push({
        code: "missing_reduced_motion_fallback",
        severity: "error",
        message: "High-motion viewport is missing a reduced-motion fallback.",
        viewport: viewport.name
      });
    }
    if ((viewport.heading_count ?? 0) === 0) {
      issues.push({
        code: "weak_heading_hierarchy",
        severity: "warning",
        message: "Viewport has no recorded headings.",
        viewport: viewport.name
      });
    }
    if ((viewport.cta_count ?? 0) === 0) {
      issues.push({
        code: "missing_primary_action",
        severity: "warning",
        message: "Viewport has no recorded primary action.",
        viewport: viewport.name
      });
    }
    if ((viewport.repeated_card_count ?? 0) >= 8) {
      issues.push({
        code: "repeated_card_grid",
        severity: "warning",
        message: "Viewport contains a large repeated card grid.",
        viewport: viewport.name
      });
    }
    if ((viewport.visible_text_characters ?? 150) < 120) {
      issues.push({
        code: "thin_visible_content",
        severity: "warning",
        message: "Viewport has very little recorded visible text.",
        viewport: viewport.name
      });
    }
  }

  return issues;
}

function validateGlobalContent(input: PdosVisualQaInput): readonly PdosVisualIssue[] {
  const issues: PdosVisualIssue[] = [];
  if ((input.headings ?? []).length === 0) {
    issues.push({
      code: "headings_missing",
      severity: "warning",
      message: "No global heading list was provided."
    });
  }
  if ((input.ctas ?? []).length === 0) {
    issues.push({
      code: "ctas_missing",
      severity: "warning",
      message: "No global CTA/action list was provided."
    });
  }
  if (input.project_type === "public_sector") {
    const maxMotion = Math.max(...input.viewports.map((viewport) => viewport.motion_level ?? 0));
    if (maxMotion > 1) {
      issues.push({
        code: "public_sector_motion_too_high",
        severity: "warning",
        message: "Public-sector surfaces should keep motion minimal unless the service goal requires it."
      });
    }
  }
  return issues;
}

function detectTemplateRisk(input: PdosVisualQaInput): readonly PdosVisualIssue[] {
  return (input.template_signals ?? [])
    .filter((signal) => TEMPLATE_SIGNAL_WEIGHTS[signal] !== undefined)
    .map((signal) => ({
      code: `template_${signal}`,
      severity: "warning" as const,
      message: `Template-risk signal detected: ${signal}.`
    }));
}

function calculateTemplateRisk(input: PdosVisualQaInput, issues: readonly PdosVisualIssue[]): number {
  const signalScore = (input.template_signals ?? []).reduce((total, signal) => total + (TEMPLATE_SIGNAL_WEIGHTS[signal] ?? 1), 0);
  const issueScore = issues.reduce((total, issue) => {
    if (issue.code === "repeated_card_grid") {
      return total + 2;
    }
    if (issue.code === "thin_visible_content" || issue.code === "weak_heading_hierarchy") {
      return total + 1;
    }
    return total;
  }, 0);
  return Math.min(10, signalScore + issueScore);
}

function suggestActions(issues: readonly PdosVisualIssue[], templateRiskScore: number): readonly string[] {
  const actions = new Set<string>();
  for (const issue of issues) {
    if (issue.code === "horizontal_overflow" || issue.code === "text_overlap") {
      actions.add("Fix responsive layout before visual polish.");
    } else if (issue.code === "low_contrast") {
      actions.add("Raise contrast and re-check key text/actions.");
    } else if (issue.code === "primary_content_hidden_in_canvas") {
      actions.add("Move primary content into readable DOM text.");
    } else if (issue.code === "missing_reduced_motion_fallback") {
      actions.add("Add prefers-reduced-motion fallback before release.");
    } else if (issue.code.includes("heading")) {
      actions.add("Strengthen heading hierarchy and reading order.");
    } else if (issue.code.includes("cta") || issue.code === "missing_primary_action") {
      actions.add("Clarify the primary user action.");
    } else if (issue.code.includes("template") || issue.code === "repeated_card_grid") {
      actions.add("Reduce generic template signals and add a purpose-specific visual anchor.");
    }
  }
  if (templateRiskScore >= 6) {
    actions.add("Run Design Critic review before implementation continues.");
  }
  if (actions.size === 0) {
    actions.add("No blocking visual QA issue detected in the provided snapshot.");
  }
  return [...actions];
}

function buildVisualQaMarkdown(
  input: PdosVisualQaInput,
  report: Omit<PdosVisualQaReport, "report_markdown">
): string {
  return [
    "# Product & Design OS Visual QA Report",
    "",
    "## Summary",
    `- URL: ${input.url ?? "not provided"}`,
    `- Project type: ${input.project_type ?? "unknown"}`,
    `- Primary goal: ${input.primary_goal ?? "not provided"}`,
    `- OK: ${String(report.ok)}`,
    `- Template-risk score: ${report.template_risk_score}/10`,
    "",
    "## Checked Viewports",
    ...formatList(report.checked_viewports),
    "## Issues",
    ...formatIssues(report.issues),
    "## Suggested Actions",
    ...formatList(report.suggested_actions)
  ].join("\n");
}

function formatIssues(issues: readonly PdosVisualIssue[]): readonly string[] {
  if (issues.length === 0) {
    return ["- None."];
  }
  return issues.map((issue) => {
    const viewport = issue.viewport ? ` (${issue.viewport})` : "";
    return `- [${issue.severity}] ${issue.code}${viewport}: ${issue.message}`;
  });
}

function formatList(items: readonly string[]): readonly string[] {
  if (items.length === 0) {
    return ["- None."];
  }
  return items.map((item) => `- ${item}`);
}

function parseVisualQaInput(value: string): PdosVisualQaInput {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.viewports)) {
    throw new Error("Visual QA input must be a JSON object with a viewports array.");
  }
  const output: {
    url?: string;
    project_type?: string;
    primary_goal?: string;
    target_users?: readonly string[];
    viewports: readonly PdosVisualViewportInput[];
    headings?: readonly string[];
    ctas?: readonly string[];
    template_signals?: readonly string[];
  } = {
    viewports: parsed.viewports.filter(isRecord).map(toViewportInput)
  };
  assignIfString(output, "url", parsed.url);
  assignIfString(output, "project_type", parsed.project_type);
  assignIfString(output, "primary_goal", parsed.primary_goal);
  assignIfStringArray(output, "target_users", parsed.target_users);
  assignIfStringArray(output, "headings", parsed.headings);
  assignIfStringArray(output, "ctas", parsed.ctas);
  assignIfStringArray(output, "template_signals", parsed.template_signals);
  return output;
}

function toViewportInput(value: Record<string, unknown>): PdosVisualViewportInput {
  const output: {
    name: string;
    width?: number;
    height?: number;
    heading_count?: number;
    cta_count?: number;
    visible_text_characters?: number;
    repeated_card_count?: number;
    text_overlap?: boolean;
    horizontal_overflow?: boolean;
    low_contrast?: boolean;
    primary_content_in_canvas?: boolean;
    motion_level?: number;
    reduced_motion_supported?: boolean;
  } = {
    name: typeof value.name === "string" ? value.name : "unknown"
  };
  assignIfNumber(output, "width", value.width);
  assignIfNumber(output, "height", value.height);
  assignIfNumber(output, "heading_count", value.heading_count);
  assignIfNumber(output, "cta_count", value.cta_count);
  assignIfNumber(output, "visible_text_characters", value.visible_text_characters);
  assignIfNumber(output, "repeated_card_count", value.repeated_card_count);
  assignIfBoolean(output, "text_overlap", value.text_overlap);
  assignIfBoolean(output, "horizontal_overflow", value.horizontal_overflow);
  assignIfBoolean(output, "low_contrast", value.low_contrast);
  assignIfBoolean(output, "primary_content_in_canvas", value.primary_content_in_canvas);
  assignIfNumber(output, "motion_level", value.motion_level);
  assignIfBoolean(output, "reduced_motion_supported", value.reduced_motion_supported);
  return output;
}

function assignIfString<T extends Record<string, unknown>>(target: T, key: keyof T, value: unknown): void {
  if (typeof value === "string") {
    target[key] = value as T[keyof T];
  }
}

function assignIfStringArray<T extends Record<string, unknown>>(target: T, key: keyof T, value: unknown): void {
  if (Array.isArray(value)) {
    target[key] = value.filter((item): item is string => typeof item === "string") as T[keyof T];
  }
}

function assignIfNumber<T extends Record<string, unknown>>(target: T, key: keyof T, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value as T[keyof T];
  }
}

function assignIfBoolean<T extends Record<string, unknown>>(target: T, key: keyof T, value: unknown): void {
  if (typeof value === "boolean") {
    target[key] = value as T[keyof T];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArgs(args: readonly string[]): {
  file?: string;
  text?: string;
  format?: "json" | "markdown";
} {
  const result: { file?: string; text?: string; format?: "json" | "markdown" } = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (!value) {
      continue;
    }
    if (key === "--file") {
      result.file = value;
      index += 1;
    } else if (key === "--text") {
      result.text = value;
      index += 1;
    } else if (key === "--format" && (value === "json" || value === "markdown")) {
      result.format = value;
      index += 1;
    }
  }
  return result;
}

function printUsage(): void {
  console.log(`Usage:
  npm run pdos:visual-qa -- --file visual-snapshot.json --format markdown
  npm run pdos:visual-qa -- --text "{\\"viewports\\":[{\\"name\\":\\"desktop\\"}]}"`);
}

function runCli(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file && !args.text) {
    printUsage();
    return;
  }
  const input = args.file ? readFileSync(args.file, "utf8") : args.text ?? "{}";
  const report = analyzeProductDesignVisualQa(input);
  console.log(formatVisualQaReport(report, args.format));
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (basename(invokedFile) === basename(currentFile) && invokedFile === currentFile) {
  runCli();
}
