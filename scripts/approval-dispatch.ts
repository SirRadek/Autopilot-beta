import { readFileSync } from "node:fs";

import { buildAgentPacket, loadDecisionMeshFromRoot } from "../src/lib/decision-mesh";
import { computePacketHash, dispatchGovernedSessionHandoff, type GovernedHandoff } from "../src/governed-core/dispatch";
import { requireApprovedApproval, readApprovalQueue } from "../src/data/delivery-system/approvalQueue";
import { readSessionRegistry } from "../src/data/delivery-system/sessionRegistry";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key?.startsWith("--") && value !== undefined) args.set(key.slice(2), value);
}

const stateDir = required("state-dir");
const approvalId = required("id");
const catalogPath = required("catalog");
const agent = required("agent");
const cwd = required("cwd");
const approval = requireApprovedApproval(readApprovalQueue(stateDir), approvalId);
if (approval.prompt_file === null) throw new Error("approval_prompt_file_missing");
const prompt = readFileSync(approval.prompt_file, "utf8");
const task = prompt;
const mesh = loadDecisionMeshFromRoot(process.cwd());
const packet = buildAgentPacket(mesh, { task, agent, token_budget: 8000 });
const handoff: GovernedHandoff = {
  handoffId: `hp-${approval.approval_id}` as GovernedHandoff["handoffId"],
  vendor: approval.vendor as GovernedHandoff["vendor"],
  prompt,
  parentSessionHash: "approval-parent-session",
  parentTurnHash: "approval-parent-turn",
  task,
  agent,
  packet_hash: computePacketHash(packet),
  required_checks: ["approval_verified", "skill_route_verified"],
  ...(approval.vendor === "openrouter_api"
    ? { openrouterMode: (args.get("mode") ?? "nemotron_planning") as "nemotron_planning" | "qwen3_code_draft", taskPacketRef: `approval-${approval.approval_id}` }
    : approval.vendor === "codex_cli" ? { codexMode: "codex_research" as const } : {}),
  ...(approval.vendor === "openrouter_api" ? {} : { cwd })
};

const sessionDocument = readSessionRegistry(stateDir);
const result = await dispatchGovernedSessionHandoff(handoff, stateDir, {
  sessions: sessionDocument.sessions,
  scope: { agentCommand: approval.vendor, cwd, name: agent },
  catalogPaths: [catalogPath],
  now: new Date().toISOString()
});
process.stdout.write(`${JSON.stringify({
  refused: result.refused,
  worker_run_id: result.refused ? null : result.workerRunId,
  exit_code: result.refused ? null : result.exitCode,
  error_reason: result.refused ? result.reason : result.errorReason
}, null, 2)}\n`);

function required(name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`missing_${name}`);
  return value;
}
