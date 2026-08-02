import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { validateDesignBriefs } from "../../scripts/validate-design-briefs";
import { validateJsonSchema } from "../../src/lib/delivery-system/validation";

const root = process.cwd();
const schema = JSON.parse(readFileSync(join(root, "design/briefs/schema/design-brief.schema.json"), "utf8")) as unknown;

describe("design briefs", () => {
  it("validates every repo brief against the schema", () => {
    const report = validateDesignBriefs();
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checkedFiles.length).toBeGreaterThan(0);
  });

  it("rejects a brief missing the required layers", () => {
    const bad = { schemaVersion: "autopilot.design-brief/1", source: { provider: "figma", fileKey: "k", nodeId: "1:1" } };
    expect(validateJsonSchema(bad, schema).length).toBeGreaterThan(0);
  });

  it("rejects duplicated token values (additionalProperties)", () => {
    const example = JSON.parse(readFileSync(join(root, "design/briefs/examples/run-card.brief.json"), "utf8")) as Record<string, unknown>;
    const bad = { ...example, tokens: { "--color": "#ffffff" } };
    expect(validateJsonSchema(bad, schema).length).toBeGreaterThan(0);
  });

  it("keeps cockpit CSS free of raw hex (design token lint)", () => {
    const result = spawnSync(process.execPath, [join(root, "scripts/design-token-lint.mjs")], { encoding: "utf8" });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
