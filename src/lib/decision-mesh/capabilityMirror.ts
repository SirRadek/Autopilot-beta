import { capabilityModules } from "../../data/delivery-system/capabilities";
import type { CapabilityModule } from "../../data/delivery-system/capabilities";
import type { DecisionMesh } from "./types";

export function validateCapabilityRoutingMirror(
  mesh: DecisionMesh,
  modules: readonly CapabilityModule[] = capabilityModules
): string[] {
  const errors: string[] = [];
  const yamlCapabilityNodes = mesh.nodes.filter((node) =>
    node.type === "capability_module" || node.type === "capability_addon"
  );
  const yamlIds = yamlCapabilityNodes.map((node) => node.id);
  const tsIds = modules.map((module) => module.id);

  compareSets("capability ids", tsIds, yamlIds, errors);

  for (const module of modules) {
    const node = yamlCapabilityNodes.find((candidate) => candidate.id === module.id);
    if (!node) {
      continue;
    }

    compareSets(`${module.id}.signals`, module.signals, node.signals, errors);
    compareSets(`${module.id}.requiredAgents`, module.requiredAgents, node.related_agents, errors);
    compareSets(`${module.id}.requiredChecks`, module.requiredChecks, node.required_checks, errors);
  }

  return errors;
}

function compareSets(label: string, actualValues: readonly string[], expectedValues: readonly string[], errors: string[]): void {
  const actual = [...new Set(actualValues)].sort();
  const expected = [...new Set(expectedValues)].sort();

  const missing = expected.filter((value) => !actual.includes(value));
  const extra = actual.filter((value) => !expected.includes(value));

  if (missing.length > 0 || extra.length > 0) {
    errors.push(`${label} drift: missing [${missing.join(", ")}], extra [${extra.join(", ")}]`);
  }
}
