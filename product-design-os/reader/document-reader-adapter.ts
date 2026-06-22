import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PYTHON = process.env.PDOS_DOCUMENT_READER_PYTHON ?? "python";
const DEFAULT_OUTPUT_DIR = "output/document-reader/product-design-os";
const CORE_DEPENDENCIES = ["pypdfium2", "pdfplumber", "PIL", "ftfy"] as const;
const EXPECTED_ARTIFACTS = [
  "document.clean.md",
  "document.raw.md",
  "validation.report.json",
  "hybrid.routing.json",
  "backcheck.report.json",
  "semantic.review.json"
] as const;

export interface PdosDocumentReaderInput {
  readonly source?: string;
  readonly output_dir?: string;
  readonly supervisor_root?: string;
  readonly python?: string;
  readonly check_only?: boolean;
  readonly format?: "json" | "markdown";
}

export interface PdosDocumentReaderRuntimeCheck {
  readonly ok: boolean;
  readonly python: string;
  readonly supervisor_root: string | null;
  readonly checks: readonly PdosDocumentReaderCheck[];
  readonly missing: readonly string[];
  readonly warnings: readonly string[];
}

export interface PdosDocumentReaderCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface PdosDocumentReaderRun {
  readonly ok: boolean;
  readonly source: string;
  readonly output_dir: string;
  readonly runtime: PdosDocumentReaderRuntimeCheck;
  readonly command: readonly string[];
  readonly exit_code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly artifacts: readonly PdosDocumentReaderArtifact[];
  readonly errors: readonly string[];
}

export interface PdosDocumentReaderArtifact {
  readonly name: string;
  readonly path: string;
  readonly exists: boolean;
  readonly bytes: number;
}

type MutableDocumentReaderInput = {
  -readonly [Key in keyof PdosDocumentReaderInput]?: PdosDocumentReaderInput[Key];
};

export async function checkDocumentReaderRuntime(
  input: PdosDocumentReaderInput = {}
): Promise<PdosDocumentReaderRuntimeCheck> {
  const python = resolvePythonExecutable(input.python ?? DEFAULT_PYTHON);
  const supervisorRoot = resolveSupervisorRoot(input.supervisor_root);
  const checks: PdosDocumentReaderCheck[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  const pythonVersion = await runProcess(python, ["--version"], process.cwd());
  checks.push({
    id: "python_available",
    ok: pythonVersion.exitCode === 0,
    detail: firstNonEmptyLine(pythonVersion.stdout, pythonVersion.stderr) || `Command: ${python}`
  });
  if (pythonVersion.exitCode !== 0) {
    missing.push("python");
  }

  if (!supervisorRoot) {
    checks.push({
      id: "supervisor_root_configured",
      ok: false,
      detail: "Set --supervisor-root or PDOS_PDF_SUPERVISOR_ROOT."
    });
    missing.push("PDOS_PDF_SUPERVISOR_ROOT");
    return buildRuntimeCheck(python, null, checks, missing, warnings);
  }

  checks.push({
    id: "supervisor_root_exists",
    ok: existsSync(supervisorRoot),
    detail: supervisorRoot
  });
  if (!existsSync(supervisorRoot)) {
    missing.push("pdf-supervisor root");
    return buildRuntimeCheck(python, supervisorRoot, checks, missing, warnings);
  }

  const moduleDir = join(supervisorRoot, "document_supervisor");
  const cliFile = join(moduleDir, "cli.py");
  const requirementsFile = join(supervisorRoot, "requirements-commercial.txt");
  for (const [id, path] of [
    ["document_supervisor_module", moduleDir],
    ["document_supervisor_cli", cliFile],
    ["commercial_requirements", requirementsFile]
  ] as const) {
    const ok = existsSync(path);
    checks.push({ id, ok, detail: path });
    if (!ok) {
      missing.push(path);
    }
  }

  if (pythonVersion.exitCode === 0 && existsSync(moduleDir)) {
    const dependencyCheck = await runPythonDependencyCheck(python, supervisorRoot);
    for (const dependency of CORE_DEPENDENCIES) {
      const ok = dependencyCheck.dependencies[dependency] === true;
      checks.push({
        id: `python_dependency_${dependency}`,
        ok,
        detail: ok ? "available" : "missing"
      });
      if (!ok) {
        missing.push(dependency);
      }
    }

    checks.push({
      id: "tesseract_optional",
      ok: dependencyCheck.tesseract_available,
      detail: dependencyCheck.tesseract_path ?? "not found in PATH"
    });
    if (!dependencyCheck.tesseract_available) {
      warnings.push("Tesseract is not available in PATH; OCR pages will fall back or report uncertainty.");
    }
  }

  return buildRuntimeCheck(python, supervisorRoot, checks, missing, warnings);
}

export async function runDocumentReader(input: PdosDocumentReaderInput): Promise<PdosDocumentReaderRun> {
  const source = input.source ? resolve(input.source) : "";
  const outputDir = resolve(input.output_dir ?? DEFAULT_OUTPUT_DIR);
  const runtime = await checkDocumentReaderRuntime(input);
  const errors: string[] = [];

  if (!source) {
    errors.push("Missing --source.");
  } else if (!existsSync(source)) {
    errors.push(`Source file does not exist: ${source}`);
  }

  if (!runtime.ok) {
    errors.push(...runtime.missing.map((item) => `Runtime missing: ${item}`));
  }

  if (errors.length > 0) {
    return {
      ok: false,
      source,
      output_dir: outputDir,
      runtime,
      command: [],
      exit_code: null,
      stdout: "",
      stderr: "",
      artifacts: listExpectedArtifacts(outputDir),
      errors
    };
  }

  await mkdir(outputDir, { recursive: true });

  const supervisorRoot = runtime.supervisor_root;
  if (!supervisorRoot) {
    throw new Error("Runtime reported ok without supervisor root.");
  }

  const command = [runtime.python, "-m", "document_supervisor.cli", "--source", source, "--out", outputDir] as const;
  const run = await runProcess(runtime.python, command.slice(1), supervisorRoot, {
    ...process.env,
    PYTHONPATH: [supervisorRoot, process.env.PYTHONPATH].filter(Boolean).join(delimiter)
  });
  const artifacts = listExpectedArtifacts(outputDir);
  const missingArtifacts = artifacts.filter((artifact) => !artifact.exists).map((artifact) => artifact.name);

  return {
    ok: run.exitCode === 0 && missingArtifacts.length === 0,
    source,
    output_dir: outputDir,
    runtime,
    command,
    exit_code: run.exitCode,
    stdout: run.stdout.trim(),
    stderr: run.stderr.trim(),
    artifacts,
    errors: [
      ...(run.exitCode === 0 ? [] : [`document_supervisor exited with code ${run.exitCode}.`]),
      ...missingArtifacts.map((artifact) => `Missing expected artifact: ${artifact}`)
    ]
  };
}

export function formatDocumentReaderRuntimeCheck(report: PdosDocumentReaderRuntimeCheck, format = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  const lines = [
    "# Product & Design OS Document Reader Runtime",
    "",
    `Status: ${report.ok ? "ok" : "not ready"}`,
    `Python: ${report.python}`,
    `Supervisor root: ${report.supervisor_root ?? "not configured"}`,
    "",
    "## Checks",
    ...report.checks.map((check) => `- ${check.ok ? "OK" : "MISSING"} ${check.id}: ${check.detail}`)
  ];

  if (report.warnings.length > 0) {
    lines.push("", "## Warnings", ...report.warnings.map((warning) => `- ${warning}`));
  }

  if (report.missing.length > 0) {
    lines.push("", "## Missing", ...report.missing.map((item) => `- ${item}`));
  }

  return lines.join("\n");
}

export async function formatDocumentReaderRun(report: PdosDocumentReaderRun, format = "markdown"): Promise<string> {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  const lines = [
    "# Product & Design OS Document Reader",
    "",
    `Status: ${report.ok ? "ok" : "failed"}`,
    `Source: ${report.source || "not provided"}`,
    `Output directory: ${report.output_dir}`,
    `Exit code: ${report.exit_code ?? "not run"}`,
    "",
    "## Runtime",
    `- ready: ${report.runtime.ok}`,
    `- supervisor root: ${report.runtime.supervisor_root ?? "not configured"}`,
    `- python: ${report.runtime.python}`,
    "",
    "## Artifacts",
    ...report.artifacts.map((artifact) => `- ${artifact.exists ? "OK" : "MISSING"} ${artifact.name} (${artifact.bytes} bytes)`)
  ];

  if (report.command.length > 0) {
    lines.push("", "## Command", "```powershell", report.command.map(quoteCommandPart).join(" "), "```");
  }

  if (report.errors.length > 0) {
    lines.push("", "## Errors", ...report.errors.map((error) => `- ${error}`));
  }

  if (report.stderr) {
    lines.push("", "## Stderr", "```text", report.stderr, "```");
  }

  return lines.join("\n");
}

function resolveSupervisorRoot(value?: string): string | null {
  const candidate = value ?? process.env.PDOS_PDF_SUPERVISOR_ROOT;
  if (!candidate || !candidate.trim()) {
    return null;
  }
  return resolve(candidate);
}

function resolvePythonExecutable(value: string): string {
  const candidate = value.trim();
  if (!candidate) {
    return value;
  }

  if (isAbsolute(candidate) || candidate.startsWith(".") || /[\\/]/.test(candidate)) {
    return resolve(candidate);
  }

  return candidate;
}

function buildRuntimeCheck(
  python: string,
  supervisorRoot: string | null,
  checks: readonly PdosDocumentReaderCheck[],
  missing: readonly string[],
  warnings: readonly string[]
): PdosDocumentReaderRuntimeCheck {
  return {
    ok: missing.length === 0,
    python,
    supervisor_root: supervisorRoot,
    checks,
    missing: [...new Set(missing)],
    warnings
  };
}

async function runPythonDependencyCheck(
  python: string,
  supervisorRoot: string
): Promise<{ dependencies: Record<string, boolean>; tesseract_available: boolean; tesseract_path: string | null }> {
  const code = [
    "import importlib.util, json, shutil, sys",
    `sys.path.insert(0, ${JSON.stringify(supervisorRoot)})`,
    `mods = ${JSON.stringify(["document_supervisor", ...CORE_DEPENDENCIES])}`,
    "deps = {mod: importlib.util.find_spec(mod) is not None for mod in mods}",
    "print(json.dumps({'dependencies': deps, 'tesseract_path': shutil.which('tesseract')}))"
  ].join("; ");
  const result = await runProcess(python, ["-c", code], supervisorRoot);

  try {
    const parsed = JSON.parse(result.stdout.trim()) as {
      dependencies?: Record<string, boolean>;
      tesseract_path?: string | null;
    };
    return {
      dependencies: parsed.dependencies ?? {},
      tesseract_available: Boolean(parsed.tesseract_path),
      tesseract_path: parsed.tesseract_path ?? null
    };
  } catch {
    return {
      dependencies: {},
      tesseract_available: false,
      tesseract_path: null
    };
  }
}

function listExpectedArtifacts(outputDir: string): PdosDocumentReaderArtifact[] {
  return EXPECTED_ARTIFACTS.map((name) => {
    const path = join(outputDir, name);
    const exists = existsSync(path);
    const bytes = exists ? statSync(path).size : 0;
    return { name, path, exists, bytes };
  });
}

function firstNonEmptyLine(...values: readonly string[]): string {
  return values
    .flatMap((value) => value.split(/\r?\n/g))
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function quoteCommandPart(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveProcess) => {
    const child = spawn(command, [...args], { cwd, env, shell: false });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolveProcess({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (exitCode) => {
      resolveProcess({ exitCode, stdout, stderr });
    });
  });
}

function parseArgs(argv: readonly string[]): PdosDocumentReaderInput {
  const input: MutableDocumentReaderInput = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--source" && next) {
      input.source = next;
      index += 1;
    } else if (arg === "--output-dir" && next) {
      input.output_dir = next;
      index += 1;
    } else if (arg === "--supervisor-root" && next) {
      input.supervisor_root = next;
      index += 1;
    } else if (arg === "--python" && next) {
      input.python = next;
      index += 1;
    } else if (arg === "--format" && (next === "json" || next === "markdown")) {
      input.format = next;
      index += 1;
    } else if (arg === "--check-only") {
      input.check_only = true;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error(usage());
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}\n\n${usage()}`);
    }
  }
  return input;
}

function usage(): string {
  return [
    "Usage:",
    "  npm run pdos:reader:document -- --check-only --supervisor-root C:\\path\\pdf-supervisor",
    "  npm run pdos:reader:document -- --source C:\\path\\file.pdf --output-dir output/document-reader/example --supervisor-root C:\\path\\pdf-supervisor",
    "",
    "Environment:",
    "  PDOS_PDF_SUPERVISOR_ROOT can provide the pdf-supervisor repository path.",
    "  PDOS_DOCUMENT_READER_PYTHON can override the Python executable."
  ].join("\n");
}

async function main(): Promise<number> {
  let input: PdosDocumentReaderInput;
  try {
    input = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (input.check_only) {
    const runtime = await checkDocumentReaderRuntime(input);
    console.log(formatDocumentReaderRuntimeCheck(runtime, input.format));
    return runtime.ok ? 0 : 1;
  }

  const run = await runDocumentReader(input);
  console.log(await formatDocumentReaderRun(run, input.format));
  return run.ok ? 0 : 1;
}

const isCli = process.argv[1] ? basename(fileURLToPath(import.meta.url)) === basename(process.argv[1]) : false;
if (isCli) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
