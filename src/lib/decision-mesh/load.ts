import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import type { DecisionMesh, DecisionMeshEdge, DecisionMeshNode, DecisionMeshRule } from "./types";

export function loadDecisionMeshFromRoot(root: string): DecisionMesh {
  return loadDecisionMesh(join(root, "mesh"));
}

export function loadProjectDecisionMeshFromRoot(root: string, projectSlug: string): DecisionMesh {
  assertSafeProjectSlug(projectSlug);
  // v0.2 (E1): per-project mesh lives in the project repo at <repo>/.autopilot/decision-mesh.
  // Legacy fallback: the old autopilot-root docs/projects/<slug>/decision-mesh layout.
  const repoLocal = join(root, ".autopilot", "decision-mesh");
  if (existsSync(join(repoLocal, "nodes"))) return loadDecisionMesh(repoLocal);
  return loadDecisionMesh(join(root, "docs", "projects", projectSlug, "decision-mesh"));
}

export function loadDecisionMesh(meshDirectory: string): DecisionMesh {
  const nodesDirectory = join(meshDirectory, "nodes");

  if (!existsSync(nodesDirectory)) {
    throw new Error(`Decision Mesh nodes directory not found: ${nodesDirectory}`);
  }

  const nodes = readdirSync(nodesDirectory)
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .sort()
    .map((file) => parseNodeFile(join(nodesDirectory, file)));

  const edgeDocument = asRecord(readYaml(join(meshDirectory, "edges.yaml")), "mesh/edges.yaml");
  const ruleDocument = asRecord(readYaml(join(meshDirectory, "rules.yaml")), "mesh/rules.yaml");
  const edges = asArray(edgeDocument.edges, "edges").map(parseEdge);
  const rules = asArray(ruleDocument.rules, "rules").map(parseRule);

  validateMesh({ nodes, edges, rules });

  return { nodes, edges, rules };
}

function assertSafeProjectSlug(projectSlug: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectSlug)) {
    throw new Error(`Invalid project mesh slug: ${projectSlug}`);
  }
}

function readYaml(path: string): unknown {
  return parse(readFileSync(path, "utf8"));
}

function parseNodeFile(path: string): DecisionMeshNode {
  const record = asRecord(readYaml(path), path);
  const stopConditions = optionalStringArray(record.stop_conditions, `${path}.stop_conditions`);
  const mustNotAssume = optionalStringArray(record.must_not_assume, `${path}.must_not_assume`);
  const objective = optionalStringArray(record.objective, `${path}.objective`);
  const failureModes = optionalStringArray(record.failure_modes, `${path}.failure_modes`);

  const node: DecisionMeshNode = {
    id: asString(record.id, `${path}.id`),
    type: asString(record.type, `${path}.type`),
    name: asString(record.name, `${path}.name`),
    question: asString(record.question, `${path}.question`),
    why: asString(record.why, `${path}.why`),
    signals: asStringArray(record.signals, `${path}.signals`),
    related_agents: asStringArray(record.related_agents, `${path}.related_agents`),
    related_files: asStringArray(record.related_files, `${path}.related_files`),
    required_checks: asStringArray(record.required_checks, `${path}.required_checks`)
  };

  const optional: OptionalArrays = {};

  if (stopConditions) {
    optional.stop_conditions = stopConditions;
  }

  if (mustNotAssume) {
    optional.must_not_assume = mustNotAssume;
  }

  if (objective) {
    optional.objective = objective;
  }

  if (failureModes) {
    optional.failure_modes = failureModes;
  }

  return withOptionalArrays(node, optional);
}

function parseEdge(value: unknown): DecisionMeshEdge {
  const record = asRecord(value, "edge");
  return {
    from: asString(record.from, "edge.from"),
    to: asString(record.to, "edge.to"),
    relation: asString(record.relation, "edge.relation"),
    weight: asNumber(record.weight, "edge.weight"),
    why: asString(record.why, "edge.why")
  };
}

function parseRule(value: unknown): DecisionMeshRule {
  const record = asRecord(value, "rule");
  const mustNotAssume = optionalStringArray(record.must_not_assume, "rule.must_not_assume");
  const severity = asString(record.severity, "rule.severity");

  if (!["blocker", "major", "minor", "note"].includes(severity)) {
    throw new Error(`Invalid Decision Mesh rule severity: ${severity}`);
  }

  const rule: DecisionMeshRule = {
    id: asString(record.id, "rule.id"),
    title: asString(record.title, "rule.title"),
    applies_to: asStringArray(record.applies_to, "rule.applies_to"),
    instruction: asString(record.instruction, "rule.instruction"),
    severity: severity as DecisionMeshRule["severity"]
  };

  const optional: OptionalArrays = {};

  if (mustNotAssume) {
    optional.must_not_assume = mustNotAssume;
  }

  return withOptionalArrays(rule, optional);
}

function validateMesh(mesh: DecisionMesh): void {
  const nodeIds = new Set<string>();

  for (const node of mesh.nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Duplicate Decision Mesh node id: ${node.id}`);
    }

    if (!node.why.trim()) {
      throw new Error(`Decision Mesh node ${node.id} is missing why`);
    }

    nodeIds.add(node.id);
  }

  for (const edge of mesh.edges) {
    if (!nodeIds.has(edge.from)) {
      throw new Error(`Decision Mesh edge references missing from node: ${edge.from}`);
    }

    if (!nodeIds.has(edge.to)) {
      throw new Error(`Decision Mesh edge references missing to node: ${edge.to}`);
    }

    if (edge.weight < 0 || edge.weight > 1) {
      throw new Error(`Decision Mesh edge weight must be 0..1: ${edge.from} -> ${edge.to}`);
    }
  }

  for (const rule of mesh.rules) {
    for (const nodeId of rule.applies_to) {
      if (!nodeIds.has(nodeId)) {
        throw new Error(`Decision Mesh rule ${rule.id} references missing node: ${nodeId}`);
      }
    }
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an array`);
  }

  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Expected ${label} to be a non-empty string`);
  }

  return value;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected ${label} to be a finite number`);
  }

  return value;
}

function asStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(`Expected ${label} to be an array of non-empty strings`);
  }

  return value;
}

function optionalStringArray(value: unknown, label: string): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return asStringArray(value, label);
}

interface OptionalArrays {
  stop_conditions?: readonly string[];
  must_not_assume?: readonly string[];
  objective?: readonly string[];
  failure_modes?: readonly string[];
}

function withOptionalArrays<T extends object>(base: T, optional: OptionalArrays): T {
  const output = { ...base } as Record<string, unknown>;

  for (const [key, value] of Object.entries(optional)) {
    if (value && value.length > 0) {
      output[key] = value;
    }
  }

  return output as T;
}
