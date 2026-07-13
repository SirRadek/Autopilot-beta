import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readApprovalQueue } from "../src/data/delivery-system/approvalQueue";
import { readSessionRegistry } from "../src/data/delivery-system/sessionRegistry";

const stateDir = process.argv[2];
if (!stateDir) throw new Error("usage: tsx scripts/control-plane-status.ts STATE_DIR");

const sessions = readSessionRegistry(stateDir).sessions;
const approvals = readApprovalQueue(stateDir).records;
const telemetryPath = join(stateDir, "cli-call-telemetry.jsonl");
const telemetry = existsSync(telemetryPath)
  ? readFileSync(telemetryPath, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; }
    })
  : [];

const status = {
  sessions: {
    total: sessions.length,
    active: sessions.filter((session) => session.status === "active").length,
    closed: sessions.filter((session) => session.status === "closed").length
  },
  approvals: {
    total: approvals.length,
    pending: approvals.filter((record) => record.status === "pending").length,
    approved: approvals.filter((record) => record.status === "approved").length,
    rejected: approvals.filter((record) => record.status === "rejected").length
  },
  telemetry: {
    calls: telemetry.length,
    successful: telemetry.filter((record) => record.outcome === "success").length,
    total_tokens: telemetry.reduce((sum, record) => sum + numberValue(record.total_tokens), 0),
    by_vendor: countBy(telemetry, "vendor"),
    by_session: countBy(telemetry, "session_id")
  }
};

process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function countBy(records: readonly Record<string, unknown>[], key: string): Record<string, number> {
  return records.reduce<Record<string, number>>((result, record) => {
    const value = typeof record[key] === "string" ? record[key] as string : "none";
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}
