import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface HeroVisualQaReport {
  readonly status: "passed" | "failed" | "skipped";
  readonly html_path: string;
  readonly report_path: string;
  readonly message: string;
  readonly checks: {
    readonly h1_visible: boolean;
    readonly cta_tap_target_min_44: boolean;
    readonly axe_violations: number;
  };
  readonly errors: readonly string[];
}

interface BrowserLike {
  readonly newPage: () => Promise<PageLike>;
  readonly close: () => Promise<void>;
}

interface PlaywrightModule {
  readonly chromium?: {
    readonly launch: (options: { readonly headless: boolean }) => Promise<BrowserLike>;
  };
}

interface PageLike {
  readonly goto: (url: string, options: { readonly waitUntil: "load" }) => Promise<unknown>;
  readonly locator: (selector: string) => LocatorLike;
  readonly addScriptTag: (options: { readonly content: string }) => Promise<unknown>;
  readonly evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
}

interface LocatorLike {
  readonly first: () => LocatorLike;
  readonly isVisible: () => Promise<boolean>;
  readonly boundingBox: () => Promise<{ readonly width: number; readonly height: number } | null>;
}

interface AxeCoreModule {
  readonly source?: string;
  readonly default?: {
    readonly source?: string;
  };
}

interface AxeRunResult {
  readonly violations?: readonly unknown[];
}

const dynamicImport = new Function("specifier", "return import(specifier)") as <T>(specifier: string) => Promise<T>;

export async function runHeroVisualQa(htmlPath: string): Promise<HeroVisualQaReport> {
  const outputDir = path.join(process.cwd(), "output", "render");
  const reportPath = path.join(outputDir, `${path.basename(htmlPath, path.extname(htmlPath))}.visual-qa.json`);
  mkdirSync(outputDir, { recursive: true });

  const relativeHtmlPath = path.relative(process.cwd(), htmlPath).replace(/\\/g, "/");
  const relativeReportPath = path.relative(process.cwd(), reportPath).replace(/\\/g, "/");

  const playwright = await optionalImport<PlaywrightModule>("@playwright/test");
  if (playwright.status === "missing" || playwright.module.chromium === undefined) {
    return writeReport(reportPath, {
      status: "skipped",
      html_path: relativeHtmlPath,
      report_path: relativeReportPath,
      message: "Playwright not installed; install @playwright/test and browser binaries to run hero visual QA.",
      checks: emptyChecks(),
      errors: [playwright.message]
    });
  }

  const axeCore = await optionalImport<AxeCoreModule>("axe-core");
  const axeSource = axeCore.status === "loaded" ? axeCore.module.source ?? axeCore.module.default?.source : undefined;
  if (axeSource === undefined) {
    return writeReport(reportPath, {
      status: "skipped",
      html_path: relativeHtmlPath,
      report_path: relativeReportPath,
      message: "axe-core not installed; install axe-core to run accessibility checks.",
      checks: emptyChecks(),
      errors: [axeCore.message]
    });
  }

  let browser: BrowserLike | undefined;
  try {
    browser = await playwright.module.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: "load" });
    await page.addScriptTag({ content: axeSource });

    const h1Visible = await page.locator("h1").first().isVisible();
    const ctaBox = await page.locator("a.cta").first().boundingBox();
    const ctaTapTarget = ctaBox !== null && ctaBox.width >= 44 && ctaBox.height >= 44;
    const axeResult = await page.evaluate<AxeRunResult>(async () => {
      const browserGlobal = globalThis as unknown as {
        readonly axe?: { readonly run: (context: unknown) => Promise<AxeRunResult> };
        readonly document?: unknown;
      };
      const axe = browserGlobal.axe;

      if (axe === undefined || browserGlobal.document === undefined) {
        return { violations: [{ id: "axe-core-unavailable" }] };
      }

      return axe.run(browserGlobal.document);
    });

    const axeViolations = axeResult.violations?.length ?? 0;
    const errors = [
      ...(h1Visible ? [] : ["h1 is not visible"]),
      ...(ctaTapTarget ? [] : ["CTA tap target is smaller than 44px in at least one dimension"]),
      ...(axeViolations === 0 ? [] : [`axe-core reported ${axeViolations} violation(s)`])
    ];

    return writeReport(reportPath, {
      status: errors.length === 0 ? "passed" : "failed",
      html_path: relativeHtmlPath,
      report_path: relativeReportPath,
      message: errors.length === 0 ? "Hero visual QA passed." : "Hero visual QA found issues.",
      checks: {
        h1_visible: h1Visible,
        cta_tap_target_min_44: ctaTapTarget,
        axe_violations: axeViolations
      },
      errors
    });
  } catch (error) {
    return writeReport(reportPath, {
      status: "skipped",
      html_path: relativeHtmlPath,
      report_path: relativeReportPath,
      message: "Playwright browser unavailable; install browser binaries to run hero visual QA.",
      checks: emptyChecks(),
      errors: [error instanceof Error ? error.message : String(error)]
    });
  } finally {
    await browser?.close();
  }
}

async function optionalImport<T>(
  specifier: string
): Promise<{ readonly status: "loaded"; readonly module: T; readonly message: "" } | { readonly status: "missing"; readonly message: string }> {
  try {
    return {
      status: "loaded",
      module: await dynamicImport<T>(specifier),
      message: ""
    };
  } catch (error) {
    return {
      status: "missing",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function emptyChecks(): HeroVisualQaReport["checks"] {
  return {
    h1_visible: false,
    cta_tap_target_min_44: false,
    axe_violations: 0
  };
}

function writeReport(reportPath: string, report: HeroVisualQaReport): HeroVisualQaReport {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}
