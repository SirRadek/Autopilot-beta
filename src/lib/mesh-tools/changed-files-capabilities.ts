// Bind-point ② — changed-file → auto capability activation.
//
// The inverse of bind-point ①: given a set of changed files (e.g. `git diff
// --name-only`), find every mesh node whose `related_files` covers a changed
// file, and surface that node's governance WITHOUT any LLM classification:
// its rules (severity-ranked), blocker ids, required_checks, stop_conditions,
// must_not_assume, and the escalation edges leaving it (escalates_when_combined,
// escalates_for_review, requires, …). Deterministic, fail-closed on no match.

import type { DecisionMesh, DecisionMeshRule } from "../decision-mesh";

// Templated hints (docs/projects/<slug>/…) never match a concrete changed file.
const PLACEHOLDER_RE = /[<>*]/;

/** A related_files hint covers a changed file if it equals it, is a dir prefix of it, or vice-versa. */
function hintCovers(changedFile: string, hint: string): boolean {
  if (PLACEHOLDER_RE.test(hint)) return false;
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
}

function uniq(xs: readonly string[]): string[] {
  return [...new Set(xs)];
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

  return { changedFiles, activatedNodes, rules, blockers, requiredChecks, stopConditions, mustNotAssume, escalations };
}
