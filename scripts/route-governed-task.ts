import { readSessionRegistry } from "../src/data/delivery-system/sessionRegistry";
import { prepareGovernedSessionDispatch } from "../src/data/delivery-system/sessionDispatch";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key?.startsWith("--") && value !== undefined) args.set(key.slice(2), value);
}

const stateDir = required("state-dir");
const agent = required("agent");
const cwd = required("cwd");
const task = required("task");
const catalogs = required("catalogs").split(",").filter(Boolean);
const name = args.get("name");
const now = args.get("now") ?? new Date().toISOString();
const plan = prepareGovernedSessionDispatch({
  sessions: readSessionRegistry(stateDir).sessions,
  scope: { agentCommand: agent, cwd, ...(name !== undefined ? { name } : {}) },
  task,
  catalogPaths: catalogs,
  now
});

process.stdout.write(`${JSON.stringify({
  session_id: plan.session.session_id,
  agent_command: plan.session.agent_command,
  cwd: plan.session.cwd,
  matching_items: plan.route.matchingItems,
  skill_ids: plan.skillIds,
  required_checks: plan.route.requiredChecks,
  stop_conditions: plan.route.stopConditions
}, null, 2)}\n`);

function required(name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`usage: tsx scripts/route-governed-task.ts --state-dir DIR --agent CMD --cwd PATH --task TEXT --catalogs FILE[,FILE]`);
  return value;
}
