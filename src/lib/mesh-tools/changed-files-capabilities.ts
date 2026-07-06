// Bind-point ② — changed-file → auto capability activation.
//
// The inverse of bind-point ①: given a set of changed files (e.g. `git diff
// --name-only`), find every mesh node whose `related_files` covers a changed
// file, and surface that node's governance WITHOUT any LLM classification:
// its rules (severity-ranked), blocker ids, required_checks, stop_conditions,
// must_not_assume, and the escalation edges leaving it (escalates_when_combined,
// escalates_for_review, requires, …). Deterministic.
//
// No-match posture: an unmapped file PASSES (fail-open) — the mesh only governs
// surfaces a node hints at — EXCEPT a file under a sensitive governance root, which
// is surfaced as `ungovernedSensitive` so a caller can fail-CLOSED on it (the gate
// must never silently wave through an ungoverned change to the vendor exec lane,
// the MCP server, the mesh/engine, the runtime hooks, or the gate scripts).

import type { DecisionMesh, DecisionMeshRule } from "../decision-mesh";

import { normalizeRelatedFileHint, PLACEHOLDER_RE } from "./related-file-hints";

// Surfaces where an ungoverned change is a real risk. A changed file under one of
// these that NO node covers is reported as `ungovernedSensitive` (deny-able), instead
// of silently passing. Kept narrow + security-critical on purpose: the runtime code paths.
const SENSITIVE_ROOTS = [
  "src/data/delivery-system",
  "mcp",
  "src/lib/decision-mesh",
  "src/lib/mesh-tools",
  "src/governed-core",
  ".codex/hooks",
  "scripts/git-hooks"
] as const;

// The mesh governance SOURCE (hand-authored nodes + rules + edges) is sensitive too: a new
// ungoverned node could introduce governance or launder coverage of real code (the gap the
// earlier "drop mesh from the sensitive set" change opened). But the GENERATED ratchet artifacts
// under mesh/ (related-files-baseline.json, related-files-snapshot.json, generated/*) are MEANT to
// grow, so we match the source files EXPLICITLY rather than treating all of mesh/ as a root.
// In practice these source files are covered by a governance node (see capability_routing's
// related_files), so a mesh change activates governance instead of being blocked; this stays as the
// fail-closed backstop for any mesh source a node does not cover.
export function isMeshGovernanceSource(file: string): boolean {
  return file === "mesh/rules.yaml" || file === "mesh/edges.yaml" || /^mesh\/nodes\/[^/]+\.ya?ml$/.test(file);
}

function underSensitiveRoot(file: string): boolean {
  if (SENSITIVE_ROOTS.some((root) => file === root || file.startsWith(`${root}/`))) return true;
  return isMeshGovernanceSource(file);
}

/**
 * A related_files hint covers a changed file if it equals it, is a dir prefix of it, or vice-versa.
 * The hint is normalized first (shared normalizeRelatedFileHint): an authored directory hint like
 * `model-output-evals/` must still prefix-match files inside it — without normalization `${hint}/`
 * becomes `model-output-evals//` and matches nothing, silently un-governing every file under it.
 */
function hintCovers(changedFile: string, rawHint: string): boolean {
  if (PLACEHOLDER_RE.test(rawHint)) return false;
  const hint = normalizeRelatedFileHint(rawHint);
  if (hint.length === 0) return false;
  return changedFile === hint || changedFile.startsWith(`${hint}/`) || hint.startsWith(`${changedFile}/`);
}

export interface ActivatedNode {
  readonly id: string;
  readonly name: string;
  readonly matchedFiles: readonly string[];
}

export interface Escalation {
  readonly from: string;
  readonly to: string;
  readonly relation: string;
  readonly why: string;
}

export interface ChangedFilesActivation {
  readonly changedFiles: readonly string[];
  readonly activatedNodes: readonly ActivatedNode[];
  /** rules whose applies_to intersects an activated node, severity-ranked (blocker first) */
  readonly rules: readonly DecisionMeshRule[];
  /** rule ids with severity "blocker" */
  readonly blockers: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
  readonly mustNotAssume: readonly string[];
  /** edges leaving an activated node — the governance escalations */
  readonly escalations: readonly Escalation[];
  /** changed files under a sensitive governance root that NO node covers — deny-able (fail-closed) */
  readonly ungovernedSensitive: readonly string[];
}

function uniq(xs: readonly string[]): string[] {
  return [...new Set(xs)];
}

export interface AckResolution {
  /** blocker rule ids excused because EVERY activated node they apply to is acked */
  readonly ackedBlockers: readonly string[];
  /** blocker rule ids still blocking (at least one activated applies_to node unacked) */
  readonly unackedBlockers: readonly string[];
  /** ack ids that matched no activated node — they excuse nothing (fail-closed) */
  readonly unknownAcks: readonly string[];
}

/**
 * Resolve Mesh-Ack'd node ids against an activation. Acks name NODES (not rules):
 * a blocker rule is excused only when every activated node it applies to is acked.
 * An ack for a non-activated node is surfaced as unknown and excuses nothing.
 * An ack never removes reporting — callers must still print the rules.
 */
export function resolveAckedBlockers(
  activation: ChangedFilesActivation,
  ackedNodeIds: readonly string[]
): AckResolution {
  const activated = new Set(activation.activatedNodes.map((n) => n.id));
  const acked = new Set(ackedNodeIds.filter((id) => activated.has(id)));
  const unknownAcks = uniq(ackedNodeIds.filter((id) => !activated.has(id)));

  const ackedBlockers: string[] = [];
  const unackedBlockers: string[] = [];
  for (const rule of activation.rules) {
    if (rule.severity !== "blocker") continue;
    const via = rule.applies_to.filter((id) => activated.has(id));
    if (via.length > 0 && via.every((id) => acked.has(id))) {
      ackedBlockers.push(rule.id);
    } else {
      unackedBlockers.push(rule.id);
    }
  }
  return { ackedBlockers, unackedBlockers, unknownAcks };
}

function severityRank(s: DecisionMeshRule["severity"]): number {
  return s === "blocker" ? 0 : s === "major" ? 1 : s === "minor" ? 2 : 3;
}

export function activateForChangedFiles(
  mesh: DecisionMesh,
  changedFiles: readonly string[]
): ChangedFilesActivation {
  const activatedNodes: ActivatedNode[] = [];
  for (const node of mesh.nodes) {
    const matchedFiles = changedFiles.filter((f) => node.related_files.some((hint) => hintCovers(f, hint)));
    if (matchedFiles.length > 0) {
      activatedNodes.push({ id: node.id, name: node.name, matchedFiles });
    }
  }

  const activatedIds = new Set(activatedNodes.map((a) => a.id));
  const activatedNodeObjs = mesh.nodes.filter((n) => activatedIds.has(n.id));

  const rules = mesh.rules
    .filter((r) => r.applies_to.some((id) => activatedIds.has(id)))
    .slice()
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const blockers = rules.filter((r) => r.severity === "blocker").map((r) => r.id);
  const requiredChecks = uniq(activatedNodeObjs.flatMap((n) => [...n.required_checks]));
  const stopConditions = uniq(activatedNodeObjs.flatMap((n) => [...(n.stop_conditions ?? [])]));
  const mustNotAssume = uniq([
    ...activatedNodeObjs.flatMap((n) => [...(n.must_not_assume ?? [])]),
    ...rules.flatMap((r) => [...(r.must_not_assume ?? [])])
  ]);
  const escalations: Escalation[] = mesh.edges
    .filter((e) => activatedIds.has(e.from))
    .map((e) => ({ from: e.from, to: e.to, relation: e.relation, why: e.why }));

  // Fail-closed signal: a changed file under a sensitive root that no node covers.
  const coveredFiles = new Set(activatedNodes.flatMap((a) => [...a.matchedFiles]));
  const ungovernedSensitive = changedFiles.filter((f) => !coveredFiles.has(f) && underSensitiveRoot(f));

  return {
    changedFiles,
    activatedNodes,
    rules,
    blockers,
    requiredChecks,
    stopConditions,
    mustNotAssume,
    escalations,
    ungovernedSensitive
  };
}
