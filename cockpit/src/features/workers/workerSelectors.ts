export type WorkerStatus = "running" | "completed" | "blocked" | "error";

export interface WorkerRecord {
  readonly worker_run_id: string;
  readonly vendor: string;
  readonly model: string | null;
  readonly session_id: string;
  readonly status: WorkerStatus;
  readonly started_at: string;
  readonly finished_at?: string | null;
  /** API-redacted worker output; UI applies an additional bounded tail before rendering. */
  readonly output?: string | null;
  readonly error_reason?: string | null;
}

export function sortWorkers(workers: readonly WorkerRecord[]): WorkerRecord[] {
  const order: Record<WorkerStatus, number> = { running: 0, blocked: 1, error: 2, completed: 3 };
  return [...workers].sort((a, b) => order[a.status] - order[b.status] || b.started_at.localeCompare(a.started_at));
}

export function boundedOutputTail(output: string | null | undefined, max = 4000): string {
  if (!output) return "";
  if (output.length <= max) return output;
  return `…${output.slice(-(max - 1))}`;
}

export function elapsedMilliseconds(worker: WorkerRecord, now = new Date()): number {
  const start = Date.parse(worker.started_at);
  const end = Date.parse(worker.finished_at ?? now.toISOString());
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

export function elapsedLabel(worker: WorkerRecord, now = new Date()): string {
  const seconds = Math.floor(elapsedMilliseconds(worker, now) / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}
