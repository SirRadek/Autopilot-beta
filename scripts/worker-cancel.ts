import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";


const stateDir = process.argv[2];
const workerRunId = process.argv[3];
const confirmed = process.argv.includes("--confirm");
if (!stateDir || !workerRunId) throw new Error("usage: tsx scripts/worker-cancel.ts STATE_DIR WORKER_RUN_ID --confirm");
if (!confirmed) throw new Error("cancel_confirmation_required");

const path = join(stateDir, "vendor-process-registry.jsonl");
if (!existsSync(path)) throw new Error("worker_process_registry_missing");
const records = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line) as { event?: string; pid?: number; worker_run_id?: string | null }]; } catch { return []; }
});
const active = records.filter((record) => record.worker_run_id === workerRunId).at(-1);
if (!active || active.event !== "spawned" || typeof active.pid !== "number") throw new Error("worker_not_active");
let killed = false;
try { process.kill(active.pid); killed = true; } catch { killed = false; }
appendFileSync(join(stateDir, "control-plane-audit.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), action: "worker_cancel", worker_run_id: workerRunId, pid: active.pid, killed })}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ worker_run_id: workerRunId, pid: active.pid, killed })}\n`);
