import { describe, expect, it } from "vitest";

import { flattenFigmaNode, normalizeNodeId, parseFigmaRef } from "../../scripts/figma-fetch";

describe("figma-fetch", () => {
  it("parses a Figma design URL into fileKey + node id", () => {
    expect(parseFigmaRef("https://www.figma.com/design/ABC123/Cockpit?node-id=42-7")).toEqual({ fileKey: "ABC123", nodeId: "42:7" });
  });

  it("accepts a raw fileKey + node id pair and normalizes the id", () => {
    expect(parseFigmaRef("ABC123", "42-7")).toEqual({ fileKey: "ABC123", nodeId: "42:7" });
    expect(normalizeNodeId("42:7")).toBe("42:7");
  });

  it("flattens a node tree to layout + text, dropping vectors and positions", () => {
    const raw = {
      id: "42:7", name: "RunCard", type: "FRAME", layoutMode: "HORIZONTAL", itemSpacing: 8,
      paddingTop: 9, paddingRight: 10, paddingBottom: 9, paddingLeft: 10,
      primaryAxisAlignItems: "SPACE_BETWEEN", counterAxisAlignItems: "CENTER",
      absoluteBoundingBox: { x: 100, y: 200, width: 300, height: 40 },
      children: [
        { id: "42:8", name: "dot", type: "VECTOR", fills: [{ type: "SOLID" }] },
        { id: "42:9", name: "title", type: "TEXT", characters: "run_id" },
        { id: "42:10", name: "meta", type: "FRAME", layoutMode: "VERTICAL", itemSpacing: 2, children: [] },
      ],
    };
    const nodes = flattenFigmaNode(raw);
    expect(nodes).toEqual([
      { id: "42:7", role: "RunCard", layout: { direction: "row", gap: "8px", padding: "9px 10px 9px 10px", justify: "space_between", align: "center" } },
      { id: "42:9", role: "title", text: "run_id" },
      { id: "42:10", role: "meta", layout: { direction: "column", gap: "2px" } },
    ]);
    // no absolute positions / bounding boxes leak through
    expect(JSON.stringify(nodes)).not.toContain("absoluteBoundingBox");
  });
});
