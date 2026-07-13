import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildObservability } from "../../src/data/delivery-system/observability";

const writeJsonl = (directory: string, name: string, rows: readonly unknown[]) =>
  writeFileSync(join(directory, name), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);

describe("bounded observability", () => {
  it("joins redacted evidence into a correlated timeline and summary", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "observability-"));
    writeJsonl(stateDir, "dispatch-decisions.jsonl", [
      { recorded_at: "2026-07-12T10:00:00Z", handoff_id: "h-1", task_hash: "hash-a", vendor: "openrouter_api", decision: "dispatched" },
      { recorded_at: "2026-07-12T10:00:01Z", handoff_id: "h-2", task_hash: "hash-a", vendor: "openrouter_api", decision: "refused", refusal_reason: "token_budget_exhausted", secret: "sk-never-return-this" }
    ]);
    writeJsonl(stateDir, "cli-call-telemetry.jsonl", [
      { recorded_at: "2026-07-12T10:00:02Z", handoff_id: "h-1", worker_run_id: "w-1", session_id: "s-1", vendor: "openrouter_api", model: "model-a", total_tokens: 30, attempt_count: 2, outcome: "success", prompt: "private prompt" }
    ]);
    writeJsonl(stateDir, "token-gateway-telemetry.jsonl", [
      { recorded_at: "2026-07-12T10:00:03Z", event: "reserved", reservation_id: "r-1", handoff_id: "h-1", session_id: "s-1", provider: "openrouter_api", model: "model-a", input_tokens: 20, output_tokens: 10, total_tokens: 30, reason: null },
      { recorded_at: "2026-07-12T10:00:04Z", event: "settled", reservation_id: "r-1", handoff_id: "h-1", session_id: "s-1", provider: "openrouter_api", model: "model-a", input_tokens: 20, output_tokens: 10, total_tokens: 30, reason: null },
      { recorded_at: "2026-07-12T10:00:04Z", event: "refused", reservation_id: null, handoff_id: "h-2", session_id: "s-1", provider: "openrouter_api", model: "model-a", input_tokens: 20, output_tokens: 10, total_tokens: 30, reason: "token_budget_exhausted" }
    ]);
    writeJsonl(stateDir, "openrouter-api-spend.jsonl", [
      { recorded_at: "2026-07-12T10:00:05Z", worker_run_id: "w-1", model: "model-a", cost_usd: 0.0123, authorization: "Bearer secret" }
    ]);
    writeJsonl(stateDir, "provider-quota-events.jsonl", [
      { observed_at: "2026-07-12T10:00:06Z", provider: "openrouter_api", status: "success", changed_fields: ["weekly"] }
    ]);
    writeJsonl(stateDir, "control-plane-audit.jsonl", [
      { at: "2026-07-12T10:00:07Z", action: "worker_cancel", worker_run_id: "w-1", token: "secret" }
    ]);

    const result = buildObservability(stateDir);
    expect(result.summary).toMatchObject({ events: 9, tokens: 30, retries: 1, refusals: 1, openrouter_cost_usd: 0.0123 });
    expect(result.summary.waste_signals).toEqual([
      { kind: "duplicate_dispatch", evidence_key: "hash-a", occurrences: 2 },
      { kind: "repeated_input_token_count", evidence_key: "s-1|openrouter_api|model-a|20", occurrences: 2 }
    ]);
    expect(result.timeline.map((event) => event.source)).toEqual(["dispatch", "dispatch", "cli_call", "token_gateway", "token_gateway", "token_gateway", "openrouter_spend", "provider_quota", "audit"]);
    expect(JSON.stringify(result)).not.toMatch(/private prompt|never-return|Bearer secret|authorization|"token"/i);
    expect(result.timeline.find((event) => event.source === "cli_call")).toMatchObject({ session_id: "s-1", handoff_id: "h-1", worker_run_id: "w-1", provider: "openrouter_api", model: "model-a", tokens: 30, retries: 1 });
  });

  it("enforces file, line, output, and query caps while ignoring malformed data", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "observability-bounds-"));
    writeFileSync(join(stateDir, "cli-call-telemetry.jsonl"), `${"x".repeat(10_000)}\n${Array.from({ length: 20 }, (_, index) => JSON.stringify({ recorded_at: `2026-07-12T10:00:${String(index).padStart(2, "0")}Z`, worker_run_id: `w-${index}`, total_tokens: 1 })).join("\n")}\n`);
    const result = buildObservability(stateDir, { max_bytes_per_file: 2_048, max_lines_per_file: 5, max_events: 3, worker_run_id: "w-19" });
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.worker_run_id).toBe("w-19");
    expect(result.limits).toEqual({ files_scanned: 6, max_bytes_per_file: 2_048, max_lines_per_file: 5, max_events: 3, truncated: true });
  });

  it("finds the OpenRouter ledger at its production parent-state location", () => {
    const parentDir = mkdtempSync(join(tmpdir(), "observability-spend-"));
    const stateDir = join(parentDir, "state");
    writeJsonl(parentDir, "openrouter-api-spend.jsonl", [{ recorded_at: "2026-07-12T10:00:00Z", model: "m", cost_usd: 0.5 }]);
    expect(buildObservability(stateDir).summary.openrouter_cost_usd).toBe(0.5);
  });

  it("preserves the existing pre-redaction observability field bound", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "observability-redaction-bound-"));
    const detail = `Authorization: Bearer ${"s".repeat(40)} ${"x".repeat(200)}`;
    writeJsonl(stateDir, "dispatch-decisions.jsonl", [{ refusal_reason: detail }]);

    expect(buildObservability(stateDir).timeline[0]?.detail).toBe(`Authorization: Bearer [REDACTED] ${"x".repeat(137)}`);
  });

  it("keeps the legacy observability redaction policy separate from incident hardening", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "observability-legacy-redaction-"));
    writeJsonl(stateDir, "dispatch-decisions.jsonl", [{ refusal_reason: "password=legacy-observability-value" }]);

    expect(buildObservability(stateDir).timeline[0]?.detail).toBe("password=legacy-observability-value");
  });
});
