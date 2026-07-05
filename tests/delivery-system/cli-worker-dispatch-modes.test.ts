import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureCodexResponseMock = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    outputFilePath: "mock-codex-output.json",
    rawFileContent: "{\"ok\":true}",
    parsedJson: { ok: true },
    durationMs: 25,
    errorOutput: "",
    timedOut: false,
    attempts: 1
  }))
);

vi.mock("../../src/data/delivery-system/cliWorkerCapture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/data/delivery-system/cliWorkerCapture")>();
  return {
    ...actual,
    captureCodexResponse: captureCodexResponseMock
  };
});

import {
  runCliWorker,
  type CliWorkerInput,
  type CodexDispatchMode
} from "../../src/data/delivery-system/cliWorker";
import { buildCodexBashCommand } from "../../src/data/delivery-system/cliWorkerCapture";

function baseInput(overrides: Partial<CliWorkerInput> = {}): CliWorkerInput {
  return {
    handoffId: "hp-dispatch-mode" as CliWorkerInput["handoffId"],
    vendor: "codex_cli",
    prompt: "bounded dispatch prompt",
    parentSessionHash: "session-hash",
    parentTurnHash: "turn-hash",
    ...overrides
  };
}

function readJsonlRecord(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8").trim().split(/\r?\n/)[0] ?? "{}") as Record<string, unknown>;
}

describe("CLI worker Codex dispatch modes", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "autopilot-cli-worker-dispatch-"));
    captureCodexResponseMock.mockClear();
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it.each([
    {
      mode: "codex_implement" as const,
      sandboxMode: "workspace-write",
      webSearch: "false"
    },
    {
      mode: "codex_review" as const,
      sandboxMode: "read-only",
      webSearch: "false"
    },
    {
      mode: "codex_research" as const,
      sandboxMode: "read-only",
      webSearch: "true"
    }
  ])("maps $mode to sandbox, approval, and web-search config", ({ mode, sandboxMode, webSearch }) => {
    const cmd = buildCodexBashCommand("codex", { codexMode: mode }, "/tmp/out.json", "/tmp/prompt.txt");

    expect(cmd).toContain(`-c sandbox_mode=${sandboxMode}`);
    expect(cmd).toContain("-c approval_policy=never");
    expect(cmd).toContain(`-c tools.web_search=${webSearch}`);
  });

  it("keeps the no-mode command exactly backward compatible", () => {
    expect(buildCodexBashCommand(
      "codex",
      { model: "gpt-5-codex" },
      "/tmp/out.json",
      "/tmp/prompt.txt"
    )).toBe(
      "'codex' exec -c sandbox_mode=read-only -c approval_policy=never -m 'gpt-5-codex' -o '/tmp/out.json' - < '/tmp/prompt.txt'"
    );
  });

  it.each([
    { name: "missing", taskPacketRef: undefined },
    { name: "empty", taskPacketRef: "" },
    { name: "blank", taskPacketRef: "   " }
  ])("throws before worker side effects when codex_implement has $name taskPacketRef", async ({ taskPacketRef }) => {
    await expect(runCliWorker(baseInput({
      codexMode: "codex_implement",
      ...(taskPacketRef !== undefined ? { taskPacketRef } : {})
    }), stateDir)).rejects.toThrow("codex_implement requires taskPacketRef");

    expect(captureCodexResponseMock).not.toHaveBeenCalled();
    expect(existsSync(join(stateDir, "worker.lock"))).toBe(false);
    expect(existsSync(join(stateDir, "cli-call-telemetry.jsonl"))).toBe(false);
  });

  it("lets codex_implement with taskPacketRef proceed to the command layer", async () => {
    await expect(runCliWorker(baseInput({
      codexMode: "codex_implement",
      taskPacketRef: "handoff-packet-123"
    }), stateDir)).resolves.toMatchObject({
      vendor: "codex_cli",
      exitCode: 0,
      errorReason: null
    });

    expect(captureCodexResponseMock).toHaveBeenCalledWith(
      "bounded dispatch prompt",
      expect.objectContaining({ codexMode: "codex_implement" })
    );
  });

  it.each([
    "codex_implement",
    "codex_review",
    "codex_research"
  ] as readonly CodexDispatchMode[])("passes %s through to Codex capture", async (codexMode) => {
    await runCliWorker(baseInput({
      codexMode,
      ...(codexMode === "codex_implement" ? { taskPacketRef: "packet-for-implement" } : {})
    }), stateDir);

    expect(captureCodexResponseMock).toHaveBeenCalledWith(
      "bounded dispatch prompt",
      expect.objectContaining({ codexMode })
    );
  });

  it("records codex_mode and task_packet_ref in telemetry and subagent evidence", async () => {
    await runCliWorker(baseInput({
      codexMode: "codex_implement",
      taskPacketRef: "handoff-packet-456"
    }), stateDir);

    const telemetry = readJsonlRecord(join(stateDir, "cli-call-telemetry.jsonl"));
    expect(telemetry.codex_mode).toBe("codex_implement");
    expect(telemetry.task_packet_ref).toBe("handoff-packet-456");

    const evidence = readJsonlRecord(join(stateDir, "subagent-evidence.jsonl"));
    expect(evidence.codex_mode).toBe("codex_implement");
    expect(evidence.task_packet_ref).toBe("handoff-packet-456");
  });
});
