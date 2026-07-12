import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildAgentPacket,
  loadDecisionMeshFromRoot
} from "../src/lib/decision-mesh";
import {
  computePacketHash,
  dispatchGovernedSessionHandoff,
  type GovernedHandoff
} from "../src/governed-core/dispatch";
import { createSessionRecord } from "../src/data/delivery-system/sessionRegistry";

if (!process.argv.includes("--live")) {
  throw new Error("refusing_live_dispatch: pass --live explicitly");
}

const catalogPath = process.argv[process.argv.indexOf("--catalog") + 1];
if (!catalogPath) throw new Error("usage: npm run smoke:governed -- --live --catalog FILE");
const vendor = process.argv.includes("--openrouter")
  ? "openrouter_api"
  : process.argv.includes("--claude")
    ? "claude_cli"
    : process.argv.includes("--agy")
      ? "agy_cli"
      : "codex_cli";

const task = "show model usage for this project and respond with exactly SMOKE_OK";
const agent = "manager";
const mesh = loadDecisionMeshFromRoot(process.cwd());
const packet = buildAgentPacket(mesh, { task, agent, token_budget: 8000 });
const stateDir = mkdtempSync(join(tmpdir(), "autopilot-governed-smoke-"));
const session = createSessionRecord({
  sessionId: "smoke-session-1",
  agentCommand: vendor,
  cwd: process.cwd(),
  name: agent
});
const handoff: GovernedHandoff = {
  handoffId: "hp-governed-smoke" as GovernedHandoff["handoffId"],
  vendor,
  prompt: task,
  parentSessionHash: "smoke-parent-session",
  parentTurnHash: "smoke-parent-turn",
  task,
  agent,
  packet_hash: computePacketHash(packet),
  required_checks: ["skill_route_verified", "read_only_smoke"],
  ...(vendor === "codex_cli" ? { codexMode: "codex_research" as const } : vendor === "openrouter_api" ? {
    openrouterMode: "nemotron_planning" as const,
    taskPacketRef: "smoke-task-packet"
  } : {}),
  ...(vendor !== "openrouter_api" ? { cwd: process.cwd() } : {})
};

const result = await dispatchGovernedSessionHandoff(handoff, stateDir, {
  sessions: [session],
  scope: { agentCommand: vendor, cwd: process.cwd(), name: agent },
  catalogPaths: [catalogPath],
  now: new Date().toISOString()
});

process.stdout.write(`${JSON.stringify({
  refused: result.refused,
  worker_run_id: result.refused ? null : result.workerRunId,
  exit_code: result.refused ? null : result.exitCode,
  error_reason: result.refused ? result.reason : result.errorReason,
  state_dir: stateDir
}, null, 2)}\n`);
