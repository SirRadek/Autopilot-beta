import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderForCli, validateMcpManifest, type McpManifest } from "../../scripts/validate-mcp-manifest";
import { validateJsonSchema } from "../../src/lib/delivery-system/validation";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, "ops/mcp/mcp-manifest.json"), "utf8")) as McpManifest;
const schema = JSON.parse(readFileSync(join(root, "ops/mcp/mcp-manifest.schema.json"), "utf8")) as unknown;

describe("mcp cross manifest", () => {
  it("validates the canonical manifest (schema + read-only + no embedded secrets)", () => {
    const report = validateMcpManifest();
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.serverCount).toBeGreaterThanOrEqual(2);
  });

  it("renders a per-CLI config filtered by target, with no resolved secrets", () => {
    const codex = renderForCli(manifest, "codex");
    expect(Object.keys(codex)).toContain("context7");
    expect(Object.keys(codex)).toContain("figma-context");
    // secret values are never materialised — only the manifest's ${ENV} refs exist
    expect(JSON.stringify(codex)).not.toContain("${");
    expect(JSON.stringify(codex)).not.toMatch(/CONTEXT7_API_KEY|FIGMA_TOKEN/);
  });

  it("rejects an embedded secret literal in secretRefs (schema pattern)", () => {
    const bad = { version: "autopilot.mcp-cross/1", servers: [{ id: "x", transport: "http", url: "https://x", readOnly: true, toolAllowlist: ["a"], targets: ["claude"], secretRefs: ["sk-live-abc123"] }] };
    expect(validateJsonSchema(bad, schema).length).toBeGreaterThan(0);
  });
});
