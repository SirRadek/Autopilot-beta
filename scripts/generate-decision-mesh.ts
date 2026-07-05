import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDecisionMeshGraph, loadDecisionMeshFromRoot } from "../src/lib/decision-mesh";

const root = process.cwd();
const graph = buildDecisionMeshGraph(loadDecisionMeshFromRoot(root));
const outputPath = join(root, "mesh", "generated", "decision-mesh.json");

writeFileSync(outputPath, `${JSON.stringify(graph, null, 2)}\n`);
console.log("Generated mesh/generated/decision-mesh.json");
