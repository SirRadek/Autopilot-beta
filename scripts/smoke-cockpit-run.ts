import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createControlPlaneRuntime } from "./control-plane-server";
import { readApprovalQueue } from "../src/data/delivery-system/approvalQueue";
import { writeProjectRegistry } from "../src/data/delivery-system/projectRegistry";
import { writeProviderQuotaStore } from "../src/data/delivery-system/providerQuotaStore";
import { readRunStore } from "../src/data/delivery-system/runStore";
import { SupervisorQueue } from "../src/data/delivery-system/supervisorQueue";
import type { TokenGatewayTelemetry } from "../src/data/delivery-system/tokenGateway";
import type { DispatchResult } from "../src/governed-core/dispatch";

type SmokeMode = "dry-run" | "live";

export interface CockpitSmokeReport {
  readonly mode: "dry-run";
  readonly provider_invoked: false;
  readonly state_dir: string;
  readonly run_id: string;
  readonly supervisor_task_id: string;
  readonly reservation_id: string;
  readonly approved_revisions: number;
  readonly reservations: number;
  readonly supervisor_tasks: number;
  readonly worker_results: number;
  readonly reservation_status: "settled";
  readonly run_status: "completed";
  readonly artifact_preview: string;
  readonly terminal_reservation_events: readonly string[];
  readonly correlation_ids: {
    readonly run_id: string;
    readonly session_id: string;
    readonly handoff_id: string;
    readonly worker_run_id: string;
    readonly supervisor_task_id: string;
    readonly reservation_id: string;
  };
}

export async function runCockpitSmoke(options: { readonly mode: SmokeMode; readonly beforeEvidenceInspection?: (stateDir: string) => void }): Promise<CockpitSmokeReport> {
  if (options.mode !== "dry-run") throw new Error("live_execution_forbidden");
  const stateDir = mkdtempSync(join(tmpdir(), "autopilot-cockpit-smoke-"));
  const token = "cockpit-smoke-local-token";
  let dispatchOutput: DispatchResult | undefined;
  const runtime = createControlPlaneRuntime(stateDir, token, {
    scheduler: { start() {}, stop() {} },
    supervisorPollMs: 5,
    dispatch: async (handoff) => {
      dispatchOutput = { refused: false, workerRunId: "smoke-worker-1", handoffId: handoff.handoffId, vendor: handoff.vendor, model: handoff.model ?? null, exitCode: 0, rawOutput: "deterministic cockpit smoke result", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn", workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true };
      return dispatchOutput;
    }
  });
  const server = runtime.server;
  try {
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "cockpit-smoke", name: "Cockpit smoke fixture", cwd: process.cwd(), enabled: true }] });
    const now = new Date().toISOString();
    writeProviderQuotaStore(stateDir, { schema_version: "v1", snapshots: [{ provider: "codex_cli", source: "cli", fetched_at: now, observed_at: now, five_hour: { limit: 100_000, used: 0, remaining: 100_000, resets_at: null }, weekly: { limit: 100_000, used: 0, remaining: 100_000, resets_at: null }, api_spend: null, currency: null, models: [{ model_id: "smoke-model", available: true, health: "healthy", source: "cli" }], health: "healthy", error_code: null }] });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("smoke_control_plane_address_missing");
    const call = async (path: string, body: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`smoke_control_plane_${response.status}:${await response.text()}`);
      return response.json() as Promise<any>;
    };
    const prepared = await call("/runs", { project_id: "cockpit-smoke", prompt: "Return deterministic cockpit smoke result", provider: "codex_cli", model: "smoke-model", estimated_tokens: 64, requested_artifacts: ["text"] });
    const runId = prepared.current.run_id as string;
    await call(`/runs/${runId}/approve`, { revision: 1, operator: "cockpit-smoke" });

    await waitFor(() => readRunStore(stateDir).runs[0]?.status === "completed");
    const completed = readRunStore(stateDir).runs[0] ?? null;
    if (completed === null || dispatchOutput === undefined || dispatchOutput.refused || completed.token_reservation === null || completed.supervisor_task_id === null) throw new Error("smoke_run_did_not_complete");
    options.beforeEvidenceInspection?.(stateDir);
    const telemetry = readTelemetry(stateDir);
    const tokenState = JSON.parse(readFileSync(join(stateDir, "token-gateway-state.json"), "utf8")) as { reservations: Record<string, unknown>; terminal: Record<string, unknown> };
    const persistedRuns = readRunStore(stateDir).runs;
    const persistedTasks = new SupervisorQueue({ stateDir }).snapshot();
    const approvalRecords = readApprovalQueue(stateDir).records;
    const persistedRun = persistedRuns.find((run) => run.current.run_id === runId);
    if (persistedRun === undefined || persistedRun.token_reservation === null || persistedRun.supervisor_task_id === null || persistedRun.provider_result?.refused !== false) throw new Error("smoke_persisted_result_missing");
    const reservationEvents = telemetry.filter((event) => event.reservation_id === persistedRun.token_reservation!.reservationId);
    const lifecycleEvents = telemetry.filter((event) => event.event === "reserved" || event.event === "settled" || event.event === "released");
    const reservedEvents = reservationEvents.filter((event) => event.event === "reserved");
    const terminalEvents = reservationEvents.filter((event) => event.event === "settled" || event.event === "released").map((event) => event.event);
    const tasks = persistedTasks.filter((item) => item.task_id === persistedRun.supervisor_task_id);
    const workerResults = persistedRuns.filter((run) => run.provider_result !== null);
    const artifacts = persistedRuns.flatMap((run) => run.artifacts);
    const approvals = approvalRecords.filter((item) => item.run_id === runId && item.status === "approved");
    const lifecycleReservationIds = new Set(lifecycleEvents.map((event) => event.reservation_id));
    if (lifecycleEvents.length !== 2 || lifecycleReservationIds.size !== 1 || !lifecycleReservationIds.has(persistedRun.token_reservation.reservationId) || reservedEvents.length !== 1 || terminalEvents.length !== 1 || terminalEvents[0] !== "settled" || Object.keys(tokenState.reservations).length !== 0 || Object.keys(tokenState.terminal).length !== 0) throw new Error("smoke_reservation_lifecycle_mismatch");
    if (persistedRuns.length !== 1 || workerResults.length !== 1 || artifacts.length !== 1 || approvalRecords.length !== 1 || approvals.length !== 1 || persistedTasks.length !== 1 || tasks.length !== 1 || tasks[0]?.status !== "completed") throw new Error("smoke_persisted_count_mismatch");
    const task = tasks[0]!;
    const reservation = persistedRun.token_reservation;
    const result = persistedRun.provider_result;
    if (persistedRun.status !== "completed" || persistedRun.reservation_status !== "settled" || task.session_id !== runId || task.handoff.sessionId !== runId || String(task.handoff.handoffId) !== reservation.handoffId || task.handoff.vendor !== persistedRun.current.provider || (task.handoff.model ?? null) !== persistedRun.current.model || reservedEvents[0]?.session_id !== runId || reservedEvents[0]?.handoff_id !== reservation.handoffId || reservedEvents[0]?.provider !== persistedRun.current.provider || reservedEvents[0]?.model !== persistedRun.current.model || dispatchOutput.workerRunId !== result.worker_run_id || dispatchOutput.handoffId !== task.handoff.handoffId || dispatchOutput.vendor !== task.handoff.vendor || dispatchOutput.model !== (task.handoff.model ?? null) || persistedRun.worker_run_id !== result.worker_run_id || persistedRun.supervisor_task_id !== task.task_id) throw new Error("smoke_correlation_mismatch");
    return {
      mode: "dry-run", provider_invoked: false, state_dir: stateDir, run_id: runId,
      supervisor_task_id: task.task_id, reservation_id: reservation.reservationId,
      approved_revisions: approvals.length, reservations: reservedEvents.length, supervisor_tasks: tasks.length, worker_results: workerResults.length,
      reservation_status: "settled", run_status: "completed", artifact_preview: artifacts[0]!.preview,
      terminal_reservation_events: terminalEvents,
      correlation_ids: { run_id: runId, session_id: reservation.sessionId!, handoff_id: reservation.handoffId!, worker_run_id: result.worker_run_id!, supervisor_task_id: task.task_id, reservation_id: reservation.reservationId }
    };
  } finally {
    await runtime.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("smoke_run_timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function readTelemetry(stateDir: string): TokenGatewayTelemetry[] {
  return readFileSync(join(stateDir, "token-gateway-telemetry.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as TokenGatewayTelemetry);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--live")) throw new Error("live_execution_forbidden");
  if (args.length !== 1 || args[0] !== "--dry-run") throw new Error("usage: npm run smoke:cockpit-run -- --dry-run");
  console.log(JSON.stringify(await runCockpitSmoke({ mode: "dry-run" }), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
