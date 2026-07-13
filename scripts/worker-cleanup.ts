import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const stateDir = process.argv[2];
const confirmed = process.argv.includes("--confirm");
if (!stateDir) throw new Error("usage: tsx scripts/worker-cleanup.ts STATE_DIR [--confirm]");
const path = join(stateDir, "vendor-process-registry.jsonl");
if (!existsSync(path)) { process.stdout.write(JSON.stringify({ orphaned_pids: [], killed: [] }) + "\n"); process.exit(0); }
const records = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line) as { event: string; pid: number; worker_run_id: string | null; recorded_at: string }]; } catch { return []; }
});
const exited = new Set(records.filter((record) => record.event === "exited").map((record) => record.pid));
const orphaned = [...new Set(records.filter((record) => record.event === "spawned" && !exited.has(record.pid)).map((record) => record.pid))].filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
const killed = confirmed ? orphaned.filter((pid) => { try { process.kill(pid); return true; } catch { return false; } }) : [];
if (confirmed) appendFileSync(join(stateDir, "control-plane-audit.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), action: "worker_orphan_cleanup", orphaned, killed })}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ orphaned_pids: orphaned, killed, confirmation_required: orphaned.length > 0 && !confirmed })}\n`);
