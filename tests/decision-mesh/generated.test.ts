import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildDecisionMeshGraph, loadDecisionMeshFromRoot } from "../../src/lib/decision-mesh";

describe("generated Decision Mesh artifact", () => {
  it("matches the YAML source of truth", () => {
    const root = process.cwd();
    const mesh = loadDecisionMeshFromRoot(root);
    const generated = JSON.parse(readFileSync(join(root, "mesh/generated/decision-mesh.json"), "utf8")) as unknown;

    expect(generated).toEqual(buildDecisionMeshGraph(mesh));
  });
});
