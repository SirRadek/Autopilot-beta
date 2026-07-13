import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createControlPlaneServer } from "./control-plane-server";
import { readApprovalQueue } from "../src/data/delivery-system/approvalQueue";
import { writeProjectRegistry } from "../src/data/delivery-system/projectRegistry";
import { writeProviderQuotaStore } from "../src/data/delivery-system/providerQuotaStore";
import { createRunOrchestrator } from "../src/data/delivery-system/runOrchestrator";
import { SupervisorQueue } from "../src/data/delivery-system/supervisorQueue";
import { TokenGateway, type TokenGatewayTelemetry } from "../src/data/delivery-system/tokenGateway";

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

export async function runCockpitSmoke(options: { readonly mode: SmokeMode }): Promise<CockpitSmokeReport> {
  if (options.mode !== "dry-run") throw new Error("live_execution_forbidden");
  const stateDir = mkdtempSync(join(tmpdir(), "autopilot-cockpit-smoke-"));
  const token = "cockpit-smoke-local-token";
  const server = createControlPlaneServer(stateDir, token);
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

    const gateway = new TokenGateway({ stateDir });
    const supervisor = new SupervisorQueue({ stateDir });
    const orchestrator = createRunOrchestrator({
      stateDir,
      tokenGateway: gateway,
      supervisor,
      dispatch: async (handoff) => ({ refused: false, workerRunId: "smoke-worker-1", handoffId: handoff.handoffId, vendor: "codex_cli", model: "smoke-model", exitCode: 0, rawOutput: "deterministic cockpit smoke result", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn", workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true })
    });
    const completed = await orchestrator.runSupervisorOnce();
    if (completed === null || completed.token_reservation === null || completed.supervisor_task_id === null || completed.provider_result?.refused !== false) throw new Error("smoke_run_did_not_complete");
    const telemetry = readTelemetry(stateDir);
    const reservationEvents = telemetry.filter((event) => event.reservation_id === completed.token_reservation!.reservationId);
    const terminalEvents = reservationEvents.filter((event) => event.event === "settled" || event.event === "released").map((event) => event.event);
    const task = supervisor.snapshot().filter((item) => item.task_id === completed.supervisor_task_id);
    const approvals = readApprovalQueue(stateDir).records.filter((item) => item.run_id === runId && item.status === "approved");
    if (completed.status !== "completed" || completed.reservation_status !== "settled" || approvals.length !== 1 || reservationEvents.filter((event) => event.event === "reserved").length !== 1 || terminalEvents.length !== 1 || terminalEvents[0] !== "settled" || task.length !== 1 || task[0]?.status !== "completed" || completed.artifacts.length !== 1) throw new Error("smoke_invariant_failed");
    return {
      mode: "dry-run", provider_invoked: false, state_dir: stateDir, run_id: runId,
      supervisor_task_id: completed.supervisor_task_id, reservation_id: completed.token_reservation.reservationId,
      approved_revisions: approvals.length, reservations: 1, supervisor_tasks: task.length, worker_results: 1,
      reservation_status: "settled", run_status: "completed", artifact_preview: completed.artifacts[0]!.preview,
      terminal_reservation_events: terminalEvents,
      correlation_ids: { run_id: runId, session_id: completed.token_reservation.sessionId!, handoff_id: completed.token_reservation.handoffId!, worker_run_id: completed.provider_result.worker_run_id!, supervisor_task_id: completed.supervisor_task_id, reservation_id: completed.token_reservation.reservationId }
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(stateDir, { recursive: true, force: true });
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
