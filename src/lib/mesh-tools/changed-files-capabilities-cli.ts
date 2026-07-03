// CLI for bind-point ② — changed-file → auto capability activation.
//
//   # explicit files:
//   tsx changed-files-capabilities-cli.ts --root . --files "mcp/server.ts src/lib/decision-mesh/query.ts"
//   # from a git range:
//   tsx changed-files-capabilities-cli.ts --root . --since origin/main
//   # piped:
//   git diff --name-only | tsx changed-files-capabilities-cli.ts --root .
//   # gate mode (exit nonzero if a blocker-governed surface is touched):
//   ... --fail-on-blocker
//   # acknowledge a specific fired blocker (repeatable; pre-commit sources AUTOPILOT_ACK_BLOCKERS):
//   ... --fail-on-blocker --ack WORKER-CLI-001
//
// Per-project mesh: pass --mesh-dir <repo>/.autopilot/decision-mesh. Read-only.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadDecisionMesh } from "../decision-mesh";

import { activateForChangedFiles, unacknowledgedBlockers } from "./changed-files-capabilities";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function argAll(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name && process.argv[i + 1] !== undefined) out.push(process.argv[i + 1] as string);
  }
  return out;
}

const root = arg("--root") ?? process.cwd();
const meshDir = arg("--mesh-dir") ?? join(root, "mesh");
const failOnBlocker = process.argv.includes("--fail-on-blocker");
const acked = argAll("--ack").flatMap((value) => value.split(/[\s,]+/).filter(Boolean));
// Opt-in: also fail when an ungoverned change touches a sensitive root. Separate from
// --fail-on-blocker so the existing hooks keep their current (blocker-only) behaviour
// until a seeded baseline is wired (else every change to the control plane's own
// sensitive dirs — which no node covers — would self-block).
const failOnUngoverned = process.argv.includes("--fail-on-ungoverned");

function resolveChangedFiles(): string[] {
  const filesArg = arg("--files");
  if (filesArg !== undefined) return filesArg.split(/[\s,]+/).filter(Boolean);
  const since = arg("--since");
  if (since !== undefined) {
    const out = execFileSync("git", ["-C", root, "diff", "--name-only", since], { encoding: "utf8" });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  // piped stdin (git diff --name-only | ...)
  try {
    return readFileSync(0, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const changedFiles = resolveChangedFiles();
const mesh = loadDecisionMesh(meshDir);
const r = activateForChangedFiles(mesh, changedFiles);
const unackedBlockers = unacknowledgedBlockers(r.blockers, acked);

console.log(`[changed-files] ${changedFiles.length} changed → ${r.activatedNodes.length} governing node(s) activated`);
for (const n of r.activatedNodes) {
  console.log(`  ACTIVATED ${n.id} (${n.name}) ← ${n.matchedFiles.join(", ")}`);
}
for (const rule of r.rules) {
  console.log(`  ${rule.severity.toUpperCase().padEnd(7)} ${rule.id}: ${rule.instruction}`);
}
for (const blocker of r.blockers.filter((b) => acked.includes(b))) {
  console.log(`  ACKED   ${blocker} (acknowledged via --ack / AUTOPILOT_ACK_BLOCKERS)`);
}
for (const e of r.escalations) {
  console.log(`  ESCALATE  ${e.from} --${e.relation}--> ${e.to}`);
}
if (r.stopConditions.length > 0) console.log(`  STOP      ${r.stopConditions.join(", ")}`);
if (r.requiredChecks.length > 0) console.log(`  CHECKS    ${r.requiredChecks.join(", ")}`);
for (const f of r.ungovernedSensitive) {
  console.log(`  UNGOVERNED ${f} (under a sensitive root, no node covers it)`);
}

const blockerFail = failOnBlocker && unackedBlockers.length > 0;
const ungovernedFail = failOnUngoverned && r.ungovernedSensitive.length > 0;
process.exit(blockerFail || ungovernedFail ? 1 : 0);
