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
//
// Per-project mesh: pass --mesh-dir <repo>/.autopilot/decision-mesh. Read-only.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadDecisionMesh } from "../decision-mesh";

import { activateForChangedFiles, resolveAckedBlockers } from "./changed-files-capabilities";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const root = arg("--root") ?? process.cwd();
const meshDir = arg("--mesh-dir") ?? join(root, "mesh");
const failOnBlocker = process.argv.includes("--fail-on-blocker");
// Opt-in: also fail when an ungoverned change touches a sensitive root. Separate from
// --fail-on-blocker so the existing hooks keep their current (blocker-only) behaviour
// until a seeded baseline is wired (else every change to the control plane's own
// sensitive dirs — which no node covers — would self-block).
const failOnUngoverned = process.argv.includes("--fail-on-ungoverned");
// Mesh-Ack: comma/space-separated NODE ids whose blocker rules the committer has
// reviewed (sourced from `Mesh-Ack: <node-id> — <reason>` commit-message trailers by
// the commit-msg hook). Acks are auditable in history; they suppress the failure,
// never the reporting, and only for rules whose activated nodes are ALL acked.
const ackArg = arg("--ack") ?? "";
const ackedNodeIds = ackArg.split(/[\s,]+/).filter(Boolean);

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

console.log(`[changed-files] ${changedFiles.length} changed → ${r.activatedNodes.length} governing node(s) activated`);
for (const n of r.activatedNodes) {
  console.log(`  ACTIVATED ${n.id} (${n.name}) ← ${n.matchedFiles.join(", ")}`);
}
for (const rule of r.rules) {
  console.log(`  ${rule.severity.toUpperCase().padEnd(7)} ${rule.id}: ${rule.instruction}`);
}
for (const e of r.escalations) {
  console.log(`  ESCALATE  ${e.from} --${e.relation}--> ${e.to}`);
}
if (r.stopConditions.length > 0) console.log(`  STOP      ${r.stopConditions.join(", ")}`);
if (r.requiredChecks.length > 0) console.log(`  CHECKS    ${r.requiredChecks.join(", ")}`);
for (const f of r.ungovernedSensitive) {
  console.log(`  UNGOVERNED ${f} (under a sensitive root, no node covers it)`);
}

const ack = resolveAckedBlockers(r, ackedNodeIds);
for (const id of ack.ackedBlockers) {
  console.log(`  ACKED     ${id} (blocker suppressed by Mesh-Ack; review is recorded in the commit message)`);
}
for (const id of ack.unknownAcks) {
  console.log(`  ACK-NOOP  ${id} (Mesh-Ack names a node this change does not activate; it excuses nothing)`);
}

const blockerFail = failOnBlocker && ack.unackedBlockers.length > 0;
if (blockerFail) {
  console.error(
    `  -> blocked by ${ack.unackedBlockers.join(", ")}. Review the rules above; if the change is sound, ` +
      `add a commit-message trailer per activated node: "Mesh-Ack: <node-id> — <short reason>".`
  );
}
const ungovernedFail = failOnUngoverned && r.ungovernedSensitive.length > 0;
process.exit(blockerFail || ungovernedFail ? 1 : 0);
