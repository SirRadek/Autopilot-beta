import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type {
  WorkUnitClass,
  WorkUnitDescriptor,
  WorkUnitRisk,
} from "./efficiencyPolicy";
import { EFFICIENCY_TELEMETRY_PATH } from "./sessionState";
import type { StoredRunProfile } from "./executionProfile";

export interface EfficiencyTelemetryEventV1 {
  readonly schema_version: "v1";
  readonly recorded_at: string;
  readonly work_unit_id: string;
  readonly work_unit_class: WorkUnitClass;
  readonly risk: WorkUnitRisk;
  readonly profile: StoredRunProfile;
  readonly handoff_id: string;
  readonly actual_model: string | null;
  readonly actual_reasoning_effort: string | null;
  readonly recommended_model: null;
  readonly recommended_reasoning_effort: null;
  readonly routing_mode: "shadow_only";
  readonly status: "started" | "completed" | "refused" | "failed";
  readonly total_attempts: number;
  readonly attempt_delta_recorded: boolean;
}

export interface BuildEfficiencyTelemetryEventInput {
  readonly recordedAt: string;
  readonly workUnit: WorkUnitDescriptor;
  readonly handoffId: string;
  readonly actualModel: string | null;
  readonly actualReasoningEffort: string | null;
  readonly status: EfficiencyTelemetryEventV1["status"];
  readonly profile: StoredRunProfile;
}

export function buildEfficiencyTelemetryEvent(
  input: BuildEfficiencyTelemetryEventInput,
): EfficiencyTelemetryEventV1 {
  return {
    schema_version: "v1",
    recorded_at: input.recordedAt,
    work_unit_id: input.workUnit.work_unit_id,
    work_unit_class: input.workUnit.class,
    risk: input.workUnit.risk,
    profile: input.profile,
    handoff_id: input.handoffId,
    actual_model: input.actualModel,
    actual_reasoning_effort: input.actualReasoningEffort,
    recommended_model: null,
    recommended_reasoning_effort: null,
    routing_mode: "shadow_only",
    status: input.status,
    total_attempts: 1,
    attempt_delta_recorded: false,
  };
}

export function appendEfficiencyTelemetryEventBestEffort(
  stateDir: string,
  event: EfficiencyTelemetryEventV1,
): void {
  try {
    mkdirSync(stateDir, { recursive: true });
    const fileName =
      EFFICIENCY_TELEMETRY_PATH.split(/[\\/]/).at(-1) ??
      "efficiency-events.jsonl";
    appendFileSync(join(stateDir, fileName), `${JSON.stringify(event)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Observability is best-effort and must never change dispatch behavior.
  }
}
