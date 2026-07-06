import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_AGY_QUOTA_COMMAND = "antigravity-usage";

export interface AgyQuotaRow {
  readonly model: string;
  readonly remaining_pct: number | null;
  readonly resets_in: string | null;
}

export interface AgyQuotaGroups {
  readonly gemini: {
    readonly min_remaining_pct: number | null;
  };
  readonly claude_gpt: {
    readonly min_remaining_pct: number | null;
  };
}

export interface AgyQuotaReport {
  readonly models: readonly AgyQuotaRow[];
  readonly groups: AgyQuotaGroups;
}

interface AgyQuotaCliArgs {
  readonly cmd: string;
  readonly json: boolean;
}

export function parseAgyQuotaTable(text: string): AgyQuotaRow[] {
  const rows: AgyQuotaRow[] = [];
  const seenModels = new Set<string>();

  for (const line of stripAnsi(text).split(/\r?\n/)) {
    if (!/[|│]/.test(line)) {
      continue;
    }

    const cells = splitTableCells(line);
    if (cells.length < 3) {
      continue;
    }

    const [modelCell, remainingCell, resetsCell] = cells;
    const model = modelCell?.trim() ?? "";
    if (!model || /^model$/i.test(model) || seenModels.has(model)) {
      continue;
    }

    const remainingPct = parseRemainingPct(remainingCell ?? "");
    if (remainingPct === null) {
      continue;
    }

    seenModels.add(model);
    rows.push({
      model,
      remaining_pct: remainingPct,
      resets_in: parseResetsIn(resetsCell ?? "")
    });
  }

  return rows;
}

export function buildAgyQuotaReport(models: readonly AgyQuotaRow[]): AgyQuotaReport {
  return {
    models,
    groups: {
      gemini: {
        min_remaining_pct: minRemainingPct(models, /\bgemini\b/i)
      },
      claude_gpt: {
        min_remaining_pct: minRemainingPct(models, /\b(?:claude|gpt)\b/i)
      }
    }
  };
}

export function formatAgyQuotaReport(report: AgyQuotaReport): string {
  if (report.models.length === 0) {
    return "No agy quota rows parsed.";
  }

  const tableRows = [
    ["Model", "Remaining", "Resets in"],
    ...report.models.map((row) => [
      row.model,
      row.remaining_pct === null ? "unknown" : `${row.remaining_pct}%`,
      row.resets_in ?? "unknown"
    ])
  ];
  const widths = tableRows[0]!.map((_, index) =>
    Math.max(...tableRows.map((row) => row[index]?.length ?? 0))
  );
  const lines = tableRows.map((row) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd()
  );

  lines.push(
    "",
    `Gemini min remaining: ${formatGroupPct(report.groups.gemini.min_remaining_pct)}`,
    `Claude/GPT min remaining: ${formatGroupPct(report.groups.claude_gpt.min_remaining_pct)}`
  );

  return lines.join("\n");
}

function runCli(args: AgyQuotaCliArgs): void {
  const result = spawnSync(args.cmd, ["quota"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code ?? result.error.name;
    console.error(`agy quota advisory: unable to run "${args.cmd} quota" (${code}); install or log in to antigravity-usage, then retry.`);
    process.exitCode = 0;
    return;
  }

  if (result.status !== 0) {
    console.error(`agy quota advisory: "${args.cmd} quota" exited ${result.status ?? "unknown"}; ensure antigravity-usage is installed and authenticated.`);
    process.exitCode = 0;
    return;
  }

  const report = buildAgyQuotaReport(parseAgyQuotaTable(outputToString(result.stdout)));
  console.log(args.json ? JSON.stringify(report, null, 2) : formatAgyQuotaReport(report));
}

function parseCliArgs(args: readonly string[]): AgyQuotaCliArgs {
  let cmd = DEFAULT_AGY_QUOTA_COMMAND;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--cmd") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("missing value for --cmd");
      }
      cmd = next;
      index += 1;
      continue;
    }

    if (arg?.startsWith("--cmd=")) {
      const value = arg.slice("--cmd=".length).trim();
      if (!value) {
        throw new Error("missing value for --cmd");
      }
      cmd = value;
      continue;
    }

    throw new Error(`unknown argument: ${arg ?? ""}`);
  }

  return { cmd, json };
}

function splitTableCells(line: string): string[] {
  const cells = line.split(/[|│]/).map((cell) => cell.trim());
  if (cells[0] === "") {
    cells.shift();
  }
  if (cells[cells.length - 1] === "") {
    cells.pop();
  }
  return cells;
}

function parseRemainingPct(cell: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*%/.exec(cell);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseResetsIn(cell: string): string | null {
  const trimmed = cell.trim();
  if (!trimmed || /^[—-]+$/.test(trimmed) || /^n\/a$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function minRemainingPct(rows: readonly AgyQuotaRow[], modelPattern: RegExp): number | null {
  const values = rows
    .filter((row) => modelPattern.test(row.model))
    .map((row) => row.remaining_pct)
    .filter((value): value is number => value !== null);

  return values.length > 0 ? Math.min(...values) : null;
}

function formatGroupPct(value: number | null): string {
  return value === null ? "unknown" : `${value}%`;
}

function stripAnsi(raw: string): string {
  return raw
    .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\][^\r\n]*/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "");
}

function outputToString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  return "";
}

function realpathIfExists(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

const currentFile = realpathIfExists(fileURLToPath(import.meta.url));
const invokedFile = process.argv[1] ? realpathIfExists(process.argv[1]) : "";

if (invokedFile === currentFile) {
  try {
    runCli(parseCliArgs(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid quota:agy arguments";
    console.error(`quota:agy failed: ${message}`);
    process.exitCode = 1;
  }
}
