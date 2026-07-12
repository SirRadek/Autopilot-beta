import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const stateDir = process.argv[2];
if (!stateDir) throw new Error("usage: tsx scripts/worker-status.ts STATE_DIR");

const readJsonl = (name: string): Record<string, unknown>[] => {
  const path = join(stateDir, name);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; }
  });
};
const lockPath = join(stateDir, "worker.lock");
const status = {
  lock: existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : null,
  registry_events: readJsonl("agent-registry.jsonl").slice(-20),
  vendor_process_events: readJsonl("vendor-process-registry.jsonl").slice(-20),
  telemetry_events: readJsonl("cli-call-telemetry.jsonl").slice(-20)
};
process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
