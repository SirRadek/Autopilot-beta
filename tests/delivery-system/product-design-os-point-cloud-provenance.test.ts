import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderComposition, RenderCompositionSpecError } from "../../product-design-os/renderer/render-composition";

const pdosRoot = join(process.cwd(), "product-design-os");

describe("point-cloud-background provenance gating", () => {
  it("rejects source-recorded point clouds from unapproved catalog sources", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pdos-point-cloud-provenance-"));
    const tempPdosRoot = join(tempRoot, "product-design-os");

    try {
      mkdirSync(join(tempPdosRoot, "assets"), { recursive: true });
      mkdirSync(join(tempPdosRoot, "contracts"), { recursive: true });
      mkdirSync(join(tempPdosRoot, "library"), { recursive: true });
      writeJson(join(tempPdosRoot, "assets", "asset-manifest.json"), {
        version: 1,
        assets: [
          {
            id: "external-cloud",
            type: "point_cloud",
            source: "product-design-os/assets/3d/external-cloud.cloud.json",
            provenance_status: "source-recorded",
            library_source_id: "candidate-cloud-source"
          }
        ]
      });
      writeJson(join(tempPdosRoot, "contracts", "component-contract-manifest.json"), {
        contracts: [
          {
            id: "pattern-point-cloud-background",
            target_kind: "pattern",
            target_id: "point-cloud-background",
            props: [],
            slots: [
              {
                name: "point_cloud",
                required: true,
                accepts_target_kinds: ["asset"],
                accepts_asset_types: ["point_cloud"]
              }
            ],
            output_invariants: []
          }
        ]
      });
      writeJson(join(tempPdosRoot, "library", "source-catalog.json"), {
        sources: [{ id: "candidate-cloud-source", status: "candidate_source", commercial_use: "allowed" }]
      });

      let thrown: unknown;
      try {
        renderComposition(pointCloudSpec("external-cloud"), tempPdosRoot);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RenderCompositionSpecError);
      expect((thrown as RenderCompositionSpecError).code).toBe("cloud_source_unlicensed");
      expect((thrown as Error).message).toMatch(/cloud_source_unlicensed/);
      expect((thrown as Error).message).toContain("external-cloud");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("still renders the committed internal point-cloud composition", () => {
    const spec = readJson(join(pdosRoot, "specs", "examples", "point-cloud-background.composition.json"));
    let html = "";

    expect(() => {
      html = renderComposition(spec, pdosRoot).html;
    }).not.toThrow();
    expect(html).toContain("data-point-cloud");
  });
});

function pointCloudSpec(assetId: string): unknown {
  return {
    spec_kind: "composition_spec",
    id: "point-cloud-provenance-test",
    nodes: [
      {
        node_id: "cloud-hero",
        target_kind: "pattern",
        target_id: "point-cloud-background",
        props: [],
        slot_fills: [
          {
            slot: "point_cloud",
            fills: [{ target_kind: "asset", target_id: assetId }]
          }
        ]
      }
    ],
    token_overrides: { enabled: false, values: [] }
  };
}

function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
